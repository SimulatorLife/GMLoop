/**
 * Configurable numeric safety thresholds used by math transform passes.
 *
 * The math optimization pipeline relies on two reciprocal thresholds to keep
 * rewrites numerically safe:
 *
 * - `maxSafeReciprocal` caps how large a multiplicative factor may grow when a
 *   division is inverted. Beyond this magnitude, floating-point precision
 *   collapses and the rewrite would change observable behavior.
 * - `minSafeDivisor` is the symmetric lower bound on the divisor: any value
 *   whose reciprocal would exceed `maxSafeReciprocal` is treated as unsafe.
 *
 * The same thresholds used to live as duplicated module-level constants in
 * `math-division-to-multiplication.ts` and `math-traversal-normalization.ts`.
 * Centralising them here eliminates the duplication, makes the values
 * discoverable from a single module, and lets callers (the optimize-math lint
 * rule, downstream tooling, tests) tune the thresholds without monkey-patching
 * module state.
 *
 * The default values match the values previously hardcoded in both call sites
 * (`1e10` and `1e-10`) so existing behavior is preserved.
 */

import { Core } from "@gmloop/core";

const { isObjectLike } = Core;

/**
 * Configurable numeric-safety policy for math transform passes.
 *
 * @remarks
 * All fields must be positive finite numbers. `minSafeDivisor` and
 * `maxSafeReciprocal` are expected to be reciprocals of each other; the
 * resolver does not enforce that relationship so that callers can intentionally
 * pick asymmetric bounds (for example, a stricter reciprocal cap combined with
 * a more permissive divisor floor) without fighting the helper.
 * `zeroQuantityEpsilon` is intentionally independent from the reciprocal pair:
 * it tunes how aggressively residual floating-point noise (for example, a
 * nearly-zero accumulated delta from a sequence of `+=` and `-=` writes, or
 * a near-zero factor exponent) is collapsed to an "effectively zero" value,
 * which is a different concern from safe division boundaries.
 */
export type MathNumericPolicy = Readonly<{
    /**
     * Maximum safe magnitude of `1 / x` for a numeric literal `x`.
     *
     * Values whose reciprocal magnitude exceeds this threshold are treated as
     * unsafe to invert and the corresponding rewrite is skipped.
     */
    maxSafeReciprocal: number;

    /**
     * Minimum safe magnitude of a divisor.
     *
     * Values below this threshold are treated as effectively zero for the
     * purpose of division and reciprocal rewrites. Pairs symmetrically with
     * `maxSafeReciprocal` (`minSafeDivisor ≈ 1 / maxSafeReciprocal`).
     */
    minSafeDivisor: number;

    /**
     * Tolerance (in absolute terms) below which a floating-point quantity is
     * treated as effectively zero by the rule-level cleanup paths — for
     * instance, the residual exponent on a near-zero factor or the residual
     * delta accumulated across a sequence of `+=` / `-=` statements.
     *
     * The value is intentionally wider than `Number.EPSILON` because real GML
     * code accumulates tiny residuals across many chained updates; a value
     * near machine epsilon would never recognise those residuals as zero and
     * the corresponding cleanup rewrites would silently no-op.
     */
    zeroQuantityEpsilon: number;
}>;

const DEFAULT_MAX_SAFE_RECIPROCAL = 1e10;
const DEFAULT_MIN_SAFE_DIVISOR = 1e-10;
const DEFAULT_ZERO_QUANTITY_EPSILON = 1e-10;

/**
 * Default numeric-safety policy used by the math transform passes.
 *
 * Values match the thresholds previously hardcoded in
 * `math-division-to-multiplication.ts`, `math-traversal-normalization.ts`,
 * and `optimize-math-expressions-rule.ts`, so existing rewrites behave
 * identically with no opt-in required. The
 * `optimize-math-expressions` rule consumes `zeroQuantityEpsilon` directly
 * to replace two duplicated `1e-10` literals that previously lived inline
 * in the rule file.
 */
export const DEFAULT_MATH_NUMERIC_POLICY: MathNumericPolicy = Object.freeze({
    maxSafeReciprocal: DEFAULT_MAX_SAFE_RECIPROCAL,
    minSafeDivisor: DEFAULT_MIN_SAFE_DIVISOR,
    zeroQuantityEpsilon: DEFAULT_ZERO_QUANTITY_EPSILON
});

type NormalizePolicyOptions = {
    fallback?: MathNumericPolicy;
};

/**
 * Coerce a raw value into a {@link MathNumericPolicy}.
 *
 * Accepts either a complete policy object, `null`, `undefined`, or a partial
 * override. Missing or invalid fields fall back to the supplied fallback
 * policy (or {@link DEFAULT_MATH_NUMERIC_POLICY} when none is provided), so
 * callers can pass through user-supplied overrides without first validating
 * every field.
 *
 * Numeric coercion accepts numbers and numeric strings (trimmed before
 * parsing so JSON/YAML configuration sources behave intuitively). NaN,
 * infinite, non-positive, and unrecognised values fall back to the
 * corresponding default rather than throwing, so transform passes never crash
 * on malformed overrides.
 *
 * @param value - Raw value to normalize. Anything that is not an object
 *   (including `null`, arrays, and primitives) is treated as "use defaults".
 * @param options - Optional normalization options.
 * @param options.fallback - Policy to draw defaults from when a field is
 *   missing. Defaults to {@link DEFAULT_MATH_NUMERIC_POLICY}.
 * @returns A frozen, fully-populated {@link MathNumericPolicy}.
 */
export function resolveMathNumericPolicy(value: unknown, { fallback }: NormalizePolicyOptions = {}): MathNumericPolicy {
    const basePolicy = fallback ?? DEFAULT_MATH_NUMERIC_POLICY;
    const override = isObjectLike(value) ? (value as Partial<MathNumericPolicy>) : {};

    return Object.freeze({
        maxSafeReciprocal: normalizePolicyNumber(override.maxSafeReciprocal, basePolicy.maxSafeReciprocal),
        minSafeDivisor: normalizePolicyNumber(override.minSafeDivisor, basePolicy.minSafeDivisor),
        zeroQuantityEpsilon: normalizePolicyNumber(override.zeroQuantityEpsilon, basePolicy.zeroQuantityEpsilon)
    });
}

function normalizePolicyNumber(value: unknown, fallbackValue: number): number {
    if (value === null || value === undefined) {
        return fallbackValue;
    }

    if (typeof value === "number") {
        return isFinitePositiveNumber(value) ? value : fallbackValue;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") {
            return fallbackValue;
        }

        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
            return isFinitePositiveNumber(parsed) ? parsed : fallbackValue;
        }

        return fallbackValue;
    }

    if (typeof value === "boolean") {
        return fallbackValue;
    }

    // Booleans, bigints, arrays, and other non-numeric types are ignored: the
    // helper is intentionally permissive so that unexpected inputs degrade
    // gracefully rather than throwing inside a transform pass.
    return fallbackValue;
}

function isFinitePositiveNumber(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}
