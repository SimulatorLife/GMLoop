import { Core } from "@gmloop/core";

/**
 * Source text scanning utilities for scientific-notation numeric literals.
 *
 * This module is consumed by two layers of the `@gmloop/lint` workspace:
 *
 *  1. **`language/recovery.ts`** (pre-parse, Phase A) — replaces every
 *     scientific-notation token with an equal-length placeholder so that the
 *     ANTLR parser does not choke on exponent syntax during malformed-source
 *     recovery.
 *
 *  2. **`rules/gml/rules/no-scientific-notation-rule.ts`** (AST phase) — walks
 *     the already-parsed source to report and auto-fix scientific-notation
 *     literals.
 *
 * Because this utility is needed by the `language/` layer (which runs *before*
 * rules), placing it here in `malformed/` — alongside `source-preprocessing.ts`
 * — keeps the dependency direction correct: the lower `language/` layer must
 * never import from the higher `rules/gml/` layer.  Moving the file here fixes
 * that architectural inversion.  (See target-state.md §2.1 and §3.1.)
 */

const EXPONENT_DIGIT_PATTERN = /^[+-]?\d+$/u;
const MAX_FIXED_LITERAL_LENGTH = 4096;

/**
 * Matches scientific-notation numeric literals (sticky, must be reset via `lastIndex`).
 * Pattern: optional-integer optional-fraction exponent  e.g. `1e5`, `1.5e-3`, `.25E+2`
 */
export const SCIENTIFIC_NOTATION_PATTERN = /(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+/y;

/**
 * Returns `true` when the characters immediately surrounding the matched span are not
 * part of a GML identifier, ensuring we never match inside a larger word.
 */
export function isScientificNotationBoundary(sourceText: string, startIndex: number, endIndex: number): boolean {
    return (
        Core.isIdentifierBoundaryCharacter(sourceText[startIndex - 1]) &&
        Core.isIdentifierBoundaryCharacter(sourceText[endIndex])
    );
}

/**
 * Removes trailing fractional zeros that are not significant, returning the
 * minimal representation (e.g. `"1.500"` → `"1.5"`, `"1.000"` → `"1"`).
 */
export function trimInsignificantFractionalZeros(decimalText: string): string {
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

/**
 * Converts a scientific-notation literal (e.g. `"1.5e-3"`) to its plain decimal
 * string representation (e.g. `"0.0015"`).  Returns `null` if the input is not
 * a valid scientific-notation literal or the result would exceed
 * `MAX_FIXED_LITERAL_LENGTH` digits.
 */
export function toPlainDecimalFromScientificLiteral(scientificText: string): string | null {
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

/**
 * Iterates over every scientific-notation token in `sourceText` that is outside
 * string literals and line comments, calling `onMatch` for each occurrence.
 *
 * The callback receives the `start` index (inclusive), `end` index (exclusive),
 * and the matched token text.
 */
export function forEachScientificNotationToken(
    sourceText: string,
    onMatch: (start: number, end: number, text: string) => void
): void {
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

        onMatch(start, end, scientificText);
        index = end;
    }
}
