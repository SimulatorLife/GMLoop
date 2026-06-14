import assert from "node:assert/strict";
import test from "node:test";

import { Core } from "@gmloop/core";

import {
    computeNumericTolerance,
    evaluateNumericExpression,
    evaluateOneMinusNumeric,
    isLiteralNumber,
    isNegativeOneFactor,
    isNumericZeroLiteral
} from "../src/rules/gml/math/math-numeric-utils.js";

void test("computeNumericTolerance honours explicit tolerance overrides", () => {
    assert.strictEqual(computeNumericTolerance(0, 0.01), 0.01);
    assert.strictEqual(computeNumericTolerance(100, 0.5), 0.5);
});

void test("computeNumericTolerance scales to magnitude with a floor of one", () => {
    // For magnitudes below one, the floor of one keeps the tolerance the same
    // as a magnitude of one: 4 * Number.EPSILON.
    const smallMagnitudeTolerance = computeNumericTolerance(0);
    assert.strictEqual(smallMagnitudeTolerance, Number.EPSILON * 4);

    // For larger magnitudes the tolerance grows linearly.
    const largeMagnitudeTolerance = computeNumericTolerance(1000);
    assert.strictEqual(largeMagnitudeTolerance, Number.EPSILON * 1000 * 4);
});

void test("isLiteralNumber treats exact matches and within-tolerance matches equivalently", () => {
    const literal = { type: "Literal", value: "1" } as unknown;
    assert.strictEqual(isLiteralNumber(literal, 1), true);
    // 1 + 2 * Number.EPSILON is within the 4 * Number.EPSILON magnitude-scaled
    // tolerance, so the literal still matches the expected value.
    assert.strictEqual(isLiteralNumber(literal, 1 + 2 * Number.EPSILON), true);
    assert.strictEqual(isLiteralNumber(literal, 1.01), false);
});

void test("isLiteralNumber honours explicit tolerance overrides", () => {
    const literal = { type: "Literal", value: "1" } as unknown;
    assert.strictEqual(isLiteralNumber(literal, 1, 0.5), true);
    assert.strictEqual(isLiteralNumber(literal, 1.6, 0.5), false);
});

void test("isNumericZeroLiteral classifies within-tolerance values as zero", () => {
    assert.strictEqual(isNumericZeroLiteral({ type: "Literal", value: "0" }), true);
    assert.strictEqual(isNumericZeroLiteral({ type: "Literal", value: "0.0000000000000001" }), true);
    assert.strictEqual(isNumericZeroLiteral({ type: "Literal", value: "0.5" }), false);
});

void test("isNumericZeroLiteral returns false for non-literal nodes", () => {
    assert.strictEqual(isNumericZeroLiteral(null), false);
    assert.strictEqual(isNumericZeroLiteral({ type: "Identifier" }), false);
});

void test("isNegativeOneFactor detects factors of negative one", () => {
    const literal = { type: "Literal", value: "-1" } as unknown;
    assert.strictEqual(isNegativeOneFactor(literal), true);
});

void test("isNegativeOneFactor rejects values that diverge beyond tolerance", () => {
    const literal = { type: "Literal", value: "-2" } as unknown;
    assert.strictEqual(isNegativeOneFactor(literal), false);
});

void test("evaluateNumericExpression returns null when dividing by a value within tolerance of zero", () => {
    const expression = {
        type: "BinaryExpression",
        operator: "/",
        left: { type: "Literal", value: "1" },
        right: { type: "Literal", value: "0" }
    } as unknown;

    assert.strictEqual(evaluateNumericExpression(expression), null);
});

void test("evaluateOneMinusNumeric accepts expressions where the left value is within tolerance of one", () => {
    const expression = {
        type: "BinaryExpression",
        operator: "-",
        left: { type: "Literal", value: "1" },
        right: { type: "Literal", value: "2" }
    } as unknown;

    // 1 - 2 = -1; the result resolves to negative one which is the canonical
    // shape callers expect from the 1 - x pattern.
    assert.strictEqual(evaluateOneMinusNumeric(expression), -1);
});

void test("evaluateOneMinusNumeric rejects expressions where the left value diverges from one", () => {
    const expression = {
        type: "BinaryExpression",
        operator: "-",
        left: { type: "Literal", value: "2" },
        right: { type: "Literal", value: "1" }
    } as unknown;

    assert.strictEqual(evaluateOneMinusNumeric(expression), null);
});

void test("areNumbersApproximatelyEqual helper (from Core) rejects non-finite inputs", () => {
    const { areNumbersApproximatelyEqual } = Core;
    assert.strictEqual(areNumbersApproximatelyEqual(0.1 + 0.2, 0.3), true);
    assert.strictEqual(areNumbersApproximatelyEqual(0, 0), true);
    // The non-finite guard rejects NaN matches even when the other operand is
    // a regular number — confirming the shared helper's stricter contract.
    assert.strictEqual(areNumbersApproximatelyEqual(Number.NaN, 0), false);
    assert.strictEqual(areNumbersApproximatelyEqual(0, Number.NaN), false);
    assert.strictEqual(areNumbersApproximatelyEqual(Number.NaN, Number.NaN), false);
});

void test("isApproximatelyZero (from Core) matches the previous computeNumericTolerance(0) contract", () => {
    const { isApproximatelyZero, ZERO_CHECK_EPSILON } = Core;
    // Same baseline as computeNumericTolerance(0) = Number.EPSILON * 4.
    assert.strictEqual(ZERO_CHECK_EPSILON, Number.EPSILON * 4);
    // True exactly at zero and within the tolerance window.
    assert.strictEqual(isApproximatelyZero(0), true);
    assert.strictEqual(isApproximatelyZero(Number.EPSILON), true);
    // NaN and Infinity never qualify as approximately zero.
    assert.strictEqual(isApproximatelyZero(Number.NaN), false);
    assert.strictEqual(isApproximatelyZero(Number.POSITIVE_INFINITY), false);
    assert.strictEqual(isApproximatelyZero(Number.NEGATIVE_INFINITY), false);
    // Anything beyond the tolerance is rejected.
    assert.strictEqual(isApproximatelyZero(1), false);
});
