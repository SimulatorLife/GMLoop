import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "./rule-definition.js";

const { clamp, isObjectLike } = Core;

export function getLineStartOffset(sourceText: string, offset: number): number {
    return sourceText.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

export function getLineIndentationAtOffset(sourceText: string, offset: number): string {
    const lineStart = getLineStartOffset(sourceText, offset);
    let cursor = lineStart;
    while (cursor < sourceText.length && (sourceText[cursor] === " " || sourceText[cursor] === "\t")) {
        cursor += 1;
    }

    return sourceText.slice(lineStart, cursor);
}

/**
 * Finds the nearest non-whitespace character before a source offset.
 *
 * This helper supports call sites that need to inspect prefix tokens (for
 * example, detecting `else if` chains) while optionally treating line breaks as
 * hard boundaries.
 *
 * @param sourceText Full source text to scan.
 * @param startIndex Offset whose preceding text should be inspected.
 * @param stopAtLineBreak Whether `\n`/`\r` should terminate scanning.
 * @returns Index of the nearest non-whitespace character before `startIndex`.
 */
export function findPreviousNonWhitespaceIndex(
    sourceText: string,
    startIndex: number,
    stopAtLineBreak: boolean
): number | null {
    let cursor = startIndex - 1;

    while (cursor >= 0) {
        const character = sourceText[cursor];
        if (stopAtLineBreak && (character === "\n" || character === "\r")) {
            return null;
        }

        if (/\s/u.test(character)) {
            cursor -= 1;
            continue;
        }

        return cursor;
    }

    return null;
}

/**
 * Finds the nearest non-whitespace character before a source offset.
 *
 * @param sourceText Full source text to scan.
 * @param startIndex Offset whose preceding text should be inspected.
 * @param stopAtLineBreak Whether `\n`/`\r` should terminate scanning.
 * @returns The nearest non-whitespace character before `startIndex`, or `null`.
 */
export function findPreviousNonWhitespaceCharacter(
    sourceText: string,
    startIndex: number,
    stopAtLineBreak: boolean
): string | null {
    const previousIndex = findPreviousNonWhitespaceIndex(sourceText, startIndex, stopAtLineBreak);
    if (previousIndex === null) {
        return null;
    }

    return sourceText[previousIndex];
}

export type AstNodeRecord = Record<string, unknown>;

export function isAstNodeRecord(value: unknown): value is AstNodeRecord {
    return isObjectLike(value) && !Array.isArray(value);
}

export type AstNodeWithType = AstNodeRecord & Readonly<{ type: string }>;

export function isAstNodeWithType(value: unknown): value is AstNodeWithType {
    return isAstNodeRecord(value) && typeof value.type === "string";
}

/**
 * Determines whether a value is an assignment-expression node whose operator
 * satisfies the provided guard.
 *
 * @param value Candidate node-like value.
 * @param operatorGuard Predicate that validates the `operator` field.
 * @returns Whether the candidate is a typed assignment-expression record.
 */
export function isAssignmentExpressionNodeWithOperator<TOperator extends string>(
    value: unknown,
    operatorGuard: (operator: unknown) => operator is TOperator
): value is AstNodeRecord &
    Readonly<{
        type: "AssignmentExpression";
        operator: TOperator;
        left: unknown;
        right: unknown;
    }> {
    return (
        isAstNodeRecord(value) &&
        value.type === "AssignmentExpression" &&
        operatorGuard(value.operator) &&
        Object.hasOwn(value, "left") &&
        Object.hasOwn(value, "right")
    );
}

/**
 * Structural type for identifier nodes in lint rule contexts.
 *
 * Matches nodes with `type: "Identifier"` and a string `name` property.
 */
export type IdentifierNode = AstNodeRecord & Readonly<{ type: "Identifier"; name: string }>;

/**
 * Type guard for identifier nodes.
 *
 * Matches any node-like value where `type` is `"Identifier"` and `name` is a
 * string. This guard is shared across lint rules that inspect identifiers for
 * rename, compound-assignment, or invariant-expression analysis.
 *
 * @param node Candidate value to inspect.
 * @returns `true` when `node` is an identifier with a string `name`.
 */
export function isIdentifierNode(node: unknown): node is IdentifierNode {
    return isAstNodeRecord(node) && node.type === "Identifier" && typeof node.name === "string";
}

/**
 * Structural type for member-index expression nodes in lint rule contexts.
 *
 * Matches nodes with `type: "MemberIndexExpression"` and optional
 * `object`, `property`, and `accessor` properties.
 */
export type MemberIndexExpressionNode = AstNodeRecord &
    Readonly<{
        type: "MemberIndexExpression";
        object?: unknown;
        property?: unknown;
        accessor?: unknown;
    }>;

/**
 * Type guard for member-index expression nodes.
 *
 * Matches any node-like value where `type` is `"MemberIndexExpression"`.
 * Used by lint rules that normalise data-structure accessors or rewrite
 * member-index patterns (e.g. `array[| i]` → `array[i]`).
 *
 * @param node Candidate value to inspect.
 * @returns `true` when `node` is a member-index expression.
 */
export function isMemberIndexExpressionNode(node: unknown): node is MemberIndexExpressionNode {
    return isAstNodeRecord(node) && node.type === "MemberIndexExpression";
}

/**
 * Structural type for variable declarator nodes in lint rule contexts.
 *
 * Matches nodes with `type: "VariableDeclarator"` and optional `id` and
 * `init` properties.
 */
export type VariableDeclaratorNode = AstNodeRecord &
    Readonly<{
        type: "VariableDeclarator";
        id?: unknown;
        init?: unknown;
    }>;

/**
 * Type guard for variable declarator nodes.
 *
 * Matches any node-like value where `type` is `"VariableDeclarator"`.
 * Used by lint rules and shared helpers that inspect variable declarations
 * for direct-return, data-structure-accessor, or assignment analysis.
 *
 * @param node Candidate value to inspect.
 * @returns `true` when `node` is a variable declarator.
 */
export function isVariableDeclaratorNode(node: unknown): node is VariableDeclaratorNode {
    return isAstNodeRecord(node) && node.type === "VariableDeclarator";
}

/**
 * Structural type for assignment expression nodes in lint rule contexts.
 *
 * For operator-specific narrowing, use
 * {@link isAssignmentExpressionNodeWithOperator} instead.
 */
export type AssignmentExpressionNode = AstNodeRecord &
    Readonly<{
        type: "AssignmentExpression";
        operator?: unknown;
        left?: unknown;
        right?: unknown;
    }>;

/**
 * Type guard for assignment expression nodes (any operator).
 *
 * Matches any node-like value where `type` is `"AssignmentExpression"`,
 * regardless of the specific operator. For narrowing to a particular
 * operator, use {@link isAssignmentExpressionNodeWithOperator}.
 *
 * @param node Candidate value to inspect.
 * @returns `true` when `node` is an assignment expression.
 */
export function isAssignmentExpressionNode(node: unknown): node is AssignmentExpressionNode {
    return isAstNodeRecord(node) && node.type === "AssignmentExpression";
}

export function isCommentOnlyLine(line: string): boolean {
    // returns true if the line consists solely of whitespace and/or comment tokens
    // (single-line comments or block comments). This is a simple heuristic used by
    // some lint rules to identify separation barriers between logic groups.
    const trimmed = line.trim();
    if (trimmed.length === 0) {
        return true;
    }
    // startsWith is safe since we already trimmed whitespace
    return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.endsWith("*/");
}

export type AstNodeParentVisitContext = Readonly<{
    node: AstNodeWithType;
    parent: AstNodeWithType | null;
    parentKey: string | null;
    parentIndex: number | null;
}>;

export interface SourceTextEdit {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

type RuleMetaOverrides = Readonly<{
    fixable?: "code" | "whitespace" | null;
    messageText?: string;
    includeFixableDefault?: boolean;
}>;

const DEFAULT_EMPTY_GML_RULE_SCHEMA: ReadonlyArray<unknown> = Object.freeze([
    { type: "object", additionalProperties: false, properties: {} }
]);

export function createMeta(definition: GmlRuleDefinition, overrides: RuleMetaOverrides = {}): Rule.RuleMetaData {
    const docs = {
        description: `Rule for ${definition.messageId}.`,
        recommended: false,
        requiresProjectContext: false
    };

    const messages: Record<string, string> = {
        [definition.messageId]: overrides.messageText ?? `${definition.messageId} diagnostic.`,
        unsafeFix: "[unsafe-fix:SEMANTIC_AMBIGUITY] Unsafe fix omitted."
    };

    const meta: Rule.RuleMetaData = {
        type: "suggestion",
        docs: Object.freeze(docs),
        schema: definition.schema ?? DEFAULT_EMPTY_GML_RULE_SCHEMA,
        messages: Object.freeze(messages)
    };

    const includeFixableDefault = overrides.includeFixableDefault ?? true;

    if (overrides.fixable === undefined) {
        if (!includeFixableDefault) {
            return Object.freeze(meta);
        }
        meta.fixable = "code";
    } else if (overrides.fixable !== null) {
        meta.fixable = overrides.fixable;
    }

    return Object.freeze(meta);
}

/**
 * Returns `true` when a node sits in a statement slot rather than an
 * expression-only position such as a `for` header or call argument list.
 *
 * @param parentKey Property name linking the node to its parent.
 * @returns Whether the parent relationship is statement-shaped.
 */
export function isStandaloneStatementParentKey(parentKey: string | null): boolean {
    return parentKey === "body" || parentKey === "consequent" || parentKey === "alternate";
}

/**
 * Detects comment token markers in a text fragment.
 *
 * Used by lint rule fixers to guard against rewrites that would inadvertently
 * remove authored comments embedded within the replaced text.
 *
 * @param text Text fragment to inspect.
 * @returns Whether the text contains any line or block comment markers.
 */
export function containsCommentToken(text: string): boolean {
    return text.includes("//") || text.includes("/*") || text.includes("*/");
}

/**
 * Detects comment tokens inside a source span so fixers can skip rewrites that
 * would risk deleting authored comments embedded in the replaced text.
 *
 * @param sourceText Full file text.
 * @param start Inclusive start offset.
 * @param end Exclusive end offset.
 * @returns Whether the span contains line or block comment markers.
 */
export function sourceRangeContainsCommentToken(sourceText: string, start: number, end: number): boolean {
    return containsCommentToken(sourceText.slice(start, end));
}

export type CommentTokenRangeIndex = Readonly<{
    prefixCounts: Uint32Array;
    sourceLength: number;
}>;

function isCommentTokenBoundary(sourceText: string, index: number): boolean {
    const character = sourceText[index];
    const nextCharacter = sourceText[index + 1];
    if (character === "/" && (nextCharacter === "/" || nextCharacter === "*")) {
        return true;
    }

    return character === "*" && nextCharacter === "/";
}

/**
 * Builds a prefix index for comment-token boundaries so repeated span checks
 * can avoid rescanning or slicing the original source text.
 *
 * @param sourceText Full file text.
 * @returns A compact prefix-count index for line-comment, block-open, and block-close markers.
 */
export function createCommentTokenRangeIndex(sourceText: string): CommentTokenRangeIndex {
    const sourceLength = sourceText.length;
    const prefixCounts = new Uint32Array(sourceLength + 1);

    for (let index = 0; index < sourceLength; index += 1) {
        prefixCounts[index + 1] = prefixCounts[index];
        if (index < sourceLength - 1 && isCommentTokenBoundary(sourceText, index)) {
            prefixCounts[index + 1] += 1;
        }
    }

    return {
        prefixCounts,
        sourceLength
    };
}

/**
 * Checks whether a source span contains any raw comment-token markers using a
 * precomputed prefix index.
 *
 * @param commentTokenRangeIndex Prefix-count index created from the file text.
 * @param start Inclusive start offset.
 * @param end Exclusive end offset.
 * @returns Whether the span includes line-comment or block-comment markers.
 */
export function rangeContainsCommentToken(
    commentTokenRangeIndex: CommentTokenRangeIndex,
    start: number,
    end: number
): boolean {
    if (end - start < 2) {
        return false;
    }

    const clampedStart = clamp(start, 0, commentTokenRangeIndex.sourceLength);
    const clampedEndExclusive = clamp(end - 1, 0, commentTokenRangeIndex.sourceLength);
    if (clampedEndExclusive <= clampedStart) {
        return false;
    }

    return commentTokenRangeIndex.prefixCounts[clampedEndExclusive] > commentTokenRangeIndex.prefixCounts[clampedStart];
}

/**
 * Reads program text once, applies a deterministic rewrite, and reports the
 * resulting full-text fix when the rewrite changes output.
 */
export function reportProgramTextRewrite(
    context: Rule.RuleContext,
    definition: GmlRuleDefinition,
    rewrite: (sourceText: string) => string
): void {
    const sourceText = context.sourceCode.text;
    const rewrittenText = rewrite(sourceText);
    reportFullTextRewrite(context, definition.messageId, sourceText, rewrittenText);
}

export function walkAstNodesWithParent(root: unknown, visit: (context: AstNodeParentVisitContext) => void): void {
    const pending: Array<AstNodeParentVisitContext> = [];
    if (isAstNodeWithType(root)) {
        pending.push({
            node: root,
            parent: null,
            parentKey: null,
            parentIndex: null
        });
    }

    const seen = new WeakSet<object>();
    while (pending.length > 0) {
        const current = pending.pop();
        if (!current) {
            continue;
        }

        const { node } = current;
        if (seen.has(node)) {
            continue;
        }

        seen.add(node);
        visit(current);

        for (const key of Object.keys(node)) {
            if (key === "parent") {
                continue;
            }

            const value = node[key];
            if (Array.isArray(value)) {
                for (let index = value.length - 1; index >= 0; index -= 1) {
                    const childNode = value[index];
                    if (!isAstNodeWithType(childNode)) {
                        continue;
                    }

                    pending.push({
                        node: childNode,
                        parent: node,
                        parentKey: key,
                        parentIndex: index
                    });
                }
                continue;
            }

            if (!isAstNodeWithType(value)) {
                continue;
            }

            pending.push({
                node: value,
                parent: node,
                parentKey: key,
                parentIndex: null
            });
        }
    }
}

function walkAstNodesUntil(root: unknown, visit: (node: object) => boolean): void {
    if (!root || typeof root !== "object") {
        return;
    }

    const visited = new WeakSet<object>();
    const stack: unknown[] = [root];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== "object") {
            continue;
        }

        if (Array.isArray(current)) {
            for (let index = current.length - 1; index >= 0; index -= 1) {
                stack.push(current[index]);
            }
            continue;
        }

        if (visited.has(current)) {
            continue;
        }

        visited.add(current);
        if (visit(current)) {
            return;
        }

        for (const key of Object.keys(current)) {
            if (key === "parent") {
                continue;
            }

            const value = current[key];
            if (!value || typeof value !== "object") {
                continue;
            }

            stack.push(value);
        }
    }
}

