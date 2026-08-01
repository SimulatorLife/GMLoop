import { isIdentifierBoundaryCharacter } from "../utils/string.js";
import { advanceStringCommentScan, createStringCommentScanState } from "./source-text.js";

/**
 * Source-text scanning utilities for scientific-notation numeric literals.
 *
 * The helpers in this module are pure text utilities that depend only on
 * {@link Core}'s string/comment scanner. They are intentionally placed in
 * `@gmloop/core` (alongside the other text primitives such as
 * `createStringCommentScanState` and `advanceStringCommentScan`) so that
 * **both** the `lint` workspace — which needs the helpers in pre-parse
 * recovery (Phase A) and the AST rule (Phase B) — and the `refactor`
 * workspace — which needs the helpers in the scientific-notation codemod —
 * can share a single implementation without violating the architectural
 * boundary that disallows `refactor → lint` dependencies.
 *
 * Earlier the file lived in `src/lint/src/malformed/` because both the
 * pre-parse `language/recovery.ts` layer and the AST-phase rule
 * `rules/gml/rules/no-scientific-notation-rule.ts` consumed it from the
 * `lint` workspace. The `refactor` codemod's parallel need forced a
 * `@gmloop/lint` import, which the `boundaries/element-types` rule
 * forbids. Promoting the module to `@gmloop/core` resolves the violation
 * without introducing a duplicate implementation, and it keeps the helpers
 * near the other generic text utilities they build on.
 *
 * Architecture: this is a pure text utility, so it lives next to the other
 * shared text primitives in `@gmloop/core/text` (target-state.md §2.1).
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
        isIdentifierBoundaryCharacter(sourceText[startIndex - 1]) && isIdentifierBoundaryCharacter(sourceText[endIndex])
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

    const exponent = Number.parseInt(exponentText, 10);
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
    const scanState = createStringCommentScanState();
    const sourceLength = sourceText.length;

    let index = 0;
    while (index < sourceLength) {
        const scannedIndex = advanceStringCommentScan(sourceText, sourceLength, index, scanState, true);
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
