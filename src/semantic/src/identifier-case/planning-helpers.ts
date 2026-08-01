import { Core } from "@gmloop/core";

/** Conflict code emitted when two identifiers collide after renaming. */
export const COLLISION_CONFLICT_CODE = "collision";

/** Conflict code emitted when an identifier is protected by the `preserve` configuration list. */
export const PRESERVE_CONFLICT_CODE = "preserve";

/** Conflict code emitted when an identifier matches an `ignorePatterns` glob and is skipped. */
export const IGNORE_CONFLICT_CODE = "ignored";

/** Conflict code emitted when an identifier clashes with a language-level reserved word. */
export const RESERVED_CONFLICT_CODE = "reserved";

/**
 * Format a human-readable conflict message for an identifier blocked by configuration.
 *
 * Returns `null` when `configConflict` is falsy, allowing callers to skip message
 * creation when no conflict exists.
 *
 * @param configConflict - Conflict descriptor returned by {@link resolveIdentifierConfigurationConflict},
 *        or a falsy value when there is no conflict.
 * @param identifierName - Name of the identifier involved in the conflict.
 * @param noun - Display label for the identifier kind (e.g. `"Variable"`, `"Asset"`).
 *        Defaults to `"Identifier"`.
 * @returns A user-facing conflict message, or `null` if `configConflict` is falsy.
 */
export function formatConfigurationConflictMessage({ configConflict, identifierName, noun = "Identifier" }) {
    if (!configConflict) {
        return null;
    }

    const labelNoun = Core.isNonEmptyString(noun) ? noun : "Identifier";
    const labelName = typeof identifierName === "string" ? identifierName : String(identifierName ?? "");
    const subject = `${labelNoun} '${labelName}'`;

    if (configConflict.code === PRESERVE_CONFLICT_CODE) {
        return `${subject} is preserved by configuration.`;
    }

    if (configConflict.code === IGNORE_CONFLICT_CODE) {
        const ignoreMatch = Core.isNonEmptyString(configConflict.ignoreMatch)
            ? ` matches ignore pattern '${configConflict.ignoreMatch}'.`
            : " is ignored by configuration.";
        return `${subject}${ignoreMatch}`;
    }

    return `${subject} cannot be renamed due to configuration.`;
}

/**
 * Compile a glob-style pattern string into a case-insensitive `RegExp`.
 *
 * Supported wildcards:
 * - `*` — matches any sequence of characters (equivalent to `.*` in regex).
 * - `?` — matches exactly one character (equivalent to `.` in regex).
 *
 * The match is anchored (`^…$`) so the pattern must cover the entire input string.
 * Matching is **case-insensitive** so that identifiers and file paths can be compared
 * without normalizing case first.
 *
 * @param pattern - Glob-style pattern string to compile.
 * @returns A `RegExp` ready for testing, or `null` if the pattern is empty or blank.
 */
export function createPatternRegExp(pattern) {
    if (!Core.isNonEmptyString(pattern)) {
        return null;
    }

    const escaped = Core.escapeRegExp(pattern.trim());
    if (!escaped) {
        return null;
    }

    const wildcardExpanded = escaped.replaceAll(String.raw`\*`, ".*").replaceAll(String.raw`\?`, ".");

    return new RegExp(`^${wildcardExpanded}$`, "i");
}

/**
 * Compile an array of glob patterns into matcher objects for repeated use.
 *
 * Each non-empty, valid pattern is compiled once into a `RegExp` and paired with
 * its original string so that callers can report which pattern triggered a match.
 * Invalid or empty patterns are silently skipped.
 *
 * @param patterns - Array of glob-style pattern strings. `null` and `undefined` are
 *        treated as empty arrays.
 * @returns An array of `{ raw: string; regexp: RegExp }` objects, one per valid pattern.
 *        The array is empty when no valid patterns are provided.
 */
