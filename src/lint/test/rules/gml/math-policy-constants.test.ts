import assert from "node:assert/strict";
import test from "node:test";

import {
    ABS_VALUE_THRESHOLD_FOR_EXPONENTIAL,
    CANONICAL_FORM_EXPONENTIAL_NOTATION_DIGITS,
    CANONICAL_FORM_FIXED_NOTATION_HIGH_PRECISION,
    CANONICAL_FORM_FIXED_NOTATION_LOW_PRECISION,
    CANONICAL_FORM_FIXED_NOTATION_MEDIUM_PRECISION,
    DEFAULT_MAX_CANONICAL_FORM_VALUE,
    DEFAULT_NUMERIC_LITERAL_EPSILON,
    EPSILON_TOLERANCE_MULTIPLIER,
    MAX_INTEGER_BOUNDARY_FOR_EXACT_REPRESENTATION,
    MIN_OPTIMIZE_MATH_EPSILON,
    MIN_OPTIMIZE_MATH_MAX_CANONICAL_FORM_VALUE
} from "../../../src/rules/gml/math/math-policy-constants.js";

void test("EPSILON_TOLERANCE_MULTIPLIER preserves the previous hardcoded factor", () => {
    // The math-numeric-utils helper used to inline `Number.EPSILON *
    // magnitude * 4`; the multiplier has to remain `4` so existing callers
    // observe identical tolerance windows.
    assert.strictEqual(EPSILON_TOLERANCE_MULTIPLIER, 4);
});

void test("DEFAULT_NUMERIC_LITERAL_EPSILON preserves the previous canonical-form epsilon", () => {
    assert.strictEqual(DEFAULT_NUMERIC_LITERAL_EPSILON, 1e-9);
});

void test("DEFAULT_MAX_CANONICAL_FORM_VALUE preserves the previous upper bound", () => {
    assert.strictEqual(DEFAULT_MAX_CANONICAL_FORM_VALUE, 1e15);
});

void test("MAX_INTEGER_BOUNDARY_FOR_EXACT_REPRESENTATION mirrors the max canonical-form value", () => {
    // The formatter chooses integer emission whenever the value is an exact
    // integer and within this bound, so the constant intentionally sits one
    // below the canonical-form ceiling. Expressing the relationship as a
    // derivation (rather than re-stating the literal) keeps the two
    // thresholds from drifting out of sync.
    assert.strictEqual(MAX_INTEGER_BOUNDARY_FOR_EXACT_REPRESENTATION, DEFAULT_MAX_CANONICAL_FORM_VALUE - 1);
    assert.strictEqual(MAX_INTEGER_BOUNDARY_FOR_EXACT_REPRESENTATION, 999_999_999_999_999);
});

void test("ABS_VALUE_THRESHOLD_FOR_EXPONENTIAL preserves the previous exponential threshold", () => {
    assert.strictEqual(ABS_VALUE_THRESHOLD_FOR_EXPONENTIAL, 1e-4);
});

void test("CANONICAL_FORM precision constants preserve the previous precision ladder", () => {
    // `toPrecision` is called with these rungs based on magnitude. The
    // constants are pinned so refactors can't silently change how many
    // significant digits the canonical form emits.
    assert.strictEqual(CANONICAL_FORM_FIXED_NOTATION_LOW_PRECISION, 10);
    assert.strictEqual(CANONICAL_FORM_FIXED_NOTATION_MEDIUM_PRECISION, 8);
    assert.strictEqual(CANONICAL_FORM_FIXED_NOTATION_HIGH_PRECISION, 6);
});

void test("CANONICAL_FORM_EXPONENTIAL_NOTATION_DIGITS preserves the previous toExponential argument", () => {
    assert.strictEqual(CANONICAL_FORM_EXPONENTIAL_NOTATION_DIGITS, 6);
});

void test("MIN_OPTIMIZE_MATH_EPSILON sits above zero so the rule can't be disabled", () => {
    // The schema's `exclusiveMinimum` is `0`; this constant exists so the
    // rule option resolver can clamp to the same floor that the schema
    // declares. Pinning the value here keeps schema, resolver, and
    // documentation aligned.
    assert.ok(MIN_OPTIMIZE_MATH_EPSILON > 0);
    assert.strictEqual(MIN_OPTIMIZE_MATH_EPSILON, 1e-15);
});

void test("MIN_OPTIMIZE_MATH_MAX_CANONICAL_FORM_VALUE sits below the default ceiling", () => {
    assert.ok(MIN_OPTIMIZE_MATH_MAX_CANONICAL_FORM_VALUE < DEFAULT_MAX_CANONICAL_FORM_VALUE);
    assert.strictEqual(MIN_OPTIMIZE_MATH_MAX_CANONICAL_FORM_VALUE, 1e6);
});
