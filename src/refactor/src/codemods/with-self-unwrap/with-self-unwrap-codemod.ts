import { Parser } from "@gmloop/parser";

import { applySourceTextEdits } from "../codemod-edit-utils.js";
import type { WithSelfUnwrapCodemodOptions, WithSelfUnwrapEdit, WithSelfUnwrapResult } from "./types.js";

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/**
 * Returns the start-of-line offset for the line that contains `offset`.
 * Returns 0 when `offset` is on the first line.
 */
function getLineStartOffset(sourceText: string, offset: number): number {
    return sourceText.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

/**
 * Unwrap any chain of ParenthesizedExpression wrappers and return the inner
 * expression node, or `null` when the input is not a recognizable AST node.
 */
function unwrapParentheses(node: unknown): Record<string, unknown> | null {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
        return null;
    }
    let current = node as Record<string, unknown>;
    while (current.type === "ParenthesizedExpression") {
        const inner = current.expression;
        if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
            return null;
        }
        current = inner as Record<string, unknown>;
    }
    return current;
}

/**
 * Returns true when `node` is a `WithStatement` whose test expression is
 * exactly the built-in `self` identifier (with any number of parentheses
 * removed).
 */
function isWithSelfNode(node: Record<string, unknown>): boolean {
    if (node.type !== "WithStatement") {
        return false;
    }
    const inner = unwrapParentheses(node.test);
    return inner !== null && inner.type === "Identifier" && inner.name === "self";
}

/**
 * Collect the outermost `with (self)` statement nodes in document order.
 *
 * Recursion stops at each `WithStatement` so that nested `with (self)` blocks
 * are not collected in the same pass.  Running the codemod again will handle
 * any deeper nesting, one layer at a time.
 */
function collectOutermostWithSelfNodes(root: unknown): ReadonlyArray<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];

    const visit = (node: unknown): void => {
        if (!node || typeof node !== "object") {
            return;
        }

        if (Array.isArray(node)) {
            for (const item of node) {
                visit(item);
            }
            return;
        }

        const record = node as Record<string, unknown>;

        if (isWithSelfNode(record)) {
            result.push(record);
            // Do not recurse into this node's body — nested with(self) blocks
            // are left for subsequent codemod passes to avoid overlapping edits.
            return;
        }

        for (const value of Object.values(record)) {
            visit(value);
        }
    };

    visit(root);
    return result;
}

// ---------------------------------------------------------------------------
// Safety checks
// ---------------------------------------------------------------------------

/**
 * Returns true when `node` (or any descendant) is an `Identifier` whose
 * `name` field equals `identifierName`.
 *
 * Used to detect `other` references inside a `with (self)` body: removing the
 * `with` wrapper changes the binding of `other`, so those blocks are skipped.
 */
function subtreeContainsIdentifierNamed(node: unknown, identifierName: string): boolean {
    if (!node || typeof node !== "object") {
        return false;
    }

    if (Array.isArray(node)) {
        return node.some((child) => subtreeContainsIdentifierNamed(child, identifierName));
    }

    const record = node as Record<string, unknown>;

    if (record.type === "Identifier" && record.name === identifierName) {
        return true;
    }

    for (const value of Object.values(record)) {
        if (value && typeof value === "object" && subtreeContainsIdentifierNamed(value, identifierName)) {
            return true;
        }
    }

    return false;
}

/**
 * Returns true when `node` (or any descendant) contains a `BreakStatement` or
 * `ContinueStatement` that is **not** guarded by an inner loop, switch, or
 * `with` construct.
 *
 * Inside `with (self)`, `break`/`continue` target the `with` loop.  Removing
 * the `with` wrapper would silently redirect them to any enclosing loop or
 * switch — a behaviour change that this codemod must avoid.
 *
 * Recursion stops at loop/switch/with boundaries (they own the
 * `break`/`continue` within them).
 */
function subtreeContainsUnguardedBreakOrContinue(node: unknown): boolean {
    if (!node || typeof node !== "object") {
        return false;
    }

    if (Array.isArray(node)) {
        return node.some(subtreeContainsUnguardedBreakOrContinue);
    }

    const record = node as Record<string, unknown>;

    if (record.type === "BreakStatement" || record.type === "ContinueStatement") {
        return true;
    }

    // These node types are guarding boundaries: any break/continue inside
    // targets them, not the with(self) we are about to remove.
    if (
        record.type === "ForStatement" ||
        record.type === "WhileStatement" ||
        record.type === "DoUntilStatement" ||
        record.type === "RepeatStatement" ||
        record.type === "WithStatement" ||
        record.type === "SwitchStatement"
    ) {
        return false;
    }

    for (const value of Object.values(record)) {
        if (value && typeof value === "object" && subtreeContainsUnguardedBreakOrContinue(value)) {
            return true;
        }
    }

    return false;
}

