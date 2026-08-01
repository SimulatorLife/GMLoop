import assert from "node:assert/strict";
import test from "node:test";

import {
    applyDivisionToMultiplication,
    DEFAULT_MATH_NUMERIC_POLICY,
    type MathNumericPolicy,
    resolveMathNumericPolicy
} from "../../../src/rules/gml/math/index.js";

void test("DEFAULT_MATH_NUMERIC_POLICY matches the previous hardcoded thresholds", () => {
    // The values here intentionally match the constants that used to live as
    // duplicated `const` declarations in math-division-to-multiplication.ts
    // and math-traversal-normalization.ts. Updating either side without the
    // other would change observable rewrite behavior, so we pin them here.
    assert.strictEqual(DEFAULT_MATH_NUMERIC_POLICY.maxSafeReciprocal, 1e10);
    assert.strictEqual(DEFAULT_MATH_NUMERIC_POLICY.minSafeDivisor, 1e-10);
});

void test("DEFAULT_MATH_NUMERIC_POLICY is frozen to prevent mutation", () => {
    assert.strictEqual(Object.isFrozen(DEFAULT_MATH_NUMERIC_POLICY), true);
});

void test("resolveMathNumericPolicy returns the default policy for null and undefined input", () => {
    assert.deepStrictEqual(resolveMathNumericPolicy(null), DEFAULT_MATH_NUMERIC_POLICY);
    assert.deepStrictEqual(resolveMathNumericPolicy(undefined), DEFAULT_MATH_NUMERIC_POLICY);
});

void test("resolveMathNumericPolicy returns the default policy for non-object input", () => {
    // Primitives and arrays should not be treated as overrides; if a caller
    // hands in `42` or `["1e10"]` we should fall back rather than throw.
    assert.deepStrictEqual(resolveMathNumericPolicy(42), DEFAULT_MATH_NUMERIC_POLICY);
    assert.deepStrictEqual(resolveMathNumericPolicy("hello"), DEFAULT_MATH_NUMERIC_POLICY);
    assert.deepStrictEqual(resolveMathNumericPolicy(true), DEFAULT_MATH_NUMERIC_POLICY);
    assert.deepStrictEqual(resolveMathNumericPolicy([1e10, 1e-10]), DEFAULT_MATH_NUMERIC_POLICY);
});

void test("resolveMathNumericPolicy accepts a complete policy override", () => {
    const override: MathNumericPolicy = Object.freeze({
        maxSafeReciprocal: 5e5,
        minSafeDivisor: 2e-6
    });
    const resolved = resolveMathNumericPolicy(override);
    assert.deepStrictEqual(resolved, override);
    assert.strictEqual(Object.isFrozen(resolved), true);
});

void test("resolveMathNumericPolicy merges partial overrides with the defaults", () => {
    const partial = { maxSafeReciprocal: 5e5 };
    const resolved = resolveMathNumericPolicy(partial);
    assert.strictEqual(resolved.maxSafeReciprocal, 5e5);
    assert.strictEqual(resolved.minSafeDivisor, DEFAULT_MATH_NUMERIC_POLICY.minSafeDivisor);
});

void test("resolveMathNumericPolicy falls back per-field for invalid numeric overrides", () => {
    // Negative, NaN, infinite, and zero values are rejected so callers can't
    // accidentally disable the safety guard. The fallback preserves the
    // corresponding field from the default policy.
    const overrides = {
        maxSafeReciprocal: Number.NaN,
        minSafeDivisor: 0
    };
    const resolved = resolveMathNumericPolicy(overrides);
    assert.strictEqual(resolved.maxSafeReciprocal, DEFAULT_MATH_NUMERIC_POLICY.maxSafeReciprocal);
    assert.strictEqual(resolved.minSafeDivisor, DEFAULT_MATH_NUMERIC_POLICY.minSafeDivisor);
});

void test("resolveMathNumericPolicy rejects non-positive overrides while keeping the rest", () => {
    const overrides = {
        maxSafeReciprocal: -1,
        minSafeDivisor: 1e-12
    };
    const resolved = resolveMathNumericPolicy(overrides);
    assert.strictEqual(resolved.maxSafeReciprocal, DEFAULT_MATH_NUMERIC_POLICY.maxSafeReciprocal);
    assert.strictEqual(resolved.minSafeDivisor, 1e-12);
});

