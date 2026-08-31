const DOC_COMMENT_TAG_ALIAS_REPLACEMENTS = Object.freeze(
    new Map<string, string>([
        ["arg", "param"],
        ["argument", "param"],
        ["params", "param"],
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

const DOC_COMMENT_TAG_ALIAS_LINE_PATTERN = /^(?<prefix>\s*\/\/\/\s*)@(?<tagName>[A-Za-z]+)\b/u;

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
    return line.replace(DOC_COMMENT_TAG_ALIAS_LINE_PATTERN, (match, ...args) => {
        const groups = (args.at(-1) ?? {}) as { prefix?: string; tagName?: string };
        const tagName = groups.tagName ?? "";
        const prefix = groups.prefix ?? "";
        const replacement = DOC_COMMENT_TAG_ALIAS_REPLACEMENTS.get(tagName.toLowerCase());
        return replacement === undefined ? match : `${prefix}@${replacement}`;
    });
}
