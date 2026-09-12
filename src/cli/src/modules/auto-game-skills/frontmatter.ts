/**
 * Minimal Agent Skills frontmatter parser.
 *
 * The Auto-Game surface only needs a single piece of metadata (`description`)
 * from each `SKILL.md` file. The previous implementation delegated this to
 * the `gray-matter` package, which in turn pulled in `js-yaml`. That transitively
 * grew the CLI dependency footprint for a job that the Agent Skills
 * frontmatter format does not actually require: every shipped skill exposes
 * exactly two keys (`name` and `description`) using the flat `key: value` form.
 *
 * This module replaces that dependency with a small, dependency-free parser
 * tailored to the Agent Skills frontmatter shape. It accepts the same delimiter
 * conventions used by `gray-matter` (`---` opens and closes the block, with
 * optional whitespace around the delimiters) and surfaces the parsed metadata
 * under the same `.data` field name so existing call sites can switch with a
 * single import update.
 *
 * The parser is intentionally narrow:
 *
 * - It does **not** implement the full YAML grammar. A skill file that uses
 *   nested mappings, anchors, tags, block scalars, or other advanced YAML
 *   features will surface as an "unreadable" diagnostic and the catalog will
 *   fall back to its default description, which matches the behaviour the
 *   workspace had before with `gray-matter` failures.
 * - It trims surrounding whitespace and an optional UTF-8 BOM from the
 *   document, so leading blank lines and Windows line endings do not break
 *   detection.
 * - Values are returned as strings, booleans, or null. A bare `key:` (with no
 *   value) is treated as `null`, matching the convention used by other
 *   Agent Skills frontmatter readers.
 *
 * When a wider YAML surface becomes necessary, swap this module for a call to
 * a dedicated YAML library; the public contract (`parseSkillFrontmatter`)
 * stays the same so call sites do not need to change.
 */

const FRONTMATTER_DELIMITER = "---";
const DOCUMENT_START_BOM = "\uFEFF";

export type FrontmatterScalar = string | boolean | null;

export type FrontmatterData = Record<string, FrontmatterScalar>;

export interface ParsedSkillFrontmatter {
    data: FrontmatterData;
}

/**
 * Parse the Agent Skills frontmatter block at the head of `source`.
 *
 * The Auto-Game surface treats frontmatter as advisory display metadata:
 * a missing block is a normal "no description" case, but a malformed block
 * (open delimiter with no close delimiter, or non-flat content) is a parse
 * failure. To match that contract, this function returns:
 *
 * - a {@link ParsedSkillFrontmatter} with an empty `data` object when no
 *   frontmatter block is present (mirroring `gray-matter`'s default for
 *   delimiter-less documents),
 * - a {@link ParsedSkillFrontmatter} with the parsed keys when the block is
 *   well-formed, and
 * - `null` only when a frontmatter block is present but cannot be parsed.
 *
 * @param source Raw text of a `SKILL.md` document.
 * @returns A {@link ParsedSkillFrontmatter} for absent or valid blocks, or
 *          `null` when the block is present but malformed.
 */
export function parseSkillFrontmatter(source: string): ParsedSkillFrontmatter | null {
    if (typeof source !== "string" || source.length === 0) {
        return { data: {} };
    }

    const normalizedSource = source.startsWith(DOCUMENT_START_BOM) ? source.slice(DOCUMENT_START_BOM.length) : source;

    const lines = normalizedSource.split(/\r?\n/);
    const openingIndex = findFrontmatterDelimiter(lines, 0);

    if (openingIndex !== 0) {
        return { data: {} };
    }

    const closingIndex = findFrontmatterDelimiter(lines, 1);
    if (closingIndex === -1) {
        return null;
    }

    const frontmatterLines = lines.slice(1, closingIndex);
    return parseFrontmatterLines(frontmatterLines);
}

function findFrontmatterDelimiter(lines: ReadonlyArray<string>, startIndex: number): number {
    for (let index = startIndex; index < lines.length; index += 1) {
        if (isDelimiterLine(lines[index])) {
            return index;
        }
    }

    return -1;
}

function isDelimiterLine(line: string | undefined): boolean {
    if (typeof line !== "string") {
        return false;
    }

    return line.trim() === FRONTMATTER_DELIMITER;
}

function parseFrontmatterLines(lines: ReadonlyArray<string>): ParsedSkillFrontmatter | null {
    const data: FrontmatterData = {};
    let sawKey = false;

    for (const rawLine of lines) {
        const line = rawLine ?? "";
        const trimmed = line.trim();

        if (trimmed.length === 0) {
            continue;
        }

        const separatorIndex = line.indexOf(":");
        if (separatorIndex <= 0) {
            // Agent Skills frontmatter is flat `key: value` pairs. Any line
            // that does not match that shape makes the block unparseable so
            // the catalog can surface it as unreadable rather than silently
            // dropping data.
            return null;
        }

        const key = line.slice(0, separatorIndex).trim();
        if (key.length === 0 || !isSafeKey(key)) {
            return null;
        }

        const rawValue = line.slice(separatorIndex + 1).trim();
        if (!isSafeValue(rawValue)) {
            return null;
        }
        data[key] = coerceScalar(rawValue);
        sawKey = true;
    }

    if (!sawKey) {
        return null;
    }

    return { data };
}

function coerceScalar(rawValue: string): FrontmatterScalar {
    if (rawValue.length === 0) {
        return null;
    }

    const lower = rawValue.toLowerCase();
    if (lower === "true") {
        return true;
    }
    if (lower === "false") {
        return false;
    }
    if (lower === "null" || lower === "~") {
        return null;
    }

    return stripWrappingQuotes(rawValue);
}

function stripWrappingQuotes(value: string): string {
    const firstCharacter = value[0];
    const lastCharacter = value.at(-1);

    if ((firstCharacter === '"' && lastCharacter === '"') || (firstCharacter === "'" && lastCharacter === "'")) {
        return value.slice(1, -1);
    }

    return value;
}

/**
 * Allow only the simple identifier shape that the Agent Skills frontmatter
 * uses for its `name:` and `description:` keys (letters, digits, hyphens,
 * underscores). Anything else signals a non-flat construct that this parser
 * intentionally does not support, so we surface the block as unreadable.
 */
function isSafeKey(key: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key);
}

/**
 * Reject values that contain YAML flow markers or other punctuation that
 * would only appear in nested mappings, sequences, or block scalars. The
 * shipped Agent Skills frontmatter is entirely flat `key: scalar value` so
 * any of these characters are an unambiguous signal that the block is not
 * shaped for this parser.
 */
function isSafeValue(value: string): boolean {
    if (value.length === 0) {
        return true;
    }

    for (const index of value) {
        if (index === "[" || index === "]" || index === "{" || index === "}" || index === "#") {
            return false;
        }
    }

    return true;
}