export function walkAstNodes(root: unknown, visit: (node: any) => void) {
    walkAstNodesUntil(root, (node) => {
        visit(node);
        return false;
    });
}

/**
 * Performs a depth-first search over an AST rooted at `root`, returning the
 * first non-array node for which `predicate` returns `true`, or `null` if no
 * match is found.
 *
 * This helper consolidates the boilerplate DFS traversal that was previously
 * duplicated across several near-identical `find*` functions (e.g.
 * `findAssignmentExpressionForRight`, `findVariableDeclaratorForInit`,
 * `findVariableDeclarationByName`) in the math transform helpers. Each caller
 * only needs to supply the match condition; the traversal mechanics are handled
 * here once.
 *
 * Traversal notes:
 * - `parent` keys are skipped to avoid re-visiting ancestors.
 * - Cycles are guarded with a `WeakSet`.
 * - Arrays are expanded in-place; elements are visited in source order.
 */
export function findFirstAstNodeBy(root: unknown, predicate: (node: any) => boolean): AstNodeRecord | null {
    let matchedNode: AstNodeRecord | null = null;
    walkAstNodesUntil(root, (node) => {
        if (!isAstNodeRecord(node)) {
            return false;
        }

        if (!predicate(node)) {
            return false;
        }

        matchedNode = node;
        return true;
    });

    return matchedNode;
}

