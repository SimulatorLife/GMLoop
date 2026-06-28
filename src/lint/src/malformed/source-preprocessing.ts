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
