import { Core } from "@gmloop/core";

import type { RepairArgumentSeparatorsEdit, RepairArgumentSeparatorsResult } from "../../types.js";
import { applySourceTextEdits } from "../codemod-helpers.js";

/**
 * Repairs missing argument separators (commas) in function calls (e.g. `foo(a b c)` to `foo(a, b, c)`).
 */
export function applyRepairArgumentSeparatorsCodemod(sourceText: string): RepairArgumentSeparatorsResult {
    if (!sourceText) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    const edits: RepairArgumentSeparatorsEdit[] = [];
    const recoveryScanSource = maskCommentsAndStringsForRecovery(sourceText);
    let index = 0;

    while (index < sourceText.length) {
        const character = recoveryScanSource[index] ?? "";
        if (!/\s/u.test(character)) {
            index += 1;
            continue;
        }

        const whitespaceRunStart = index;
        while (index < sourceText.length && /\s/u.test(recoveryScanSource[index] ?? "")) {
            index += 1;
        }
        const whitespaceRunEnd = index - 1;

        const previousIndex = findPreviousNonWhitespaceIndex(recoveryScanSource, whitespaceRunStart, false);
        const nextIndex = findNextNonWhitespaceIndex(recoveryScanSource, whitespaceRunEnd);
        if (previousIndex === null || nextIndex === null) {
            continue;
        }

        const prevChar = recoveryScanSource[previousIndex] ?? "";
        if (!canTerminateArgumentExpression(prevChar)) {
            continue;
        }

        if (isIdentifierCharacter(prevChar)) {
            const token = readIdentifierTokenEndingAt(recoveryScanSource, previousIndex);
            if (token && NON_CALL_PREFIX_KEYWORDS.has(token.value.toLowerCase())) {
                continue;
            }
        }

        const nextChar = recoveryScanSource[nextIndex] ?? "";
        if (!canStartArgumentExpression(nextChar)) {
            continue;
        }

        if (isIdentifierCharacter(nextChar)) {
            const token = readIdentifierTokenStartingAt(recoveryScanSource, nextIndex);
            if (
                token &&
                NON_CALL_PREFIX_KEYWORDS.has(token.toLowerCase()) &&
                token.toLowerCase() !== "new" &&
                token.toLowerCase() !== "not" &&
                token.toLowerCase() !== "function"
            ) {
                continue;
            }
        }

        if (!isLikelyCallArgumentGap(recoveryScanSource, previousIndex)) {
            continue;
        }

        edits.push(
            Object.freeze({
                start: whitespaceRunStart,
                end: whitespaceRunStart,
                text: ","
            })
        );
    }

    if (edits.length === 0) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    const outputText = applySourceTextEdits(sourceText, edits);
    return Object.freeze({
        changed: outputText !== sourceText,
        outputText,
        appliedEdits: Object.freeze(edits)
    });
}

function isIdentifierCharacter(character: string): boolean {
    return /[A-Za-z0-9_]/u.test(character);
}

function canTerminateArgumentExpression(character: string): boolean {
    return (
        isIdentifierCharacter(character) ||
        character === '"' ||
        character === "'" ||
        character === ")" ||
        character === "]" ||
        character === "}"
    );
}

function canStartArgumentExpression(character: string): boolean {
    return (
        isIdentifierCharacter(character) ||
        character === '"' ||
        character === "'" ||
        character === "(" ||
        character === "[" ||
        character === "{"
    );
}

function isArgumentBoundaryCharacter(character: string): boolean {
    return character === ")" || character === "]" || character === "}" || character === ",";
}

function isLineTerminator(character: string): boolean {
    return character === "\n" || character === "\r";
}

function maskCommentsAndStringsForRecovery(sourceText: string): string {
    const chars = sourceText.split("");
    let index = 0;
    const scanState = Core.createStringCommentScanState();

    while (index < sourceText.length) {
        const scannedIndex = Core.advanceStringCommentScan(sourceText, sourceText.length, index, scanState, true);
        if (scannedIndex !== index) {
            // Mask the comment or string with spaces so it is ignored
            for (let cursor = index; cursor < scannedIndex; cursor += 1) {
                if (!isLineTerminator(chars[cursor] ?? "")) {
                    chars[cursor] = " ";
                }
            }
            index = scannedIndex;
            continue;
        }

        index += 1;
    }

    return chars.join("");
}