export function findFirstChangedCharacterOffset(originalText: string, rewrittenText: string): number {
    const minLength = Math.min(originalText.length, rewrittenText.length);
    for (let index = 0; index < minLength; index += 1) {
        if (originalText[index] !== rewrittenText[index]) {
            return index;
        }
    }

    if (originalText.length !== rewrittenText.length) {
        return minLength;
    }

    return 0;
}

export function reportFullTextRewrite(
    context: Rule.RuleContext,
    messageId: string,
    originalText: string,
    rewrittenText: string
): void {
    if (rewrittenText === originalText) {
        return;
    }

    const firstChangedOffset = findFirstChangedCharacterOffset(originalText, rewrittenText);
    const loc = resolveLocFromIndex(context, originalText, firstChangedOffset);

    context.report({
        loc,
        messageId,
        fix: (fixer) => fixer.replaceTextRange([0, originalText.length], rewrittenText)
    });
}

function resolveLineColumnFromOffset(sourceText: string, offset: number): { line: number; column: number } {
    const clampedOffset = clamp(offset, 0, sourceText.length);
    let line = 1;
    let lastLineStart = 0;
    for (let index = 0; index < clampedOffset; index += 1) {
        if (sourceText[index] === "\n") {
            line += 1;
            lastLineStart = index + 1;
        }
    }

    return {
        line,
        column: clampedOffset - lastLineStart
    };
}

