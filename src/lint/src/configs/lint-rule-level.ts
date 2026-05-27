import { Core } from "@gmloop/core";

/**
 * Valid lint rule severity levels.
 */
export const LintRuleLevel = Object.freeze({
    OFF: "off",
    WARN: "warn",
    ERROR: "error"
} as const);

export type LintRuleLevel = (typeof LintRuleLevel)[keyof typeof LintRuleLevel];

const VALID_LEVELS = Object.freeze(new Set(["off", "warn", "error"])) as ReadonlySet<LintRuleLevel>;

// Pre-compute the sorted list for error messages
const SORTED_LEVEL_LIST = [...VALID_LEVELS].toSorted().join(", ");

function formatLintRuleLevelError(received: string): string {
    return `Lint rule level must be one of: ${SORTED_LEVEL_LIST}. Received: ${received}.`;
}

export function normalizeLintRuleLevel(
    value: unknown,
    { errorConstructor }: { errorConstructor?: new (message: string) => Error } = {}
): LintRuleLevel {
    if (typeof value !== "string") {
        throw new TypeError(`Lint rule level must be provided as a string (received type '${typeof value}').`);
    }
    const normalized = Core.toNormalizedLowerCaseString(value);
    if (!VALID_LEVELS.has(normalized as LintRuleLevel)) {
        throw new (errorConstructor ?? Error)(formatLintRuleLevelError(Core.describeValueForError(value)));
    }
    return normalized as LintRuleLevel;
}

export function normalizeLintRuleLevelWithFallback(
    value: unknown,
    fallback: LintRuleLevel = LintRuleLevel.OFF
): LintRuleLevel {
    if (typeof value !== "string") {
        return fallback;
    }
    const normalized = Core.toNormalizedLowerCaseString(value);
    return VALID_LEVELS.has(normalized as LintRuleLevel) ? (normalized as LintRuleLevel) : fallback;
}

export function isLintRuleLevel(value: unknown): value is LintRuleLevel {
    return typeof value === "string" && VALID_LEVELS.has(value as LintRuleLevel);
}

export function getLintRuleLevelValues(): readonly LintRuleLevel[] {
    return Object.values(LintRuleLevel);
}

export function formatLintRuleLevelList(): string {
    return SORTED_LEVEL_LIST;
}