// ---------------------------------------------------------------------------
// Indentation helpers
// ---------------------------------------------------------------------------

/**
 * Detect the extra indentation that body lines carry beyond `baseIndent`.
 *
 * Scans the first non-blank line in `bodyContent` and returns the portion of
 * its leading whitespace that extends beyond `baseIndent`.  Returns an empty
 * string when the body is empty or the first non-blank line does not carry
 * extra indentation.
 */
function detectExtraIndent(bodyContent: string, baseIndent: string): string {
    for (const line of bodyContent.split("\n")) {
        if (line.trim().length === 0) {
            continue;
        }

        const match = /^[ \t]*/u.exec(line);
        if (!match) {
            return "";
        }

        const lineIndent = match[0];
        if (lineIndent.length > baseIndent.length && lineIndent.startsWith(baseIndent)) {
            return lineIndent.slice(baseIndent.length);
        }

        return "";
    }

    return "";
}

/**
 * Remove a fixed leading `extraIndent` prefix from every line in `content`.
 *
 * Lines that do not start with `extraIndent` (e.g., blank lines) are left
 * unchanged.
 */
function dedentLines(content: string, extraIndent: string): string {
    if (!extraIndent) {
        return content;
    }

    return content
        .split("\n")
        .map((line) => (line.startsWith(extraIndent) ? line.slice(extraIndent.length) : line))
        .join("\n");
}

// ---------------------------------------------------------------------------
// Edit generation
// ---------------------------------------------------------------------------

/**
 * Attempt to build a source-text replacement for a single `with (self)` block.
 *
 * Returns `null` when the block cannot be safely unwrapped (e.g., the body
 * references `other`, contains unguarded `break`/`continue`, or the body is
 * not a block statement).
 */
function buildUnwrapEdit(sourceText: string, withNode: Record<string, unknown>): WithSelfUnwrapEdit | null {
    const withStart = typeof withNode.start === "number" ? withNode.start : null;
    if (withStart === null) {
        return null;
    }

    const body = withNode.body as Record<string, unknown> | null;
    if (!body) {
        return null;
    }

    // Only handle block-statement bodies; single-expression bodies are
    // left unchanged because computing their exact statement boundary
    // (including the trailing `;`) from a bare expression node is fragile.
    if (body.type !== "BlockStatement") {
        return null;
    }

    const bodyStart = typeof body.start === "number" ? body.start : null; // position of `{`
    const bodyEnd = typeof body.end === "number" ? body.end : null; // position of `}` (inclusive)
    if (bodyStart === null || bodyEnd === null) {
        return null;
    }

    // Safety: do not unwrap if the body uses `other` (its binding changes).
    if (subtreeContainsIdentifierNamed(body, "other")) {
        return null;
    }

    // Safety: do not unwrap if the body contains break/continue that currently
    // target the `with` loop iteration.
    if (subtreeContainsUnguardedBreakOrContinue(body)) {
        return null;
    }

    // -----------------------------------------------------------------------
    // Compute replacement region
    // -----------------------------------------------------------------------

    // Start of the line that contains the `with` keyword (includes leading
    // whitespace / indentation that we must preserve for body lines).
    const withLineStart = getLineStartOffset(sourceText, withStart);

    // Position of the first character after `{` and its trailing newline.
    // This marks the start of the body content we want to keep.
    let bodyContentStart = bodyStart + 1; // skip the opening `{`
    while (
        bodyContentStart < sourceText.length &&
        sourceText[bodyContentStart] !== "\n" &&
        sourceText[bodyContentStart] !== "\r"
    ) {
        bodyContentStart++;
    }
    if (bodyContentStart < sourceText.length && sourceText[bodyContentStart] === "\r") {
        bodyContentStart++;
    }
    if (bodyContentStart < sourceText.length && sourceText[bodyContentStart] === "\n") {
        bodyContentStart++;
    }

    // Start of the line that contains the closing `}`.
    const closingBraceLineStart = getLineStartOffset(sourceText, bodyEnd);

    // Position immediately after the closing `}` line (including its newline).
    let afterClosingBraceLine = bodyEnd + 1; // skip the closing `}`
    while (
        afterClosingBraceLine < sourceText.length &&
        sourceText[afterClosingBraceLine] !== "\n" &&
        sourceText[afterClosingBraceLine] !== "\r"
    ) {
        afterClosingBraceLine++;
    }
    if (afterClosingBraceLine < sourceText.length && sourceText[afterClosingBraceLine] === "\r") {
        afterClosingBraceLine++;
    }
    if (afterClosingBraceLine < sourceText.length && sourceText[afterClosingBraceLine] === "\n") {
        afterClosingBraceLine++;
    }

    // -----------------------------------------------------------------------
    // Handle special cases: empty block and same-line block
    // -----------------------------------------------------------------------

    if (bodyContentStart >= closingBraceLineStart) {
        // The opening `{` and closing `}` are on the same line (or there is no
        // body content between them).
        const inlineBodyText = sourceText.slice(bodyStart + 1, bodyEnd).trim();
        if (inlineBodyText.length === 0) {
            // Empty block — delete the entire `with (self) {}` statement.
            return Object.freeze({
                start: withLineStart,
                end: afterClosingBraceLine,
                text: ""
            });
        }

        // Non-empty single-line block — skip (see comment above for reasoning).
        return null;
    }

    // -----------------------------------------------------------------------
    // Build dedented replacement text for multiline blocks
    // -----------------------------------------------------------------------

    const baseIndent = sourceText.slice(withLineStart, withStart);
    const bodyContent = sourceText.slice(bodyContentStart, closingBraceLineStart);
    const extraIndent = detectExtraIndent(bodyContent, baseIndent);
    const dedentedBody = dedentLines(bodyContent, extraIndent);

    return Object.freeze({
        start: withLineStart,
        end: afterClosingBraceLine,
        text: dedentedBody
    });
}

