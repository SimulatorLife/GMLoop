import { Core } from "@gmloop/core";

import { applySourceTextEdits } from "../codemod-helpers.js";
import type { ScientificNotationEdit, ScientificNotationResult } from "./types.js";

const EXPONENT_DIGIT_PATTERN = /^[+-]?\d+$/u;
const SCIENTIFIC_NOTATION_PATTERN = /(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+/y;
const MAX_FIXED_LITERAL_LENGTH = 4096;

function trimInsignificantFractionalZeros(decimalText: string): string {
    const decimalPointIndex = decimalText.indexOf(".");
    if (decimalPointIndex === -1) {
        return decimalText;
    }

    let trimmedLength = decimalText.length;
    while (trimmedLength > decimalPointIndex + 1 && decimalText[trimmedLength - 1] === "0") {
        trimmedLength -= 1;
    }

    if (trimmedLength === decimalPointIndex + 1) {
        trimmedLength = decimalPointIndex;
    }

    const trimmed = decimalText.slice(0, trimmedLength);
    return trimmed.length === 0 ? "0" : trimmed;
}

function toPlainDecimalFromScientificLiteral(scientificText: string): string | null {
    const separatorIndex = Math.max(scientificText.indexOf("e"), scientificText.indexOf("E"));
    if (separatorIndex <= 0 || separatorIndex >= scientificText.length - 1) {
        return null;
    }

    const mantissaText = scientificText.slice(0, separatorIndex);
    const exponentText = scientificText.slice(separatorIndex + 1);
    if (!EXPONENT_DIGIT_PATTERN.test(exponentText)) {
        return null;
    }

    const exponent = Number.parseInt(exponentText);
    if (!Number.isFinite(exponent)) {
        return null;
    }

    const decimalPointIndex = mantissaText.indexOf(".");
    const unsignedDigits =
        decimalPointIndex === -1
            ? mantissaText
            : `${mantissaText.slice(0, decimalPointIndex)}${mantissaText.slice(decimalPointIndex + 1)}`;
    if (!/^\d+$/u.test(unsignedDigits)) {
        return null;
    }

    let leadingZeroCount = 0;
    while (leadingZeroCount < unsignedDigits.length && unsignedDigits[leadingZeroCount] === "0") {
        leadingZeroCount += 1;
    }

    if (leadingZeroCount >= unsignedDigits.length) {
        return "0";
    }

    const significantDigits = unsignedDigits.slice(leadingZeroCount);
    const baseDecimalIndex = decimalPointIndex === -1 ? mantissaText.length : decimalPointIndex;
    const shiftedDecimalIndex = baseDecimalIndex + exponent - leadingZeroCount;
    const outputDigitLength = Math.max(significantDigits.length, shiftedDecimalIndex);
    if (outputDigitLength > MAX_FIXED_LITERAL_LENGTH) {
        return null;
    }

    if (shiftedDecimalIndex <= 0) {
        const decimal = `0.${"0".repeat(-shiftedDecimalIndex)}${significantDigits}`;
        return trimInsignificantFractionalZeros(decimal);
    }

    if (shiftedDecimalIndex >= significantDigits.length) {
        return `${significantDigits}${"0".repeat(shiftedDecimalIndex - significantDigits.length)}`;
    }

    const integerPortion = significantDigits.slice(0, shiftedDecimalIndex);
    const fractionalPortion = significantDigits.slice(shiftedDecimalIndex);
    return trimInsignificantFractionalZeros(`${integerPortion}.${fractionalPortion}`);
}

function isScientificNotationBoundary(sourceText: string, startIndex: number, endIndex: number): boolean {
    return (
        Core.isIdentifierBoundaryCharacter(sourceText[startIndex - 1]) &&
        Core.isIdentifierBoundaryCharacter(sourceText[endIndex])
    );
}

function collectScientificNotationEdits(sourceText: string): ReadonlyArray<ScientificNotationEdit> {
    const edits: ScientificNotationEdit[] = [];
    const scanState = Core.createStringCommentScanState();
    const sourceLength = sourceText.length;
    let index = 0;

    while (index < sourceLength) {
        const scannedIndex = Core.advanceStringCommentScan(sourceText, sourceLength, index, scanState, true);
        if (scannedIndex !== index) {
            index = scannedIndex;
            continue;
        }

        SCIENTIFIC_NOTATION_PATTERN.lastIndex = index;
        const match = SCIENTIFIC_NOTATION_PATTERN.exec(sourceText);
        if (!match) {
            index += 1;
            continue;
        }

        const scientificText = match[0] ?? "";
        const start = index;
        const end = start + scientificText.length;
        if (!isScientificNotationBoundary(sourceText, start, end)) {
            index += 1;
            continue;
        }

        const replacement = toPlainDecimalFromScientificLiteral(scientificText);
        if (replacement !== null && replacement !== scientificText) {
            edits.push(
                Object.freeze({
                    start,
                    end,
                    text: replacement
                })
            );
        }
        index = end;
    }

    return edits;
}

/**
 * Replace unsupported scientific-notation numeric literals with equivalent
 * plain decimal literals accepted by GML.
 */
export function applyScientificNotationCodemod(sourceText: string): ScientificNotationResult {
    if (!Core.isNonEmptyString(sourceText)) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    const edits = collectScientificNotationEdits(sourceText);
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
