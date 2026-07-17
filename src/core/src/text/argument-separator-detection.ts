import { advanceStringCommentScan, createStringCommentScanState, type StringCommentScanState } from "./source-text.js";

/**
 * Source-text helpers for detecting missing argument separators in GML
 * function calls.
 *
 * The helpers in this module are pure text utilities that operate on a
 * "comment-and-string-masked" projection of the source text. They are
 * intentionally placed in `@gmloop/core` (alongside the other text
 * primitives such as `createStringCommentScanState` and
 * `advanceStringCommentScan`) so that **both** the `lint` workspace — which
 * needs the helpers in pre-parse recovery (Phase A) — and the `refactor`
 * workspace — which needs the same helpers in the
 * `repair-argument-separators` codemod — can share a single implementation
 * without violating the architectural boundary that disallows
 * `refactor → lint` dependencies.
 *
 * Previously each workspace defined its own copy of these helpers, which
 * produced two divergent implementations of the same masking/comparison
 * logic. Promoting them to `@gmloop/core` keeps the argument-gap detection
 * algorithm in exactly one place.
 *
 * Architecture: these are pure text utilities that compose with the generic
 * string/comment scanner in `@gmloop/core/text` (target-state.md §2.1).
 */

const IDENTIFIER_CHARACTER_PATTERN = /[A-Za-z0-9_]/u;
const WHITESPACE_CHARACTER_PATTERN = /\s/u;

const QUOTE_DOUBLE = '"';
const QUOTE_SINGLE = "'";

/**
 * Whether `character` is a GML identifier character (ASCII letter, digit, or
 * underscore). Used to decide whether whitespace separates two expression
 * tokens (rather than, e.g., an operator).
 */
export function isIdentifierCharacter(character: string): boolean {
    return IDENTIFIER_CHARACTER_PATTERN.test(character);
}

/**
 * Whether `character` can legitimately terminate an argument expression:
 * an identifier tail, a string-literal closing quote, or a balanced closing
 * bracket of any flavour. Used together with {@link canStartArgumentExpression}
 * to identify whitespace that separates two argument expressions.
 */
export function canTerminateArgumentExpression(character: string): boolean {
    return (
        isIdentifierCharacter(character) ||
        character === QUOTE_DOUBLE ||
        character === QUOTE_SINGLE ||
        character === ")" ||
        character === "]" ||
        character === "}"
    );
}

/**
 * Inverse of {@link canTerminateArgumentExpression}: whether `character` can
 * legitimately begin an argument expression.
 */
export function canStartArgumentExpression(character: string): boolean {
    return (
        isIdentifierCharacter(character) ||
        character === QUOTE_DOUBLE ||
        character === QUOTE_SINGLE ||
        character === "(" ||
        character === "[" ||
        character === "{"
    );
}

/**
 * Whether `character` is an argument-list boundary token (a closing bracket of
 * any flavour, or a comma). Used by {@link isLikelyCallArgumentGap} to bail
 * out of prefix scans that already cross a structural boundary.
 */
export function isArgumentBoundaryCharacter(character: string): boolean {
    return character === ")" || character === "]" || character === "}" || character === ",";
}

/**
 * Whether `character` is a CR or LF line terminator. Used to preserve line
 * breaks during comment masking so {@link isLikelyCallArgumentGap} still
 * treats them as hard scan boundaries.
 */
export function isLineTerminator(character: string): boolean {
    return character === "\n" || character === "\r";
}

/**
 * Identifier token shape returned by {@link readIdentifierTokenEndingAt}.
 */
export type IdentifierToken = Readonly<{
    value: string;
    start: number;
}>;

/**
 * Walk backwards from `endIndex` to read the identifier token that ends at
 * that position. Returns `null` when the character at `endIndex` is not an
 * identifier character.
 *
 * @param sourceText Full source text being scanned.
 * @param endIndex Index of the last character of the candidate identifier.
 */
export function readIdentifierTokenEndingAt(sourceText: string, endIndex: number): IdentifierToken | null {
    const character = sourceText[endIndex] ?? "";
    if (!isIdentifierCharacter(character)) {
        return null;
    }

    let startIndex = endIndex;
    while (startIndex > 0 && isIdentifierCharacter(sourceText[startIndex - 1] ?? "")) {
        startIndex -= 1;
    }

    return Object.freeze({
        value: sourceText.slice(startIndex, endIndex + 1),
        start: startIndex
    });
}

