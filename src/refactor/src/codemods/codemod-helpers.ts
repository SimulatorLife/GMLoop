/**
 * Shared helpers for the codemod layer.
 *
 * This module contains pure utility functions that are duplicated across
 * multiple codemods.  Keeping them here allows each codemod to stay focused
 * on its own transformation logic rather than re-implementing common
 * infrastructure.
 */

/**
 * Minimal text edit shape used by codemods (uses `text` instead of `newText`,
 * matching the edit types defined in each codemod's own `types.ts`).
 */
export type CodemodSourceTextEdit = Readonly<{ start: number; end: number; text: string }>;

/**
 * Apply a sorted list of non-overlapping edits to `sourceText` in a single
 * forward pass.
 *
 * Edits must already be non-overlapping.  They are sorted by start position
 * (ascending) so that string slicing proceeds left-to-right without any
 * back-tracking or intermediate string copies.
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
        result += sourceText.slice(cursor, edit.start);
        result += edit.text;
        cursor = edit.end;
    }

    result += sourceText.slice(cursor);
    return result;
}