function findPreviousNonWhitespaceIndex(
    sourceText: string,
    startIndex: number,
    stopAtLineBreak: boolean
): number | null {
    let cursor = startIndex - 1;
    while (cursor >= 0) {
        const character = sourceText[cursor];
        if (stopAtLineBreak && (character === "\n" || character === "\r")) {
            return null;
        }
        if (/\s/u.test(character ?? "")) {
            cursor -= 1;
            continue;
        }
        return cursor;
    }
    return null;
}

function findNextNonWhitespaceIndex(sourceText: string, startIndex: number): number | null {
    let cursor = startIndex + 1;
    while (cursor < sourceText.length) {
        if (!/\s/u.test(sourceText[cursor] ?? "")) {
            return cursor;
        }
        cursor += 1;
    }
    return null;
}

type IdentifierToken = Readonly<{
    value: string;
    start: number;
}>;

function readIdentifierTokenEndingAt(sourceText: string, endIndex: number): IdentifierToken | null {
    const character = sourceText[endIndex] ?? "";
    if (!isIdentifierCharacter(character)) {
        return null;
    }

    let startIndex = endIndex;
    while (startIndex > 0 && isIdentifierCharacter(sourceText[startIndex - 1] ?? "")) {
        startIndex -= 1;
    }

    return Object.freeze({
        value: sourceText.slice(startIndex, endIndex + 1),
        start: startIndex
    });
}

function readIdentifierTokenStartingAt(sourceText: string, startIndex: number): string | null {
    const character = sourceText[startIndex] ?? "";
    if (!isIdentifierCharacter(character)) {
        return null;
    }

    let endIndex = startIndex;
    while (endIndex < sourceText.length && isIdentifierCharacter(sourceText[endIndex] ?? "")) {
        endIndex += 1;
    }

    return sourceText.slice(startIndex, endIndex);
}

const NON_CALL_PREFIX_KEYWORDS = new Set([
    "if",
    "for",
    "while",
    "switch",
    "repeat",
    "with",
    "function",
    "constructor",
    "catch",
    "and",
    "or",
    "xor",
    "not",
    "div",
    "mod",
    "return",
    "var",
    "else",
    "until",
    "throw",
    "new",
    "try",
    "finally",
    "static",
    "enum",
    "globalvar",
    "case",
    "default",
    "do",
    "break",
    "continue",
    "exit"
]);

function isLikelyCallArgumentGap(sourceText: string, leftIndex: number): boolean {
    let cursor = leftIndex;
    while (cursor >= 0) {
        const character = sourceText[cursor] ?? "";
        if (character === "(") {
            const calleeEndIndex = findPreviousNonWhitespaceIndex(sourceText, cursor, false);
            if (calleeEndIndex === null) {
                return false;
            }

            const calleeToken = readIdentifierTokenEndingAt(sourceText, calleeEndIndex);
            if (calleeToken) {
                if (NON_CALL_PREFIX_KEYWORDS.has(calleeToken.value.toLowerCase())) {
                    return false;
                }

                const beforeCalleeIndex = findPreviousNonWhitespaceIndex(sourceText, calleeToken.start, false);
                if (beforeCalleeIndex === null) {
                    return true;
                }

                const prefixToken = readIdentifierTokenEndingAt(sourceText, beforeCalleeIndex);
                return prefixToken?.value.toLowerCase() !== "function";
            }

            const calleeCharacter = sourceText[calleeEndIndex] ?? "";
            return calleeCharacter === ")" || calleeCharacter === "]";
        }

        if (isArgumentBoundaryCharacter(character) || character === "\n" || character === "\r" || character === ";") {
            return false;
        }

        cursor -= 1;
    }

    return false;
}
