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
    // duplicated `const` declarations in math-division-to-multiplication.ts,
    // math-traversal-normalization.ts, and two duplicated `1e-10` literals
    // inside optimize-math-expressions-rule.ts
    // (`buildMultiplicativeExpression` and `performDeadCodeElimination`).
    // Updating either side without the other would change observable rewrite
    // behavior, so we pin them here.
    assert.strictEqual(DEFAULT_MATH_NUMERIC_POLICY.maxSafeReciprocal, 1e10);
    assert.strictEqual(DEFAULT_MATH_NUMERIC_POLICY.minSafeDivisor, 1e-10);
    assert.strictEqual(DEFAULT_MATH_NUMERIC_POLICY.zeroQuantityEpsilon, 1e-10);
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
        minSafeDivisor: 2e-6,
        zeroQuantityEpsilon: 5e-6
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
    assert.strictEqual(resolved.zeroQuantityEpsilon, DEFAULT_MATH_NUMERIC_POLICY.zeroQuantityEpsilon);
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
        minSafeDivisor: 0.01,
        zeroQuantityEpsilon: 0.02
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
    assert.strictEqual(merged.zeroQuantityEpsilon, customFallback.zeroQuantityEpsilon);
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

void test("applyDivisionToMultiplication treats near-1 reciprocal numerators as one", () => {
    // Regression coverage for the floating-point equality fix at
    // `math-division-to-multiplication.ts` (the `extractReciprocalScalar`
    // helper). The previous `Math.abs(numeratorValue - 1) > Number.EPSILON`
    // check rejected numerator literals whose value differed from 1 by more
    // than a single ulp, so the `value / (1.0000000000000004 / 2)` pattern
    // silently escaped the rewrite and the original division chain survived
    // the lint pass. The shared `Core.areNumbersApproximatelyEqual` helper
    // scales the tolerance to the magnitude of the operands, so values like
    // 1.0000000000000004 (1 + 2*Number.EPSILON) and 0.9999999999999998
    // (1 - 2*Number.EPSILON) are still recognised as effectively one and
    // the reciprocal-division rewrite fires through the same tolerance
    // window as the rest of the optimize-math-expressions pipeline.
    //
    // The two picked literals are intentionally placed on both sides of 1
    // so the regression guards against an off-by-one fix that only handles
    // the positive direction. The inner denominator is `2` so the
    // reciprocal rewrites into a non-scientific literal (`2` regardless of
    // whether the numerator sits above or below 1) and
    // `formatMultiplierLiteral` accepts the result. If the helper were
    // ever swapped back to a bare `Number.EPSILON` comparison, both
    // assertions would flake because the candidate AST node would no longer
    // be detected as a reciprocal pattern and the outer division would
    // remain `/` instead of flipping to `*`.
    const positiveNearOne: any = {
        type: "BinaryExpression",
        operator: "/",
        left: { type: "Identifier", name: "value" },
        right: {
            type: "BinaryExpression",
            operator: "/",
            left: { type: "Literal", value: "1.0000000000000004" },
            right: { type: "Literal", value: "2" }
        }
    };

    applyDivisionToMultiplication(positiveNearOne);

    assert.strictEqual(positiveNearOne.operator, "*");
    assert.strictEqual(positiveNearOne.right.value, "2");

    const negativeNearOne: any = {
        type: "BinaryExpression",
        operator: "/",
        left: { type: "Identifier", name: "value" },
        right: {
            type: "BinaryExpression",
            operator: "/",
            left: { type: "Literal", value: "0.9999999999999998" },
            right: { type: "Literal", value: "2" }
        }
    };

    applyDivisionToMultiplication(negativeNearOne);

    assert.strictEqual(negativeNearOne.operator, "*");
    assert.strictEqual(negativeNearOne.right.value, "2");
});

