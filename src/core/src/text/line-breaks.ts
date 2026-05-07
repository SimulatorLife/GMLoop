import { isNonEmptyString } from "../utils/string.js";

// Shared text utility helpers related to line break detection.
// This module centralizes line break handling so parser and printer code
// can share a single implementation instead of duplicating logic.

const LINE_BREAK_SPLIT_PATTERN = /\r\n|[\n\r\u2028\u2029\u0085]/u;
const CHAR_CODE_CARRIAGE_RETURN = 0x0d;
const CHAR_CODE_LINE_FEED = 0x0a;
const CHAR_CODE_LINE_SEPARATOR = 0x20_28;
const CHAR_CODE_PARAGRAPH_SEPARATOR = 0x20_29;
const CHAR_CODE_NEXT_LINE = 0x00_85;

/**
 * Describe each recognized line break sequence within {@link text}.
 *
 * @param {unknown} text Candidate string to scan for newline sequences.
 * @returns {Array<{ index: number, length: number }>} Ordered break spans.
 */
export function getLineBreakSpans(text) {
    if (typeof text !== "string" || text.length === 0) {
        return [];
    }

    const spans: Array<{ index: number; length: number }> = [];
    const length = text.length;

    for (let index = 0; index < length; index += 1) {
        const code = text.charCodeAt(index);

        if (code === CHAR_CODE_CARRIAGE_RETURN) {
            if (index + 1 < length && text.charCodeAt(index + 1) === CHAR_CODE_LINE_FEED) {
                spans.push({ index, length: 2 });
                index += 1;
                continue;
            }

            spans.push({ index, length: 1 });
            continue;
        }

        if (
            code === CHAR_CODE_LINE_FEED ||
            code === CHAR_CODE_LINE_SEPARATOR ||
            code === CHAR_CODE_PARAGRAPH_SEPARATOR ||
            code === CHAR_CODE_NEXT_LINE
        ) {
            spans.push({ index, length: 1 });
        }
    }

    return spans;
}

/**
 * Count the number of line break characters in a string.
 *
 * @param {string} text Text to inspect.
 * @returns {number} Number of recognized line break characters.
 */
export function getLineBreakCount(text) {
    if (!isNonEmptyString(text)) {
        return 0;
    }

    let count = 0;
    const length = text.length;

    // Scanning the string manually with a simple loop avoids the regex machinery
    // used by `getLineBreakSpans`, which allocates match objects and maintains
    // lastIndex state even when the pattern is stateless. Parser hot paths call
    // this `countLineBreaks` helper for nearly every token and comment node during
    // AST construction, so even small per-invocation overhead compounds quickly.
    // Profiling shows that the straight-line loop trims roughly 25% off the total
    // time spent in line-break counting (see micro-benchmark results in the commit
    // message that introduced this optimization) while preserving the original CRLF
    // collapsing semantics (where "\r\n" counts as a single line break, not two).
    // The tradeoff is manual character-code inspection instead of declarative regex,
    // but the performance gain is worth the added verbosity given how frequently this
    // function runs. If you modify this logic, ensure the CRLF handling remains intact:
    // when '\r' is followed by '\n', skip the '\n' to avoid double-counting.
    for (let index = 0; index < length; index += 1) {
        const code = text.charCodeAt(index);

        if (code === CHAR_CODE_CARRIAGE_RETURN) {
            if (index + 1 < length && text.charCodeAt(index + 1) === CHAR_CODE_LINE_FEED) {
                index += 1;
            }

            count += 1;
            continue;
        }

        if (
            code === CHAR_CODE_LINE_FEED ||
            code === CHAR_CODE_LINE_SEPARATOR ||
            code === CHAR_CODE_PARAGRAPH_SEPARATOR ||
            code === CHAR_CODE_NEXT_LINE
        ) {
            count += 1;
        }
    }

    return count;
}