export function buildPatternMatchers(patterns) {
    const matchers = [];

    for (const pattern of patterns ?? []) {
        const regexp = createPatternRegExp(pattern);
        if (!regexp) {
            continue;
        }

        matchers.push({ raw: pattern, regexp });
    }

    return matchers;
}

/**
 * Test whether an identifier name or file path matches any compiled ignore pattern.
 *
 * Both `identifierName` and `filePath` are tested against every matcher, which lets
 * users write a single pattern that suppresses warnings for a whole file
 * (e.g. `"*_legacy.gml"`) or for a specific identifier name (e.g. `"__argN"`).
 *
 * @param matchers - Pre-compiled matcher objects produced by {@link buildPatternMatchers}.
 * @param identifierName - Identifier name to test.
 * @param filePath - File path of the source file containing the identifier.
 * @returns The raw pattern string of the first matcher that fired, or `null` when
 *          no pattern matches. The raw string can be included in diagnostic messages.
 */
export function matchesIgnorePattern(matchers, identifierName, filePath) {
    if (!Core.isNonEmptyArray(matchers)) {
        return null;
    }

    const name = identifierName ?? "";
    const file = filePath ?? "";

    for (const matcher of matchers) {
        if (matcher.regexp.test(name) || matcher.regexp.test(file)) {
            return matcher.raw;
        }
    }

    return null;
}

/**
 * Determine whether an identifier is blocked from renaming by user configuration.
 *
 * Checks are applied in priority order:
 * 1. **Preserve list** — if `identifierName` appears in `preservedSet`, returns a
 *    `{ code: "preserve" }` conflict immediately.
 * 2. **Ignore patterns** — if the identifier name or its file path matches any entry
 *    in `ignoreMatchers`, returns a `{ code: "ignored", ignoreMatch }` conflict.
 * 3. **No conflict** — returns `null` when neither condition applies.
 *
 * @param preservedSet - Set of identifier names that must not be renamed.
 * @param identifierName - Identifier name to check.
 * @param ignoreMatchers - Pre-compiled matchers from {@link buildPatternMatchers}.
 * @param filePath - File path of the source file, used for pattern matching.
 * @returns A conflict descriptor object, or `null` if no configuration conflict exists.
 */
export function resolveIdentifierConfigurationConflict({ preservedSet, identifierName, ignoreMatchers, filePath }) {
    if (identifierName !== undefined && typeof preservedSet?.has === "function" && preservedSet.has(identifierName)) {
        return {
            code: PRESERVE_CONFLICT_CODE,
            reason: "preserve"
        };
    }

    const ignoreMatch = matchesIgnorePattern(ignoreMatchers, identifierName, filePath);

    if (ignoreMatch) {
        return {
            code: IGNORE_CONFLICT_CODE,
            reason: "ignore",
            ignoreMatch
        };
    }

    return null;
}

/**
 * Construct a conflict report object for an identifier case issue.
 *
 * This is the single factory used throughout the identifier-case subsystem to
 * create structured conflict records. Callers should use the `*_CONFLICT_CODE`
 * constants exported from this module as the `code` value.
 *
 * @param code - Machine-readable conflict discriminant (e.g. `COLLISION_CONFLICT_CODE`).
 * @param severity - Severity level from {@link ConflictSeverity} (`"error"`, `"warning"`, `"info"`).
 * @param message - User-facing description of the conflict.
 * @param scope - Scope descriptor object that identifies where the conflict was detected
 *        (e.g. the type and name of the surrounding script or object).
 * @param identifier - The identifier name involved in the conflict.
 * @param suggestions - Optional list of alternative identifier names. Defaults to an empty array.
 * @param details - Optional supplemental context object included for diagnostics. Defaults to `null`.
 * @returns A conflict record ready for accumulation and reporting.
 */
export function createConflict({ code, severity, message, scope, identifier, suggestions = [], details = null }) {
    return {
        code,
        severity,
        message,
        scope,
        identifier,
        suggestions,
        details
    };
}

