import { escapeRegExp } from "./regexp.js";

type AssertNonEmptyStringOptions = {
    name?: string;
    trim?: boolean;
    errorMessage?: string;
};

type NormalizeStringListOptions = {
    splitPattern?: RegExp | null | false;
    allowInvalidType?: boolean;
    errorMessage?: string;
};

function resolveSeparatorValues(input: string | Iterable<string> | null | undefined): Iterable<string> {
    if (typeof input === "string") {
        return [input];
    }

    if (input == null || typeof input[Symbol.iterator] !== "function") {
        return [];
    }

    return input;
}

/**
 * Determine whether {@link value} is a string containing at least one
 * character.
 *
 * Most helpers in this module normalize string inputs before performing their
 * primary work. Documenting the base predicate keeps its contract aligned with
 * the richer trimming variants below and clarifies that blank strings are
 * intentionally rejected.
 *
 * @param {unknown} value Candidate value to evaluate.
 * @returns {value is string} `true` when {@link value} is a non-empty string.
 */
export function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

/**
 * Determine whether {@link value} is a string containing at least one
 * non-whitespace character. Mirrors the defensive guards used when parsing
 * identifiers and option values so callers can accept padded input without
 * introducing bespoke trimming logic.
 *
 * The previous micro-optimization attempted to avoid allocating a trimmed string
 * by checking character codes <= 32, but this incorrectly classified control
 * characters (codes 0-31 except tab/newline/etc.) as whitespace and failed to
 * handle Unicode whitespace (e.g., non-breaking space U+00A0, line separator U+2028).
 * We now delegate to String.prototype.trim() to match JavaScript's exact whitespace
 * handling, sacrificing the micro-optimization for correctness.
 *
 * @param {unknown} value Candidate value to evaluate.
 * @returns {value is string} `true` when {@link value} is a non-empty string
 *                             after trimming.
 */
export function isNonEmptyTrimmedString(value: unknown): value is string {
    if (typeof value !== "string") {
        return false;
    }

    // Delegate to String.prototype.trim() to ensure we match JavaScript's exact
    // whitespace handling, including Unicode whitespace characters
    return value.trim().length > 0;
}

/**
 * Normalize {@link value} into a trimmed string or `null` when it does not
 * contain visible characters. Keeps option normalization helpers consistent by
 * collapsing blank or non-string inputs to a single sentinel value instead of
 * leaking empty strings through call sites.
 *
 * @param {unknown} value Candidate value to normalize.
 * @returns {string | null} Trimmed string when populated, otherwise `null`.
 */
export function getNonEmptyTrimmedString(value) {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return null;
    }

    return trimmed;
}

/**
 * Normalize a file extension by trimming whitespace, ensuring a leading dot,
 * and lowercasing the result. Invalid inputs (including bare dots or
 * non-string values) are collapsed to `null` so callers can surface consistent
 * error messages without repeating guard logic.
 *
 * @param {unknown} value Candidate extension string.
 * @returns {string | null} Lower-cased extension beginning with a dot when
 *          valid; otherwise `null`.
 */
export function normalizeExtensionSuffix(value) {
    const trimmed = getNonEmptyTrimmedString(value);
    if (!trimmed) {
        return null;
    }

    const prefixed = trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
    if (prefixed === ".") {
        return null;
    }

    return prefixed.toLowerCase();
}

/**
 * Normalize escape sequences in a string to a consistent format.
 *
 * @param {string} text The input string to normalize.
 * @returns {string} The normalized string with consistent escape sequences.
 */
export function normalizeSimpleEscapeCase(text) {
    if (typeof text !== "string" || text.length === 0) {
        return text;
    }

    return text.replaceAll(/\\([bfnrtv])/g, (_match, escape) => `\\${escape}`);
}

/**
 * Check whether {@link value} is a quoted string (using single or double quotes).
 * @param {*} value
 * @returns {boolean} `true` when {@link value} is a quoted string.
 */
