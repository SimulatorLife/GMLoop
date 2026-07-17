/**
 * Shared numeric-policy constants used across the math transform passes and
 * the math-skip evaluator. Centralising the values here keeps the magic
 * numbers that govern floating-point tolerance and canonical-form
 * representation discoverable from a single module and lets the
 * `optimize-math-expressions` lint rule surface the same numbers as
 * user-facing options without duplicating literals across files.
 *
 * Anything that is a hardcoded numeric threshold and is consumed by more
 * than one helper, or by both a helper and the rule option schema, belongs
 * here. One-shot arithmetic values that have no broader consumers should
 * stay next to their single call site instead.
 *
 * The default values mirror the thresholds that were previously inlined
 * throughout the math workspace so existing lint output is preserved when
 * callers opt in to the defaults.
 */

/**
 * Floating-point comparison tolerance multiplier.
 *
 * `computeNumericTolerance(magnitude)` returns `Number.EPSILON * max(1,
 * magnitude) * EPSILON_TOLERANCE_MULTIPLIER`. The multiplier widens the raw
 * epsilon gap to absorb the small rounding drift introduced by chained
 * floating-point operations without widening it enough to mask real bugs.
 *
 * Empirically, `4` matches the safety margin previously used inline in
 * `math-numeric-utils.ts`. Changing it should be done with care because
 * every helper that consumes `computeNumericTolerance` inherits the new
 * tolerance.
 */
export const EPSILON_TOLERANCE_MULTIPLIER = 4;

/**
 * Default floating-point tolerance used when comparing a numeric literal
 * against its canonical-form representation.
 *
 * A literal such as `1.0000000000000002` parses to a value numerically equal
 * to `1`, so any `epsilon` smaller than the parser's rounding noise will
 * spuriously flag the literal as not-canonical. `1e-9` is large enough to
 * absorb parser rounding for all double-precision literals that GML actually
 * produces while still being strict enough to reject values whose canonical
 * form differs in a meaningful digit.
 */
export const DEFAULT_NUMERIC_LITERAL_EPSILON = 1e-9;

/**
 * Default upper bound on the absolute value that the canonical-form
 * formatter is willing to emit.
 *
 * Values whose magnitude exceeds this threshold fall back to the original
 * source text (via `evaluateCanonicalFormDecision`) because exponential
 * notation is the only stable representation and that representation is
 * not what users typically author by hand.
 */
export const DEFAULT_MAX_CANONICAL_FORM_VALUE = 1e15;

/**
 * Inclusive upper bound on integer-valued literals that the canonical-form
 * formatter emits as a bare integer literal.
 *
 * The formatter chooses integer emission whenever the value is both an exact
 * integer and within this bound, so this constant is one less than
 * {@link DEFAULT_MAX_CANONICAL_FORM_VALUE}. Keeping the relationship
 * explicit (rather than re-stating the literal) prevents the two thresholds
 * from drifting out of sync as the bound evolves.
 */
export const MAX_INTEGER_BOUNDARY_FOR_EXACT_REPRESENTATION = DEFAULT_MAX_CANONICAL_FORM_VALUE - 1;

/**
 * Threshold below which the canonical-form formatter switches to
 * exponential notation. Values with `abs(value) < ABS_VALUE_THRESHOLD_FOR_EXPONENTIAL`
 * are emitted via `toExponential` because fixed notation would otherwise lose
 * the leading non-zero digits to the formatter's `toPrecision` rounding.
 */
export const ABS_VALUE_THRESHOLD_FOR_EXPONENTIAL = 1e-4;

/**
 * Number of significant digits used by the canonical-form formatter when
 * emitting values in exponential notation. Matches the previous inline
 * `toExponential(6)` argument.
 */
export const CANONICAL_FORM_EXPONENTIAL_NOTATION_DIGITS = 6;

/**
 * Significant-digit precision ladder used by `toPrecision` when emitting
 * fixed-notation canonical forms. The formatter picks the precision by the
 * magnitude of the input:
 *
 * - values with magnitude < `1` use {@link CANONICAL_FORM_FIXED_NOTATION_LOW_PRECISION}
 *   digits so leading zeros do not eat the available precision budget;
 * - values with magnitude < `100` use the medium precision;
 * - larger values use the high precision.
 *
 * Bumping any rung is safe (the formatter will simply produce more
 * characters), but lowering a rung risks rounding the canonical form
 * differently from the parsed literal and breaking the canonical-form
 * rewrite.
 */
export const CANONICAL_FORM_FIXED_NOTATION_LOW_PRECISION = 10;
export const CANONICAL_FORM_FIXED_NOTATION_MEDIUM_PRECISION = 8;
export const CANONICAL_FORM_FIXED_NOTATION_HIGH_PRECISION = 6;

/**
 * Inclusive minimum epsilon accepted by the `optimize-math-expressions`
 * rule option schema. Smaller positive values are clamped up to this floor
 * so the lint rule never runs with a tolerance so tight that every literal
 * is reported as not-canonical.
 */
export const MIN_OPTIMIZE_MATH_EPSILON = 1e-15;

/**
 * Inclusive minimum max-canonical-form-value accepted by the
 * `optimize-math-expressions` rule option schema. The floor sits one order
 * of magnitude below the default so that genuinely small codebases can
 * tighten the bound without bumping into the limit.
 */
export const MIN_OPTIMIZE_MATH_MAX_CANONICAL_FORM_VALUE = 1e6;