/**
 * Walk forwards from `startIndex` to read the identifier token that begins at
 * that position. Returns `null` when the character at `startIndex` is not an
 * identifier character.
 *
 * @param sourceText Full source text being scanned.
 * @param startIndex Index of the first character of the candidate identifier.
 */
export function readIdentifierTokenStartingAt(sourceText: string, startIndex: number): string | null {
    const character = sourceText[startIndex] ?? "";
    if (!isIdentifierCharacter(character)) {
        return null;
    }

    let endIndex = startIndex;
    while (endIndex < sourceText.length && isIdentifierCharacter(sourceText[endIndex] ?? "")) {
        endIndex += 1;
    }

    return sourceText.slice(startIndex, endIndex);
}

/**
 * GML keywords that introduce a parenthesised group which is *not* a function
 * call site, e.g. `if (cond)`, `while (cond)`, `function name()`. The argument
 * separator detector uses this set to skip whitespace inside these groups so
 * it does not hallucinate argument separators around the keyword's operands.
 */
export const NON_CALL_PREFIX_KEYWORDS: ReadonlySet<string> = new Set([
    "if",
    "for",
    "while",
    "switch",
    "repeat",
    "with",
    "function",
    "constructor",
    "catch",
    "and",
    "or",
    "xor",
    "not",
    "div",
    "mod",
    "return",
    "var",
    "else",
    "until",
    "throw",
    "new",
    "try",
    "finally",
    "static",
    "enum",
    "globalvar",
    "case",
    "default"
]);

/**
 * Locate the previous non-whitespace character before `startIndex`, returning
 * its index. When `stopAtLineBreak` is `true`, hitting a `\n` or `\r` short
 * circuits the scan and returns `null` so callers can treat line breaks as
 * hard boundaries.
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

        if (WHITESPACE_CHARACTER_PATTERN.test(character ?? "")) {
            cursor -= 1;
            continue;
        }

        return cursor;
    }

    return null;
}

/**
 * Locate the next non-whitespace character after `startIndex`, returning its
 * index or `null` when none exists.
 */
export function findNextNonWhitespaceIndex(sourceText: string, startIndex: number): number | null {
    let cursor = startIndex + 1;
    while (cursor < sourceText.length) {
        if (!WHITESPACE_CHARACTER_PATTERN.test(sourceText[cursor] ?? "")) {
            return cursor;
        }

        cursor += 1;
    }

    return null;
}

/**
 * Locate the index of the first character on the line after `index`. Used by
 * {@link isDirectiveLineAtIndex}-style scans to advance past a directive line
 * in a single step: pair them and resume scanning at the returned offset,
 * which is always one past the next line break or the end of the source text.
 *
 * @param sourceText Full source text being scanned.
 * @param index Index of a character on the line whose terminator should be located.
 * @returns Index immediately after the next `\n`, or `sourceText.length` when
 *   the line has no terminator.
 */
export function findNextLineStart(sourceText: string, index: number): number {
    const nextLineBreak = sourceText.indexOf("\n", index);
    return nextLineBreak === -1 ? sourceText.length : nextLineBreak + 1;
}

/**
 * Determines whether the source offset lies on a directive line (a line whose
 * first non-whitespace character is `#`, e.g. `#region`, `#macro`, `#define`).
 *
 * Argument-separator recovery must skip directive lines because their
 * contents are preprocessor tokens rather than runtime GML expressions;
 * treating them as a function call would hallucinate missing commas inside
 * directive payloads.
 *
 * @param sourceText Full source text being scanned.
 * @param index Index of the character to test.
 * @returns `true` if the character belongs to a directive line, otherwise `false`.
 */
export function isDirectiveLineAtIndex(sourceText: string, index: number): boolean {
    const lineStart = sourceText.lastIndexOf("\n", index - 1) + 1;
    for (let cursor = lineStart; cursor < sourceText.length; cursor += 1) {
        const character = sourceText[cursor];
        if (character === "\n" || character === "\r") {
            return false;
        }
        if (WHITESPACE_CHARACTER_PATTERN.test(character ?? "")) {
            continue;
        }
        return character === "#";
    }
    return false;
}

