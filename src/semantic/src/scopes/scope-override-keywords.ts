/**
 * Scope override keyword for the semantic scope tracker.
 *
 * Using a plain string constant avoids the overhead of maintaining an object
 * wrapper that would require Object.values() and Set lookups when only one
 * value exists. This is intentionally simpler than the historical pattern.
 */
export const SCOPE_OVERRIDE_KEYWORD = "global";

/**
 * Checks whether a value is a recognized scope override keyword.
 */
export function isScopeOverrideKeyword(value: unknown): boolean {
    return value === SCOPE_OVERRIDE_KEYWORD;
}

/**
 * Returns all known scope override keywords as a comma-separated string.
 */
export function formatKnownScopeOverrideKeywords(): string[] {
    return [SCOPE_OVERRIDE_KEYWORD];
}
