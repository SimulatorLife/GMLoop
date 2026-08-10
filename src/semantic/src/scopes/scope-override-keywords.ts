/**
 * Keyword recognised by the semantic scope tracker as a scope override.
 *
 * Exposing the keyword as a plain string literal avoids the overhead of an
 * object/Set wrapper: the tracker only ever needs one value today, and a Set
 * lookup or `Object.values()` enumeration would be strictly more code than
 * the single equality check performed by {@link isScopeOverrideKeyword}.
 */
export const SCOPE_OVERRIDE_KEYWORD = "global";

/**
 * Type guard that reports whether `value` is one of the recognised scope
 * override keywords.
 *
 * @param value - Candidate value; any non-string input (including `null`
 *   and `undefined`) returns `false` because keywords are string literals.
 * @returns `true` when `value` matches a known keyword, `false` otherwise.
 */
export function isScopeOverrideKeyword(value: unknown): boolean {
    return value === SCOPE_OVERRIDE_KEYWORD;
}

/**
 * Returns every recognised scope override keyword as an array.
 *
 * The array is intentionally not joined inside this helper so callers retain
 * control over the separator and surrounding formatting. The error-message
 * path in `ScopeTracker.resolveScopeOverrideFromString` joins the result with
 * `", "` to render a human-readable list.
 *
 * @returns A readonly list containing every known scope override keyword in
 *   the order they should be presented to users.
 */
export function formatKnownScopeOverrideKeywords(): string[] {
    return [SCOPE_OVERRIDE_KEYWORD];
}
