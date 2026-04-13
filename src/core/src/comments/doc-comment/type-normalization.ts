import { assertFunction, capitalize, getNonEmptyString, getNonEmptyTrimmedString } from "../../utils/index.js";
import { normalizeOptionalParamToken } from "./params.js";

const STRING_TYPE = "string" as const;

const JSDOC_REPLACEMENTS = {
    "@func": "@function",
    "@funct": "@function",
    "@method": "@function",
    "@yield": "@returns",
    "@yields": "@returns",
    "@return": "@returns",
    "@output": "@returns",
    "@outputs": "@returns",
    "@desc": "@description",
    "@arg": "@param",
    "@argument": "@param",
    "@params": "@param",
    "@overrides": "@override",
    "@overide": "@override",
    "@overridden": "@override",
    "@exception": "@throws",
    "@throw": "@throws",
    "@private": "@ignore",
    "@hidden": "@ignore",
    "@hide": "@ignore"
};

const JSDOC_REPLACEMENT_RULES = Object.entries(JSDOC_REPLACEMENTS).map(([oldWord, newWord]) => ({
    regex: new RegExp(String.raw`(\/\/\/\s*)${oldWord}\b`, "gi"),
    replacement: newWord
}));

const FUNCTION_LIKE_DOC_TAG_PATTERN = /@(func(?:tion)?|method)\b/i;

const FUNCTION_SIGNATURE_PATTERN = /(^|\n)(\s*\/\/\/\s*@function\b[^\r\n]*?)(\s*\([^)]*\))(\s*(?=\n|$))/gi;

const DOC_COMMENT_TYPE_PATTERN = /\{([^}]+)\}/g;

export const DEFAULT_DOC_COMMENT_TYPE_NORMALIZATION = Object.freeze({
    synonyms: Object.freeze([
        // This maps common possible types to a standardized GML type/form
        ["void", "undefined"],
        ["null", "undefined"],
        ["*", "any"],
        ["unknown", "any"],
        ["number", "real"],
        ["bigint", "int64"],
        ["uint64", "int64"],
        ["uint32", "int32"],
        ["uint16", "int16"],
        ["uint8", "int8"],
        ["float", "real"],
        ["double", "real"],
        ["decimal", "real"],
        ["int", "real"],
        ["boolean", "bool"]
    ]),
    nativeTypes: Object.freeze([
        // These types, when printed out, will use this exact casing (all lowercase)
        // See: https://manual.gamemaker.io/beta/en/The_Asset_Editors/Code_Editor_Properties/Feather_Data_Types.htm
        // NOTE: JSDoc base types are case-insensitive, so string and String are the same.
        // Specifiers (after the .) are case-sensitive, meaning Id.DsList is valid (referring
        // to a DS List) but Id.dslist is not.

        // Allow this group to be recognized as native types and specifiers
        // So, for example, these are all valid:
        /// @param {Struct.MyStruct}
        /// @param {Struct}
        /// @param {Asset.GMSprite}
        /// @param {Constant}
        // ...
        "struct",
        "asset",
        "constant",

        // For this group, these are not a native types
        // But included for normalization purposes
        "enum",
        "method",

        // Others
        "undefined",
        "real",
        "string",
        "array",
        "pointer",
        "any",
        "int64",
        "int32",
        "int16",
        "int8"
    ]),
    specifierPrefixes: Object.freeze([
        // Used for type specifiers like Asset.GMSprite, Id.Buffer, etc.
        // These are case-insensitive for normalization purposes
        // But will be capitalized when printed out
        "asset",
        "constant",
        "id",
        "struct"
    ])
});

let customResolver: ((options?: unknown) => unknown) | null = null;
let cachedDefault: ReturnType<typeof createDocCommentTypeNormalization> | null = null;

export function resolveDocCommentTypeNormalization(options: unknown = {}) {
    if (!customResolver) {
        if (!cachedDefault) {
            cachedDefault = createDocCommentTypeNormalization(DEFAULT_DOC_COMMENT_TYPE_NORMALIZATION);
        }
        return cachedDefault;
    }
    const result = customResolver(options);
    return createDocCommentTypeNormalization(result);
}

