/**
 * Text utilities for GameMaker Language source text.
 *
 * This module consolidates three formerly separate helpers—source-text
 * validation, line-break handling, and string/comment scanning—into a single
 * cohesive file under the `text` domain. Keeping related text-manipulation
 * logic together reduces the surface area for discoverability and prevents
 * redundant defensive guards at call sites.
 *
 * Rationale: The three original files each occupied a dedicated directory slot
 * while sharing no cross-file dependencies and covering a single logical domain
 * (working with raw source text). Merging them into one file eliminates the
 * directory overhead without sacrificing readability. The barrel (`index.ts`)
 * re-exports the combined surface so existing call sites are unaffected.
 */

import { isNonEmptyString } from "../utils/string.js";

// ---------------------------------------------------------------------------
// Source text validation
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SOURCE_LENGTH = 10 * 1024 * 1024; // 10MB

/**
 * Configuration for source text validation.
 */
export interface SourceTextValidationOptions {
    /**
     * Maximum allowed source text length in characters.
     * Defaults to 10MB (10,485,760 characters).
     */
    maxLength?: number;

    /**
     * Whether to allow empty source text.
     * When false, empty strings are rejected with a validation error.
     * Defaults to true.
     */
    allowEmpty?: boolean;
}

/**
 * Error thrown when source text validation fails.
 */
export class SourceTextValidationError extends TypeError {
    constructor(message: string) {
        super(message);
        this.name = "SourceTextValidationError";
    }
}

/**
 * Validates that a value is a string suitable for parsing.
 *
 * This function performs defensive runtime checks on external input before it
 * reaches the parser. It guards against:
 * - Non-string types (including null, undefined, objects, arrays)
 * - Excessively large strings that could cause memory exhaustion
 * - Empty strings (when configured to disallow them)
 *
 * @param value - The value to validate (typically from untrusted external sources).
 * @param options - Optional validation configuration.
 * @returns The validated string when all checks pass.
 * @throws {SourceTextValidationError} When validation fails, with a message
 *   describing the specific violation.
 *
 * @example
 * ```typescript
 * // Validate basic input
 * const source = validateSourceText(userInput);
 *
 * // Enforce stricter limits
 * const source = validateSourceText(userInput, {
 *   maxLength: 1024 * 1024, // 1MB limit
 *   allowEmpty: false
 * });
 * ```
 */
export function validateSourceText(value: unknown, options: SourceTextValidationOptions = {}): string {
    const { maxLength = DEFAULT_MAX_SOURCE_LENGTH, allowEmpty = true } = options;

    if (value === null) {
        throw new SourceTextValidationError(
            "Source text cannot be null. Provide a string or empty string if no source is available."
        );
    }

    if (value === undefined) {
        throw new SourceTextValidationError(
            "Source text cannot be undefined. Provide a string or empty string if no source is available."
        );
    }

    if (typeof value !== "string") {
        const actualType = Array.isArray(value) ? "array" : typeof value;
        throw new SourceTextValidationError(`Source text must be a string, received ${actualType}.`);
    }

    if (!allowEmpty && value.length === 0) {
        throw new SourceTextValidationError("Source text cannot be empty when allowEmpty is false.");
    }

    if (value.length > maxLength) {
        throw new SourceTextValidationError(
            `Source text exceeds maximum allowed length of ${maxLength} characters (received ${value.length} characters).`
        );
    }

    return value;
}

/**
 * Type guard to check if a value is a valid non-null string.
 *
 * Unlike {@link validateSourceText}, this function returns a boolean instead
 * of throwing, making it suitable for conditional logic where errors should
 * not interrupt control flow.
 *
 * @param value - The value to check.
 * @returns True if value is a string (including empty strings), false otherwise.
 *
 * @example
 * ```typescript
 * if (isValidSourceTextType(input)) {
 *   // TypeScript now knows `input` is a string
 *   const parsed = parse(input);
 * }
 * ```
 */
export function isValidSourceTextType(value: unknown): value is string {
    return typeof value === "string";
}

// ---------------------------------------------------------------------------
// Line break utilities
// ---------------------------------------------------------------------------

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
export function getLineBreakSpans(text: unknown): Array<{ index: number; length: number }> {
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
export function getLineBreakCount(text: string): number {
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
export function splitLines(text: unknown): Array<string> {
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

// ---------------------------------------------------------------------------
// String / comment scanning
// ---------------------------------------------------------------------------

/**
 * State used while scanning through string literals and comment blocks.
 */
export type StringCommentScanState = {
    stringQuote: string | null;
    stringEscape: boolean;
    inLineComment: boolean;
    inBlockComment: boolean;
};

/**
 * Create a new string/comment scan state object.
 */
export function createStringCommentScanState(): StringCommentScanState {
    return {
        stringQuote: null,
        stringEscape: false,
        inLineComment: false,
        inBlockComment: false
    };
}

/**
 * Advance the scan index through the current string literal, updating state.
 */
export function advanceThroughStringLiteral(text: string, currentIndex: number, state: StringCommentScanState): number {
    const character = text[currentIndex];
    const nextIndex = currentIndex + 1;

    if (state.stringEscape) {
        state.stringEscape = false;
        return nextIndex;
    }

    if (character === "\\") {
        state.stringEscape = true;
        return nextIndex;
    }

    if (character === state.stringQuote) {
        state.stringQuote = null;
    }

    return nextIndex;
}

/**
 * Advance the scan index through the current comment block, updating state.
 */
export function advanceThroughComment(
    text: string,
    length: number,
    currentIndex: number,
    state: StringCommentScanState
): number {
    const character = text[currentIndex];
    const nextIndex = currentIndex + 1;

    if (state.inLineComment) {
        if (character === "\n" || character === "\r") {
            state.inLineComment = false;
        }
        return nextIndex;
    }

    if (character === "*" && currentIndex + 1 < length && text[currentIndex + 1] === "/") {
        state.inBlockComment = false;
        return currentIndex + 2;
    }

    return nextIndex;
}

/**
 * Start scanning a string literal or comment if one begins at the current index.
 */
export function tryStartStringOrComment(
    text: string,
    length: number,
    currentIndex: number,
    state: StringCommentScanState
): number {
    const character = text[currentIndex];

    if (character === "'" || character === '"' || character === "`") {
        state.stringQuote = character;
        state.stringEscape = false;
        return currentIndex + 1;
    }

    if (character === "/" && currentIndex + 1 < length) {
        const nextCharacter = text[currentIndex + 1];

        if (nextCharacter === "/") {
            state.inLineComment = true;
            return currentIndex + 2;
        }

        if (nextCharacter === "*") {
            state.inBlockComment = true;
            return currentIndex + 2;
        }
    }

    return currentIndex;
}

/**
 * Advance the scan index when the cursor is inside a string/comment or when a new
 * string/comment begins at the current position.
 */
export function advanceStringCommentScan(
    text: string,
    length: number,
    currentIndex: number,
    state: StringCommentScanState,
    allowAtString = false
): number {
    if (state.stringQuote) {
        return advanceThroughStringLiteral(text, currentIndex, state);
    }

    if (state.inLineComment || state.inBlockComment) {
        return advanceThroughComment(text, length, currentIndex, state);
    }

    if (allowAtString && text[currentIndex] === "@" && currentIndex + 1 < length) {
        const nextCharacter = text[currentIndex + 1];
        if (nextCharacter === "'" || nextCharacter === '"') {
            state.stringQuote = nextCharacter;
            state.stringEscape = false;
            return currentIndex + 2;
        }
    }

    return tryStartStringOrComment(text, length, currentIndex, state);
}
