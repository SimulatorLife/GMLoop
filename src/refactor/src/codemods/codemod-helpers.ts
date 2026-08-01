/**
 * Shared helpers for the codemod layer.
 *
 * This module contains pure utility functions that are duplicated across
 * multiple codemods.  Keeping them here allows each codemod to stay focused
 * on its own transformation logic rather than re-implementing common
 * infrastructure.
 *
 * Directive-line and GML text scanning helpers used to live here too, but
 * they have been promoted to `@gmloop/core` (see
 * `Core.isDirectiveLineAtIndex`, `Core.findNextLineStart`, and the
 * `argument-separator-detection` module) so the `lint` workspace can share
 * them without violating the `refactor → lint` boundary.
 */

import { Core } from "@gmloop/core";

/**
 * Minimal text edit shape used by codemods (uses `text` instead of `newText`,
 * matching the edit types defined in each codemod's own `types.ts`).
 */
export type CodemodSourceTextEdit = Readonly<{ start: number; end: number; text: string }>;

/**
 * Minimal AST record used by codemods that walk the parser output directly.
 * Codemods type nodes narrowly per transformation; this alias only enforces
 * the structural shape that the helpers below rely on.
 */
export type CodemodAstRecord = Record<string, unknown>;

/**
 * Narrow unknown values to AST record-like objects that can be safely read
 * for codemod transformations.
 */
export function isAstRecord(value: unknown): value is CodemodAstRecord {
    return Core.isObjectLike(value);
}

/**
 * Return true when `node` is a `CallExpression` whose callee is an identifier
 * matching `functionName`. The comparison is case-insensitive to mirror
 * GameMaker's identifier rules, so callers always pass the lowercase form.
 */
export function isNamedCall(node: unknown, functionName: string): node is CodemodAstRecord {
    if (!isAstRecord(node) || node.type !== "CallExpression") {
        return false;
    }

    const object = node.object;
    return (
        isAstRecord(object) &&
        object.type === "Identifier" &&
        typeof object.name === "string" &&
        object.name.toLowerCase() === functionName.toLowerCase()
    );
}

/**
 * Strip leading `ParenthesizedExpression` nodes from `node` and return the
 * innermost expression. Returns `null` when the input is not an AST record.
 */
export function unwrapParenthesizedExpression(node: unknown): CodemodAstRecord | null {
    let current = isAstRecord(node) ? node : null;
    while (current?.type === "ParenthesizedExpression") {
        current = isAstRecord(current.expression) ? current.expression : null;
    }
    return current;
}

/**
 * Read the trimmed source text for `node` using its recorded start/end
 * offsets. Returns `null` when either offset is unavailable, letting callers
 * treat synthesized or detached AST fragments as missing rather than throwing.
 */
export function getNodeSource(sourceText: string, node: CodemodAstRecord): string | null {
    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
    return typeof start === "number" && typeof end === "number" ? sourceText.slice(start, end).trim() : null;
}

const BUILTIN_NAME_MACRO_PATTERN = /^\s*#macro\s+([A-Za-z_][A-Za-z0-9_]*)\b/gmu;

/**
 * Detect whether `sourceText` declares any `#macro` whose name matches one of
 * the provided built-in identifier names (case-insensitive). Codemods use this
 * guard to avoid rewriting call sites that may resolve to a user-defined
 * alias instead of the built-in symbol.
 *
 * @param sourceText - Source text to scan for `#macro` directives.
 * @param names - Lower-cased built-in identifier names to detect.
 * @returns True when a matching `#macro` declaration is present.
 */
export function hasBuiltinNameMacro(sourceText: string, names: ReadonlySet<string>): boolean {
    return [...sourceText.matchAll(BUILTIN_NAME_MACRO_PATTERN)].some((match) => {
        const macroName = match[1]?.toLowerCase();
        return macroName !== undefined && names.has(macroName);
    });
}

/**
 * Detect whether `programNode` (or any descendant) declares a function,
 * constructor, or variable whose identifier matches one of the provided
 * built-in names (case-insensitive). Codemods use this guard to avoid
 * rewriting call sites that may resolve to a user-defined symbol.
 *
 * Function parameters are also inspected because GML allows binding built-in
 * names to parameters; the `parent` link is intentionally skipped so the
 * traversal cannot revisit ancestors.
 *
 * @param programNode - Program node (or any AST fragment) to traverse.
 * @param names - Lower-cased built-in identifier names to detect.
 * @returns True when a matching declaration is present anywhere in the subtree.
 */
