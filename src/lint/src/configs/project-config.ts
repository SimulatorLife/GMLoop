import type { GmloopProjectConfig } from "@gmloop/core";

import {
    LINT_RULESET_NAMES,
    LINT_RULESET_RULE_LEVELS,
    type LintRuleLevel,
    type LintRulesetName
} from "./rule-level-presets.js";

const VALID_RULE_LEVELS = new Set(["off", "warn", "error"]);
const LINT_RULESET_NAME_VALUES = new Set(LINT_RULESET_NAMES);

function isLintRulesetName(value: string): value is LintRulesetName {
    return LINT_RULESET_NAME_VALUES.has(value as LintRulesetName);
}

function readLintRulesetName(config: GmloopProjectConfig): LintRulesetName | null {
    const rawRuleset = config.lintRuleset;
    if (rawRuleset === undefined) {
        return null;
    }

    if (typeof rawRuleset !== "string") {
        throw new TypeError(`gmloop.json lintRuleset must be one of ${LINT_RULESET_NAMES.join(", ")}.`);
    }

    if (!isLintRulesetName(rawRuleset)) {
        throw new TypeError(`gmloop.json lintRuleset must be one of ${LINT_RULESET_NAMES.join(", ")}.`);
    }

    return rawRuleset;
}

/**
 * Normalize `lintRules` from a shared `gmloop.json` object.
 *
 * @param config Shared top-level project config.
 * @returns Normalized rule-level overrides.
 */
export function normalizeLintRulesConfig(
    config: GmloopProjectConfig
): Readonly<Record<string, "off" | "warn" | "error">> {
    const lintRuleset = readLintRulesetName(config);
    const rulesetRules = lintRuleset ? LINT_RULESET_RULE_LEVELS[lintRuleset] : {};
    const rawLintRules = config.lintRules;
    if (rawLintRules === undefined) {
        return Object.freeze({
            ...rulesetRules
        });
    }
    if (!rawLintRules || typeof rawLintRules !== "object" || Array.isArray(rawLintRules)) {
        throw new TypeError("gmloop.json lintRules must be an object.");
    }

    const normalizedRules: Record<string, LintRuleLevel> = {
        ...rulesetRules
    };
    for (const [ruleId, rawLevel] of Object.entries(rawLintRules)) {
        if (typeof rawLevel !== "string" || !VALID_RULE_LEVELS.has(rawLevel)) {
            throw new TypeError(`gmloop.json lintRules.${ruleId} must be one of off, warn, or error.`);
        }
        normalizedRules[ruleId] = rawLevel as LintRuleLevel;
    }

    return Object.freeze(normalizedRules);
}
