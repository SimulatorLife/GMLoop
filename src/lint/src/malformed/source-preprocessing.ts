/**
 * Source text preprocessing utilities for malformed-code lint preprocessing.
 *
 * These functions perform source-level transformations before or during
 * linting malformed source in Phase A before AST-based rules run.
 * They operate on raw text and provide deterministic, single-file rewrites that
 * are safe to apply even when parsing fails.
 */

import { Core } from "@gmloop/core";

/**
 * Result of a comment fix operation, including the transformed text and a
 * mapping function to convert indices in the new text back to the original.
 */
export type CommentFixResult = {
    readonly sourceText: string;
    readonly indexMapper: (index: number) => number;
};

/**
 * Fixes malformed JSDoc-style comments in GML source code.
 *
 * Transforms comments that have incorrect spacing between the slashes and the
 * annotation marker (e.g., `/ @param` → `// @param`). Returns both the fixed
 * source text and an index mapper to maintain source location accuracy.
 *
 * @param sourceText - Raw GML source code potentially containing malformed comments
 * @returns Object containing the corrected source text and an index mapper
 */
export function fixMalformedComments(sourceText: string): CommentFixResult {
    if (!Core.isNonEmptyString(sourceText)) {
        return { sourceText, indexMapper: (i) => i };
    }

    const malformedCommentPattern = /^(\s*)\/\s+(@.+)$/gm;
    const changes: Array<{
        newStart: number;
        newLength: number;
        oldLength: number;
        diff: number;
    }> = [];
    let accumulatedDiff = 0;

    const newText = sourceText.replaceAll(
        malformedCommentPattern,
        (match, indentationPrefix, annotationText, index) => {
            const replacement = `${indentationPrefix}// ${annotationText}`;
            const diff = replacement.length - match.length;

            if (diff !== 0) {
                changes.push({
                    newStart: index + accumulatedDiff,
                    newLength: replacement.length,
                    oldLength: match.length,
                    diff
                });
                accumulatedDiff += diff;
            }
            return replacement;
        }
    );

    const indexMapper = (index: number): number => {
        let currentShift = 0;
        for (const change of changes) {
            if (index < change.newStart) {
                return index - currentShift;
            }
            if (index < change.newStart + change.newLength) {
                const oldStart = change.newStart - currentShift;
                const offset = index - change.newStart;
                if (offset < change.oldLength) {
                    return oldStart + offset;
                }
                return oldStart + change.oldLength;
            }
            currentShift += change.diff;
        }
        return index - currentShift;
    };

    return { sourceText: newText, indexMapper };
}

/**
 * Attempts to recover from missing closing braces by appending them to the source.
 *
 * When the parser fails due to missing closing braces, this function appends the
 * appropriate number of closing braces to allow parsing to continue. Returns null
 * if the error is not brace-related or if no braces need to be added.
 *
 * @param sourceText - Raw GML source code that failed to parse
 * @param error - The error object from the failed parse attempt
 * @returns The source text with appended braces, or null if recovery is not applicable
 */
export function recoverParseSourceFromMissingBrace(sourceText: string, error: unknown): string | null {
    if (!isMissingClosingBraceError(error)) {
        return null;
    }

    const appended = appendMissingClosingBraces(sourceText);

    return appended === sourceText ? null : appended;
}

/**
 * Determines whether an error indicates missing closing braces.
 */
function isMissingClosingBraceError(error: unknown): boolean {
    const message = extractErrorMessage(error);

    return Core.isNonEmptyString(message) && message.toLowerCase().includes("missing associated closing brace");
}

/**
 * Extracts a human-readable error message from unknown error input.
 */
function extractErrorMessage(error: unknown): string {
    if (!error) {
        return "";
    }

    if (Core.isNonEmptyString(error)) {
        return String(error);
    }

    if (typeof error === "object" && "message" in error) {
        const message = (error as { message: unknown }).message;
        return Core.isNonEmptyString(message) ? String(message) : "";
    }

    return "";
}

/**
 * Appends the necessary number of closing braces to balance unclosed opening braces.
 */
function appendMissingClosingBraces(sourceText: string): string {
    if (!Core.isNonEmptyString(sourceText)) {
        return sourceText;
    }

    const missingBraceCount = countUnclosedBraces(sourceText);

    if (missingBraceCount <= 0) {
        return sourceText;
    }

    let normalized = sourceText;

    if (!normalized.endsWith("\n")) {
        normalized += "\n";
    }

    const closingLines = Array.from({ length: missingBraceCount }, () => "}").join("\n");

    return `${normalized}${closingLines}`;
}

/**
 * Counts the number of unclosed opening braces in the source text.
 *
 * Skips braces that appear in comments or strings to avoid false positives.
 */
type BraceScannerState = {
    depth: number;
    inSingleLineComment: boolean;
    inBlockComment: boolean;
    stringDelimiter: string | null;
    isEscaped: boolean;
};

function countUnclosedBraces(sourceText: string): number {
    const state: BraceScannerState = {
        depth: 0,
        inSingleLineComment: false,
        inBlockComment: false,
        stringDelimiter: null,
        isEscaped: false
    };

    for (let index = 0; index < sourceText.length; index += 1) {
        index += consumeBraceScannerCharacter(state, sourceText[index], sourceText[index + 1]);
    }

    return state.depth;
}

function consumeBraceScannerCharacter(state: BraceScannerState, char: string, nextChar: string | undefined): number {
    if (state.stringDelimiter !== null) {
        return consumeStringCharacter(state, char);
    }

    if (state.inSingleLineComment) {
        if (char === "\n") {
            state.inSingleLineComment = false;
        }

        return 0;
    }

    if (state.inBlockComment) {
        if (char === "*" && nextChar === "/") {
            state.inBlockComment = false;
            return 1;
        }

        return 0;
    }

    if (char === "/" && nextChar === "/") {
        state.inSingleLineComment = true;
        return 1;
    }

    if (char === "/" && nextChar === "*") {
        state.inBlockComment = true;
        return 1;
    }

    if (char === "'" || char === '"') {
        state.stringDelimiter = char;
        return 0;
    }

    if (char === "{") {
        state.depth += 1;
        return 0;
    }

    if (char === "}" && state.depth > 0) {
        state.depth -= 1;
    }

    return 0;
}

function consumeStringCharacter(state: BraceScannerState, char: string): number {
    if (state.isEscaped) {
        state.isEscaped = false;
        return 0;
    }

    if (char === "\\") {
        state.isEscaped = true;
        return 0;
    }

    if (char === state.stringDelimiter) {
        state.stringDelimiter = null;
    }

    return 0;
}