export function setDocCommentTypeNormalizationResolver(resolver: unknown) {
    assertFunction(resolver, "resolver", {
        errorMessage:
            "Doc comment type normalization resolvers must be functions that return a normalization descriptor"
    });
    customResolver = resolver as (options?: unknown) => unknown;
    return resolveDocCommentTypeNormalization();
}

export function restoreDefaultDocCommentTypeNormalizationResolver() {
    customResolver = null;
    cachedDefault = null;
    return resolveDocCommentTypeNormalization();
}

/**
 * Replaces legacy JSDoc/GML tag aliases with their canonical tag names
 * without mutating type annotation spellings or other metadata text.
 */
export function applyJsDocTagAliasReplacements(text: unknown) {
    if (typeof text !== "string") {
        return text;
    }

    let normalizedText: string = text;
    for (const { regex, replacement } of JSDOC_REPLACEMENT_RULES) {
        regex.lastIndex = 0;
        normalizedText = normalizedText.replace(regex, `$1${replacement}`);
    }

    return normalizedText;
}

export function applyJsDocReplacements(text: unknown) {
    const isStringText = typeof text === STRING_TYPE;
    const shouldStripEmptyParams = isStringText && FUNCTION_LIKE_DOC_TAG_PATTERN.test(text as string);

    let formattedText: unknown = text;

    if (isStringText) {
        let stringText: string = shouldStripEmptyParams ? (text as string).replace(/\(\)\s*$/, "") : (text as string);
        const aliasReplacedText = applyJsDocTagAliasReplacements(stringText);
        if (typeof aliasReplacedText === "string") {
            stringText = aliasReplacedText;
        }

        stringText = stripTrailingFunctionParameters(stringText);
        stringText = normalizeDocTagSpacing(stringText);
        stringText = normalizeFeatherOptionalParamSyntax(stringText);

        formattedText = stringText;
    }

    if (typeof formattedText !== STRING_TYPE) {
        return formattedText;
    }

    return normalizeDocCommentTypeAnnotations(formattedText as string);
}

function normalizeDocTagSpacing(text: string) {
    let normalized = text.replaceAll(/(@[a-zA-Z]+)\s{2,}/g, "$1 ");
    normalized = normalized.replaceAll(/(\{[^}]+\})\s{2,}/g, "$1 ");
    return normalized;
}

function normalizeFeatherOptionalParamSyntax(text: string) {
    if (typeof text !== STRING_TYPE || !/@param\b/i.test(text)) {
        return text;
    }

    return text.replace(
        /(\s*\/\/\/\s*@param(?:\s+\{[^}]+\})?\s*)(\S+)/i,
        (match: string, prefix: string, token: string) => {
            const normalizedToken = normalizeOptionalParamToken(token);
            const normalizedTokenText = getDocCommentTokenText(normalizedToken, token);
            return `${prefix}${normalizedTokenText}`;
        }
    );
}

function stripTrailingFunctionParameters(text: string) {
    if (typeof text !== STRING_TYPE || !/@function\b/i.test(text)) {
        return text;
    }

    return text.replaceAll(
        FUNCTION_SIGNATURE_PATTERN,
        (match, linePrefix, functionPrefix) => `${linePrefix}${functionPrefix.replace(/\s+$/, "")}`
    );
}

function getDocCommentTokenText(value: unknown, fallback: string) {
    return typeof value === "string" ? value : fallback;
}

export function normalizeDocCommentTypeAnnotations(text: string) {
    if (typeof text !== STRING_TYPE || !text.includes("{")) {
        return text;
    }

    DOC_COMMENT_TYPE_PATTERN.lastIndex = 0;
    return text.replace(DOC_COMMENT_TYPE_PATTERN, (match, typeText) => {
        const normalized = normalizeGameMakerType(typeText);
        return `{${normalized}}`;
    });
}

