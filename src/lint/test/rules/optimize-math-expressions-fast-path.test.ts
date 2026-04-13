import assert from "node:assert/strict";
import { test } from "node:test";

import { lintWithRule } from "./lint-rule-test-harness.js";

void test("optimize-math-expressions rewrites additive product chains to dot_product helpers", () => {
    const input = ["result3d = a * b + c * d + e * f;", "result2d = g * h + i * j;", ""].join("\n");

    const result = lintWithRule("optimize-math-expressions", input, {});

    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.messageId, "optimizeMathExpressions");
    assert.equal(
        result.output,
        ["result3d = dot_product_3d(a, c, e, b, d, f);", "result2d = dot_product(g, i, h, j);", ""].join("\n")
    );
});

void test("optimize-math-expressions preserves square-product simplifications without forcing dot_product", () => {
    const input = "result = a * a + b * b + c * c;\n";
    const result = lintWithRule("optimize-math-expressions", input, {});

    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.messageId, "optimizeMathExpressions");
    assert.equal(result.output, "result = dot_product_3d(a, b, c, a, b, c);\n");
    assert.equal(result.output.includes("dot_product_3d"), true);
});

void test("optimize-math-expressions leaves additive identifier chains unchanged", () => {
    const input = ["sum = left + right + carry;", "return sum - previous;", ""].join("\n");
    const result = lintWithRule("optimize-math-expressions", input, {});

    assert.equal(result.messages.length, 0);
    assert.equal(result.output, input);
});

void test("optimize-math-expressions applies the same cached reciprocal rewrite across repeated expressions", () => {
    const input = ["a = size / 2;", "b = size / 2;", "c = size / 2;", ""].join("\n");
    const result = lintWithRule("optimize-math-expressions", input, {});

    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.messageId, "optimizeMathExpressions");
    assert.equal(result.output, ["a = size * 0.5;", "b = size * 0.5;", "c = size * 0.5;", ""].join("\n"));
});

void test("optimize-math-expressions does not rewrite reciprocal multipliers that require scientific notation", () => {
    const input = ["return _lcg / 2147483648;", "return value / 4;", ""].join("\n");
    const result = lintWithRule("optimize-math-expressions", input, {});

    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.messageId, "optimizeMathExpressions");
    assert.equal(result.output, ["return _lcg / 2147483648;", "return value * 0.25;", ""].join("\n"));
});

void test("optimize-math-expressions does not rewrite additive scalar products into dot_product", () => {
    const input = "result = (current_time / 3000) + ((i / currArmNum) * 6 * pi);\n";
    const result = lintWithRule("optimize-math-expressions", input, {});

    assert.equal(result.output, "result = current_time * 0.0003333333333333333 + i / currArmNum * 6 * pi;\n");
    assert.equal(result.output.includes("dot_product("), false);
});

void test("optimize-math-expressions canonicalizes three-axis squared sums to dot_product_3d", () => {
    const input = "m = mx * mx + my * my + mz * mz;\n";
    const result = lintWithRule("optimize-math-expressions", input, {});

    assert.equal(result.output, "m = dot_product_3d(mx, my, mz, mx, my, mz);\n");
});

void test("optimize-math-expressions canonicalizes sqrt of 3-axis squared sums to point_distance_3d", () => {
    const input = "p1_p3 = sqrt(P1toP3x * P1toP3x + P1toP3y * P1toP3y + P1toP3z * P1toP3z);\n";
    const result = lintWithRule("optimize-math-expressions", input, {});

    assert.equal(result.output, "p1_p3 = point_distance_3d(0, 0, 0, P1toP3x, P1toP3y, P1toP3z);\n");
});

void test("optimize-math-expressions keeps fast dot_product rewrites stable across large repeated batches", () => {
    const lineCount = 200;
    const lines: string[] = [];
    for (let index = 0; index < lineCount; index += 1) {
        lines.push(`result_${index} = a_${index} * b_${index} + c_${index} * d_${index} + e_${index} * f_${index};`);
    }
    lines.push("");
    const input = lines.join("\n");

    const result = lintWithRule("optimize-math-expressions", input, {});

    assert.equal(result.messages.length, 1);
    for (let index = 0; index < lineCount; index += 1) {
        assert.match(result.output, new RegExp(String.raw`result_${index}\s*=\s*dot_product_3d\(`, "u"));
    }
    assert.doesNotMatch(result.output, /\bpoint_distance_3d\(/u);
});
