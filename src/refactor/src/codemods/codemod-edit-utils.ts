/**
 * Shared edit-application utilities used across codemods.
 *
 * Centralizes the single-pass sorted-edit application pattern used by all
 * codemods to avoid repeated implementation and ensure consistent behavior.
 */

/**
 * Apply a list of non-overlapping edits to `sourceText` in a single forward
 * pass.  Edits are sorted in ascending order by start/end so the result is
 * assembled without intermediate string copies, matching the same pattern
 * used by `applyGroupedTextEditsToContent` in the refactor engine.
 *
 * @param sourceText - The original source text.
 * @param edits - Sorted or unsorted array of edits to apply. Edits must not
 *                overlap.
 * @returns The source text with all edits applied.
 */
export function applySourceTextEdits<T extends { start: number; end: number; text: string }>(
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
        result += sourceText.slice(cursor, edit.start);
        result += edit.text;
        cursor = edit.end;
    }

    result += sourceText.slice(cursor);
    return result;
}