function resolveFileOccurrenceKey(filePath, fallbackPath) {
    if (Core.isNonEmptyString(filePath)) {
        return filePath;
    }

    if (Core.isNonEmptyString(fallbackPath)) {
        return fallbackPath;
    }

    if (fallbackPath === null) {
        return null;
    }

    return "<unknown>";
}

/**
 * Increment the occurrence count for a file path in a mutable counts map.
 *
 * The key used in `counts` is resolved in this order:
 * 1. `filePath` — used when it is a non-empty string.
 * 2. `fallbackPath` — used when `filePath` is absent but `fallbackPath` is a non-empty string.
 * 3. `"<unknown>"` — used when `fallbackPath` is `undefined` (signals the call site
 *    that a file path was expected but not available).
 * 4. `null` — returned when `fallbackPath` is explicitly `null`, indicating that this
 *    occurrence should be omitted from file-level aggregation.
 *
 * @param counts - Mutable `Map<string, number>` accumulating occurrence counts by file path.
 * @param filePath - Primary file path of the occurrence.
 * @param fallbackPath - Secondary key to use when `filePath` is missing. Pass `null`
 *        to suppress the `"<unknown>"` sentinel and skip the increment entirely.
 *        Defaults to `null`.
 * @returns `true` when a key was resolved and `counts` was updated; `false` when the
 *          key resolved to `null` and the increment was skipped.
 */
export function incrementFileOccurrence(counts, filePath, fallbackPath = null) {
    const key = resolveFileOccurrenceKey(filePath, fallbackPath);
    if (key === null) {
        return false;
    }

    Core.incrementMapValue(counts, key);
    return true;
}

/**
 * Aggregate reference objects into a per-file occurrence summary.
 *
 * Counts how many times each file path appears across `references`, with two
 * optional overrides:
 * - `includeFilePaths` — paths that are seeded into the count before processing
 *   `references` (useful for the definition site, which may not appear as a reference).
 * - `fallbackPath` — key used for references whose `filePath` is absent.  Pass `null`
 *   to silently drop path-less references instead of bucketing them under `"<unknown>"`.
 *
 * @param references - Array of reference objects with a `filePath` string property.
 *        `null` and `undefined` are treated as empty arrays.
 * @param options - Optional configuration.
 * @param options.fallbackPath - Key for references that lack a `filePath`. Defaults to `null`
 *        (path-less references are skipped).
 * @param options.includeFilePaths - Additional file paths to seed the count with before
 *        processing references. Defaults to an empty array.
 * @returns An array of `{ filePath: string; occurrences: number }` entries, one per
 *          distinct file path seen in the references.
 */
export function summarizeReferenceFileOccurrences(references, { fallbackPath = null, includeFilePaths = [] } = {}) {
    const counts = new Map();

    for (const extraPath of includeFilePaths ?? []) {
        if (typeof extraPath !== "string" || extraPath.length === 0) {
            continue;
        }

        incrementFileOccurrence(counts, extraPath);
    }

    for (const reference of references ?? []) {
        const filePath = reference?.filePath;
        incrementFileOccurrence(counts, filePath, fallbackPath);
    }

    return summarizeFileOccurrences(counts);
}

/**
 * Convert a raw occurrence counts map into an array of `{ filePath, occurrences }` entries.
 *
 * This is the final step of the file-occurrence aggregation pipeline. It transforms
 * the mutable `Map<string, number>` produced by {@link incrementFileOccurrence} into
 * a plain array that can be serialized, sorted, or passed to report generators.
 *
 * @param counts - Map of file path → occurrence count, as produced by
 *        {@link incrementFileOccurrence}.
 * @returns Array of `{ filePath: string; occurrences: number }` objects. The iteration
 *          order matches the insertion order of `counts`.
 */
export function summarizeFileOccurrences(counts) {
    return [...counts.entries()].map(([filePath, occurrences]) => ({
        filePath,
        occurrences
    }));
}