interface MaskCommentsAndStringsOptions {
    /**
     * When `true`, also mask directive lines (lines whose first non-whitespace
     * character is `#`). Required for codemods that rewrite GML source so they
     * never touch directive payloads. Parser-recovery callers can leave this
     * `false` because the parser handles directives natively.
     *
     * Defaults to `false`.
     */
    readonly maskDirectiveLines?: boolean;
}

/**
 * Returns a copy of `sourceText` in which all string literals and comments
 * have been replaced with whitespace. The replacement preserves the original
 * line terminators so {@link isLikelyCallArgumentGap} still treats them as
 * hard scan boundaries, and preserves the delimiter characters (the opening
 * and closing quote or comment marker) so the argument-gap detector can
 * still recognise where a string or comment begins and ends.
 *
 * Use this projection to safely scan for argument-list patterns without
 * getting confused by quoted content or commented-out code.
 *
 * @param sourceText Full source text to mask.
 * @param options When `options.maskDirectiveLines` is `true`, also mask
 *   directive lines (e.g. `#region ... #endregion`).
 */
export function maskCommentsAndStringsForRecovery(
    sourceText: string,
    options: MaskCommentsAndStringsOptions = {}
): string {
    const { maskDirectiveLines = false } = options;

    const chars = sourceText.split("");
    const sourceLength = sourceText.length;
    const scanState: StringCommentScanState = createStringCommentScanState();
    let index = 0;

    while (index < sourceLength) {
        if (maskDirectiveLines && isDirectiveLineAtIndex(sourceText, index)) {
            const lineEndIndex = findNextLineStart(sourceText, index);
            for (let cursor = index; cursor < lineEndIndex; cursor += 1) {
                if (!isLineTerminator(chars[cursor] ?? "")) {
                    chars[cursor] = " ";
                }
            }
            index = lineEndIndex;
            continue;
        }

        const scannedIndex = advanceStringCommentScan(sourceText, sourceLength, index, scanState, true);
        if (scannedIndex !== index) {
            // `advanceStringCommentScan` only advances one source-text character
            // at a time, so drain the rest of the comment/string span in a loop
            // and mask the whole run in one pass. Strings keep their closing
            // delimiter (`"` or `'`) because argument-gap detection needs a
            // non-whitespace boundary character to walk back to when the
            // string body is empty or contains only whitespace; comments keep
            // none, because the algorithm would otherwise mistake the leading
            // `/` for a division operator between the masked region and the
            // surrounding code.
            let scanEnd = scannedIndex;
            while (scanEnd < sourceLength) {
                const nextScanned = advanceStringCommentScan(sourceText, sourceLength, scanEnd, scanState, true);
                if (nextScanned === scanEnd) {
                    break;
                }
                scanEnd = nextScanned;
            }

            const firstCharacter = sourceText[index] ?? "";
            const preserveEnd = firstCharacter === '"' || firstCharacter === "'" ? scanEnd - 1 : -1;
            for (let cursor = index; cursor < scanEnd; cursor += 1) {
                if (cursor === preserveEnd) {
                    continue;
                }
                if (!isLineTerminator(chars[cursor] ?? "")) {
                    chars[cursor] = " ";
                }
            }
            index = scanEnd;
            continue;
        }

        index += 1;
    }

    return chars.join("");
}

/**
 * Returns `true` when the whitespace gap at `leftIndex` lies inside what looks
 * like a function-call argument list (rather than an `if`/`while`/`for`
 * parenthesised group or a top-level statement).
 *
 * The detector scans backwards from `leftIndex` for the enclosing `(`, then
 * checks whether the previous token is a callable name (i.e. not a reserved
 * keyword or `function` keyword prefix). The scan bails out at argument
 * boundaries, line terminators, or statement terminators so it does not walk
 * past a structural boundary and produce false positives.
 *
 * @param sourceText Masked source text (see {@link maskCommentsAndStringsForRecovery}).
 * @param leftIndex Index of the character immediately before the whitespace run.
 */
