import { Core } from "@gmloop/core";

const RESERVED_PREFIX_PATTERN =
    /^(?<prefix>(?:global|other|self|local|with|noone)\.|argument(?:_(?:local|relative))?(?:\[\d+\]|\d+)?\.?)/;

// Hoist frequently re-created regular expressions so identifier normalization
// can reuse them across calls. This helper runs in tight loops while
// tokenizing identifiers, so avoiding per-call RegExp allocation keeps the hot
// path allocation-free.
const CORE_SEGMENT_DELIMITER_PATTERN = /_+/;
const CASE_SEGMENT_PATTERN = /[A-Z]+(?=[A-Z][a-z0-9])|[A-Z]?[a-z0-9]+|[0-9]+|[A-Z]+/g;
const TOKEN_PART_PATTERN = /[A-Za-z]+|[0-9]+/g;
const NUMBER_ONLY_PATTERN = /^\d+$/;

function extractReservedPrefix(identifier) {
    const match = identifier.match(RESERVED_PREFIX_PATTERN);
    if (!match) {
        return { prefix: "", remainder: identifier };
    }

    const { prefix } = match.groups;
    return { prefix, remainder: identifier.slice(prefix.length) };
}

function splitNumericSuffix(text) {
    if (text.length === 0) {
        return { core: text, suffixSeparator: "", suffixDigits: "" };
    }

    let suffixStart = text.length;
    while (suffixStart > 0) {
        const code = text.charCodeAt(suffixStart - 1);
        if (code < 48 || code > 57) {
            break;
        }
        suffixStart -= 1;
    }

    if (suffixStart === text.length) {
        return { core: text, suffixSeparator: "", suffixDigits: "" };
    }

    let suffixSeparator = "";
    if (suffixStart > 0 && text.charCodeAt(suffixStart - 1) === 95) {
        suffixSeparator = "_";
        suffixStart -= 1;
    }

    const suffixDigits = text.slice(suffixSeparator ? suffixStart + 1 : suffixStart);

    return {
        core: text.slice(0, suffixStart),
        suffixSeparator,
        suffixDigits
    };
}

function stripEdgeUnderscores(text) {
    let start = 0;
    while (start < text.length && text.charCodeAt(start) === 95) {
        start += 1;
    }

    let end = text.length;
    while (end > 0 && text.charCodeAt(end - 1) === 95) {
        end -= 1;
    }

    const leading = text.slice(0, start);
    const trailing = text.slice(end);
    const core = text.slice(start, end);
    return { core, leading, trailing };
}

function tokenizeCore(core) {
    if (!core) {
        return [];
    }

    const rawSegments = Core.compactArray(Core.trimStringEntries(core.split(CORE_SEGMENT_DELIMITER_PATTERN)));

    const tokens = [];
    for (const segment of rawSegments) {
        CASE_SEGMENT_PATTERN.lastIndex = 0;
        let caseMatch = CASE_SEGMENT_PATTERN.exec(segment);
        while (caseMatch !== null) {
            TOKEN_PART_PATTERN.lastIndex = 0;
            let partMatch = TOKEN_PART_PATTERN.exec(caseMatch[0]);
            while (partMatch !== null) {
                const part = partMatch[0];
                NUMBER_ONLY_PATTERN.lastIndex = 0;
                const isNumber = NUMBER_ONLY_PATTERN.test(part);
                const normalized = isNumber ? part : part.toLowerCase();
                tokens.push({ normalized, type: isNumber ? "number" : "word" });
                partMatch = TOKEN_PART_PATTERN.exec(caseMatch[0]);
            }
            caseMatch = CASE_SEGMENT_PATTERN.exec(segment);
        }
    }

    return tokens;
}

function finalizeIdentifier(normalized, base) {
    const suffix = normalized.suffixDigits ? normalized.suffixSeparator + normalized.suffixDigits : "";
    return normalized.prefix + normalized.leadingUnderscores + base + normalized.trailingUnderscores + suffix;
}

function buildWordCase(normalized, transformToken) {
    const { tokens } = normalized;
    if (tokens.length === 0) {
        return finalizeIdentifier(normalized, "");
    }

    let base = "";
    // Avoid `tokens.entries()` or destructuring patterns like `for (const [i, token] of ...)`
    // because they allocate an intermediate iterator and tuple for each element, which adds
    // measurable overhead when formatting large codebases. Identifier case transformations
    // run on every symbol in the AST, so even small per-iteration costs compound quickly.
    // Micro-benchmarks show that a simple index-based loop (manually incrementing `index`)
    // lets V8 stay in fast-path array access without creating ephemeral objects or triggering
    // garbage collection pressure. This is a deliberate tradeoff: the code is slightly more
    // verbose, but the performance gain matters because this function sits in a hot loop
    // that executes thousands of times per file during identifier normalization passes.
    let index = 0;
    for (const token of tokens) {
        base += transformToken(token, index);
        index += 1;
    }

    return finalizeIdentifier(normalized, base);
}

function buildCamelCase(normalized) {
    return buildWordCase(normalized, (token, index) => {
        if (token.type === "number") {
            return token.normalized;
        }

        if (index === 0) {
            return token.normalized;
        }

        return Core.capitalize(token.normalized);
    });
}

function buildPascalCase(normalized) {
    return buildWordCase(normalized, (token) =>
        token.type === "number" ? token.normalized : Core.capitalize(token.normalized)
    );
}

function shouldJoinForSnake(previousToken, currentToken) {
    return (
        (previousToken.type === "word" && currentToken.type === "number") ||
        (previousToken.type === "number" && currentToken.type === "word")
    );
}