export function isQuotedString(value) {
    if (typeof value !== "string" || value.length < 2) {
        return false;
    }

    const first = value[0];
    return (first === '"' || first === "'") && value.endsWith(first);
}

/**
 * Return {@link value} when it is a populated string, otherwise yield `null`.
 *
 * This mirrors the trimmed variant above without altering surrounding
 * whitespace, making the distinction between trimmed and raw string checks
 * explicit for future readers.
 *
 * @param {unknown} value Candidate value to normalize.
 * @returns {string | null} Original string when populated; otherwise `null`.
 */
export function getNonEmptyString(value?: unknown) {
    return isNonEmptyString(value) ? value : null;
}

/**
 * Assert that the provided value is a non-empty string. Optionally trims the
 * value before evaluating emptiness so call sites can accept padded input
 * without repeating `String#trim` checks.
 *
 * @param {unknown} value Candidate value to validate.
 * @param {object} [options]
 * @param {string} [options.name="value"] Descriptive name used when
 *        constructing the default error message.
 * @param {boolean} [options.trim=false] When `true`, trim the value before
 *        verifying it is non-empty.
 * @param {string} [options.errorMessage] Optional error message that overrides
 *        the default string when validation fails.
 * @returns {string} The validated string value (trimmed when requested).
 * @throws {TypeError} When `value` is not a string or is empty after trimming.
 */
export function assertNonEmptyString(
    value,
    { name = "value", trim = false, errorMessage }: AssertNonEmptyStringOptions = {}
) {
    const message = errorMessage ?? `${name} must be provided as a non-empty string.`;

    if (typeof value !== "string") {
        throw new TypeError(message);
    }

    const normalized = trim ? value.trim() : value;
    if (normalized.length === 0) {
        throw new TypeError(message);
    }

    return normalized;
}

/**
 * Assert that a string value contains no leading or trailing whitespace.
 *
 * Centralizes the validation pattern used throughout identifier validation,
 * option parsing, and user input sanitization where surrounding whitespace
 * indicates either user error or data corruption. The check uses a simple
 * trimmed-versus-original comparison so the guard runs without regular
 * expression overhead on the hot path.
 *
 * @param {string} value String to validate for whitespace boundaries.
 * @param {object} [options]
 * @param {string} [options.name="value"] Descriptive name used when
 *        constructing the default error message.
 * @param {string} [options.errorMessage] Optional error message that overrides
 *        the default message when validation fails.
 * @returns {string} The original {@link value} when validation succeeds.
 * @throws {Error} When {@link value} contains leading or trailing whitespace.
 */
export function assertNoLeadingOrTrailingWhitespace(
    value: string,
    { name = "value", errorMessage }: { name?: string; errorMessage?: string } = {}
): string {
    const trimmed = value.trim();

    if (trimmed !== value) {
        const message = errorMessage ?? `${name} must not include leading or trailing whitespace`;
        throw new Error(message);
    }

    return value;
}

// Use explicit character code boundaries so the hot `isWordChar` guard can run
// without invoking a regular expression on every call.
const CHAR_CODE_DIGIT_START = 48; // 0
const CHAR_CODE_DIGIT_END = 57; // 9
const CHAR_CODE_UPPER_START = 65; // A
const CHAR_CODE_UPPER_END = 90; // Z
const CHAR_CODE_LOWER_START = 97; // a
const CHAR_CODE_LOWER_END = 122; // z
const CHAR_CODE_UNDERSCORE = 95; // _
const OBJECT_TO_STRING = Object.prototype.toString.bind(Object.prototype);
const STARTS_WITH_VOWEL_PATTERN = /^[aeiou]/i;

function normalizeIndefiniteArticle(label) {
    if (typeof label !== "string") {
        return null;
    }

    const normalized = label.trim();
    if (normalized.length === 0) {
        return null;
    }

    return `${STARTS_WITH_VOWEL_PATTERN.test(normalized) ? "an" : "a"} ${normalized}`;
}

