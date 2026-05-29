/**
 * Guard: determine whether the provided value is a finite number.
 *
 * @param {unknown} value Potential numeric value.
 * @returns {value is number} `true` when `value` is a finite number.
 */
export function isFiniteNumber(value?: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/**
 * Return a number when it is finite, otherwise `null`.
 *
 * Consolidates the repeated guard pattern:
 *   `typeof x === "number" ? x : null`
 * that appears across the codebase for values that are already known to be
 * numbers at the call site (e.g. property reads from loosely-typed objects).
 *
 * @param {unknown} value Candidate value to narrow.
 * @returns {number | null} The value when it is a finite number, otherwise `null`.
 */
export function toNumber(value: unknown): number | null {
    return typeof value === "number" ? value : null;
}

/**
 * Convert a candidate value into a finite number. Mirrors the explicit
 * `Number()` coercion followed by `Number.isFinite` checks that appear across
 * the semantic and shared helpers so call sites can centralize their numeric
 * guards without reimplementing the same fallback logic.
 *
 * @param {unknown} value Potential numeric value.
 * @returns {number | null} Finite number when coercion succeeds; otherwise `null`.
 */
export function toFiniteNumber(value) {
    if (isFiniteNumber(value)) {
        return value;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Truncate the provided numeric value to an integer when it is a finite
 * number. Non-number and non-finite inputs yield `null` so callers can easily
 * detect invalid values without sprinkling duplicate guards.
 *
 * @param {unknown} value Potential numeric value.
 * @returns {number | null} Truncated integer when `value` is finite, otherwise
 *          `null`.
 */
export function toNormalizedInteger(value?: unknown) {
    if (!isFiniteNumber(value)) {
        return null;
    }

    const normalized = Math.trunc(value);
    return Object.is(normalized, -0) ? 0 : normalized;
}

/**
 * Constrain a numeric value to the inclusive range `[min, max]`.
 *
 * When `value` is less than `min`, returns `min`. When `value` exceeds `max`,
 * returns `max`. Otherwise returns `value` unchanged. Consolidates the
 * `Math.min(max, Math.max(min, value))` pattern that appears across the
 * codebase into a single, well-named function.
 *
 * @param {number} value Numeric value to constrain.
 * @param {number} min Lower bound (inclusive).
 * @param {number} max Upper bound (inclusive).
 * @returns {number} The clamped value within `[min, max]`.
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

const APPROXIMATE_EQUALITY_SCALE_MULTIPLIER = 4;

/**
 * Compare two numbers using a tolerance scaled to their magnitude so values
 * derived from filesystem timestamps continue to match even when floating
 * point precision differs between platforms.
 *
 * `Number.EPSILON` is scaled to the largest absolute operand and widened a bit
 * to account for file systems that round to coarse intervals (for example,
 * milliseconds versus seconds). Non-finite numbers never match to avoid
 * conflating sentinel values like `Infinity` or `NaN` with real timestamps.
 *
 * @param {number} a First number to compare.
 * @param {number} b Second number to compare.
 * @returns {boolean} `true` when both inputs are finite and fall within the
 *          dynamic tolerance window.
 */
export function areNumbersApproximatelyEqual(a, b) {
    if (a === b) {
        return true;
    }

    if (!Number.isFinite(a) || !Number.isFinite(b)) {
        return false;
    }

    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    const tolerance = Number.EPSILON * scale * APPROXIMATE_EQUALITY_SCALE_MULTIPLIER;
    return Math.abs(a - b) <= tolerance;
}
