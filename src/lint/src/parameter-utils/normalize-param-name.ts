/**
 * Utilities for normalizing parameter names in GML documentation.
 *
 * GML convention uses leading underscores to indicate private or internal
 * parameters, but documentation should use the canonical (unprefixed) name.
 * These helpers strip leading underscores consistently across the codebase.
 */

/**
 * Normalize a GML parameter name by removing leading underscores.
 *
 * GML convention prefixes private parameters with underscores (e.g., `_arg`,
 * `__count`). This function removes all leading underscores to produce the
 * canonical documentation name.
 *
 * @param name - The parameter name to normalize.
 * @returns The normalized name with leading underscores removed.
 *
 * @example
 * normalizeDocParamName("_value")  // "value"
 * normalizeDocParamName("__count") // "count"
 * normalizeDocParamName("items")    // "items"
 */
export function normalizeDocParamName(name: string): string {
    return name.replace(/^_+/u, "");
}
