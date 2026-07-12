/**
 * Logical operators style option for the formatter.
 *
 * Controls whether the formatter outputs logical operators as keywords
 * (e.g. `and`, `or`) or symbols (e.g. `&&`, `||`). The module provides an
 * enumerated set of supported styles.
 */
import { Core } from "@gmloop/core";

const { createEnumeratedOptionHelpers } = Core;

const LogicalOperatorsStyle = Object.freeze({
    KEYWORDS: "keywords",
    SYMBOLS: "symbols"
} as const);

export const DEFAULT_LOGICAL_OPERATORS_STYLE = LogicalOperatorsStyle.KEYWORDS;

/**
 * Helpers for validating and normalizing logical operators style values.
 */
const logicalOperatorsStyleHelpers = createEnumeratedOptionHelpers(Object.values(LogicalOperatorsStyle), {
    formatError: (list, received) => `logicalOperatorsStyle must be one of: ${list}. Received: ${received}.`,
    enforceStringType: true,
    valueLabel: "logicalOperatorsStyle"
});

/**
 * Check whether the provided value matches one of the supported logical
 * operator style identifiers.
 *
 * Consumers frequently receive untyped config (for example CLI flags or JSON
 * options) and need a quick membership test without re-threading the
 * enumerated set. The value is normalized (trimmed and lowercased) before
 * checking, making this consistent with {@link normalizeLogicalOperatorsStyle}.
 *
 * @param {unknown} value Candidate option value to inspect.
 * @returns {boolean} `true` when the value maps to a known logical operator style.
 */
export function isLogicalOperatorsStyle(value: unknown): boolean {
    return logicalOperatorsStyleHelpers.normalize(value, null) !== null;
}

/**
 * Normalize a user-provided logical operator style option into a canonical
 * value.
 *
 * The helper trims surrounding whitespace, enforces that the result is one of
 * the enumerated styles, and falls back to the default when callers omit the
 * option altogether. Invalid values raise descriptive `TypeError` or `RangeError`
 * instances so CLI error messaging can surface actionable feedback.
 *
 * @param {unknown} rawStyle Untrusted option value supplied by the caller.
 * @returns {string} Canonical logical operator style string.
 * @throws {TypeError} When the value is not a string.
 * @throws {RangeError} When the value cannot be coerced into a
 *         supported style label.
 */
export function normalizeLogicalOperatorsStyle(rawStyle?: unknown): string {
    if (rawStyle === undefined) {
        return DEFAULT_LOGICAL_OPERATORS_STYLE;
    }

    return logicalOperatorsStyleHelpers.requireValue(rawStyle, RangeError);
}

export { LogicalOperatorsStyle };