type SourceCodeWithOptionalLocator = Rule.RuleContext["sourceCode"] & {
    getLocFromIndex?: (offset: number) => { line: number; column: number } | undefined;
};

/**
 * Resolve a source-text offset to a `{ line, column }` location, preferring
 * the ESLint source-code `getLocFromIndex` API when available and falling back
 * to a manual line-scan when it is absent. The index is clamped to `[0,
 * sourceText.length]` before any look-up so out-of-bounds offsets never crash.
 *
 * This consolidates the identical patterns that previously existed in
 * `resolveReportLoc` (feather rules) and `resolveSafeLocFromIndex` (GML rules)
 * into a single authoritative helper.
 *
 * @param {Rule.RuleContext} context ESLint rule context whose `sourceCode` may
 *     expose `getLocFromIndex`.
 * @param {string} sourceText Full source text corresponding to `index`.
 * @param {number} index Character offset to resolve.
 * @returns {{ line: number; column: number }} 1-based line and 0-based column.
 */
export function resolveLocFromIndex(
    context: Rule.RuleContext,
    sourceText: string,
    index: number
): { line: number; column: number } {
    const clampedIndex = clamp(index, 0, sourceText.length);
    const locator = context.sourceCode as SourceCodeWithOptionalLocator;
    const located = typeof locator.getLocFromIndex === "function" ? locator.getLocFromIndex(clampedIndex) : undefined;

    if (
        located &&
        typeof located.line === "number" &&
        typeof located.column === "number" &&
        Number.isFinite(located.line) &&
        Number.isFinite(located.column)
    ) {
        return located;
    }

    return resolveLineColumnFromOffset(sourceText, clampedIndex);
}