/**
 * Split {@link text} into individual lines while recognising the newline
 * sequences produced by Windows, Unix, and Unicode line separators.
 *
 * Normalizes the ad-hoc `String#split` logic previously embedded in the
 * project-index syntax error formatter so that future call sites can reuse the
 * same cross-platform handling without re-implementing the regular expression.
 * Non-string inputs return an empty array, mirroring the defensive guards used
 * by other shared helpers that accept optional metadata.
 *
 * @param {unknown} text Text that may contain newline characters.
 * @returns {Array<string>} Ordered list of lines. Blank input yields a single
 *          empty string to mirror native `String#split` semantics.
 */
export function splitLines(text) {
    if (typeof text !== "string") {
        return [];
    }

    if (text.length === 0) {
        return [""];
    }

    return text.split(LINE_BREAK_SPLIT_PATTERN);
}

/**
 * Determine the dominant line ending used in {@link text}.
 *
 * Counts CRLF (`\r\n`) and bare LF (`\n`) occurrences separately and returns
 * whichever appears more often. When counts are equal (or the text has no line
 * breaks), `"\n"` is returned as the tie-break default.
 *
 * This is the canonical shared implementation for lint rules and codemods that
 * must emit new text using the same line ending already present in the source
 * file, rather than each workspace duplicating the logic independently.
 *
 * Architecture note: this utility belongs in `@gmloop/core` because it is
 * a pure text utility shared across the `lint` and `refactor` workspaces.
 * (target-state.md §2.1)
 *
 * @param {string} text The source text to analyse.
 * @returns {"\r\n" | "\n"} The dominant line ending sequence.
 */
export function dominantLineEnding(text: string): "\r\n" | "\n" {
    let crlfCount = 0;
    let lfCount = 0;
    const length = text.length;

    // Single-pass scan keeps this helper on the fast path for lint/refactor
    // fixers that repeatedly inspect source text. The previous implementation
    // ran two regex passes and allocated match arrays for every invocation.
    // This loop preserves the original semantics: CRLF counts as one CRLF line
    // ending, bare LF counts as LF, and everything else falls back to the LF
    // tie-break default.
    for (let index = 0; index < length; index += 1) {
        if (text.charCodeAt(index) !== CHAR_CODE_LINE_FEED) {
            continue;
        }

        if (index > 0 && text.charCodeAt(index - 1) === CHAR_CODE_CARRIAGE_RETURN) {
            crlfCount += 1;
            continue;
        }

        lfCount += 1;
    }

    return crlfCount > lfCount ? "\r\n" : "\n";
}

/**
 * Return the source offset of the first character on the line that contains
 * `offset`.
 *
 * The algorithm scans backwards for the most recent `\n` and adds one so the
 * result always points at a non-newline character (or 0 when `offset` is on
 * the first line).  Works correctly for both LF and CRLF line endings because
 * the `\n` character is always present in CRLF sequences.
 *
 * @param sourceText Full source text to scan.
 * @param offset     Character offset whose line start should be resolved.
 * @returns Offset of the first character on the same line as `offset`.
 */
export function getLineStartOffset(sourceText: string, offset: number): number {
    return sourceText.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

/**
 * Extract the leading whitespace (spaces and tabs only) of the line containing
 * `offset`.
 *
 * This is used by lint auto-fixers and codemod rewriters that need to preserve
 * the existing indentation when inserting new statements before or after an
 * existing line.
 *
 * @param sourceText Full source text to scan.
 * @param offset     Character offset whose line indentation should be resolved.
 * @returns String of space/tab characters that precede the first non-whitespace
 *          character on the same line.
 */
export function getLineIndentationAtOffset(sourceText: string, offset: number): string {
    const lineStart = getLineStartOffset(sourceText, offset);
    let cursor = lineStart;
    while (cursor < sourceText.length && (sourceText[cursor] === " " || sourceText[cursor] === "\t")) {
        cursor += 1;
    }

    return sourceText.slice(lineStart, cursor);
}
