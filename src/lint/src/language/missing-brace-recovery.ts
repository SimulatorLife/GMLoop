import { Core } from "@gmloop/core";

/**
 * Attempts language-owned parser recovery for a missing closing brace error.
 *
 * The two-tier malformed-code contract keeps token-level source fixes in the
 * malformed layer while structural parse recovery remains part of the lint
 * language parser. This helper appends only the closing braces required to let
 * AST-based linting continue after the parser has already identified a missing
 * associated closing brace.
 *
 * @param sourceText - Raw GML source code that failed to parse.
 * @param error - Parser error from the failed parse attempt.
 * @returns Source text with appended closing braces, or null if recovery is not applicable.
 */
export function recoverParseSourceFromMissingBrace(sourceText: string, error: unknown): string | null {
    if (!isMissingClosingBraceError(error)) {
        return null;
    }

    const appended = appendMissingClosingBraces(sourceText);

    return appended === sourceText ? null : appended;
}

/**
 * Determines whether an error indicates missing closing braces.
 */
function isMissingClosingBraceError(error: unknown): boolean {
    const message = extractErrorMessage(error);

    return Core.isNonEmptyString(message) && message.toLowerCase().includes("missing associated closing brace");
}

/**
 * Extracts a human-readable error message from unknown error input.
 */
function extractErrorMessage(error: unknown): string {
    if (!error) {
        return "";
    }

    if (Core.isNonEmptyString(error)) {
        return String(error);
    }

    if (typeof error === "object" && "message" in error) {
        const message = error.message;
        return Core.isNonEmptyString(message) ? String(message) : "";
    }

    return "";
}

/**
 * Appends the necessary number of closing braces to balance unclosed opening braces.
 */
function appendMissingClosingBraces(sourceText: string): string {
    if (!Core.isNonEmptyString(sourceText)) {
        return sourceText;
    }

    const missingBraceCount = countUnclosedBraces(sourceText);

    if (missingBraceCount <= 0) {
        return sourceText;
    }

    let normalized = sourceText;

    if (!normalized.endsWith("\n")) {
        normalized += "\n";
    }

    const closingLines = Array.from({ length: missingBraceCount }, () => "}").join("\n");

    return `${normalized}${closingLines}`;
}

/**
 * Counts the number of unclosed opening braces in the source text.
 *
 * Skips braces that appear in comments or strings to avoid false positives.
 */
type BraceScannerState = {
    depth: number;
    inSingleLineComment: boolean;
    inBlockComment: boolean;
    stringDelimiter: string | null;
    isEscaped: boolean;
};

function countUnclosedBraces(sourceText: string): number {
    const state: BraceScannerState = {
        depth: 0,
        inSingleLineComment: false,
        inBlockComment: false,
        stringDelimiter: null,
        isEscaped: false
    };

    for (let index = 0; index < sourceText.length; index += 1) {
        index += consumeBraceScannerCharacter(state, sourceText[index], sourceText[index + 1]);
    }

    return state.depth;
}

function consumeBraceScannerCharacter(state: BraceScannerState, char: string, nextChar: string | undefined): number {
    if (state.stringDelimiter !== null) {
        return consumeStringCharacter(state, char);
    }

    if (state.inSingleLineComment) {
        if (char === "\n" || char === "\r") {
            state.inSingleLineComment = false;
        }

        return 0;
    }

    if (state.inBlockComment) {
        if (char === "*" && nextChar === "/") {
            state.inBlockComment = false;
            return 1;
        }

        return 0;
    }

    if (char === "/" && nextChar === "/") {
        state.inSingleLineComment = true;
        return 1;
    }

    if (char === "/" && nextChar === "*") {
        state.inBlockComment = true;
        return 1;
    }

    if (char === "'" || char === '"') {
        state.stringDelimiter = char;
        return 0;
    }

    if (char === "{") {
        state.depth += 1;
        return 0;
    }

    if (char === "}" && state.depth > 0) {
        state.depth -= 1;
    }

    return 0;
}

function consumeStringCharacter(state: BraceScannerState, char: string): number {
    if (state.isEscaped) {
        state.isEscaped = false;
        return 0;
    }

    if (char === "\\") {
        state.isEscaped = true;
        return 0;
    }

    if (char === state.stringDelimiter) {
        state.stringDelimiter = null;
    }

    return 0;
}