export function applySourceTextEdits(sourceText: string, edits: ReadonlyArray<SourceTextEdit>): string {
    if (edits.length === 0) {
        return sourceText;
    }

    const ordered = [...edits].toSorted((left, right) => right.start - left.start);
    let rewritten = sourceText;
    for (const edit of ordered) {
        if (edit.start < 0 || edit.end < edit.start || edit.end > rewritten.length) {
            continue;
        }

        rewritten = `${rewritten.slice(0, edit.start)}${edit.text}${rewritten.slice(edit.end)}`;
    }

    return rewritten;
}

export function computeLineStartOffsets(sourceText: string): Array<number> {
    const offsets = [0];
    for (let index = 0; index < sourceText.length; index += 1) {
        const character = sourceText[index];
        if (character === "\r" && sourceText[index + 1] === "\n") {
            offsets.push(index + 2);
            index += 1;
            continue;
        }

        if (character === "\n") {
            offsets.push(index + 1);
        }
    }

    return offsets;
}

export function getLineIndexForOffset(lineStartOffsets: ReadonlyArray<number>, offset: number): number {
    if (lineStartOffsets.length === 0 || offset <= 0) {
        return 0;
    }

    let low = 0;
    let high = lineStartOffsets.length - 1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const lineStart = lineStartOffsets[middle] ?? 0;
        const nextLineStart =
            middle + 1 < lineStartOffsets.length
                ? (lineStartOffsets[middle + 1] ?? Number.MAX_SAFE_INTEGER)
                : Number.MAX_SAFE_INTEGER;
        if (offset < lineStart) {
            high = middle - 1;
            continue;
        }
        if (offset >= nextLineStart) {
            low = middle + 1;
            continue;
        }
        return middle;
    }

    return clamp(low, 0, lineStartOffsets.length - 1);
}

