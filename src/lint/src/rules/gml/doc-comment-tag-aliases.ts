const DOC_COMMENT_TAG_ALIAS_REPLACEMENTS = Object.freeze(
    new Map<string, string>([
        ["arg", "param"],
        ["argument", "param"],
        ["params", "param"],
        ["desc", "description"],
        ["exception", "throws"],
        ["hidden", "ignore"],
        ["hide", "ignore"],
        ["output", "returns"],
        ["outputs", "returns"],
        ["overide", "override"],
        ["overidden", "override"],
        ["overridden", "override"],
        ["overrides", "override"],
        ["private", "ignore"],
        ["return", "returns"],
        ["throw", "throws"],
        ["yield", "returns"],
        ["yields", "returns"]
    ])
);

/**
 * Rewrites focused doc-comment tag aliases to their canonical lint names.
 *
 * Function marker aliases are intentionally excluded because
 * `gml/remove-doc-function-tags` owns removing legacy function marker lines.
 *
 * @param line Source line to inspect.
 * @returns The line with a canonical tag name when a focused alias is present.
 */
export function normalizeDocCommentTagAliasLine(line: string): string {
    return line.replace(/^(\s*\/\/\/\s*)@([A-Za-z]+)\b/u, (match, prefix: string, tagName: string) => {
        const replacement = DOC_COMMENT_TAG_ALIAS_REPLACEMENTS.get(tagName.toLowerCase());
        return replacement === undefined ? match : `${prefix}@${replacement}`;
    });
}