// ---------------------------------------------------------------------------
// Edit application
// ---------------------------------------------------------------------------

// applySourceTextEdits is provided by codemod-edit-utils.ts

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const EMPTY_RESULT_EDITS: ReadonlyArray<WithSelfUnwrapEdit> = Object.freeze([]);

function buildNoChangeResult(sourceText: string): WithSelfUnwrapResult {
    return Object.freeze({
        changed: false,
        outputText: sourceText,
        appliedEdits: EMPTY_RESULT_EDITS,
        unwrappedCount: 0
    });
}

/**
 * Applies the with-self-unwrap codemod to a single GML source file.
 *
 * The codemod finds every `with (self) { ... }` block and replaces it with
 * the block's body statements inlined at the same indentation level as the
 * original `with` statement.  Blocks that reference `other` or contain
 * unguarded `break`/`continue` statements are left unchanged to preserve
 * correctness.
 *
 * @param sourceText - The GML source text to transform.
 * @param _options   - Reserved for future configuration; currently ignored.
 * @returns A {@link WithSelfUnwrapResult} describing whether any edits were
 *          applied and providing the transformed source text.
 */
export function applyWithSelfUnwrapCodemod(
    sourceText: string,
    _options: WithSelfUnwrapCodemodOptions = {}
): WithSelfUnwrapResult {
    if (typeof sourceText !== "string" || sourceText.length === 0) {
        return buildNoChangeResult(sourceText);
    }

    // Fast-path: skip parsing when the source cannot contain a `with` statement.
    if (!sourceText.includes("with")) {
        return buildNoChangeResult(sourceText);
    }

    let ast: unknown;
    try {
        ast = Parser.GMLParser.parse(sourceText);
    } catch {
        return buildNoChangeResult(sourceText);
    }

    const withSelfNodes = collectOutermostWithSelfNodes(ast);
    if (withSelfNodes.length === 0) {
        return buildNoChangeResult(sourceText);
    }

    const edits: Array<WithSelfUnwrapEdit> = [];

    for (const withNode of withSelfNodes) {
        const edit = buildUnwrapEdit(sourceText, withNode);
        if (edit !== null) {
            edits.push(edit);
        }
    }

    if (edits.length === 0) {
        return buildNoChangeResult(sourceText);
    }

    const outputText = applySourceTextEdits(sourceText, edits);

    return Object.freeze({
        changed: outputText !== sourceText,
        outputText,
        appliedEdits: Object.freeze(edits),
        unwrappedCount: edits.length
    });
}