void test("resolveMathNumericPolicy parses numeric strings and trims whitespace", () => {
    const overrides = {
        maxSafeReciprocal: "  1e6 ",
        minSafeDivisor: " 1e-6 "
    };
    const resolved = resolveMathNumericPolicy(overrides);
    assert.strictEqual(resolved.maxSafeReciprocal, 1e6);
    assert.strictEqual(resolved.minSafeDivisor, 1e-6);
});

void test("resolveMathNumericPolicy treats blank and non-numeric strings as missing", () => {
    const overrides = {
        maxSafeReciprocal: "  ",
        minSafeDivisor: "not-a-number"
    };
    const resolved = resolveMathNumericPolicy(overrides);
    assert.strictEqual(resolved.maxSafeReciprocal, DEFAULT_MATH_NUMERIC_POLICY.maxSafeReciprocal);
    assert.strictEqual(resolved.minSafeDivisor, DEFAULT_MATH_NUMERIC_POLICY.minSafeDivisor);
});

void test("resolveMathNumericPolicy honours a custom fallback policy", () => {
    const customFallback: MathNumericPolicy = Object.freeze({
        maxSafeReciprocal: 100,
        minSafeDivisor: 0.01
    });
    const resolved = resolveMathNumericPolicy(undefined, { fallback: customFallback });
    assert.deepStrictEqual(resolved, customFallback);

    // Partial overrides should still draw from the custom fallback, not the
    // global default, so that callers can opt into an entirely different
    // operating regime by passing a fallback.
    const partialOverride = { minSafeDivisor: 0.5 };
    const merged = resolveMathNumericPolicy(partialOverride, { fallback: customFallback });
    assert.strictEqual(merged.maxSafeReciprocal, customFallback.maxSafeReciprocal);
    assert.strictEqual(merged.minSafeDivisor, 0.5);
});

void test("resolveMathNumericPolicy ignores boolean and object field overrides", () => {
    // The helper is intentionally permissive: unexpected types are treated as
    // "use the default" rather than raising, so that user-supplied
    // configuration that happens to be malformed (for example a YAML parser
    // returning booleans for missing keys) cannot break the transform pass.
    const overrides = {
        maxSafeReciprocal: true,
        minSafeDivisor: { value: 1e-12 }
    };
    const resolved = resolveMathNumericPolicy(overrides);
    assert.deepStrictEqual(resolved, DEFAULT_MATH_NUMERIC_POLICY);
});

void test("applyDivisionToMultiplication uses the default policy when none is supplied", () => {
    // With the default 1e10 cap, dividing by 2 (reciprocal = 0.5) should be
    // rewritten into a multiplication. 2 is well within the safety window and
    // rounds exactly in IEEE-754, so we can assert the literal text precisely.
    const ast: any = {
        type: "BinaryExpression",
        operator: "/",
        left: { type: "Identifier", name: "x" },
        right: { type: "Literal", value: "2" }
    };

    applyDivisionToMultiplication(ast);

    assert.strictEqual(ast.operator, "*");
    assert.strictEqual(ast.left.name, "x");
    assert.strictEqual(ast.right.value, "0.5");
});

void test("applyDivisionToMultiplication honours a tighter policy override", () => {
    // Tightening `maxSafeReciprocal` to 1 means any division by a value with
    // |reciprocal| > 1 (i.e. divisor with magnitude < 1) is rejected. We pick
    // 0.5 so the default would happily rewrite it, but the tight policy must
    // refuse. This exercises the new `policy` parameter end-to-end so future
    // refactors can't silently drop the override.
    const ast: any = {
        type: "BinaryExpression",
        operator: "/",
        left: { type: "Identifier", name: "x" },
        right: { type: "Literal", value: "0.5" }
    };

    const policy = resolveMathNumericPolicy({ maxSafeReciprocal: 1, minSafeDivisor: 1 });
    applyDivisionToMultiplication(ast, policy);

    assert.strictEqual(ast.operator, "/");
    assert.strictEqual(ast.left.name, "x");
    assert.strictEqual(ast.right.value, "0.5");
});

