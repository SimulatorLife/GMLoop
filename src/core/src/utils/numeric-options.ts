import { toNormalizedInteger } from "./number.js";
import { describeValueForError } from "./string.js";

type CoerceIntegerOptions = {
    min: number;
    received?: unknown;
    createErrorMessage?: (received: unknown) => string;
};

type PositiveIntegerOptionOptions = {
    zeroReplacement?: number;
};

type NormalizeNumericOptionOptions = {
    optionName: string;
    coerce: (value: number, context: Record<string, unknown>) => number | undefined;
    formatTypeError: (name: string, type: string) => string;
};

function coerceInteger(value: unknown, { min, received, createErrorMessage }: CoerceIntegerOptions) {
    const normalized = toNormalizedInteger(value);
    if (normalized !== null && normalized >= min) {
        return normalized;
    }

    const formattedReceived = describeValueForError(received ?? value);
    const fallbackMessage = `Value must be an integer greater than or equal to ${min} (received ${formattedReceived}).`;

    const message =
        typeof createErrorMessage === "function"
            ? createErrorMessage(formattedReceived)
            : (createErrorMessage ?? fallbackMessage);

    throw new TypeError(message);
}

export function coercePositiveInteger(value: unknown, options: Partial<CoerceIntegerOptions> = {}) {
    return coerceInteger(value, {
        min: 1,
        ...options
    });
}

export function coerceNonNegativeInteger(value: unknown, options: Partial<CoerceIntegerOptions> = {}) {
    return coerceInteger(value, {
        min: 0,
        ...options
    });
}

/**
 * Normalize option values that represent positive integers while handling
 * the frequently used "zero disables" idiom. Unlike {@link
 * coercePositiveInteger} this helper keeps `undefined`, `null`, and
 * non-numeric inputs from throwing so option parsing can fall back to the
 * provided default.
 *
 * @param {unknown} value Raw option value to inspect.
 * @param {number} defaultValue Fallback returned when the option is absent or
 *                              resolves to zero without an explicit
 *                              `zeroReplacement`.
 * @param {object} [options]
 * @param {number} [options.zeroReplacement] Replacement to use when the
 *                                           normalized value is exactly zero.
 * @returns {number} Either the coerced positive integer, the zero
 *                   replacement, or `defaultValue` when the input is blank.
 */
export function coercePositiveIntegerOption(
    value: unknown,
    defaultValue: number,
    { zeroReplacement }: PositiveIntegerOptionOptions = {}
) {
    let candidate = value;

    if (typeof candidate === "string") {
        const trimmed = candidate.trim();

        if (trimmed === "") {
            return defaultValue;
        }

        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) {
            return defaultValue;
        }

        candidate = parsed;
    }

    const normalized = toNormalizedInteger(candidate);

    if (normalized === null) {
        return defaultValue;
    }

    if (normalized > 0) {
        return normalized;
    }

    if (normalized === 0 && zeroReplacement !== undefined) {
        return zeroReplacement;
    }

    return defaultValue;
}

/**
 * Normalize numeric Prettier options to a sanitized value or `undefined`.
 * This sits closer to the public API surface than the CLI's
 * `resolveIntegerOption` (see `src/cli/src/shared/numeric-options.ts`) and
 * therefore performs stronger type guarding and richer context reporting
 * for error messages.
 *
 * When consumers provide strings, the value is trimmed before validation so
 * whitespace-only inputs are treated as "unset". Callers receive rich context
 * about the coercion attempt so they can tailor error messages without
 * needing an extra abstraction layer.
 *
 * @param {unknown} rawValue Incoming option value from configuration or CLI.
 * @param {object} options
 * @param {string} options.optionName Human-readable option name used in error
 *        messages.
 * @param {(value: number, context: Object) => number | undefined} options.coerce
 *        Coercion function that enforces bounds and transforms the numeric
 *        value.
 * @param {(name: string, type: string) => string} options.formatTypeError
 *        Factory for the error message when a non-numeric type is provided.
 * @returns {number | undefined} The normalized numeric value, or `undefined`
 *          when the input should be treated as absent.
 */
export function normalizeNumericOption(
    rawValue: unknown,
    { optionName, coerce, formatTypeError }: NormalizeNumericOptionOptions
) {
    if (rawValue == null) {
        return;
    }

    const rawType = typeof rawValue;
    const isString = rawType === "string";

    if (rawType !== "number" && !isString) {
        throw new Error(formatTypeError(optionName, rawType));
    }

    const normalized = isString ? (rawValue as string).trim() : rawValue;
    if (isString && normalized === "") {
        return;
    }

    const received = describeValueForError(rawValue);
    const numericValue = isString ? Number(normalized) : (normalized as number);

    return coerce(numericValue, {
        optionName,
        rawType,
        rawValue,
        received,
        isString
    });
}
