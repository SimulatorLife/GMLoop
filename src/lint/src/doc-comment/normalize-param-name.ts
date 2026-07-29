/**
 * Utilities for normalizing parameter names in GML documentation.
 *
 * GML doc-comment tags carry two prefix conventions that callers routinely
 * want stripped before comparing parameter names:
 *
 * - a leading `*` marks a by-reference argument (e.g. `*func_fx_callback`),
 *   matching the by-reference marker that the
 *   {@link ../rules/gml/rules/normalize-doc-comments-rule.ts | normalize-doc-comments}
 *   pipeline captures in its `*?[A-Za-z0-9_]+` patterns;
 * - a leading `_` (or run of `_`) marks a private or internal parameter
 *   (e.g. `_arg`, `__count`) per the GML convention.
 *
 * Both prefixes are stripped here so downstream matchers (lookups, ordering,
 * dedup) can compare against the canonical, unprefixed identifier regardless
 * of how the source tagged the argument.
 */

/**
 * Normalize a GML parameter name by stripping the doc-comment prefixes that
 * `/// @param` tags may carry.
 *
 * The helper removes, in order:
 *   1. any run of leading `*` characters (the by-reference marker); and
 *   2. any run of leading `_` characters (the private/internal marker).
 *
 * Anything that follows the prefixes is returned unchanged, so the canonical
 * identifier is preserved verbatim for lookups against function declarations
 * or for deduplicating documented `@param` entries. Names without either
 * prefix are returned as-is. The function is pure and does not allocate
 * when neither prefix is present.
 *
 * @param name - The parameter name as parsed from a `/// @param` tag.
 * @returns The canonical parameter name with both prefixes removed.
 *
 * @example
 * normalizeDocParamName("_value")           // "value"
 * normalizeDocParamName("__count")          // "count"
 * normalizeDocParamName("*func_fx_callback") // "func_fx_callback"
 * normalizeDocParamName("*_internal")       // "internal"
 * normalizeDocParamName("items")            // "items"
 */
export function normalizeDocParamName(name: string): string {
    return name.replace(/^\*+/u, "").replace(/^_+/u, "");
}