export function normalizeGameMakerType(typeText: string) {
    if (typeof typeText !== STRING_TYPE) {
        return typeText;
    }

    const docCommentTypeNormalization = resolveDocCommentTypeNormalization();
    const segments: Array<{ type: "identifier" | "separator"; value: string }> = [];
    const tokenPattern = /([A-Za-z_][A-Za-z0-9_]*)|([^A-Za-z_]+)/g;
    let match;

    while ((match = tokenPattern.exec(typeText)) !== null) {
        if (match[1]) {
            const identifier = match[1];
            const normalizedIdentifier = docCommentTypeNormalization.lookupTypeIdentifier(identifier) ?? identifier;
            segments.push({
                type: "identifier",
                value: normalizedIdentifier
            });
            continue;
        }

        if (match[2]) {
            segments.push({ type: "separator", value: match[2] });
        }
    }

    const findNextNonWhitespaceSegment = (startIndex: number) => {
        for (let index = startIndex; index < segments.length; index += 1) {
            const segment = segments[index];
            if (segment && segment.type === "separator" && /^\s+$/.test(segment.value)) {
                continue;
            }

            return segment ?? null;
        }

        return null;
    };

    const outputSegments: string[] = [];

    const isDotSeparatedTypeSpecifierPrefix = (prefixIndex: number) => {
        let sawDot = false;

        for (let index = prefixIndex + 1; index < segments.length; index += 1) {
            const candidate = segments[index];
            if (!candidate) {
                continue;
            }

            if (candidate.type === "separator") {
                const trimmed = getNonEmptyTrimmedString(candidate.value);

                if (!trimmed) {
                    continue;
                }

                if (trimmed.startsWith(".")) {
                    sawDot = true;
                    continue;
                }

                return false;
            }

            if (candidate.type === "identifier") {
                return sawDot;
            }

            return false;
        }

        return false;
    };

    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (!segment) {
            continue;
        }

        if (segment.type === "identifier") {
            let normalizedValue: unknown = segment.value;

            if (typeof normalizedValue === STRING_TYPE) {
                const canonicalPrefix = docCommentTypeNormalization.getCanonicalSpecifierName(normalizedValue) as
                    | string
                    | null;

                if (typeof canonicalPrefix === "string" && isDotSeparatedTypeSpecifierPrefix(index)) {
                    normalizedValue = canonicalPrefix;
                }
            }

            outputSegments.push(normalizedValue as string);
            continue;
        }

        const separatorValue = segment.value ?? "";
        if (separatorValue.length === 0) {
            continue;
        }

        if (/^\s+$/.test(separatorValue)) {
            const previous = segments[index - 1];
            const next = segments[index + 1];
            const nextToken = findNextNonWhitespaceSegment(index + 1);

            if (nextToken && nextToken.type === "separator" && /^[[(<>{})]/.test(nextToken.value.trim())) {
                continue;
            }

            const previousIdentifier = previous && previous.type === "identifier" ? previous.value : null;
            const nextIdentifier = next && next.type === "identifier" ? next.value : null;

            if (!previousIdentifier || !nextIdentifier) {
                continue;
            }

            if (docCommentTypeNormalization.hasSpecifierPrefix(previousIdentifier)) {
                const canonicalPrefix = docCommentTypeNormalization.getCanonicalSpecifierName(previousIdentifier);
                if (canonicalPrefix && outputSegments.length > 0) {
                    outputSegments[outputSegments.length - 1] = canonicalPrefix as string;
                }
                outputSegments.push(".");
            } else {
                outputSegments.push(",");
            }

            continue;
        }

        let normalizedSeparator = separatorValue.replaceAll(/\s+/g, "");
        if (normalizedSeparator.length === 0) {
            continue;
        }

        normalizedSeparator = normalizedSeparator.replaceAll("|", ",");
        outputSegments.push(normalizedSeparator);
    }

    return outputSegments.join("");
}

function normalizeEntryPair(entry: unknown) {
    if (Array.isArray(entry)) {
        return entry.length >= 2 ? [entry[0], entry[1]] : null;
    }

    if (!entry || typeof entry !== "object") {
        return null;
    }

    if (Object.hasOwn(entry, 0) && Object.hasOwn(entry, 1)) {
        const arr = entry as any;
        return [arr[0], arr[1]];
    }

    if (Object.hasOwn(entry, "key") && Object.hasOwn(entry, "value")) {
        const obj = entry as Record<string, unknown>;
        return [obj.key, obj.value];
    }

    return null;
}

function normalizeDocCommentLookupKey(identifier: unknown) {
    const trimmed = getNonEmptyTrimmedString(identifier);
    if (!trimmed) {
        return null;
    }

    const normalized = trimmed.toLowerCase();
    if (normalized.length === 0) {
        return null;
    }

    return normalized;
}