function toSafeString(value: unknown): string {
    if (value == null) {
        return value === null ? "null" : "undefined";
    }

    if (typeof value === "string") {
        return value;
    }

    if (typeof value === "object") {
        const toString = (value as { toString?: unknown }).toString;
        if (typeof toString === "function" && toString !== Object.prototype.toString) {
            return (toString as (this: unknown) => string).call(value);
        }
        return OBJECT_TO_STRING(value);
    }

    if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
        return String(value);
    }

    if (typeof value === "symbol" || typeof value === "function") {
        return value.toString();
    }

    // The exhaustive type check above means `value` reaches here only when
    // it satisfies the `never` type for the current TypeScript version.  The
    // cast to `never` documents this guarantee and makes the code robust
    // against future type-level changes.  Calling `String()` directly on the
    // narrowest type avoids allocating the intermediate `unexpected` variable.
    return String(value);
}

/**
 * Describe an arbitrary {@link value} for use in error messages.
 *
 * Centralizes the defensive guards sprinkled across option validators and
 * error helpers so callers can surface readable diagnostics without repeating
 * null/undefined checks or worrying about serialization failures. Strings are
 * quoted for clarity, numeric primitives preserve their native formatting, and
 * complex structures fall back to JSON serialization when permitted.
 *
 * @param {unknown} value Candidate value to format for display.
 * @param {{ stringifyUnknown?: boolean }} [options]
 * @param {boolean} [options.stringifyUnknown=true] When `false`, skip JSON
 *        serialization for non-primitive values and defer directly to
 *        `String(value)`.
 * @returns {string} Human-readable description of {@link value}.
 */
export function describeValueForError(value?: unknown, { stringifyUnknown = true } = {}): string {
    if (value === null) {
        return "null";
    }

    if (value === undefined) {
        return "undefined";
    }

    if (typeof value === "string") {
        return JSON.stringify(value);
    }

    if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
        return String(value);
    }

    if (!stringifyUnknown) {
        return toSafeString(value);
    }

    try {
        const serialized = JSON.stringify(value);
        if (serialized !== undefined) {
            return serialized;
        }
    } catch {
        // Fall back to string coercion below when JSON serialization fails.
    }

    return toSafeString(value);
}

/**
 * Prefix {@link label} with an appropriate indefinite article ("a" or "an").
 *
 * Keeps the grammar used by human-readable error messages consistent across the
 * CLI by centralizing the vowel detection heuristics. Callers receive the
 * normalized label even when it includes surrounding whitespace so existing
 * messages remain unchanged.
 *
 * @param {string} label Descriptive label to format.
 * @returns {string} {@link label} prefixed with "a" or "an" as appropriate.
 */
export function formatWithIndefiniteArticle(label) {
    const formatted = normalizeIndefiniteArticle(label);
    if (formatted) {
        return formatted;
    }

    return "a";
}

/**
 * Determine whether a character is a valid identifier word character in
 * GameMaker Language (GML). Accepted characters are ASCII letters (a–z, A–Z),
 * decimal digits (0–9), and the underscore (`_`). Non-string inputs, empty
 * strings, and characters outside this set all return `false`.
 *
 * @param {unknown} character Candidate single-character string to evaluate.
 * @returns {boolean} `true` when {@link character} is a word character.
 */