export function containsBuiltinNameDeclaration(programNode: unknown, names: ReadonlySet<string>): boolean {
    if (Array.isArray(programNode)) {
        return programNode.some((entry) => containsBuiltinNameDeclaration(entry, names));
    }
    if (!isAstRecord(programNode)) {
        return false;
    }

    const node = programNode;

    if (node.type === "FunctionDeclaration" || node.type === "ConstructorDeclaration") {
        if (typeof node.id === "string" && names.has(node.id.toLowerCase())) {
            return true;
        }

        if (
            Array.isArray(node.params) &&
            node.params.some((parameter) => {
                const identifierName = Core.getIdentifierName(parameter);
                return identifierName !== null && names.has(identifierName.toLowerCase());
            })
        ) {
            return true;
        }
    }

    if (node.type === "VariableDeclarator") {
        const identifierName = Core.getIdentifierName(node.id);
        return identifierName !== null && names.has(identifierName.toLowerCase());
    }

    for (const [key, child] of Object.entries(node)) {
        if (key !== "parent" && containsBuiltinNameDeclaration(child, names)) {
            return true;
        }
    }
    return false;
}

/**
 * Shape every codemod result conforms to. Each codemod's own `types.ts` file
 * aliases this shape so its result is structurally identical.
 */
export type CodemodResultShape = Readonly<{
    changed: boolean;
    outputText: string;
    appliedEdits: ReadonlyArray<CodemodSourceTextEdit>;
}>;

/**
 * Build a frozen unchanged-result that reports the source text was not
 * transformed. Codemods return this when their preconditions fail (parse
 * error, pre-rewritten guard, no candidate edits).
 *
 * @param sourceText - Source text that was left untouched.
 * @returns Frozen unchanged-result typed as the caller-specified codemod result.
 */
export function createUnchangedCodemodResult<T extends CodemodResultShape>(sourceText: string): T {
    return Object.freeze({
        changed: false,
        outputText: sourceText,
        appliedEdits: Object.freeze([])
    }) as T;
}

/**
 * Build a frozen codemod result from collected edits. When the edit list is
 * empty, returns an unchanged-result so callers don't need to special-case the
 * empty-edits path before calling this helper.
 *
 * @param sourceText - Source text the codemod started with.
 * @param appliedEdits - Non-overlapping source edits the codemod produced.
 * @returns Frozen codemod result typed as the caller-specified codemod result.
 */
export function createCodemodResultFromEdits<T extends CodemodResultShape>(
    sourceText: string,
    appliedEdits: ReadonlyArray<CodemodSourceTextEdit>
): T {
    if (appliedEdits.length === 0) {
        return createUnchangedCodemodResult(sourceText);
    }

    const outputText = applySourceTextEdits(sourceText, appliedEdits);
    return Object.freeze({
        changed: outputText !== sourceText,
        outputText,
        appliedEdits: Object.freeze(appliedEdits)
    }) as T;
}

function assertSourceTextEditRange(sourceText: string, edit: CodemodSourceTextEdit): void {
    if (!Number.isInteger(edit.start) || edit.start < 0) {
        throw new RangeError(`Codemod edit start offset must be a non-negative integer: ${edit.start}`);
    }

    if (!Number.isInteger(edit.end) || edit.end < 0) {
        throw new RangeError(`Codemod edit end offset must be a non-negative integer: ${edit.end}`);
    }

    if (edit.end < edit.start) {
        throw new RangeError(`Codemod edit end offset ${edit.end} must not be before start offset ${edit.start}`);
    }

    if (edit.end > sourceText.length) {
        throw new RangeError(`Codemod edit range ${edit.start}-${edit.end} exceeds source length ${sourceText.length}`);
    }
}

/**
 * Apply a list of non-overlapping edits to `sourceText` in a single forward pass.
 *
 * Edits may arrive in any order. The helper validates every range, sorts edits
 * by start position, and rejects overlaps before producing output so a codemod
 * bug cannot silently corrupt source text during project-wide transformations.
 *
 * @param sourceText - Source text to transform.
 * @param edits - Non-overlapping source edits to apply.
 * @returns Source text with all edits applied.
 * @throws RangeError when an edit has an invalid range or overlaps a previous edit.
 */
export function applySourceTextEdits<T extends CodemodSourceTextEdit>(
    sourceText: string,
    edits: ReadonlyArray<T>
): string {
    if (edits.length === 0) {
        return sourceText;
    }

    const sorted = [...edits].toSorted((left, right) => left.start - right.start || left.end - right.end);
    let result = "";
    let cursor = 0;

    for (const edit of sorted) {
        assertSourceTextEditRange(sourceText, edit);

        if (edit.start < cursor) {
            throw new RangeError(`Codemod edits overlap at offsets ${edit.start}-${edit.end}`);
        }

        result += sourceText.slice(cursor, edit.start);
        result += edit.text;
        cursor = edit.end;
    }

    result += sourceText.slice(cursor);
    return result;
}