void test("applyDivisionToMultiplication rejects divisors below the configured minSafeDivisor", () => {
    // The default `minSafeDivisor` is 1e-10, so a divisor of 1e-11 should
    // never be inverted: |reciprocal| = 1e11 which already exceeds the
    // default 1e10 cap. We assert the divisor-floor guard by setting the
    // reciprocal cap to an extreme value (1e20) so only the divisor floor
    // can reject the rewrite.
    const ast: any = {
        type: "BinaryExpression",
        operator: "/",
        left: { type: "Identifier", name: "x" },
        right: { type: "Literal", value: "1e-11" }
    };

    const policy = resolveMathNumericPolicy({ maxSafeReciprocal: 1e20, minSafeDivisor: 1e-10 });
    applyDivisionToMultiplication(ast, policy);

    assert.strictEqual(ast.operator, "/");
    assert.strictEqual(ast.right.value, "1e-11");
});

void test("applyDivisionToMultiplication flattens redundant parens around a multiplicative left operand", () => {
    // After the divide-by-constant rewrite, `((x * 2)) / 4` should become
    // `x * 2 * 0.25`. The flatten pass strips the redundant parens around
    // the multiplicative operand so the output reads as a flat multiplication
    // chain rather than `((x * 2)) * 0.25`.
    const ast: any = {
        type: "BinaryExpression",
        operator: "/",
        left: {
            type: "ParenthesizedExpression",
            expression: {
                type: "BinaryExpression",
                operator: "*",
                left: { type: "Identifier", name: "x" },
                right: { type: "Literal", value: "2" }
            }
        },
        right: { type: "Literal", value: "4" }
    };

    applyDivisionToMultiplication(ast);

    assert.strictEqual(ast.operator, "*");
    assert.strictEqual(ast.left.type, "BinaryExpression");
    assert.strictEqual(ast.left.operator, "*");
    assert.strictEqual(ast.left.left.name, "x");
    assert.strictEqual(ast.left.right.value, "2");
    assert.strictEqual(ast.right.value, "0.25");
});

void test("applyDivisionToMultiplication preserves parens around a non-multiplicative left operand", () => {
    // The flatten pass must only strip wrappers whose innermost expression
    // is a `*` BINARY_EXPRESSION. Removing parens around `+` would change
    // precedence, so `(x + 2) / 4` must keep its parens.
    const ast: any = {
        type: "BinaryExpression",
        operator: "/",
        left: {
            type: "ParenthesizedExpression",
            expression: {
                type: "BinaryExpression",
                operator: "+",
                left: { type: "Identifier", name: "x" },
                right: { type: "Literal", value: "2" }
            }
        },
        right: { type: "Literal", value: "4" }
    };

    applyDivisionToMultiplication(ast);

    assert.strictEqual(ast.operator, "*");
    assert.strictEqual(ast.left.type, "ParenthesizedExpression");
    assert.strictEqual(ast.left.expression.operator, "+");
    assert.strictEqual(ast.right.value, "0.25");
});

void test("applyDivisionToMultiplication recurses into nested divisions", () => {
    // The depth-first recursion must visit children before their parents so
    // nested divisions like `(x / 2) / 4` collapse to `x * 0.5 * 0.25`
    // (i.e., each `* 0.5` rewrite happens before the outer `* 0.25`
    // rewrite is attempted).
    const ast: any = {
        type: "BinaryExpression",
        operator: "/",
        left: {
            type: "BinaryExpression",
            operator: "/",
            left: { type: "Identifier", name: "x" },
            right: { type: "Literal", value: "2" }
        },
        right: { type: "Literal", value: "4" }
    };

    applyDivisionToMultiplication(ast);

    assert.strictEqual(ast.operator, "*");
    assert.strictEqual(ast.left.type, "BinaryExpression");
    assert.strictEqual(ast.left.operator, "*");
    assert.strictEqual(ast.left.left.name, "x");
    assert.strictEqual(ast.left.right.value, "0.5");
    assert.strictEqual(ast.right.value, "0.25");
});
