/**
 * Typed enumeration for GML lint rule severity levels.
 *
 * This module centralizes the valid severity values used throughout the lint
 * configuration system, replacing raw string literals with typed constants.
 * This provides compile-time safety, IDE autocomplete, and validation helpers.
 */

import { Core } from "@gmloop/core";

const { createEnumeratedOptionHelpers } = Core;

/**
 * Valid lint rule severity levels.
 */
export const LintRuleLevel = Object.freeze({
    OFF: "off",
    WARN: "warn",
    ERROR: "error"
} as const);

export type LintRuleLevel = (typeof LintRuleLevel)[keyof typeof LintRuleLevel];

/**
 * Helpers for validating and normalizing lint rule level values.
 */
const lintRuleLevelHelpers = createEnumeratedOptionHelpers(Object.values(LintRuleLevel), {
    formatError: (list, received) => `Lint rule level must be one of: ${list}. Received: ${received}.`,
    enforceStringType: true,
    valueLabel: "Lint rule level"
});

/**
 * Validate and normalize a lint rule level value.
 *
 * @param value - Raw severity value to validate
 * @param options - Optional configuration
 * @param options.errorConstructor - Optional custom error constructor
 * @returns Validated lint rule level
 * @throws TypeError when value is not a string
 * @throws Error when value is not a recognized lint rule level
 */
export function normalizeLintRuleLevel(
    value: unknown,
    { errorConstructor }: { errorConstructor?: new (message: string) => Error } = {}
): LintRuleLevel {
    return lintRuleLevelHelpers.requireValue(value, errorConstructor) as LintRuleLevel;
}

/**
 * Normalize a lint rule level value with a fallback.
 *
 * @param value - Raw severity value to normalize
 * @param fallback - Fallback severity to use if value is invalid (defaults to "off")
 * @returns Normalized lint rule level
 */
export function normalizeLintRuleLevelWithFallback(
    value: unknown,
    fallback: LintRuleLevel = LintRuleLevel.OFF
): LintRuleLevel {
    const normalized = lintRuleLevelHelpers.normalize(value, null);
    return (normalized as LintRuleLevel) ?? fallback;
}

/**
 * Check if a value is a valid lint rule level.
 *
 * @param value - Value to check
 * @returns True if value is a valid lint rule level
 */
export function isLintRuleLevel(value: unknown): value is LintRuleLevel {
    return lintRuleLevelHelpers.valueSet.has(value as string);
}

/**
 * Get the ordered list of valid lint rule level values.
 *
 * @returns Readonly array of valid level values
 */
export function getLintRuleLevelValues(): readonly LintRuleLevel[] {
    return Object.values(LintRuleLevel);
}

/**
 * Get a formatted list of valid lint rule level values for error messages.
 *
 * @returns Formatted string listing valid severity values
 */
export function formatLintRuleLevelList(): string {
    return lintRuleLevelHelpers.formatList();
}
