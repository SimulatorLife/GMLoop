const MALFORMED_SAFE_LINT_RULE_IDS = new Set(["gml/no-scientific-notation", "gml/require-argument-separators"]);

/**
 * Resolve the lint-language recovery mode required by a single-rule fixture run.
 *
 * Target-state.md §3.1 reserves limited parser recovery for malformed-safe
 * Phase A fixes. All other lint fixture runs must stay on strict parsing so
 * AST-based rules only execute on valid source.
 *
 * @param ruleEntries - ESLint rule entries enabled for a fixture execution.
 * @returns `"limited"` when every enabled rule is malformed-safe, otherwise `"none"`.
 */
export function resolveFixtureLintRecoveryMode(ruleEntries: Readonly<Record<string, unknown>>): "none" | "limited" {
    const enabledRuleIds = Object.entries(ruleEntries)
        .filter(([, level]) => level !== "off")
        .map(([ruleId]) => ruleId);

    if (enabledRuleIds.length === 0) {
        return "none";
    }

    return enabledRuleIds.every((ruleId) => MALFORMED_SAFE_LINT_RULE_IDS.has(ruleId)) ? "limited" : "none";
}
