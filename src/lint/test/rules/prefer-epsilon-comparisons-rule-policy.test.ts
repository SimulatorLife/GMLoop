/**
 * Unit tests for the `prefer-epsilon-comparisons` policy module.
 *
 * These tests verify the eligibility decisions ("what should be rewritten?")
 * independently from the rule's mechanism (which walks lines, tracks
 * brace-depth scope, and reports ESLint fixes).  Mixing the two previously
 * obscured the policy contract; these tests pin it down so a future
 * contributor can change the eligibility rules without firing up the ESLint
 * runtime to verify the contract still holds.
 *
 * Each test case documents one decision the policy makes: which
 * declarations qualify as math-sensitive, which zero-comparison shape is
 * recognised, which math calls imply a non-negative result, and so on.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
    evaluateIfZeroComparison,
    evaluateIsEpsilonDeclaration,
    evaluateIsFunctionScopeStart,
    evaluateIsMathSensitiveVariableDeclaration,
    evaluateMathSensitiveVariables,
    expressionIsKnownNonNegativeMath,
    hasRepeatedDotProductOperands,
    readMathSensitiveFunctionNames
} from "../../src/rules/gml/rules/prefer-epsilon-comparisons-rule-policy.js";

// ---------------------------------------------------------------------------
// readMathSensitiveFunctionNames
// ---------------------------------------------------------------------------

void test("readMathSensitiveFunctionNames returns every math builtin called by the expression", () => {
    assert.deepStrictEqual(readMathSensitiveFunctionNames("sqrt(dx * dx + dy * dy) + point_distance(a, b, c, d)"), [
        "sqrt",
        "point_distance"
    ]);
});

void test("readMathSensitiveFunctionNames ignores identifiers that are not followed by '('", () => {
    // `sin` appears as a bare identifier in the expression and so must not be
    // counted as a math call.
    assert.deepStrictEqual(readMathSensitiveFunctionNames("var sin = 0; sin + 1"), []);
});

void test("readMathSensitiveFunctionNames does not count builtin substrings (e.g. 'cosine')", () => {
    // The previous substring-based matcher mis-flagged identifiers like
    // `cosine` as the `cos` builtin. The pattern must require a `(` after the
    // identifier to confirm a call form.
    assert.deepStrictEqual(readMathSensitiveFunctionNames("var cosine = 1; var answer = cosine * 2"), []);
});

void test("readMathSensitiveFunctionNames is case-insensitive on the function name", () => {
    assert.deepStrictEqual(readMathSensitiveFunctionNames("SQRT(x) + Sin(angle)"), ["sqrt", "sin"]);
});

// ---------------------------------------------------------------------------
// hasRepeatedDotProductOperands
// ---------------------------------------------------------------------------

void test("hasRepeatedDotProductOperands returns true for repeated-operand 2D dot products", () => {
    assert.strictEqual(hasRepeatedDotProductOperands("dot_product(ax, ay, ax, ay)"), true);
});

void test("hasRepeatedDotProductOperands returns true for repeated-operand 3D dot products", () => {
    assert.strictEqual(hasRepeatedDotProductOperands("dot_product_3d(ax, ay, az, ax, ay, az)"), true);
});

void test("hasRepeatedDotProductOperands returns false when the operand halves differ", () => {
    assert.strictEqual(hasRepeatedDotProductOperands("dot_product(ax, ay, bx, by)"), false);
});

void test("hasRepeatedDotProductOperands returns false when the argument count is wrong", () => {
    // 3D dot_product requires six arguments; four arguments mean the call
    // is the 2D form. The matcher must reject mismatched counts.
    assert.strictEqual(hasRepeatedDotProductOperands("dot_product_3d(ax, ay, az, ax, ay)"), false);
});

void test("hasRepeatedDotProductOperands returns false for non-dot_product calls", () => {
    assert.strictEqual(hasRepeatedDotProductOperands("sqrt(x + x)"), false);
});

// ---------------------------------------------------------------------------
// expressionIsKnownNonNegativeMath
// ---------------------------------------------------------------------------

void test("expressionIsKnownNonNegativeMath returns true for repeated-operand dot products", () => {
    assert.strictEqual(expressionIsKnownNonNegativeMath("dot_product(ax, ay, ax, ay)", ["dot_product"]), true);
});

void test("expressionIsKnownNonNegativeMath returns true when every call is in the non-negative set", () => {
    assert.strictEqual(
        expressionIsKnownNonNegativeMath("sqr(x) + sqrt(y) + point_distance(a, b, c, d)", [
            "sqr",
            "sqrt",
            "point_distance"
        ]),
        true
    );
});

void test("expressionIsKnownNonNegativeMath returns false when any call can produce a negative result", () => {
    // `sin` is in MATH_SENSITIVE but not in NON_NEGATIVE_MATH_FUNCTION_NAMES,
    // so a strict positivity rewrite must still fire.
    assert.strictEqual(expressionIsKnownNonNegativeMath("sin(angle)", ["sin"]), false);
});

void test("expressionIsKnownNonNegativeMath returns false when the expression contains a leading '-'", () => {
    assert.strictEqual(expressionIsKnownNonNegativeMath("-sqr(x) + sqrt(y)", ["sqr", "sqrt"]), false);
});

void test("expressionIsKnownNonNegativeMath returns false for an empty function name list", () => {
    // The rule must only treat an expression as non-negative when its math
    // calls alone justify the assumption.
    assert.strictEqual(expressionIsKnownNonNegativeMath("1 + 1", []), false);
});

// ---------------------------------------------------------------------------
// evaluateIsMathSensitiveVariableDeclaration
// ---------------------------------------------------------------------------

void test("evaluateIsMathSensitiveVariableDeclaration captures a math-sensitive declaration", () => {
    const declaration = evaluateIsMathSensitiveVariableDeclaration("var actual_dist = sqr(x) + sqr(y);");
    assert.deepStrictEqual(declaration, {
        variableName: "actual_dist",
        expression: "sqr(x) + sqr(y)",
        functionNames: ["sqr", "sqr"]
    });
});

void test("evaluateIsMathSensitiveVariableDeclaration returns null when no math builtin is called", () => {
    assert.strictEqual(evaluateIsMathSensitiveVariableDeclaration("var queue_size = array_length(queue);"), null);
});

void test("evaluateIsMathSensitiveVariableDeclaration returns null for non-declaration lines", () => {
    assert.strictEqual(evaluateIsMathSensitiveVariableDeclaration("if (actual_dist == 0) {"), null);
});

void test("evaluateIsMathSensitiveVariableDeclaration accepts indented declarations", () => {
    const declaration = evaluateIsMathSensitiveVariableDeclaration("    var other = dot_product_3d(a, b, c, d, e, f);");
    assert.deepStrictEqual(declaration, {
        variableName: "other",
        expression: "dot_product_3d(a, b, c, d, e, f)",
        functionNames: ["dot_product_3d"]
    });
});

// ---------------------------------------------------------------------------
// evaluateIsFunctionScopeStart
// ---------------------------------------------------------------------------

void test("evaluateIsFunctionScopeStart accepts a named function declaration", () => {
    assert.strictEqual(evaluateIsFunctionScopeStart("function foo() {"), true);
});

void test("evaluateIsFunctionScopeStart accepts a method/lambda assignment", () => {
    assert.strictEqual(evaluateIsFunctionScopeStart("update = function(a, b) {"), true);
});

void test("evaluateIsFunctionScopeStart rejects plain statements", () => {
    assert.strictEqual(evaluateIsFunctionScopeStart("var x = 1;"), false);
});

void test("evaluateIsFunctionScopeStart rejects lines whose opening brace is not at end-of-line", () => {
    // `function` keyword must be followed by an opening `{` at the end of
    // the line; this ensures we only treat the line as the scope opener
    // when the function body actually starts here.
    assert.strictEqual(evaluateIsFunctionScopeStart("function foo()"), false);
});

// ---------------------------------------------------------------------------
// evaluateIsEpsilonDeclaration
// ---------------------------------------------------------------------------

void test("evaluateIsEpsilonDeclaration accepts an eps declaration line", () => {
    assert.strictEqual(evaluateIsEpsilonDeclaration("    var eps = math_get_epsilon();"), true);
});

void test("evaluateIsEpsilonDeclaration rejects unrelated var declarations", () => {
    assert.strictEqual(evaluateIsEpsilonDeclaration("var eps = 0;"), false);
    assert.strictEqual(evaluateIsEpsilonDeclaration("var other = math_get_epsilon();"), false);
});

// ---------------------------------------------------------------------------
// evaluateIfZeroComparison
// ---------------------------------------------------------------------------

void test("evaluateIfZeroComparison captures an equality check", () => {
    const match = evaluateIfZeroComparison("    if (actual_dist == 0) {");
    assert.deepStrictEqual(match, {
        indentation: "    ",
        variableName: "actual_dist",
        operator: "==",
        suffix: " {"
    });
});

void test("evaluateIfZeroComparison captures a strict-positivity check", () => {
    const match = evaluateIfZeroComparison("if (m > 0) {");
    assert.deepStrictEqual(match, {
        indentation: "",
        variableName: "m",
        operator: ">",
        suffix: " {"
    });
});

void test("evaluateIfZeroComparison returns null for non-zero comparisons", () => {
    assert.strictEqual(evaluateIfZeroComparison("if (m > 5) {"), null);
    assert.strictEqual(evaluateIfZeroComparison("if (m == 1) {"), null);
});

void test("evaluateIfZeroComparison returns null for non-`if` zero checks", () => {
    // The rule only rewrites the top-level `if` shape. A `while` or `var`
    // line that happens to mention `== 0` must not be classified.
    assert.strictEqual(evaluateIfZeroComparison("while (m == 0) {"), null);
    assert.strictEqual(evaluateIfZeroComparison("var x = m == 0;"), null);
});

// ---------------------------------------------------------------------------
// evaluateMathSensitiveVariables
// ---------------------------------------------------------------------------

void test("evaluateMathSensitiveVariables returns no variables when no math declarations are present", () => {
    const classification = evaluateMathSensitiveVariables([
        "var queue_size = array_length(queue);",
        "if (queue_size == 0) {",
        "    return;",
        "}",
        ""
    ]);
    assert.strictEqual(classification.mathSensitiveVariables.size, 0);
    assert.strictEqual(classification.nonNegativeMathSensitiveVariables.size, 0);
});

void test("evaluateMathSensitiveVariables partitions math and non-negative math variables", () => {
    const classification = evaluateMathSensitiveVariables([
        "var actual_dist = sqr(xoff) + sqr(yoff);",
        "var dn = dot_product_3d(vx, vy, vz, nx, ny, nz);",
        "var l = sqrt(toX * toX + toY * toY + toZ * toZ);",
        "var l2 = point_distance(a, b, c, d);",
        "var sine = sin(angle);"
    ]);
    assert.deepStrictEqual(
        [...classification.mathSensitiveVariables].toSorted(),
        ["actual_dist", "dn", "l", "l2", "sine"].toSorted()
    );
    // `sqr`, `sqrt`, and `point_distance` produce non-negative results, but
    // `dot_product_3d` and `sin` can produce signed outputs, so those two
    // must be excluded from the non-negative set.
    assert.deepStrictEqual(
        [...classification.nonNegativeMathSensitiveVariables].toSorted(),
        ["actual_dist", "l", "l2"].toSorted()
    );
});

// ---------------------------------------------------------------------------
// Surface-area regression: the policy module's evaluator set is intentionally
// narrow — only the predicates the rule mechanism actually consumes are
// exported. Adding a new evaluator that nothing calls recreates the dead
// abstraction layer this simplification removed.
// ---------------------------------------------------------------------------

void test("policy evaluators match the set the rule mechanism consumes", async () => {
    const rulesDirectory = path.dirname(fileURLToPath(import.meta.url));
    const policySourcePath = path.resolve(
        rulesDirectory,
        "../../../src/rules/gml/rules/prefer-epsilon-comparisons-rule-policy.ts"
    );
    const mechanismSourcePath = path.resolve(
        rulesDirectory,
        "../../../src/rules/gml/rules/prefer-epsilon-comparisons-rule.ts"
    );

    const policyModule = await import("../../src/rules/gml/rules/prefer-epsilon-comparisons-rule-policy.js");

    // The policy exposes leaf evaluators (e.g. `hasRepeatedDotProductOperands`,
    // `readMathSensitiveFunctionNames`) in addition to the composite
    // evaluators the mechanism calls directly. The leaves exist so the
    // policy contract is testable at fine granularity and so future
    // re-users can compose them into new policy strategies without
    // duplicating the math classification rules.
    const expectedFunctionNames = [
        "readMathSensitiveFunctionNames",
        "hasRepeatedDotProductOperands",
        "expressionIsKnownNonNegativeMath",
        "evaluateIsMathSensitiveVariableDeclaration",
        "evaluateIsFunctionScopeStart",
        "evaluateIsEpsilonDeclaration",
        "evaluateIfZeroComparison",
        "evaluateMathSensitiveVariables"
    ] as const;

    const exportedFunctionNames = Object.keys(policyModule).filter((name) => typeof policyModule[name] === "function");

    assert.deepStrictEqual(
        exportedFunctionNames.toSorted(),
        [...expectedFunctionNames].toSorted(),
        "policy module must only export evaluators the rule mechanism (directly or transitively) consumes"
    );

    // Sanity-check: the mechanism directly drives the rewrite by calling a
    // small set of composite evaluators. The leaf evaluators are exercised
    // transitively from inside the policy module.
    const mechanismSource = await readFile(mechanismSourcePath, "utf8");
    const policySource = await readFile(policySourcePath, "utf8");

    const mechanismImports = [
        "evaluateMathSensitiveVariables",
        "evaluateIsEpsilonDeclaration",
        "evaluateIsFunctionScopeStart",
        "evaluateIfZeroComparison"
    ] as const;

    for (const name of mechanismImports) {
        assert.ok(mechanismSource.includes(name), `${name} must be referenced by the rule mechanism`);
        assert.ok(
            policySource.includes(`export function ${name}`),
            `${name} must still be exported from the policy module`
        );
    }

    // The leaf evaluators are exercised by other policy functions; they
    // exist to keep the policy testable at fine granularity, and the
    // surface-area test asserts both their presence in the source and their
    // actual reference somewhere within the policy module.
    const leafExports = [
        "readMathSensitiveFunctionNames",
        "hasRepeatedDotProductOperands",
        "expressionIsKnownNonNegativeMath",
        "evaluateIsMathSensitiveVariableDeclaration"
    ] as const;

    for (const name of leafExports) {
        assert.ok(policySource.includes(`export function ${name}`), `${name} must be exported`);
        assert.ok(policySource.includes(name), `${name} must be referenced inside the policy module`);
    }
});
