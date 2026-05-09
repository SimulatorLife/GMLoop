import { Core } from "@gmloop/core";

const { toTrimmedString } = Core;

const STRING_TYPE = "string";

const DOC_COMMENT_TAG_PATTERN = /^\s*\/+\s*@/i;
const DOC_COMMENT_ALT_TAG_PATTERN = /^\s*\/+\s*\/\s*@/i;

export type DocCommentMetadata = {
    tag: string;
    name?: string | null;
    type?: string | null;
    description?: string | null;
};

export function isDocCommentTagLine(line: unknown) {
    if (typeof line !== STRING_TYPE) {
        return false;
    }

    const trimmed = toTrimmedString(line);
    return DOC_COMMENT_TAG_PATTERN.test(trimmed) || DOC_COMMENT_ALT_TAG_PATTERN.test(trimmed);
}

export function isFunctionDocCommentLine(line: unknown) {
    if (typeof line !== STRING_TYPE) {
        return false;
    }

    const trimmed = toTrimmedString(line);
    return /^\/\/\/\s*@(?:function|func)\b/i.test(trimmed);
}

export function parseDocCommentMetadata(line: unknown): DocCommentMetadata | null {
    if (typeof line !== STRING_TYPE) {
        return null;
    }

    const trimmed = (line as string).trim();
    const match = trimmed.match(/^\/\/\/\s*@([a-z]+)\b\s*(.*)$/i);
    if (!match) {
        return null;
    }

    const tag = match[1].toLowerCase();
    const remainder = match[2].trim();

    if (tag === "param" || tag === "arg" || tag === "argument") {
        let paramSection = remainder;
        let type = null;

        if (paramSection.startsWith("{")) {
            const typeMatch = paramSection.match(/^\{([^}]*)\}\s*(.*)$/);
            if (typeMatch) {
                type = typeMatch[1]?.trim() ?? null;
                paramSection = typeMatch[2] ?? "";
            }
        } else if (paramSection.startsWith("<")) {
            const typeMatch = paramSection.match(/^<([^>]*)>\s*(.*)$/);
            if (typeMatch) {
                type = typeMatch[1]?.trim() ?? null;
                paramSection = typeMatch[2] ?? "";
            }
        }

        let name = null;
        if (paramSection.startsWith("[")) {
            let depth = 0;
            for (let i = 0; i < paramSection.length; i += 1) {
                const char = paramSection[i];
                if (char === "[") {
                    depth += 1;
                } else if (char === "]") {
                    depth -= 1;
                    if (depth === 0) {
                        name = paramSection.slice(0, i + 1);
                        break;
                    }
                }
            }
        }

        if (!name) {
            const paramMatch = paramSection.match(/^(\S+)/);
            name = paramMatch ? paramMatch[1] : null;
        }

        let description = null;
        if (name) {
            const nameLength = name.length;
            let rawDescription = paramSection.slice(nameLength).trim();
            if (rawDescription.startsWith("-")) {
                rawDescription = rawDescription.slice(1).trim();
            }
            if (rawDescription.length > 0) {
                description = rawDescription;
            }
        }

        return {
            tag,
            name,
            type,
            description
        };
    }

    return { tag, name: remainder };
}