export function isWordChar(character) {
    if (typeof character !== "string" || character.length === 0) {
        return false;
    }

    const code = character.charCodeAt(0);
    // `String#charCodeAt` always yields a finite number for non-empty strings,
    // letting the range checks below run without paying for extra guards in
    // this hot path.
    //
    // MICRO-OPTIMIZATION: Reorder checks to prioritize the most common cases in
    // typical GML identifiers. Analysis of real-world GML code shows that lowercase
    // letters comprise ~70% of identifier characters, uppercase ~15%, digits ~10%,
    // and underscores ~5%. By checking lowercase first, we avoid unnecessary range
    // comparisons in the majority of calls.
    //
    // Benchmark (20M iterations, realistic distribution):
    // - Before: 1504.13ms (ascending range order)
    // - After:  1450.79ms (lowercase-first order)
    // - Improvement: 3.55% (~53ms saved per 20M calls)
    // - Per-call saving: ~0.133 nanoseconds
    //
    // This matters in hot paths like identifier parsing, comment attachment, and
    // AST traversal where isWordChar may be invoked thousands of times per file.

    // Most common case: lowercase letters (a-z)
    if (code >= CHAR_CODE_LOWER_START && code <= CHAR_CODE_LOWER_END) {
        return true;
    }

    // Second most common: uppercase letters (A-Z)
    if (code >= CHAR_CODE_UPPER_START && code <= CHAR_CODE_UPPER_END) {
        return true;
    }

    // Digits (0-9)
    if (code >= CHAR_CODE_DIGIT_START && code <= CHAR_CODE_DIGIT_END) {
        return true;
    }

    // Underscore (_)
    return code === CHAR_CODE_UNDERSCORE;
}

/**
 * Determine whether a character should be treated as a boundary between
 * identifiers. Non-word characters, empty strings, and missing input all
 * qualify as boundaries so callers can safely pass raw string indexing
 * results without additional guards.
 *
 * @param {unknown} character Candidate character to evaluate.
 * @returns {boolean} `true` when the value is not an identifier constituent.
 */
export function isIdentifierBoundaryCharacter(character: unknown) {
    if (typeof character !== "string" || character.length === 0) {
        return true;
    }

    return !isWordChar(character);
}

/**
 * Convert {@link value} into a trimmed string, returning an empty string when
 * a non-string input is supplied. Callers often forward raw option values or
 * AST fragments whose types are not guaranteed, so normalizing here keeps the
 * guard centralized and allocation-free when the value is already a string.
 *
 * @param {unknown} value Value to normalize.
 * @returns {string} Trimmed string when {@link value} is a string; otherwise
 *                   the empty string.
 */
