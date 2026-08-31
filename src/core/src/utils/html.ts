const AMP_LT_GT_QUOT_PATTERN = /[&<>"]/g;
const AMP_LT_GT_QUOT_REPLACEMENTS: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
};

/**
 * Escape the entities common to both HTML and XML attribute values (`&`, `<`,
 * `>`, `"`). Callers append their own apostrophe encoding on top, since HTML
 * and XML disagree on the canonical form (`&#39;` vs `&apos;`).
 */
function escapeSharedAttributeEntities(value: string): string {
    return value.replaceAll(AMP_LT_GT_QUOT_PATTERN, (character) => AMP_LT_GT_QUOT_REPLACEMENTS[character] ?? character);
}

/**
 * Escape a string for safe interpolation into an HTML attribute value.
 *
 * Encodes `&`, `<`, `>`, `"`, and `'` (as the numeric `&#39;` form used by the
 * HTML5 spec) so the resulting text cannot break out of a quoted attribute or
 * be misparsed as markup.
 *
 * @param value Raw text to escape.
 * @returns HTML-attribute-safe text.
 */
export function escapeHtmlAttribute(value: string): string {
    return escapeSharedAttributeEntities(value).replaceAll("'", "&#39;");
}

/**
 * Escape a string for safe interpolation into an XML attribute value.
 *
 * Encodes `&`, `<`, `>`, `"`, and `'` (as the named `&apos;` form required by
 * the XML spec) so the resulting text cannot break out of a quoted attribute
 * or be misparsed as markup.
 *
 * @param value Raw text to escape.
 * @returns XML-attribute-safe text.
 */
export function escapeXmlAttribute(value: string): string {
    return escapeSharedAttributeEntities(value).replaceAll("'", "&apos;");
}
