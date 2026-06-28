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

/**
 * Determines whether the source offset lies on a directive line (a line whose
 * first non-whitespace character is `#`, e.g. `#region`, `#macro`, `#define`).
 *
 * Codemods scanning GML source must skip directive lines because their
 * contents are preprocessor tokens rather than runtime GML expressions;
 * rewriting them produces invalid output.
 *
 * @param sourceText - Full source text being scanned.
 * @param index - Index of the character to test.
 * @returns `true` if the character belongs to a directive line, otherwise `false`.
 */
export function isDirectiveLineAtIndex(sourceText: string, index: number): boolean {
    const lineStart = sourceText.lastIndexOf("\n", index - 1) + 1;
    for (let cursor = lineStart; cursor < sourceText.length; cursor += 1) {
        const character = sourceText[cursor];
        if (character === "\n" || character === "\r") {
            return false;
        }
        if (/\s/u.test(character ?? "")) {
            continue;
        }
        return character === "#";
    }
    return false;
}

/**
 * Returns the index of the first character on the line after `index`.
 *
 * Used by codemods that need to advance past a directive line in a single
 * step: pair with {@link isDirectiveLineAtIndex} and resume scanning at the
 * returned offset, which is always one past the next line break or the end of
 * the source text.
 *
 * @param sourceText - Full source text being scanned.
 * @param index - Index of a character on the line whose terminator should be located.
 * @returns Index immediately after the next `\n`, or `sourceText.length` when the line has no terminator.
 */
export function findNextLineStart(sourceText: string, index: number): number {
    const nextLineBreak = sourceText.indexOf("\n", index);
    return nextLineBreak === -1 ? sourceText.length : nextLineBreak + 1;
}
