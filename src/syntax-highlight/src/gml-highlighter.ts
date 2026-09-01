import {
    GML_BUILTIN_CONSTANTS,
    GML_DIRECTIVES,
    GML_KEYWORDS,
    GML_SYMBOL_OPERATORS,
    GML_WORD_OPERATORS,
    type GmlToken,
    type GmlTokenType
} from "./gml-language-definition.js";

const KEYWORDS = new Set<string>(GML_KEYWORDS);
const BUILTIN_CONSTANTS = new Set<string>(GML_BUILTIN_CONSTANTS);
const WORD_OPERATORS = new Set<string>(GML_WORD_OPERATORS);
const IDENTIFIER_START = /[$_\p{L}]/u;
const IDENTIFIER_PART = /[$_\p{L}\p{Mn}\p{Nd}\p{Pc}]/u;
const HEX_DIGIT = /[0-9a-f]/iu;

function isIdentifierStart(character: string | undefined): boolean {
    return character !== undefined && IDENTIFIER_START.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
    return character !== undefined && IDENTIFIER_PART.test(character);
}

function isDecimalDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
}

function readWhile(source: string, start: number, predicate: (character: string) => boolean): number {
    let end = start;
    while (end < source.length && predicate(source[end])) {
        end += 1;
    }
    return end;
}

function readQuotedString(source: string, start: number, quote: string, verbatim: boolean): number {
    let end = start + (verbatim ? 2 : 1);
    while (end < source.length) {
        if (source[end] === quote) {
            if (verbatim && source[end + 1] === quote) {
                end += 2;
                continue;
            }
            return end + 1;
        }
        if (!verbatim && source[end] === "\\" && end + 1 < source.length) {
            end += 2;
            continue;
        }
        end += 1;
    }
    return end;
}

function readTemplateString(source: string, start: number): number {
    let end = start + 2;
    let interpolationDepth = 0;
    while (end < source.length) {
        if (source[end] === "\\" && end + 1 < source.length) {
            end += 2;
            continue;
        }
        if (source[end] === "{") {
            interpolationDepth += 1;
        } else if (source[end] === "}" && interpolationDepth > 0) {
            interpolationDepth -= 1;
        } else if (source[end] === '"' && interpolationDepth === 0) {
            return end + 1;
        }
        end += 1;
    }
    return end;
}

function readNumber(source: string, start: number): number {
    if (
        (source.startsWith("0x", start) || source[start] === "$" || source[start] === "#") &&
        HEX_DIGIT.test(source[start + (source[start] === "0" ? 2 : 1)] ?? "")
    ) {
        const digitsStart = start + (source[start] === "0" ? 2 : 1);
        return readWhile(source, digitsStart, (character) => character === "_" || HEX_DIGIT.test(character));
    }
    if (source.startsWith("0b", start)) {
        return readWhile(source, start + 2, (character) => character === "_" || character === "0" || character === "1");
    }

    let end =
        source[start] === "."
            ? readWhile(source, start + 1, (character) => isDecimalDigit(character) || character === "_")
            : readWhile(source, start, (character) => isDecimalDigit(character) || character === "_");
    if (source[end] === ".") {
        end = readWhile(source, end + 1, (character) => isDecimalDigit(character) || character === "_");
    }
    if (
        (source[end] === "e" || source[end] === "E") &&
        isDecimalDigit(source[end + 1 + (source[end + 1] === "+" || source[end + 1] === "-" ? 1 : 0)])
    ) {
        const exponentDigitsStart = end + 1 + (source[end + 1] === "+" || source[end + 1] === "-" ? 1 : 0);
        end = readWhile(source, exponentDigitsStart, (character) => isDecimalDigit(character) || character === "_");
    }
    return end;
}

function nextNonWhitespaceCharacter(source: string, start: number): string | undefined {
    let position = start;
    while (position < source.length && /\s/u.test(source[position])) {
        position += 1;
    }
    return source[position];
}