export function isLikelyCallArgumentGap(sourceText: string, leftIndex: number): boolean {
    let cursor = leftIndex;
    while (cursor >= 0) {
        const character = sourceText[cursor] ?? "";
        if (character === "(") {
            const calleeEndIndex = findPreviousNonWhitespaceIndex(sourceText, cursor, false);
            if (calleeEndIndex === null) {
                return false;
            }

            const calleeToken = readIdentifierTokenEndingAt(sourceText, calleeEndIndex);
            if (calleeToken) {
                if (NON_CALL_PREFIX_KEYWORDS.has(calleeToken.value.toLowerCase())) {
                    return false;
                }

                const beforeCalleeIndex = findPreviousNonWhitespaceIndex(sourceText, calleeToken.start, false);
                if (beforeCalleeIndex === null) {
                    return true;
                }

                const prefixToken = readIdentifierTokenEndingAt(sourceText, beforeCalleeIndex);
                return prefixToken?.value.toLowerCase() !== "function";
            }

            const calleeCharacter = sourceText[calleeEndIndex] ?? "";
            return calleeCharacter === ")" || calleeCharacter === "]";
        }

        if (isArgumentBoundaryCharacter(character) || character === "\n" || character === "\r" || character === ";") {
            return false;
        }

        cursor -= 1;
    }

    return false;
}

/**
 * Description of a single whitespace run in a masked source text, paired
 * with the indexes of the non-whitespace characters that surround it.
 *
 * Returned by {@link forEachWhitespaceRunWithAdjacentTokens}; consumers use
 * the surrounding indexes to decide whether the run is a missing-comma gap,
 * a structural separator, or just incidental spacing.
 */
export type WhitespaceRunWithAdjacentTokens = Readonly<{
    /** Inclusive start offset of the whitespace run. */
    whitespaceRunStart: number;
    /** Inclusive end offset of the whitespace run. */
    whitespaceRunEnd: number;
    /** Offset of the nearest non-whitespace character before the run, or `null` at the file start. */
    previousIndex: number;
    /** Offset of the nearest non-whitespace character after the run, or `null` at the file end. */
    nextIndex: number;
}>;

const WHITESPACE_CHARACTER_PATTERN_FOR_RUNS = /\s/u;

/**
 * Walks `maskedSource` (typically produced by
 * {@link maskCommentsAndStringsForRecovery}) and invokes `onRun` once for each
 * contiguous whitespace run, including the offsets of the surrounding
 * non-whitespace characters.
 *
 * The walk is shared by both `lint`'s pre-parse recovery projection and
 * `refactor`'s `repair-argument-separators` codemod so they iterate over the
 * same candidates without duplicating the boundary-scan bookkeeping. The
 * caller decides whether each whitespace run is a missing-comma gap by
 * further inspecting the surrounding characters via
 * {@link canTerminateArgumentExpression}, {@link canStartArgumentExpression},
 * and {@link isLikelyCallArgumentGap}.
 *
 * @param maskedSource Masked source text whose whitespace runs to enumerate.
 * @param onRun Callback invoked once per whitespace run.
 */
export function forEachWhitespaceRunWithAdjacentTokens(
    maskedSource: string,
    onRun: (run: WhitespaceRunWithAdjacentTokens) => void
): void {
    const sourceLength = maskedSource.length;
    let index = 0;

    while (index < sourceLength) {
        const character = maskedSource[index] ?? "";
        if (!WHITESPACE_CHARACTER_PATTERN_FOR_RUNS.test(character)) {
            index += 1;
            continue;
        }

        const whitespaceRunStart = index;
        while (index < sourceLength && WHITESPACE_CHARACTER_PATTERN_FOR_RUNS.test(maskedSource[index] ?? "")) {
            index += 1;
        }
        const whitespaceRunEnd = index - 1;

        const previousIndex = findPreviousNonWhitespaceIndex(maskedSource, whitespaceRunStart, false);
        const nextIndex = findNextNonWhitespaceIndex(maskedSource, whitespaceRunEnd);
        if (previousIndex === null || nextIndex === null) {
            continue;
        }

        onRun(Object.freeze({ whitespaceRunStart, whitespaceRunEnd, previousIndex, nextIndex }));
    }
}