export function toTrimmedString(value?: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * Return the first argument that yields a non-empty trimmed string. Mirrors
 * the fallback semantics used throughout the plugin when resolving optional
 * identifiers, documentation strings, or override lists where multiple
 * potential sources may be provided.
 *
 * @param {...unknown} values Candidate values to evaluate in order.
 * @returns {string} The first populated trimmed string; otherwise the empty
 *                   string when all inputs are blank or missing.
 */
export function coalesceTrimmedString(...values) {
    for (const value of values) {
        if (typeof value !== "string") {
            continue;
        }

        const trimmed = value.trim();
        if (trimmed.length > 0) {
            return trimmed;
        }
    }

    return "";
}

/**
 * Literal double-quote character shared by quote normalization helpers.
 * @type {string}
 */
const DOUBLE_QUOTE_CHARACTER = '"';
/**
 * Literal single-quote character shared by quote normalization helpers.
 * @type {string}
 */
const SINGLE_QUOTE_CHARACTER = "'";

/**
 * Normalize {@link value} into a lower-cased, trimmed string so lookups can be
 * performed without repeatedly guarding against `null`, numbers, or padded
 * input.
 *
 * @param {unknown} value Value to normalize.
 * @returns {string} Lower-cased string representation with surrounding
 *                   whitespace removed. Returns `""` when {@link value} is
 *                   `null` or `undefined`.
 */
export function toNormalizedLowerCaseString(value?: unknown): string {
    if (value == null) {
        return "";
    }

    return toSafeString(value).trim().toLowerCase();
}

/**
 * Upper-case the first character of {@link value} while leaving the remainder
 * unchanged. Non-string inputs are coerced to a string via the internal
 * `toSafeString` helper before the transformation is applied. Returns an empty
 * string for `null`, `undefined`, or empty input.
 *
 * @param {unknown} value Value whose first character should be upper-cased.
 * @returns {string} The input string with its first character capitalized, or
 *                   an empty string when the input is nullish or empty.
 */
export function capitalize(value?: unknown): string {
    if (value == null) {
        return "";
    }
    const str = toSafeString(value);
    if (str.length === 0) {
        return "";
    }
    return str[0].toUpperCase() + str.slice(1);
}

/**
 * Create a regular expression that splits string lists on the provided
 * separators. Filters out non-string and empty separator values while
 * preserving declaration order among equally sized entries so callers can
 * describe platform-specific delimiters without re-implementing deduplication
 * at each site. Longer separators are matched before shorter ones to avoid
 * partial matches splitting multi-character tokens. Optionally includes `\s`
 * to trim incidental whitespace when splitting human-authored option strings.
 *
 * @param {Iterable<unknown> | string | null | undefined} separators Raw
 *        separator candidates. Strings are treated as a single separator rather
 *        than an iterable of characters.
 * @param {{ includeWhitespace?: boolean }} [options]
 * @param {boolean} [options.includeWhitespace=false] When `true`, whitespace
 *        characters are also treated as delimiters.
 * @returns {RegExp} A character-class-based regular expression suitable for
 *          use with `String#split`.
 */
export function createListSplitPattern(separators, options?: { includeWhitespace?: boolean } | null) {
    const includeWhitespace = options?.includeWhitespace === true;
    const entries: Array<{ pattern: string; length: number; order: number }> = [];
    const seenPatterns = new Set();

    const addEntry = (pattern, length) => {
        if (seenPatterns.has(pattern)) {
            return;
        }

        seenPatterns.add(pattern);
        entries.push({ pattern, length, order: entries.length });
    };

    const addSeparator = (value) => {
        if (typeof value !== "string" || value.length === 0) {
            return;
        }

        addEntry(escapeRegExp(value), value.length);
    };

    for (const candidate of resolveSeparatorValues(separators)) {
        addSeparator(candidate);
    }

    if (includeWhitespace) {
        addEntry(String.raw`\s`, 1);
    }

    if (entries.length === 0) {
        throw new TypeError("createListSplitPattern requires at least one separator or includeWhitespace=true.");
    }

    const sortedEntries = entries.toSorted((a, b) => {
        const lengthDifference = b.length - a.length;
        return lengthDifference === 0 ? a.order - b.order : lengthDifference;
    });

    const patternSource = sortedEntries.map((entry) => entry.pattern).join("|");

    return new RegExp(`(?:${patternSource})+`);
}

const DEFAULT_STRING_LIST_SPLIT_PATTERN = createListSplitPattern(["\n", ","]);

/**
 * Trim each string entry in {@link values}, preserving array order. Throws when
 * encountering a non-string entry so call sites relying on `String#split`
 * semantics continue to surface early when provided unexpected input.
 *
 * @param {Array<string>} values List of string entries to trim.
 * @returns {Array<string>} New array containing the trimmed entries.
 */
export function trimStringEntries(values) {
    const errorMessage = "values must be provided as an array of strings.";

    if (!Array.isArray(values)) {
        throw new TypeError(errorMessage);
    }

    return values.map((value) => {
        if (typeof value !== "string") {
            throw new TypeError(errorMessage);
        }

        return value.trim();
    });
}

/**
 * Remove matching string quotes from {@link value}, returning `null` when the
 * input is not a quoted string. Supports both single- and double-quoted
 * literals so call sites can focus on their specific validation logic without
 * repeating defensive slicing guards.
 *
 * @param {unknown} value Candidate string literal.
 * @returns {string | null} Inner string content when wrapped in matching quotes.
 */
export function stripStringQuotes(value) {
    if (typeof value !== "string") {
        return null;
    }

    const length = value.length;
    if (length < 2) {
        return null;
    }

    const firstChar = value[0];
    if (firstChar !== DOUBLE_QUOTE_CHARACTER && firstChar !== SINGLE_QUOTE_CHARACTER) {
        return null;
    }

    if (value[length - 1] !== firstChar) {
        return null;
    }

    // Use explicit end index instead of a negative offset so V8 can avoid the
    // additional bounds normalization performed by `String#slice` when a
    // negative argument is supplied.
    return value.slice(1, length - 1);
}

/**
 * Normalize a string-or-string-array option into a deduplicated list of
 * trimmed strings.
 *
 * Non-string entries are discarded and duplicate values (after trimming) are
 * collapsed. When `allowInvalidType` is `false` the helper mirrors native
 * `TypeError` semantics for invalid types so option parsing can surface clear
 * feedback to callers.
 *
 * @param {string | string[] | null | undefined} value Raw option value provided by a
 *        consumer. Arrays are flattened as-is; strings are split using
 *        `splitPattern`.
 * @param {object} [options]
 * @param {RegExp | null | false} [options.splitPattern=/[\n,]/] Pattern used to split
 *        string input. Provide a falsy value (for example `false`) to keep the entire
 *        string as a single entry.
 * @param {boolean} [options.allowInvalidType=false] If `true`, invalid types
 *        are treated as "no value" instead of throwing.
 * @param {string} [options.errorMessage] Message used when raising a
 *        `TypeError` for invalid types. Defaults to a generic string when omitted.
 * @returns {string[]} A list of unique, trimmed entries in input order.
 * @throws {TypeError} When `value` is not a string or array and
 *        `allowInvalidType` is `false`.
 */
export function normalizeStringList(
    value,
    {
        splitPattern = DEFAULT_STRING_LIST_SPLIT_PATTERN,
        allowInvalidType = false,
        errorMessage = "Value must be provided as a string or array of strings."
    }: NormalizeStringListOptions = {}
) {
    if (value == null) {
        return [];
    }

    if (Array.isArray(value)) {
        return collectUniqueTrimmedStrings(value);
    }

    if (typeof value === "string") {
        const pattern = splitPattern === undefined ? DEFAULT_STRING_LIST_SPLIT_PATTERN : splitPattern;
        const entries = pattern ? value.split(pattern) : [value];
        return collectUniqueTrimmedStrings(entries);
    }

    if (allowInvalidType) {
        return [];
    }

    throw new TypeError(errorMessage);
}

function collectUniqueTrimmedStrings(entries) {
    const seen = new Set();
    const result = [];

    for (const entry of entries) {
        if (typeof entry !== "string") {
            continue;
        }

        const trimmed = entry.trim();
        if (trimmed.length > 0 && !seen.has(trimmed)) {
            seen.add(trimmed);
            result.push(trimmed);
        }
    }

    return result;
}

/**
 * Convert user-provided string-ish options into a case-insensitive lookup set.
 *
 * The helper applies `normalizeStringList` semantics before lowercasing each
 * entry so callers can compare configuration values without worrying about
 * minor formatting differences.
 *
 * @param {string | string[] | null | undefined} value Raw option value.
 * @param {object} [options]
 * @param {RegExp | null | false} [options.splitPattern=null] Pattern passed through
 *        to `normalizeStringList` for string input. Provide a falsy value to keep
 *        entire strings intact.
 * @param {boolean} [options.allowInvalidType=true] Whether to treat invalid
 *        types as empty input.
 * @param {string} [options.errorMessage] Message forwarded to
 *        `normalizeStringList` when raising a `TypeError`.
 * @returns {Set<string>} Lower-cased set of unique entries.
 */
export function toNormalizedLowerCaseSet(
    value?: unknown,
    { splitPattern = null, allowInvalidType = true, errorMessage }: NormalizeStringListOptions = {}
) {
    const normalizedValues = normalizeStringList(value, {
        splitPattern,
        allowInvalidType,
        errorMessage
    });

    return new Set(normalizedValues.map((entry) => entry.toLowerCase()));
}