function classifyIdentifier(word: string, source: string, end: number, afterPropertyDot: boolean): GmlTokenType {
    if (afterPropertyDot) return "property-access";
    if (BUILTIN_CONSTANTS.has(word)) return "builtin-constant";
    if (KEYWORDS.has(word)) return "keyword";
    if (WORD_OPERATORS.has(word)) return "operator";
    if (nextNonWhitespaceCharacter(source, end) === "(") return "function-name";
    return "identifier";
}

/** Tokenize GML without changing or dropping any source text. */
export function tokenizeGml(source: string): GmlToken[] {
    const tokens: GmlToken[] = [];
    let position = 0;
    let afterPropertyDot = false;

    const appendToken = (type: GmlTokenType, end: number): void => {
        tokens.push({ type, text: source.slice(position, end) });
        position = end;
    };

    while (position < source.length) {
        const character = source[position];

        if (source.startsWith("//", position)) {
            const end = source.indexOf("\n", position + 2);
            appendToken("comment", end === -1 ? source.length : end);
            afterPropertyDot = false;
            continue;
        }
        if (source.startsWith("/*", position)) {
            const close = source.indexOf("*/", position + 2);
            appendToken("comment", close === -1 ? source.length : close + 2);
            afterPropertyDot = false;
            continue;
        }

        const directive = GML_DIRECTIVES.find((candidate) => source.startsWith(candidate, position));
        if (directive !== undefined && !isIdentifierPart(source[position + directive.length])) {
            appendToken("directive", position + directive.length);
            afterPropertyDot = false;
            continue;
        }

        if (source.startsWith('$"', position)) {
            appendToken("string", readTemplateString(source, position));
            afterPropertyDot = false;
            continue;
        }
        if (character === "@" && (source[position + 1] === '"' || source[position + 1] === "'")) {
            appendToken("string", readQuotedString(source, position, source[position + 1], true));
            afterPropertyDot = false;
            continue;
        }
        if (character === '"' || character === "'") {
            appendToken("string", readQuotedString(source, position, character, false));
            afterPropertyDot = false;
            continue;
        }

        if (
            isDecimalDigit(character) ||
            (character === "." && isDecimalDigit(source[position + 1])) ||
            ((character === "$" || character === "#") && HEX_DIGIT.test(source[position + 1] ?? ""))
        ) {
            appendToken("number", readNumber(source, position));
            afterPropertyDot = false;
            continue;
        }

        if (isIdentifierStart(character)) {
            const end = readWhile(source, position + 1, isIdentifierPart);
            const word = source.slice(position, end);
            appendToken(classifyIdentifier(word, source, end, afterPropertyDot), end);
            afterPropertyDot = false;
            continue;
        }

        const symbolOperator = GML_SYMBOL_OPERATORS.find((operator) => source.startsWith(operator, position));
        if (symbolOperator !== undefined) {
            appendToken("operator", position + symbolOperator.length);
            afterPropertyDot = false;
            continue;
        }

        if (
            source.startsWith("[|", position) ||
            source.startsWith("[?", position) ||
            source.startsWith("[#", position) ||
            source.startsWith("[@", position) ||
            source.startsWith("[$", position)
        ) {
            appendToken("punctuation", position + 2);
            afterPropertyDot = false;
            continue;
        }

        if (character === ".") {
            appendToken("property-access", position + 1);
            afterPropertyDot = true;
            continue;
        }

        if ("[]{}(),;:".includes(character)) {
            appendToken("punctuation", position + 1);
            afterPropertyDot = false;
            continue;
        }

        appendToken("plain", position + 1);
        if (!/\s/u.test(character)) afterPropertyDot = false;
    }

    return tokens;
}

function escapeHtml(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Render GML as escaped HTML spans using stable `gml-*` class names. */
export function highlightGml(source: string): string {
    return tokenizeGml(source)
        .map((token) => `<span class="gml-${token.type}">${escapeHtml(token.text)}</span>`)
        .join("");
}