export function findMatchingBraceEndIndex(sourceText: string, openBraceIndex: number): number {
    let braceDepth = 0;
    for (let index = openBraceIndex; index < sourceText.length; index += 1) {
        const character = sourceText[index];
        if (character === "{") {
            braceDepth += 1;
            continue;
        }

        if (character !== "}") {
            continue;
        }

        braceDepth -= 1;
        if (braceDepth === 0) {
            return index + 1;
        }
    }

    return -1;
}

export function readLineIndentationBeforeOffset(sourceText: string, offset: number): string {
    const boundedOffset = clamp(offset, 0, sourceText.length);
    let lineStart = sourceText.lastIndexOf("\n", boundedOffset - 1);
    if (lineStart < 0) {
        lineStart = 0;
    } else {
        lineStart += 1;
    }

    const prefix = sourceText.slice(lineStart, boundedOffset);
    const indentationMatch = /^[\t ]*/u.exec(prefix);
    return indentationMatch?.[0] ?? "";
}

/**
 * Collect all identifier names reachable from any AST subtree or statement
 * list. Works for a single node, an array of statements, or any object-like
 * root since the underlying {@link walkAstNodes} expands arrays encountered
 * during traversal.
 */
export function collectIdentifierNamesInSubtree(root: unknown): ReadonlySet<string> {
    const identifierNames = new Set<string>();
    walkAstNodes(root, (node) => {
        if (isIdentifierNode(node)) {
            identifierNames.add(node.name);
        }
    });

    return identifierNames;
}

export function getVariableDeclarator(statement: unknown): AstNodeRecord | null {
    if (isVariableDeclaratorNode(statement)) {
        return statement;
    }

    if (!isAstNodeRecord(statement) || statement.type !== "VariableDeclaration") {
        return null;
    }

    const declarations = statement.declarations;
    if (Array.isArray(declarations) && declarations.length === 1) {
        const firstChild = declarations[0];
        if (isVariableDeclaratorNode(firstChild)) {
            return firstChild;
        }
    }

    return null;
}

/**
 * Read the first element of `context.options` as a plain object, returning an
 * empty frozen object when no valid object option is present.
 */
export function readObjectOption(context: Rule.RuleContext): Record<string, unknown> {
    if (!Array.isArray(context.options)) {
        return Object.freeze({});
    }

    const [rawOption] = context.options;
    if (!rawOption || typeof rawOption !== "object") {
        return Object.freeze({});
    }

    return rawOption as Record<string, unknown>;
}

/**
 * Determine whether the rule should report "unsafe" diagnostics based on the
 * `reportUnsafe` option (defaults to `true` when the option is absent).
 */
export function shouldReportUnsafe(context: Rule.RuleContext): boolean {
    const option = readObjectOption(context).reportUnsafe;
    return option === undefined ? true : option === true;
}
