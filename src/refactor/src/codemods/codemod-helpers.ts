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