function createDocCommentTypeNormalization(candidate: unknown) {
    const synonyms = new Map<string, string>();
    for (const [key, value] of DEFAULT_DOC_COMMENT_TYPE_NORMALIZATION.synonyms) {
        synonyms.set(key.toLowerCase(), value);
    }

    const nativeTypes = new Set(DEFAULT_DOC_COMMENT_TYPE_NORMALIZATION.nativeTypes);

    const specifierPrefixes = new Set(
        DEFAULT_DOC_COMMENT_TYPE_NORMALIZATION.specifierPrefixes.map((value) => value.toLowerCase())
    );

    if (candidate && typeof candidate === "object") {
        const cand = candidate as Record<string, unknown>;
        mergeNormalizationEntries(synonyms, cand.synonyms);
        mergeSpecifierPrefixes(specifierPrefixes, cand.specifierPrefixes);
    }

    return Object.freeze({
        lookupTypeIdentifier(identifier: unknown) {
            return withNormalizedDocCommentLookup(
                identifier,
                (normalized) => {
                    const synonym = synonyms.get(normalized);
                    if (synonym) {
                        return synonym;
                    }

                    if (nativeTypes.has(normalized)) {
                        return normalized;
                    }

                    return null;
                },
                null
            );
        },
        getCanonicalSpecifierName(identifier: unknown) {
            return withNormalizedDocCommentLookup(
                identifier,
                (normalized) => {
                    if (specifierPrefixes.has(normalized)) {
                        return capitalize(normalized);
                    }
                    return null;
                },
                null
            );
        },
        hasSpecifierPrefix(identifier: unknown) {
            return withNormalizedDocCommentLookup(identifier, (normalized) => specifierPrefixes.has(normalized), false);
        }
    });
}

function withNormalizedDocCommentLookup(
    identifier: unknown,
    handler: (normalized: string) => unknown,
    fallbackValue: unknown
) {
    if (typeof handler !== "function") {
        throw new TypeError("Doc comment lookup handler must be provided as a function.");
    }

    const normalized = normalizeDocCommentLookupKey(identifier);
    if (!normalized) {
        return fallbackValue;
    }

    return handler(normalized);
}

function mergeNormalizationEntries(target: Map<string, string>, entries: unknown) {
    if (!entries) {
        return;
    }

    for (const [rawKey, rawValue] of getEntryIterable(entries) ?? []) {
        const key = normalizeDocCommentLookupKey(rawKey);
        const value = getNonEmptyString(rawValue);
        if (!key || !value) {
            continue;
        }
        target.set(key, value);
    }
}

function mergeSpecifierPrefixes(target: Set<string>, candidates: unknown) {
    if (!candidates) {
        return;
    }

    for (const candidate of toIterable(candidates)) {
        const normalized = normalizeDocCommentLookupKey(candidate);
        if (!normalized) {
            continue;
        }
        target.add(normalized);
    }
}

function tryGetEntriesIterator(candidate: unknown) {
    if (!candidate || Array.isArray(candidate) || (typeof candidate !== "object" && typeof candidate !== "function")) {
        return null;
    }

    const { entries } = candidate as { entries?: () => Iterator<unknown> };
    if (typeof entries !== "function") {
        return null;
    }

    try {
        const iterator = entries.call(candidate);
        if (iterator && typeof iterator[Symbol.iterator] === "function") {
            return iterator;
        }
    } catch {
        return null;
    }

    return null;
}

function* getEntryIterable(value: unknown) {
    if (!value) {
        return;
    }

    const entriesIterator = tryGetEntriesIterator(value);
    if (entriesIterator) {
        for (const entry of entriesIterator) {
            const pair = normalizeEntryPair(entry);
            if (pair) {
                yield pair;
            }
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const entry of value) {
            const pair = normalizeEntryPair(entry);
            if (pair) {
                yield pair;
            }
        }
        return;
    }

    if (typeof value === "object") {
        yield* Object.entries(value);
    }
}

function* toIterable(value: unknown) {
    if (value == null) {
        return;
    }

    if (typeof value === STRING_TYPE) {
        yield value;
        return;
    }

    if (typeof value[Symbol.iterator] === "function") {
        yield* value as Iterable<unknown>;
        return;
    }

    if (typeof value === "object") {
        yield* Object.values(value as Record<string, unknown>);
    }
}
