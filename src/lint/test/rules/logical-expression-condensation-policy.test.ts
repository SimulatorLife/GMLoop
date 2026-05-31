/**
 * Unit tests for the logical-expression-condensation-policy module.
 *
 * These tests verify that the truth-table policy evaluation logic is correct
 * and independent from the mechanism code that condenses boolean branches.
 * Each test case documents the expected behavior of the policy decision.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    evaluateTruthTablePolicy,
    SIMPLIFICATION_POLICY_BASELINE,
    TRUTH_TABLE_POLICY_BASELINE
} from "../../src/rules/gml/transforms/logical-expression-condensation-policy.js";

void test("evaluateTruthTablePolicy returns allowTruthTable=true for variableCount within baseline limit", () => {
    for (
        let variableCount = 1;
        variableCount <= TRUTH_TABLE_POLICY_BASELINE.maxVariablesForTruthTable;
        variableCount += 1
    ) {
        const decision = evaluateTruthTablePolicy({ variableCount });
        assert.strictEqual(decision.allowTruthTable, true, `Variable count ${variableCount} should be allowed`);
        assert.deepStrictEqual(decision.reason, { kind: "ok" });
    }
});

void test("evaluateTruthTablePolicy returns allowTruthTable=false when variableCount exceeds max", () => {
    const max = TRUTH_TABLE_POLICY_BASELINE.maxVariablesForTruthTable;
    const beyond = max + 1;

    const decision = evaluateTruthTablePolicy({ variableCount: beyond });
    assert.strictEqual(decision.allowTruthTable, false);
    assert.deepStrictEqual(decision.reason, {
        kind: "too_many_variables",
        actual: beyond,
        max
    });
});

void test("evaluateTruthTablePolicy returns allowTruthTable=false for zero variableCount", () => {
    const decision = evaluateTruthTablePolicy({ variableCount: 0 });
    assert.strictEqual(decision.allowTruthTable, false);
    assert.deepStrictEqual(decision.reason, { kind: "no_variables" });
});

void test("evaluateTruthTablePolicy returns allowTruthTable=false for negative variableCount", () => {
    const decision = evaluateTruthTablePolicy({ variableCount: -1 });
    assert.strictEqual(decision.allowTruthTable, false);
    assert.deepStrictEqual(decision.reason, { kind: "no_variables" });
});

void test("evaluateTruthTablePolicy is pure and idempotent", () => {
    const input = { variableCount: 5 };
    const decision1 = evaluateTruthTablePolicy(input);
    const decision2 = evaluateTruthTablePolicy(input);
    const decision3 = evaluateTruthTablePolicy(input);

    assert.deepStrictEqual(decision1, decision2);
    assert.deepStrictEqual(decision2, decision3);
});

void test("evaluateTruthTablePolicy accepts custom config with higher limit", () => {
    const customConfig = {
        maxVariablesForTruthTable: 20
    };

    // Variable count of 15 is above the default baseline (10) but within the custom limit.
    const decision = evaluateTruthTablePolicy({ variableCount: 15 }, customConfig);
    assert.strictEqual(decision.allowTruthTable, true);
    assert.deepStrictEqual(decision.reason, { kind: "ok" });
});

void test("evaluateTruthTablePolicy accepts custom config with lower limit", () => {
    const customConfig = {
        maxVariablesForTruthTable: 3
    };

    // Variable count of 5 is above the custom limit (3) but within the baseline.
    const decision = evaluateTruthTablePolicy({ variableCount: 5 }, customConfig);
    assert.strictEqual(decision.allowTruthTable, false);
    assert.deepStrictEqual(decision.reason, {
        kind: "too_many_variables",
        actual: 5,
        max: 3
    });
});

void test("TRUTH_TABLE_POLICY_BASELINE is frozen and contains expected fields", () => {
    assert.ok(Object.isFrozen(TRUTH_TABLE_POLICY_BASELINE));
    assert.ok(Object.hasOwn(TRUTH_TABLE_POLICY_BASELINE, "maxVariablesForTruthTable"));
    assert.strictEqual(typeof TRUTH_TABLE_POLICY_BASELINE.maxVariablesForTruthTable, "number");
    assert.ok(TRUTH_TABLE_POLICY_BASELINE.maxVariablesForTruthTable > 0);
});

void test("evaluateTruthTablePolicy decision objects are frozen", () => {
    const decision = evaluateTruthTablePolicy({ variableCount: 5 });
    assert.ok(Object.isFrozen(decision));
    assert.ok(Object.isFrozen(decision.reason));
});

void test("TRUTH_TABLE_POLICY_BASELINE value is 10", () => {
    assert.strictEqual(TRUTH_TABLE_POLICY_BASELINE.maxVariablesForTruthTable, 10);
});

// ============================================================================
// SimplificationPolicy tests
// ============================================================================

void test("SIMPLIFICATION_POLICY_BASELINE contains expected fields", () => {
    assert.ok(Object.isFrozen(SIMPLIFICATION_POLICY_BASELINE));
    assert.ok(Object.hasOwn(SIMPLIFICATION_POLICY_BASELINE, "maxSimplificationIterations"));
    assert.ok(Object.hasOwn(SIMPLIFICATION_POLICY_BASELINE, "maxPostProcessingIterations"));
    assert.strictEqual(typeof SIMPLIFICATION_POLICY_BASELINE.maxSimplificationIterations, "number");
    assert.strictEqual(typeof SIMPLIFICATION_POLICY_BASELINE.maxPostProcessingIterations, "number");
});

void test("SIMPLIFICATION_POLICY_BASELINE maxSimplificationIterations is a positive integer", () => {
    assert.ok(
        Number.isInteger(SIMPLIFICATION_POLICY_BASELINE.maxSimplificationIterations),
        "maxSimplificationIterations must be an integer"
    );
    assert.ok(
        SIMPLIFICATION_POLICY_BASELINE.maxSimplificationIterations > 0,
        "maxSimplificationIterations must be positive"
    );
});

void test("SIMPLIFICATION_POLICY_BASELINE maxPostProcessingIterations is a positive integer", () => {
    assert.ok(
        Number.isInteger(SIMPLIFICATION_POLICY_BASELINE.maxPostProcessingIterations),
        "maxPostProcessingIterations must be an integer"
    );
    assert.ok(
        SIMPLIFICATION_POLICY_BASELINE.maxPostProcessingIterations > 0,
        "maxPostProcessingIterations must be positive"
    );
});

void test("SIMPLIFICATION_POLICY_BASELINE maxSimplificationIterations is at least maxPostProcessingIterations", () => {
    // The main simplification pass needs more iterations than post-processing because
    // it handles the full scope of boolean transformations.
    assert.ok(
        SIMPLIFICATION_POLICY_BASELINE.maxSimplificationIterations >=
            SIMPLIFICATION_POLICY_BASELINE.maxPostProcessingIterations,
        "maxSimplificationIterations should be >= maxPostProcessingIterations"
    );
});

void test("SIMPLIFICATION_POLICY_BASELINE values are calibrated defaults", () => {
    // These assertions document the current calibrated defaults.
    // If these values need to change, update this test and the corresponding
    // documentation in the policy file.
    assert.strictEqual(SIMPLIFICATION_POLICY_BASELINE.maxSimplificationIterations, 50);
    assert.strictEqual(SIMPLIFICATION_POLICY_BASELINE.maxPostProcessingIterations, 5);
});
