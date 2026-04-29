import { getNonEmptyString } from "../../utils/string.js";

export interface DocCommentStringCoercions {
    coerceNonEmptyString(value: string): string | null;
}

export const defaultDocCommentStringCoercions: DocCommentStringCoercions = Object.freeze({
    coerceNonEmptyString: getNonEmptyString
});

const STRING_TYPE = "string";

function unwrapOptionalParamToken(tokenText: string): string {
    if (!tokenText.startsWith("[")) {
        return tokenText;
    }

    let bracketDepth = 0;

    for (const [index, char] of Array.from(tokenText).entries()) {
        if (char === "[") {
            bracketDepth += 1;
            continue;
        }

        if (char !== "]") {
            continue;
        }

        bracketDepth -= 1;
        if (bracketDepth === 0) {
            return index > 0 ? tokenText.slice(1, index) : tokenText;
        }
    }

    return tokenText;
}

export function normalizeOptionalParamToken(token: unknown) {
    if (typeof token !== STRING_TYPE) {
        return token;
    }

    const stringToken = token as string;
    const trimmed = stringToken.trim();

    if (/^\[[^\]]+\]$/.test(trimmed)) {
        return trimmed;
    }

    const stripped = trimmed.replaceAll(/^\*+|\*+$/g, "");

    if (stripped === trimmed) {
        return trimmed;
    }

    const normalized = stripped.trim();

    if (normalized.length === 0) {
        return stripped.replaceAll("*", "");
    }

    return `[${normalized}]`;
}

export function stripSyntheticParameterSentinels(name: unknown) {
    if (typeof name !== STRING_TYPE) {
        return name;
    }

    let sanitized = name as string;
    sanitized = sanitized.replace(/^[_$]+/, "");
    sanitized = sanitized.replace(/[_$]+$/, "");

    return sanitized.length > 0 ? sanitized : name;
}

export function normalizeDocMetadataName(name: unknown) {
    if (typeof name !== STRING_TYPE) {
        return name;
    }

    const optionalNormalized = normalizeOptionalParamToken(name);
    if (typeof optionalNormalized === STRING_TYPE) {
        const normalizedString = optionalNormalized as string;
        if (/^\[[^\]]+\]$/.test(normalizedString)) {
            return normalizedString;
        }

        const sanitized = stripSyntheticParameterSentinels(normalizedString);
        return (sanitized as string).length > 0 ? sanitized : normalizedString;
    }

    return name;
}

export function getCanonicalParamNameFromText(name: unknown): string | null {
    if (typeof name !== STRING_TYPE) {
        return null;
    }

    let trimmed = unwrapOptionalParamToken((name as string).trim());

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex !== -1) {
        trimmed = trimmed.slice(0, equalsIndex);
    }

    const normalized = normalizeDocMetadataName(trimmed.trim());
    if (typeof normalized !== STRING_TYPE) {
        return null;
    }

    const normalizedString = (normalized as string).trim();
    return normalizedString.length > 0 ? normalizedString : null;
}

export function docParamNamesLooselyEqual(left: unknown, right: unknown) {
    if (typeof left !== STRING_TYPE || typeof right !== STRING_TYPE) {
        return false;
    }

    const toComparable = (value: unknown) => {
        const normalized = normalizeDocMetadataName(value);
        if (typeof normalized !== STRING_TYPE) {
            return null;
        }

        let trimmed = (normalized as string).trim();
        if (trimmed.length === 0) {
            return null;
        }

        if (trimmed.startsWith("[") && trimmed.endsWith("]") && trimmed.length > 2) {
            trimmed = trimmed.slice(1, -1).trim();
        }

        return trimmed.toLowerCase();
    };

    const leftComp = toComparable(left);
    const rightComp = toComparable(right);

    return leftComp !== null && rightComp !== null && leftComp === rightComp;
}

export function isOptionalParamDocName(name: unknown) {
    if (typeof name !== STRING_TYPE) {
        return false;
    }
    const trimmed = (name as string).trim();
    return trimmed.startsWith("[") && trimmed.endsWith("]");
}

export function normalizeParamDocType(
    typeText: string,
    coercions: DocCommentStringCoercions = defaultDocCommentStringCoercions
) {
    return coercions.coerceNonEmptyString(typeText);
}

export const preservedUndefinedDefaultParameters = new WeakSet<any>();
export const synthesizedUndefinedDefaultParameters = new WeakSet<any>();
