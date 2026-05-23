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

void test("optimize-math-expressions canonicalizes near-zero literals to '0' using epsilon comparison", () => {
    // Values like 1e-15 are numerically zero for GML literal purposes.
    // The rule must use tolerance-aware comparison (not strict ===) so that
    // `1e-15` normalizes to "0" instead of staying as the raw scientific
    // representation, which would break optimizations that compare against 0.
    const input = "result = 1e-15 * value;\n";
    const result = lintWithRule("optimize-math-expressions", input, {});

    assert.equal(result.messages.length, 1);
    // The literal 1e-15 should be treated as approximately 0, so the
    // expression collapses to a canonical zero.
    assert.equal(result.output.includes("0"), true);
});

void test("optimize-math-expressions rewrites division by near-2 as multiplication via epsilon comparison", () => {
    // A literal computed at parse time may be 1.9999999999999998 due to
    // floating-point rounding rather than exactly 2. The rule must use
    // tolerance-aware comparison so it recognizes the near-2 literal and
    // rewrites the division to a multiplication by the reciprocal.
    //
    // This test covers both cases in one stronger assertion:
    // 1. 2.0 normalizes to exactly 2 and triggers the rewrite (→ size * 0.5)
    // 2. 1.9999999999999998 (floating-point noise for ~2) also triggers the
    //    rewrite, proving epsilon-aware comparison vs strict equality.
    const input = "half1 = size / 2.0;\nhalf2 = size / 1.9999999999999998;\n";
    const result = lintWithRule("optimize-math-expressions", input, {});

    // Both lines should trigger the division-to-multiplication rewrite and
    // produce a multiplication by 0.5. The output should NOT contain `/`.
    assert.equal(result.messages.length, 1);
    assert.ok(result.output.includes("*"), "output should contain a multiplication, not division");
    assert.equal(result.output.includes("/"), false, "output should not contain division operator");
});

void test("optimize-math-expressions removes *= 1 and /= 1 using epsilon tolerance for near-1 values", () => {
    // When `1.0` is written in source, strict === 1 correctly handles it.
    // But floating-point computation can produce 0.9999999999999998 instead
    // of exactly 1 (e.g. `1 - 1e-16` or `0.1 + 0.9`). Without epsilon-tolerant
    // comparison, `x *= 0.9999999999999998` would bypass the removal and the
    // expression would appear unchanged in the output — a silent correctness
    // failure that is hard to debug.
    const exactOneInput = "x *= 1.0;\ny /= 1.0;\n";
    const exactOneResult = lintWithRule("optimize-math-expressions", exactOneInput, {});

    // Both `*=` and `/=` with exactly 1 should be removed.
    assert.equal(exactOneResult.messages.length, 1);
    assert.equal(exactOneResult.output.includes("1.0"), false, "1.0 should be removed from output");

    // The floating-point noise case: `1 - 2.22e-16` evaluates to ~0.9999999999999998.
    // This should also trigger the removal via epsilon-tolerant matching, proving
    // the comparison is tolerant rather than strict.
    const nearOneInput = "x *= (1 - 2.22e-16);\ny /= (1 + 1e-15);\n";
    const nearOneResult = lintWithRule("optimize-math-expressions", nearOneInput, {});

    // The statements with near-1 multipliers should be removed (output is shorter).
    assert.equal(nearOneResult.messages.length, 1);
    assert.ok(
        nearOneResult.output.length < nearOneInput.length,
        "near-1 expressions should be removed, making output shorter than input"
    );
});
