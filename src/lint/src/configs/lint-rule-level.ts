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
    // For objects, prefer custom toString if available, otherwise fall back to Object.prototype.toString
    if (typeof value === "object" && value !== null) {
        if (
            "toString" in value &&
            typeof (value as unknown as { toString(): string }).toString === "function" &&
            (value as unknown as { toString(): string }).toString !== Object.prototype.toString
        ) {
            // eslint-disable-next-line @typescript-eslint/no-base-to-string -- the guard above confirms this is a custom toString
            return (value as unknown as { toString(): string }).toString();
        }
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- explicitly using Object.prototype.toString for plain objects
        return Object.prototype.toString.call(value);
    }
    // For functions, symbols, etc., use JSON.stringify as fallback
    try {
        return JSON.stringify(value);
    } catch {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- last resort fallback for unknown types
        return Object.prototype.toString.call(value);
    }
}

/**
 * Format an error message for invalid lint rule level values.
 */
function formatLintRuleLevelError(received: string): string {
    return `Lint rule level must be one of: ${SORTED_LEVEL_LIST}. Received: ${received}.`;
}

/**
 * Normalize a value to lowercase string or null.
 */
function toNormalizedLowerCaseString(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string") return value.trim().toLowerCase();
    // For non-string values, convert to display string then normalize
    try {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- JSON.stringify is intentional for object display
        return JSON.stringify(value).trim().toLowerCase();
    } catch {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- fallback for circular refs and other stringify failures
        return String(value).trim().toLowerCase();
    }
}

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
    if (typeof value !== "string") {
        throw new TypeError(`Lint rule level must be provided as a string (received type '${typeof value}').`);
    }
    const normalized = toNormalizedLowerCaseString(value);
    if (!VALID_LEVELS.has(normalized as LintRuleLevel)) {
        throw new (errorConstructor ?? Error)(formatLintRuleLevelError(describeValueForError(value)));
    }
    return normalized as LintRuleLevel;
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
    if (typeof value !== "string") {
        return fallback;
    }
    const normalized = toNormalizedLowerCaseString(value);
    return VALID_LEVELS.has(normalized as LintRuleLevel) ? (normalized as LintRuleLevel) : fallback;
}

/**
 * Check if a value is a valid lint rule level.
 *
 * @param value - Value to check
 * @returns True if value is a valid lint rule level
 */
export function isLintRuleLevel(value: unknown): value is LintRuleLevel {
    return typeof value === "string" && VALID_LEVELS.has(value as LintRuleLevel);
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
    return SORTED_LEVEL_LIST;
}
