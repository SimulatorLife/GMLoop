/**
 * Cross-domain layout helpers shared between the printer and comment subsystems.
 *
 * These utilities operate on source text at the character level and have no
 * domain-specific knowledge of GML AST nodes or formatting rules. They live here
 * so neither the printer nor the comments layer imports across the domain boundary
 * (printer ↔ comments) directly from each other.
 */

/**
 * Count blank lines after the provided index, ignoring semicolons and
 * whitespace between line breaks.
 *
 * Used by:
 * - comment-printer.ts  – to detect blank lines before block comments
 * - statement-traversal-spacing.ts – to detect trailing blank lines
 */
export function countTrailingBlankLines(text: string | null | undefined, startIndex: number): number {
    if (typeof text !== "string") {
        return 0;
    }

    const { length } = text;
    let index = startIndex;
    let newlineCount = 0;

    while (index < length) {
        const characterCode = text.charCodeAt(index);

        if (characterCode === 59) {
            index += 1;
            continue;
        }

        if (characterCode === 10) {
            newlineCount += 1;
            index += 1;
            continue;
        }

        if (characterCode === 13) {
            newlineCount += 1;
            index += index + 1 < length && text.charCodeAt(index + 1) === 10 ? 2 : 1;
            continue;
        }

        if (isWhitespaceCharacterCode(characterCode)) {
            index += 1;
            continue;
        }

        break;
    }

    if (newlineCount === 0) {
        return 0;
    }

    return Math.max(0, newlineCount - 1);
}

/**
 * Return the next non-whitespace character after the provided index.
 */
export function getNextNonWhitespaceCharacter(text: string | null | undefined, startIndex: number): string | null {
    if (typeof text !== "string") {
        return null;
    }

    const { length } = text;
    let index = startIndex;

    while (index < length) {
        if (!isWhitespaceCharacterCode(text.charCodeAt(index))) {
            return text[index] ?? null;
        }

        index += 1;
    }

    return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fallback used by {@link isWhitespaceCharacterCode} for non-ASCII code
 * points. Cached as a module-level constant so the regex is only compiled
 * once.
 */
const UNICODE_WHITESPACE_REGEX = /\s/;

/**
 * Return whether the provided character code is a Unicode whitespace code
 * point. Uses a fast ASCII branch for the common case and falls back to the
 * Unicode `\s` regex for higher code points (line/paragraph separators,
 * non-breaking spaces, etc.).
 *
 * Used by:
 * - countTrailingBlankLines / getNextNonWhitespaceCharacter above
 * - semicolons.ts – to decide which characters the semicolon cleanup skips
 */
export function isWhitespaceCharacterCode(charCode: number): boolean {
    if (charCode < 0x80) {
        return charCode === 0x20 || (charCode >= 0x09 && charCode <= 0x0d);
    }

    return UNICODE_WHITESPACE_REGEX.test(String.fromCharCode(charCode));
}
