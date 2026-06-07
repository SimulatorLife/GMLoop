/**
 * GML syntax highlighter that tokenizes GML source code into semantic spans
 * suitable for rendering with CSS syntax highlighting.
 */

export type GmlTokenType =
    | "comment"
    | "keyword"
    | "function-name"
    | "string"
    | "number"
    | "operator"
    | "punctuation"
    | "property-access"
    | "builtin-constant"
    | "plain";

export interface GmlToken {
    readonly type: GmlTokenType;
    readonly text: string;
}

const GML_KEYWORDS = new Set([
    "function",
    "var",
    "if",
    "else",
    "for",
    "foreach",
    "while",
    "do",
    "switch",
    "case",
    "default",
    "break",
    "continue",
    "return",
    "with",
    "exit",
    "repeat",
    "until",
    "global",
    "globalvar",
    "static",
    "enum",
    "true",
    "false",
    "undefined",
    "noone",
    "pointer_invalid",
    "pointer_null",
    "and",
    "or",
    "not"
]);

const GML_BUILTIN_CONSTANTS = new Set(["true", "false", "undefined", "noone", "pointer_invalid", "pointer_null"]);

function isKeyword(word: string): boolean {
    return GML_KEYWORDS.has(word);
}

function isBuiltinConstant(word: string): boolean {
    return GML_BUILTIN_CONSTANTS.has(word);
}

function isDigit(char: string): boolean {
    return char >= "0" && char <= "9";
}

function isIdentStart(char: string): boolean {
    return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_" || char === "$";
}

function isIdentPart(char: string): boolean {
    return isIdentStart(char) || isDigit(char);
}

function classifyWord(word: string, nextChar: string | null): GmlTokenType {
    if (isBuiltinConstant(word)) {
        return "builtin-constant";
    }
    if (isKeyword(word)) {
        return "keyword";
    }
    if (nextChar === "(") {
        return "function-name";
    }
    return "plain";
}

/**
 * Tokenize GML source code into an array of typed tokens.
 */
export function tokenizeGml(source: string): GmlToken[] {
    const tokens: GmlToken[] = [];
    let pos = 0;
    const len = source.length;

    while (pos < len) {
        const ch = source[pos];

        if (ch === "/" && source[pos + 1] === "/") {
            let end = pos + 2;
            while (end < len && source[end] !== "\n") {
                end++;
            }
            tokens.push({ type: "comment", text: source.slice(pos, end) });
            pos = end;
            continue;
        }

        if (ch === "/" && source[pos + 1] === "*") {
            let end = pos + 2;
            while (end < len - 1 && (source[end] !== "*" || source[end + 1] !== "/")) {
                end++;
            }
            end += 2;
            tokens.push({ type: "comment", text: source.slice(pos, end) });
            pos = end;
            continue;
        }

        if (ch === '"' || ch === "'") {
            const quote = ch;
            let end = pos + 1;
            while (end < len) {
                if (source[end] === quote) {
                    end++;
                    break;
                }
                if (source[end] === "\\" && end + 1 < len) {
                    end += 2;
                    continue;
                }
                end++;
            }
            tokens.push({ type: "string", text: source.slice(pos, end) });
            pos = end;
            continue;
        }

        if (isDigit(ch) || (ch === "." && isDigit(source[pos + 1]))) {
            let end = pos;
            if (ch === ".") {
                tokens.push({ type: "punctuation", text: "." });
                pos++;
                continue;
            }
            while (
                end < len &&
                (isDigit(source[end]) ||
                    source[end] === "." ||
                    source[end] === "e" ||
                    source[end] === "E" ||
                    source[end] === "+" ||
                    source[end] === "-")
            ) {
                if (
                    (source[end] === "e" || source[end] === "E") &&
                    end + 1 < len &&
                    (source[end + 1] === "+" || source[end + 1] === "-")
                ) {
                    end++;
                }
                end++;
            }
            tokens.push({ type: "number", text: source.slice(pos, end) });
            pos = end;
            continue;
        }

        if (isIdentStart(ch)) {
            let end = pos + 1;
            while (end < len && isIdentPart(source[end])) {
                end++;
            }
            const word = source.slice(pos, end);
            const nextChar = end < len ? source[end] : null;
            const type = classifyWord(word, nextChar);
            tokens.push({ type, text: word });
            pos = end;
            continue;
        }

        if (ch === ".") {
            // Check if dot is followed by an identifier (skipping whitespace for GML's flexible spacing)
            let nextPos = pos + 1;
            while (nextPos < len && source[nextPos] === " ") {
                nextPos++;
            }
            if (nextPos < len && isIdentStart(source[nextPos])) {
                tokens.push({ type: "property-access", text: "." });
                pos++;
                continue;
            }
        }

        const twoCharOps = ["==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "*=", "/=", "++", "--", "<<", ">>"];
        let matched = false;
        for (const op of twoCharOps) {
            if (source.startsWith(op, pos)) {
                tokens.push({ type: "operator", text: op });
                pos += op.length;
                matched = true;
                break;
            }
        }
        if (matched) continue;

        const lastToken = tokens.at(-1);
        const isAfterOperator = lastToken?.type === "operator";
        if ("+-*/%=<>!&|?:;,[{}()]".includes(ch)) {
            if (ch === "=" && isAfterOperator) {
                // Skip "=" after another operator (part of compound operator already consumed)
            } else if ("+-*/%=<>!&|".includes(ch)) {
                tokens.push({ type: "operator", text: ch });
            } else {
                tokens.push({ type: "punctuation", text: ch });
            }
            pos++;
            continue;
        }

        tokens.push({ type: "plain", text: ch });
        pos++;
    }

    return tokens;
}

/**
 * Convert GML tokens into an HTML string with span elements wrapping each token.
 */
export function highlightGml(source: string): string {
    const tokens = tokenizeGml(source);
    const escaped = tokens.map((token) => {
        const escapedText = token.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        return `<span class="gml-${token.type}">${escapedText}</span>`;
    });
    return escaped.join("");
}
