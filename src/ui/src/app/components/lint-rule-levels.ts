import type { GraphVisualizationProjectConfigurationLintRuleEntry } from "../../graph/index.js";

/**
 * Severity level for a lint rule, sourced from the catalog of supported
 * configuration levels.
 */
export type LintLevel = GraphVisualizationProjectConfigurationLintRuleEntry["level"];

/**
 * Filter selection for the lint rules table. "all" is the UI-only sentinel
 * meaning "no level restriction"; every other value is a real {@link LintLevel}.
 */
export type LintLevelFilter = "all" | LintLevel;

/**
 * Canonical ordered list of supported {@link LintLevel} values, used to render
 * level selectors and severity badges. The tuple-as-const shape guarantees
 * TypeScript raises a compile error if a new {@link LintLevel} is added
 * without first being registered here.
 */
export const LINT_LEVELS = ["error", "warn", "off"] as const satisfies ReadonlyArray<LintLevel>;

/**
 * Set form of {@link LINT_LEVELS} for fast membership checks. Derived from the
 * tuple so that adding a new level cannot desynchronize the two collections.
 */
export const LINT_LEVEL_VALUES: ReadonlySet<LintLevel> = new Set(LINT_LEVELS);

/**
 * User-facing display label for each supported {@link LintLevel}.
 *
 * Using a `Record<LintLevel, string>` (instead of an if/else chain on raw
 * strings) ensures the compiler enforces an exhaustive mapping whenever the
 * {@link LintLevel} union is extended.
 */
export const LINT_LEVEL_LABELS: Readonly<Record<LintLevel, string>> = Object.freeze({
    error: "Error",
    off: "Off",
    warn: "Warn"
});

/**
 * User-facing display label for each supported {@link LintLevelFilter} value,
 * covering the "all" sentinel used by the rules table filter.
 */
export const LINT_LEVEL_FILTER_LABELS: Readonly<Record<LintLevelFilter, string>> = Object.freeze({
    all: "All Levels",
    error: LINT_LEVEL_LABELS.error,
    off: LINT_LEVEL_LABELS.off,
    warn: LINT_LEVEL_LABELS.warn
});

/**
 * Type guard that narrows an arbitrary value to a {@link LintLevel}.
 *
 * Returning a type guard (rather than throwing) lets call sites decide how to
 * react to invalid input — typically by falling back to a default — without
 * needing a try/catch boundary.
 */
export function isLintLevel(value: unknown): value is LintLevel {
    return typeof value === "string" && LINT_LEVEL_VALUES.has(value as LintLevel);
}

/**
 * Type guard that narrows an arbitrary value to a {@link LintLevelFilter}.
 *
 * Accepts the "all" sentinel in addition to every {@link LintLevel} so a
 * single call can validate the value coming out of a `<select>` element whose
 * options include both "all" and the level entries.
 */
export function isLintLevelFilter(value: unknown): value is LintLevelFilter {
    return value === "all" || isLintLevel(value);
}

/**
 * Validate a raw string (typically the `value` of an HTML `<option>` element)
 * and return a {@link LintLevel} or `null` when the string is not one of the
 * supported severity levels. Centralising the parse here means raw literal
 * comparisons can never drift from the canonical level list.
 */
export function parseLintLevel(value: unknown): LintLevel | null {
    return isLintLevel(value) ? value : null;
}

/**
 * Validate a raw string (typically the `value` of an HTML `<option>` element)
 * and return a {@link LintLevelFilter} or `null` when the string is neither
 * "all" nor a supported severity level.
 */
export function parseLintLevelFilter(value: unknown): LintLevelFilter | null {
    return isLintLevelFilter(value) ? value : null;
}
