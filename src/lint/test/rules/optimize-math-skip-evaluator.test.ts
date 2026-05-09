/**
 * Unit tests for the optimize-math-skip-evaluator module.
 *
 * These tests verify that the policy evaluation logic is correct and
 * independent from the mechanism code that applies rewrites. Each test
 * case documents the expected behavior of the policy decision.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    DEFAULT_MATH_SIGNAL_PATTERNS,
    DEFAULT_TEXT_LENGTH_POLICY,
    evaluateMathOptimizationCandidate,
    evaluateSkipDecision,
    formatCanonicalNumericLiteral,
    MATH_OPTIMIZATION_POLICY_CONSTANTS
} from "../../src/rules/gml/rules/optimize-math-skip-evaluator.js";

void test("evaluateSkipDecision returns true for nested expression parents", () => {
    const parents = [
        { type: "BinaryExpression" },
        { type: "UnaryExpression" },
        { type: "LogicalExpression" },
        { type: "ParenthesizedExpression" }
    ];

    for (const parent of parents) {
        assert.strictEqual(evaluateSkipDecision(parent, "left"), true, `Should skip when parent is ${parent.type}`);
    }
});

void test("evaluateSkipDecision returns true for specific parent/key combinations", () => {
    const testCases: Array<{ parent: { type: string }; key: string; expected: boolean }> = [
        { parent: { type: "VariableDeclarator" }, key: "init", expected: true },
        { parent: { type: "AssignmentExpression" }, key: "right", expected: true },
        { parent: { type: "IfStatement" }, key: "test", expected: true },
        { parent: { type: "ReturnStatement" }, key: "argument", expected: true },
        // Negative cases - wrong key
        { parent: { type: "VariableDeclarator" }, key: "id", expected: false },
        { parent: { type: "AssignmentExpression" }, key: "left", expected: false },
        { parent: { type: "IfStatement" }, key: "body", expected: false },
        { parent: { type: "ReturnStatement" }, key: "callee", expected: false }
    ];

    for (const { parent, key, expected } of testCases) {
        assert.strictEqual(
            evaluateSkipDecision(parent, key),
            expected,
            `Parent=${parent.type}, key=${key} should ${expected ? "skip" : "process"}`
        );
    }
});

void test("evaluateSkipDecision returns false for null/undefined parent", () => {
    assert.strictEqual(evaluateSkipDecision(null, null), false);
    assert.strictEqual(evaluateSkipDecision(undefined, null), false);
    assert.strictEqual(evaluateSkipDecision({}, null), false);
});

void test("evaluateSkipDecision returns false for parent without type property", () => {
    assert.strictEqual(evaluateSkipDecision({ name: "test" }, null), false);
    assert.strictEqual(evaluateSkipDecision({ foo: "bar" }, "left"), false);
});

void test("evaluateSkipDecision returns false for generic statement parents", () => {
    const statementParents = [
        { type: "ExpressionStatement" },
        { type: "BlockStatement" },
        { type: "Program" },
        { type: "FunctionDeclaration" }
    ];

    for (const parent of statementParents) {
        assert.strictEqual(
            evaluateSkipDecision(parent, "body"),
            false,
            `Should NOT skip when parent is ${parent.type}`
        );
    }
});

void test("evaluateMathOptimizationCandidate detects math syntax", () => {
    const testCases: Array<{ sourceText: string; nodeType: string; expected: boolean }> = [
        { sourceText: "a + b", nodeType: "BinaryExpression", expected: true },
        { sourceText: "x * y", nodeType: "BinaryExpression", expected: true },
        { sourceText: "score / 2", nodeType: "BinaryExpression", expected: true },
        { sourceText: "sin(angle)", nodeType: "CallExpression", expected: true },
        { sourceText: "sqrt(x * x)", nodeType: "CallExpression", expected: true },
        // Negative cases
        { sourceText: "hello", nodeType: "Identifier", expected: false },
        { sourceText: "myFunction()", nodeType: "CallExpression", expected: false },
        { sourceText: '"string"', nodeType: "Literal", expected: false },
        { sourceText: "", nodeType: "BinaryExpression", expected: false }
    ];

    for (const { sourceText, nodeType, expected } of testCases) {
        const evaluation = evaluateMathOptimizationCandidate({ sourceText, nodeType });
        assert.strictEqual(
            evaluation.hasMathSyntax,
            expected,
            `"${sourceText}" should ${expected ? "have" : "not have"} math syntax`
        );
    }
});

void test("evaluateMathOptimizationCandidate respects length threshold", () => {
    const shortExpr = "x + y";
    const longExpr = "a".repeat(DEFAULT_TEXT_LENGTH_POLICY.maxOptimizationCandidateLength + 1);

    const shortEval = evaluateMathOptimizationCandidate({ sourceText: shortExpr, nodeType: "BinaryExpression" });
    const longEval = evaluateMathOptimizationCandidate({ sourceText: longExpr, nodeType: "BinaryExpression" });

    assert.strictEqual(shortEval.exceedsLengthThreshold, false);
    assert.strictEqual(longEval.exceedsLengthThreshold, true);
});

void test("evaluateMathOptimizationCandidate detects strong math signals", () => {
    const strongSignalExpr = "x * y / z";
    const weakSignalExpr = "a + b - c";

    const strongEval = evaluateMathOptimizationCandidate({
        sourceText: strongSignalExpr,
        nodeType: "BinaryExpression"
    });
    const weakEval = evaluateMathOptimizationCandidate({ sourceText: weakSignalExpr, nodeType: "BinaryExpression" });

    assert.strictEqual(strongEval.hasStrongMathSignal, true);
    assert.strictEqual(weakEval.hasStrongMathSignal, false);
});

void test("evaluateMathOptimizationCandidate detects division operators", () => {
    const divisionExpr = "x / 2";
    const noDivisionExpr = "x * y + z";

    const divisionEval = evaluateMathOptimizationCandidate({ sourceText: divisionExpr, nodeType: "BinaryExpression" });
    const noDivisionEval = evaluateMathOptimizationCandidate({
        sourceText: noDivisionExpr,
        nodeType: "BinaryExpression"
    });

    assert.strictEqual(divisionEval.hasDivisionOperator, true);
    assert.strictEqual(noDivisionEval.hasDivisionOperator, false);
});

void test("evaluateMathOptimizationCandidate detects numeric literals", () => {
    const numericExpr = "42 * x";
    const noNumericExpr = "a + b";

    const numericEval = evaluateMathOptimizationCandidate({ sourceText: numericExpr, nodeType: "BinaryExpression" });
    const noNumericEval = evaluateMathOptimizationCandidate({
        sourceText: noNumericExpr,
        nodeType: "BinaryExpression"
    });

    assert.strictEqual(numericEval.hasNumericLiteral, true);
    assert.strictEqual(noNumericEval.hasNumericLiteral, false);
});

void test("evaluateMathOptimizationCandidate handles string literals", () => {
    const stringExpr = '"hello" + "world"';

    const result = evaluateMathOptimizationCandidate({ sourceText: stringExpr, nodeType: "BinaryExpression" });

    // String concatenation should not be treated as a math candidate
    assert.strictEqual(result.hasMathSyntax, false);
});

void test("evaluateMathOptimizationCandidate handles function call expressions", () => {
    const callExpr = "myFunction(x, y)";

    const result = evaluateMathOptimizationCandidate({ sourceText: callExpr, nodeType: "CallExpression" });

    // Function calls should not be treated as math candidates
    assert.strictEqual(result.hasMathSyntax, false);
});

void test("MATH_OPTIMIZATION_POLICY_CONSTANTS match DEFAULT_TEXT_LENGTH_POLICY", () => {
    assert.strictEqual(
        MATH_OPTIMIZATION_POLICY_CONSTANTS.MAX_OPTIMIZATION_CANDIDATE_LENGTH,
        DEFAULT_TEXT_LENGTH_POLICY.maxOptimizationCandidateLength
    );
    assert.strictEqual(
        MATH_OPTIMIZATION_POLICY_CONSTANTS.MAX_MANUAL_NORMALIZATION_LENGTH,
        DEFAULT_TEXT_LENGTH_POLICY.maxManualNormalizationLength
    );
});

void test("formatCanonicalNumericLiteral produces correct output", () => {
    const testCases: Array<{ input: number; expected: string }> = [
        { input: 0, expected: "0" },
        { input: 1, expected: "1" },
        { input: -1, expected: "-1" },
        { input: 0.5, expected: "0.5" },
        { input: 100, expected: "100" },
        { input: 0.0001, expected: "0.0001" },
        { input: 1_234_567_890, expected: "1234567890" }
    ];

    for (const { input, expected } of testCases) {
        const result = formatCanonicalNumericLiteral(input);
        assert.strictEqual(result, expected, `formatCanonicalNumericLiteral(${input}) should be "${expected}"`);
    }
});

void test("formatCanonicalNumericLiteral handles edge cases", () => {
    assert.strictEqual(formatCanonicalNumericLiteral(Number.NaN), null);
    assert.strictEqual(formatCanonicalNumericLiteral(Number.POSITIVE_INFINITY), null);
    assert.strictEqual(formatCanonicalNumericLiteral(Number.NEGATIVE_INFINITY), null);
});

void test("DEFAULT_MATH_SIGNAL_PATTERNS contains all required patterns", () => {
    const patterns: Array<keyof typeof DEFAULT_MATH_SIGNAL_PATTERNS> = [
        "mathOptimizationSignal",
        "mathStrongSignal",
        "divisionBasedSignal",
        "numericLiteralSignal",
        "manualMathCallSignal"
    ];

    for (const patternName of patterns) {
        assert.ok(DEFAULT_MATH_SIGNAL_PATTERNS[patternName] instanceof RegExp, `${patternName} should be a RegExp`);
    }
});

void test("evaluateSkipDecision is pure and does not mutate inputs", () => {
    const parent = { type: "BinaryExpression", extra: "data" };
    const originalParent = JSON.stringify(parent);

    evaluateSkipDecision(parent, "left");

    assert.strictEqual(JSON.stringify(parent), originalParent, "Parent should not be mutated");
});

void test("evaluateMathOptimizationCandidate is pure and does not mutate config", () => {
    const context = { sourceText: "a + b", nodeType: "BinaryExpression" };
    const originalContext = JSON.stringify(context);

    evaluateMathOptimizationCandidate(context);

    assert.strictEqual(JSON.stringify(context), originalContext, "Context should not be mutated");
});

void test("skip decisions are consistent across multiple calls", () => {
    const parent = { type: "BinaryExpression" };

    // Call multiple times and verify consistency
    const result1 = evaluateSkipDecision(parent, "left");
    const result2 = evaluateSkipDecision(parent, "left");
    const result3 = evaluateSkipDecision(parent, "left");

    assert.strictEqual(result1, result2);
    assert.strictEqual(result2, result3);
});

void test("candidate evaluation is consistent across multiple calls", () => {
    const context = { sourceText: "x * y", nodeType: "BinaryExpression" };

    // Call multiple times and verify consistency
    const result1 = evaluateMathOptimizationCandidate(context);
    const result2 = evaluateMathOptimizationCandidate(context);
    const result3 = evaluateMathOptimizationCandidate(context);

    assert.strictEqual(result1.hasMathSyntax, result2.hasMathSyntax);
    assert.strictEqual(result2.hasMathSyntax, result3.hasMathSyntax);
});

void test("evaluateSkipDecision handles edge case of empty parent", () => {
    assert.strictEqual(evaluateSkipDecision({}, null), false);
    assert.strictEqual(evaluateSkipDecision({ type: "" }, null), false);
});

void test("evaluateMathOptimizationCandidate handles edge cases", () => {
    // Empty string
    const emptyEval = evaluateMathOptimizationCandidate({ sourceText: "", nodeType: "BinaryExpression" });
    assert.strictEqual(emptyEval.exceedsLengthThreshold, true);
    assert.strictEqual(emptyEval.hasMathSyntax, false);

    // Very long but valid math expression
    const longMathExpr = "x + y".repeat(500);
    const longEval = evaluateMathOptimizationCandidate({ sourceText: longMathExpr, nodeType: "BinaryExpression" });
    assert.strictEqual(longEval.exceedsLengthThreshold, true);
});

void test("shouldAttemptManualNormalization is correctly determined", () => {
    // Should attempt: has division operator
    const divisionExpr = "x / 2 + y";
    const divisionEval = evaluateMathOptimizationCandidate({ sourceText: divisionExpr, nodeType: "BinaryExpression" });
    assert.strictEqual(divisionEval.shouldAttemptManualNormalization, true);

    // Should attempt: has multiplication
    const multExpr = "x * y";
    const multEval = evaluateMathOptimizationCandidate({ sourceText: multExpr, nodeType: "BinaryExpression" });
    assert.strictEqual(multEval.shouldAttemptManualNormalization, true);

    // Should attempt: has numeric with addition
    const numericAddExpr = "42 + x";
    const numericAddEval = evaluateMathOptimizationCandidate({
        sourceText: numericAddExpr,
        nodeType: "BinaryExpression"
    });
    assert.strictEqual(numericAddEval.shouldAttemptManualNormalization, true);

    // Should NOT attempt: simple addition without numbers
    const simpleAddExpr = "x + y";
    const simpleAddEval = evaluateMathOptimizationCandidate({
        sourceText: simpleAddExpr,
        nodeType: "BinaryExpression"
    });
    assert.strictEqual(simpleAddEval.shouldAttemptManualNormalization, false);
});

void test("evaluateSkipDecision with complex parent structures", () => {
    // Test that deeply nested structures are handled correctly
    const complexParent = {
        type: "ParenthesizedExpression",
        extra: { nested: { data: "test" } }
    };

    assert.strictEqual(evaluateSkipDecision(complexParent, "expression"), true);
});
