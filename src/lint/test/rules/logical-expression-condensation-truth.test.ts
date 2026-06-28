/**
 * Unit tests for the logical-expression-condensation-truth helpers.
 *
 * The truth-table module renders a Quine-McCluskey minimum cover back into
 * the boolean ADT as either a sum-of-products (DNF) term or a
 * product-of-sums (CNF) clause. Before the unification refactor, the DNF
 * and CNF paths each carried their own loop that walked the implicant's
 * (mask, value) bit-pair, picked the literal polarity, and assembled the
 * result. The two loops were identical except for the polarity choice and
 * the final combiner, which made any future fix (e.g. handling a new
 * "don't care" sentinel) require two coordinated edits.
 *
 * These tests pin the unified behaviour by exercising both call paths
 * (`buildTermFromImplicant` for DNF, `buildClauseFromImplicant` for CNF)
 * across the corners that drove the original duplication:
 *
 * - All-mask implicant (empty literal list → identity constant).
 * - Single active bit (length-1 → unwrapped literal).
 * - Multiple active bits (length-N → AND/OR of all literals).
 * - Polarity inversion between the two forms (De Morgan duality).
 * - `value = 0` vs `value = (1 << variableCount) - 1` to confirm every
 *   literal can be either positive or negative.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
    buildClauseFromImplicant,
    buildExpressionFromImplicants,
    buildTermFromImplicant
} from "../../src/rules/gml/transforms/logical-expression-condensation-truth.js";

const BOOLEAN_VAR = "VAR";
const BOOLEAN_CONST = "CONST";
const BOOLEAN_NOT = "NOT";
const BOOLEAN_AND = "AND";
const BOOLEAN_OR = "OR";

function variable(index) {
    return { type: BOOLEAN_VAR, variable: { index } };
}

function booleanConstant(value) {
    return { type: BOOLEAN_CONST, value };
}

function booleanNot(argument) {
    return { type: BOOLEAN_NOT, argument };
}

function booleanAnd(terms) {
    return { type: BOOLEAN_AND, terms };
}

function booleanOr(terms) {
    return { type: BOOLEAN_OR, terms };
}

void test("buildTermFromImplicant returns true when every bit is masked off", () => {
    const variableCount = 4;
    const implicant = { value: 0, mask: 0b1111, covered: new Set() };

    assert.deepStrictEqual(buildTermFromImplicant(implicant, variableCount), booleanConstant(true));
});

void test("buildClauseFromImplicant returns false when every bit is masked off", () => {
    const variableCount = 4;
    const implicant = { value: 0, mask: 0b1111, covered: new Set() };

    assert.deepStrictEqual(buildClauseFromImplicant(implicant, variableCount), booleanConstant(false));
});

void test("buildTermFromImplicant emits a single literal when only one bit is active", () => {
    const implicant = { value: 0b0100, mask: 0b0011, covered: new Set() };

    assert.deepStrictEqual(buildTermFromImplicant(implicant, 3), variable(2));
});

void test("buildClauseFromImplicant emits a single literal when only one bit is active", () => {
    // CNF polarity is inverted: a set value bit renders as the negated
    // variable, so the single active bit (set to 1) becomes NOT(variable(2)).
    const implicant = { value: 0b0100, mask: 0b0011, covered: new Set() };

    assert.deepStrictEqual(buildClauseFromImplicant(implicant, 3), booleanNot(variable(2)));
});

void test("buildTermFromImplicant ANDs every active bit in value order", () => {
    // mask=0b0000 means every bit is active; value=0b1010 picks variables
    // 1 (set) and 3 (set) as positive, variables 0 and 2 as negated.
    const variableCount = 4;
    const implicant = { value: 0b1010, mask: 0b0000, covered: new Set() };

    const expected = booleanAnd([booleanNot(variable(0)), variable(1), booleanNot(variable(2)), variable(3)]);

    assert.deepStrictEqual(buildTermFromImplicant(implicant, variableCount), expected);
});

void test("buildClauseFromImplicant ORs every active bit with inverted polarity", () => {
    // Same implicant as above; CNF must invert the polarity so the bit-set
    // positions become negated and the clear positions become positive.
    const variableCount = 4;
    const implicant = { value: 0b1010, mask: 0b0000, covered: new Set() };

    const expected = booleanOr([variable(0), booleanNot(variable(1)), variable(2), booleanNot(variable(3))]);

    assert.deepStrictEqual(buildClauseFromImplicant(implicant, variableCount), expected);
});

void test("buildTermFromImplicant skips masked bits in bit order", () => {
    // Only bits 0 and 2 are active. Variable 0's value bit is 1 (positive)
    // and variable 2's value bit is 0 (negated).
    const variableCount = 4;
    const implicant = { value: 0b0001, mask: 0b1010, covered: new Set() };

    const expected = booleanAnd([variable(0), booleanNot(variable(2))]);

    assert.deepStrictEqual(buildTermFromImplicant(implicant, variableCount), expected);
});

void test("buildClauseFromImplicant skips masked bits in bit order", () => {
    // Mirrors the DNF case above with the polarity inverted.
    const variableCount = 4;
    const implicant = { value: 0b0001, mask: 0b1010, covered: new Set() };

    const expected = booleanOr([booleanNot(variable(0)), variable(2)]);

    assert.deepStrictEqual(buildClauseFromImplicant(implicant, variableCount), expected);
});

void test("buildTermFromImplicant produces all-positive literals when value is all-ones", () => {
    const variableCount = 3;
    const implicant = { value: 0b111, mask: 0b000, covered: new Set() };

    const expected = booleanAnd([variable(0), variable(1), variable(2)]);

    assert.deepStrictEqual(buildTermFromImplicant(implicant, variableCount), expected);
});

void test("buildClauseFromImplicant produces all-positive literals when value is zero", () => {
    // value=0 and CNF means every literal is the bare variable; the CNF
    // polarity inversion flips the all-clear value into the all-clear CNF
    // expression (i.e. (v0 ∨ v1 ∨ v2)).
    const variableCount = 3;
    const implicant = { value: 0b000, mask: 0b000, covered: new Set() };

    const expected = booleanOr([variable(0), variable(1), variable(2)]);

    assert.deepStrictEqual(buildClauseFromImplicant(implicant, variableCount), expected);
});

void test("DNF and CNF agree on identity constants for the all-masked implicant", () => {
    const implicant = { value: 0, mask: 0b1111, covered: new Set() };

    assert.deepStrictEqual(buildTermFromImplicant(implicant, 4), booleanConstant(true));
    assert.deepStrictEqual(buildClauseFromImplicant(implicant, 4), booleanConstant(false));
});

void test("buildExpressionFromImplicants returns the negated constant when index list is empty", () => {
    // negated=false (DNF cover of minterms): no true rows means the
    // expression is unsatisfiable, so the helper short-circuits to `false`.
    assert.deepStrictEqual(buildExpressionFromImplicants([], 2, false), booleanConstant(false));
    // negated=true (CNF cover of maxterms): no false rows means every
    // assignment is true, so the helper short-circuits to `true`.
    assert.deepStrictEqual(buildExpressionFromImplicants([], 2, true), booleanConstant(true));
});
