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

/**
 * Format a non-string value for display in error messages.
 */
function describeValueForError(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
    if (typeof value === "object" && value !== null) {
        if (
            "toString" in value &&
            typeof (value as unknown as { toString(): string }).toString === "function" &&
            (value as unknown as { toString(): string }).toString !== Object.prototype.toString
        ) {
            return (value as unknown as { toString(): string }).toString();
        }
        return Object.prototype.toString.call(value);
    }
    try {
        return JSON.stringify(value);
    } catch {
        return Object.prototype.toString.call(value);
    }
}

function formatLintRuleLevelError(received: string): string {
    return `Lint rule level must be one of: ${SORTED_LEVEL_LIST}. Received: ${received}.`;
}

function toNormalizedLowerCaseString(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string") return value.trim().toLowerCase();
    try {
        return JSON.stringify(value).trim().toLowerCase();
    } catch {
        return "";
    }
}

export function normalizeLintRuleLevel(
    value: unknown,
    { errorConstructor }: { errorConstructor?: new (message: string) => Error } = {}
): LintRuleLevel {
    if (typeof value !== "string") {
        throw new TypeError(`Lint rule level must be provided as a string (received type '${typeof value}').`);
    }
    const normalized = toNormalizedLowerCaseString(value);
    if (!VALID_LEVELS.has(normalized as LintRuleLevel)) {
        throw new (errorConstructor ?? Error)(formatLintRuleLevelError(describeValueForError(value)));
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
    const normalized = toNormalizedLowerCaseString(value);
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