function buildSnakeCase(normalized, transform) {
    const { tokens } = normalized;
    if (tokens.length === 0) {
        return finalizeIdentifier(normalized, "");
    }

    let base = transform(tokens[0]);
    for (let index = 1; index < tokens.length; index += 1) {
        const token = tokens[index];
        const previous = tokens[index - 1];
        const text = transform(token);

        base += shouldJoinForSnake(previous, token) ? text : `_${text}`;
    }

    return finalizeIdentifier(normalized, base);
}

function transformSnakeLower(token) {
    return token.normalized;
}

function transformSnakeUpper(token) {
    const { normalized, type } = token;
    if (type === "word") {
        return normalized.toUpperCase();
    }

    return normalized;
}

const IDENTIFIER_CASE_STYLE_METADATA = Object.freeze({
    off: Object.freeze({
        description: "Disable automatic identifier case rewriting."
    }),
    camel: Object.freeze({
        description: "Convert identifiers to lower camelCase (e.g. `exampleName`).",
        format: buildCamelCase
    }),
    pascal: Object.freeze({
        description: "Convert identifiers to Upper PascalCase (e.g. `ExampleName`).",
        format: buildPascalCase
    }),
    "snake-lower": Object.freeze({
        description: "Convert identifiers to lower snake_case (e.g. `example_name`).",
        format: (normalized) => buildSnakeCase(normalized, transformSnakeLower)
    }),
    "snake-upper": Object.freeze({
        description: "Convert identifiers to UPPER_SNAKE_CASE (e.g. `EXAMPLE_NAME`).",
        format: (normalized) => buildSnakeCase(normalized, transformSnakeUpper)
    })
});

export function getIdentifierCaseStyleMetadata(style) {
    const metadata = IDENTIFIER_CASE_STYLE_METADATA[style];
    if (!metadata) {
        throw new Error(`Unsupported identifier case: ${style}`);
    }

    return metadata;
}

function getIdentifierCaseFormatter(style) {
    const metadata = getIdentifierCaseStyleMetadata(style);
    if (typeof metadata.format !== "function") {
        throw new TypeError(`Unsupported identifier case: ${style}`);
    }

    return metadata.format;
}

export function normalizeIdentifierCase(identifier) {
    if (typeof identifier !== "string") {
        throw new TypeError("Identifier must be a string");
    }

    const match = extractReservedPrefix(identifier);
    return buildNormalizedIdentifier(identifier, match);
}

export function formatIdentifierCase(input, style) {
    const normalized = typeof input === "string" ? normalizeIdentifierCase(input) : input;
    const format = getIdentifierCaseFormatter(style);
    return format(normalized);
}

export function isIdentifierCase(identifier, style) {
    const normalized = normalizeIdentifierCase(identifier);
    const format = getIdentifierCaseFormatter(style);
    return format(normalized) === identifier;
}

function normalizeReservedPrefixOverrides(overrides) {
    if (typeof overrides === "string") {
        return [];
    }

    if (overrides == null || typeof overrides[Symbol.iterator] !== "function") {
        return [];
    }

    const entries = Core.normalizeStringList(Core.toArrayFromIterable(overrides));

    // Sort descending by length so longer prefixes are tested first, ensuring
    // correct longest-match semantics. Within equal lengths, sort descending
    // lexicographically to match the original insertion order.
    //
    // The previous insertion-sort-via-reduce created at least one new array per
    // entry (up to three for mid-array inserts), giving O(n) heap allocations
    // immediately discarded. Array.sort operates in-place, eliminating all
    // intermediate arrays and reducing complexity from O(n²) to O(n log n).
    return entries.sort((a, b) => {
        const lengthDiff = b.length - a.length;
        if (lengthDiff !== 0) {
            return lengthDiff;
        }
        // Descending lexicographic: b.localeCompare(a) is positive when b > a,
        // placing lex-greater prefixes first for consistent longest-match resolution.
        return b.localeCompare(a);
    });
}

function extractReservedPrefixWithOverrides(identifier, overrides) {
    const baseMatch = extractReservedPrefix(identifier);
    if (baseMatch.prefix || overrides.length === 0) {
        return baseMatch;
    }

    for (const prefix of overrides) {
        if (identifier.startsWith(prefix)) {
            return { prefix, remainder: identifier.slice(prefix.length) };
        }
    }

    return baseMatch;
}

function buildNormalizedIdentifier(identifier, match) {
    const { core: withoutNumericSuffix, suffixSeparator, suffixDigits } = splitNumericSuffix(match.remainder);
    const { core, leading, trailing } = stripEdgeUnderscores(withoutNumericSuffix);

    const tokens = tokenizeCore(core);

    return {
        original: identifier,
        prefix: match.prefix,
        leadingUnderscores: leading,
        trailingUnderscores: trailing,
        suffixSeparator,
        suffixDigits,
        tokens
    };
}

export function normalizeIdentifierCaseWithOptions(identifier, options: any = {}) {
    const overrides = normalizeReservedPrefixOverrides(options.reservedPrefixes);
    if (overrides.length === 0) {
        return normalizeIdentifierCase(identifier);
    }

    if (typeof identifier !== "string") {
        throw new TypeError("Identifier must be a string");
    }

    const match = extractReservedPrefixWithOverrides(identifier, overrides);
    return buildNormalizedIdentifier(identifier, match);
}

export function formatIdentifierCaseWithOptions(input, style, options: any = {}) {
    const normalized = typeof input === "string" ? normalizeIdentifierCaseWithOptions(input, options) : input;

    const format = getIdentifierCaseFormatter(style);
    return format(normalized);
}

export function isIdentifierCaseWithOptions(identifier, style, options: any = {}) {
    const normalized = normalizeIdentifierCaseWithOptions(identifier, options);
    const format = getIdentifierCaseFormatter(style);
    return format(normalized) === identifier;
}
