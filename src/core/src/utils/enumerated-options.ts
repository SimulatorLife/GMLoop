import { formatTypeValidationError } from "./error.js";
import { assertFunctionProperties } from "./object.js";
import { describeValueForError, isNonEmptyString, toNormalizedLowerCaseString } from "./string.js";

type EnumeratedValue = string;

export interface EnumeratedOptionHelpers {
    readonly valueSet: ReadonlySet<EnumeratedValue>;
    formatList(): string;
    normalize(value: unknown, fallback?: EnumeratedValue | null): EnumeratedValue | null;
    requireValue(value: unknown, errorConstructor?: new (message: string) => Error): EnumeratedValue;
}

/**
 * Create helpers for normalizing and validating enumerated options.
 *
 * Provides a unified interface for handling enumerated option values with
 * normalization, validation, and error formatting capabilities. The returned
 * helper object encapsulates the valid value set and provides methods for
 * flexible option handling across different contexts.
 *
 * @param values - Iterable of valid enumerated values
 * @param options - Configuration options
 * @param options.formatError - Optional function to format validation error messages
 * @param options.enforceStringType - If true, rejects non-string inputs early with TypeError
 * @param options.valueLabel - Label for the value type in error messages (only with enforceStringType)
 * @param options.caseSensitive - If true, performs exact string matching instead of normalizing to lowercase (default: false)
 * @returns Frozen helper object with validation and normalization methods
 *
 * @example
 * // Basic usage with case-insensitive normalization
 * const helpers = createEnumeratedOptionHelpers(["json", "yaml"]);
 * helpers.normalize("JSON"); // "json"
 * helpers.requireValue("xml"); // throws Error
 *
 * @example
 * // With string type enforcement
 * const helpers = createEnumeratedOptionHelpers(["json"], {
 *   enforceStringType: true,
 *   valueLabel: "Output format"
 * });
 * helpers.requireValue(42); // throws TypeError
 *
 * @example
 * // With case-sensitive matching
 * const helpers = createEnumeratedOptionHelpers(["script", "var"], {
 *   caseSensitive: true
 * });
 * helpers.normalize("SCRIPT"); // null (not "script")
 * helpers.normalize("script"); // "script"
 */
export function createEnumeratedOptionHelpers(
    values: Iterable<EnumeratedValue>,
    options?: {
        formatError?: (list: string, received: string) => string;
        enforceStringType?: boolean;
        valueLabel?: string;
        caseSensitive?: boolean;
    }
): EnumeratedOptionHelpers {
    const config = options ?? {};
    const { formatError, enforceStringType = false, valueLabel = "Value", caseSensitive = false } = config;

    const valueSet = new Set(Array.from(values));
    const listLabel = [...valueSet].toSorted().join(", ");

    // Shared normalization logic used by both normalize and requireValue
    const tryNormalize = (value: unknown): EnumeratedValue | null => {
        if (value == null || (enforceStringType && typeof value !== "string")) {
            return null;
        }
        const normalized: string | null = caseSensitive
            ? typeof value === "string"
                ? value
                : null
            : toNormalizedLowerCaseString(value);
        return normalized && valueSet.has(normalized) ? normalized : null;
    };

    return Object.freeze({
        valueSet,
        formatList: () => listLabel,
        normalize: (value: unknown, fallback: EnumeratedValue | null = null) => {
            return tryNormalize(value) ?? fallback;
        },
        requireValue: (value: unknown, ErrorConstructor: new (message: string) => Error = Error) => {
            if (enforceStringType && typeof value !== "string") {
                throw new TypeError(formatTypeValidationError("a string", value, { label: valueLabel }));
            }
            const normalized = tryNormalize(value);
            if (normalized !== null) {
                return normalized;
            }
            const received = describeValueForError(value);
            const message = formatError
                ? formatError(listLabel, received)
                : `Value must be one of: ${listLabel}. Received: ${received}.`;
            throw new ErrorConstructor(message);
        }
    });
}

/**
 * Normalize enumerated option values against a set of valid entries.
 *
 * Centralizes the common pattern of accepting optional input, applying a
 * normalization/coercion step, and falling back to a default when the provided
 * value is blank or absent. Callers provide the canonical set of entries to
 * validate against along with any fallback semantics so downstream logic stays
 * focused on option handling rather than defensive guards.
 *
 * @param {unknown} value Raw option value supplied by the caller.
 * @param {unknown} fallbackValue Value returned when the option is omitted or
 *        normalizes to an empty string.
 * @param {{ has(value: string): boolean }} validValues Collection used to
 *        determine whether the normalized value is accepted.
 * @param {object} [options]
 * @param {(value: unknown) => string} [options.coerce=toNormalizedLowerCaseString]
 *        Normalization function applied before validation.
 * @returns {string | null | unknown} Normalized value when valid, the fallback
 *          when the option is absent/blank, or `null` when the normalized value
 *          is invalid.
 */
export function normalizeEnumeratedOption(
    value,
    fallbackValue,
    validValues,
    { coerce = toNormalizedLowerCaseString } = {}
) {
    assertFunctionProperties(validValues, ["has"], {
        name: "validValues",
        errorMessage: "validValues must provide a has function"
    });

    if (value == null) {
        return fallbackValue;
    }

    const normalized = coerce(value);

    if (!isNonEmptyString(normalized)) {
        return fallbackValue;
    }

    return validValues.has(normalized) ? normalized : null;
}