void test("applyDivisionToMultiplication rejects reciprocal numerators outside the tolerance window", () => {
    // Make sure the tolerance is not so wide that the rewrite fires for
    // numerator literals that are clearly not 1. `1.5` differs from 1 by
    // half a unit, which is several orders of magnitude beyond the
    // 4 * Number.EPSILON * scale window that `areNumbersApproximatelyEqual`
    // uses around magnitude 1, so the outer division-by-reciprocal rewrite
    // must leave the source alone. (The inner denominator `2` is still
    // rewritten as a standalone multiplication because the reciprocal rule
    // fires regardless of its parent's numerator, which is the desired
    // behaviour.)
    const ast: any = {
        type: "BinaryExpression",
        operator: "/",
        left: { type: "Identifier", name: "value" },
        right: {
            type: "BinaryExpression",
            operator: "/",
            left: { type: "Literal", value: "1.5" },
            right: { type: "Literal", value: "2" }
        }
    };

    applyDivisionToMultiplication(ast);

    assert.strictEqual(ast.operator, "/");
    // The outer right was originally a `1.5 / 2` BinaryExpression. Its
    // right-hand Literal `2` flips to `0.5`, but the parent must remain a
    // division because the numerator is clearly not within tolerance of 1.
    assert.strictEqual(ast.right.operator, "*");
    assert.strictEqual(ast.right.right.value, "0.5");
});

void test("resolveMathNumericPolicy accepts a zeroQuantityEpsilon override on its own", () => {
    // The zero-quantity tolerance is independent of the reciprocal/divisor
    // pair; downstream callers should be able to tune it without touching
    // the other two fields. Pin the merge semantics so future refactors
    // can't silently drop the override.
    const override = { zeroQuantityEpsilon: 1e-6 };
    const resolved = resolveMathNumericPolicy(override);
    assert.strictEqual(resolved.zeroQuantityEpsilon, 1e-6);
    assert.strictEqual(resolved.maxSafeReciprocal, DEFAULT_MATH_NUMERIC_POLICY.maxSafeReciprocal);
    assert.strictEqual(resolved.minSafeDivisor, DEFAULT_MATH_NUMERIC_POLICY.minSafeDivisor);
});

void test("resolveMathNumericPolicy rejects non-positive zeroQuantityEpsilon overrides", () => {
    // Negative, NaN, infinite, and zero zeroQuantityEpsilon values are
    // rejected so callers can't accidentally widen the rewrite to include
    // clearly non-zero quantities. The fallback preserves the corresponding
    // field from the default policy.
    const resolved = resolveMathNumericPolicy({
        zeroQuantityEpsilon: -1e-12
    });
    assert.strictEqual(resolved.zeroQuantityEpsilon, DEFAULT_MATH_NUMERIC_POLICY.zeroQuantityEpsilon);

    const zeroResolved = resolveMathNumericPolicy({ zeroQuantityEpsilon: 0 });
    assert.strictEqual(zeroResolved.zeroQuantityEpsilon, DEFAULT_MATH_NUMERIC_POLICY.zeroQuantityEpsilon);

    const nanResolved = resolveMathNumericPolicy({ zeroQuantityEpsilon: Number.NaN });
    assert.strictEqual(nanResolved.zeroQuantityEpsilon, DEFAULT_MATH_NUMERIC_POLICY.zeroQuantityEpsilon);
});

void test("resolveMathNumericPolicy parses zeroQuantityEpsilon from numeric strings", () => {
    // Numeric coercion must mirror the other fields so JSON/YAML config
    // sources can supply the threshold as a string (for example, "5e-7")
    // without the rule throwing at parse time.
    const resolved = resolveMathNumericPolicy({ zeroQuantityEpsilon: "  5e-7 " });
    assert.strictEqual(resolved.zeroQuantityEpsilon, 5e-7);
});

void test("resolveMathNumericPolicy surfaces a custom zeroQuantityEpsilon through the custom fallback", () => {
    // A custom fallback policy must drive zeroQuantityEpsilon the same way
    // it drives the reciprocal/divisor pair, so callers can lock all three
    // settings together by passing a dedicated fallback policy.
    const customFallback: MathNumericPolicy = Object.freeze({
        maxSafeReciprocal: 1e8,
        minSafeDivisor: 1e-9,
        zeroQuantityEpsilon: 1e-9
    });
    const resolved = resolveMathNumericPolicy(undefined, { fallback: customFallback });
    assert.strictEqual(resolved.zeroQuantityEpsilon, 1e-9);
});
