import type { Rule } from "eslint";

import { gmlRuleMalformedServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import { createMeta } from "../rule-base-helpers.js";

const { forEachScientificNotationToken } = gmlRuleMalformedServices;

const EXPONENT_DIGIT_PATTERN = /^[+-]?\d+$/u;
const MAX_FIXED_LITERAL_LENGTH = 4096;

type ScientificNotationFix = Readonly<{
    start: number;
    end: number;
    replacement: string;
}>;

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

function collectScientificNotationFixes(sourceText: string): ReadonlyArray<ScientificNotationFix> {
    const fixes: ScientificNotationFix[] = [];

    forEachScientificNotationToken(sourceText, (start, end, scientificText) => {
        const replacement = toPlainDecimalFromScientificLiteral(scientificText);
        if (replacement && replacement !== scientificText) {
            fixes.push(Object.freeze({ start, end, replacement }));
        }
    });

    return fixes;
}

/**
 * Creates the `gml/no-scientific-notation` rule.
 *
 * Replaces unsupported scientific-notation numeric literals (for example,
 * `1e-11`) with equivalent plain decimal literals accepted by GML.
 */
export function createNoScientificNotationRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const fixes = collectScientificNotationFixes(sourceText);
                    for (const fix of fixes) {
                        context.report({
                            loc: context.sourceCode.getLocFromIndex(fix.start),
                            messageId: definition.messageId,
                            fix(fixer) {
                                return fixer.replaceTextRange([fix.start, fix.end], fix.replacement);
                            }
                        });
                    }
                }
            });
        }
    });
}
