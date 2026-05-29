import type { GmloopProjectConfig } from "@gmloop/core";

import {
    isLintRuleLevel,
    type LintRuleLevel as LintRuleLevelAlias,
    normalizeLintRuleLevel
} from "./lint-rule-level.js";
import {
    LINT_RULESET_NAMES,
    LINT_RULESET_RULE_LEVELS,
    LintRuleLevel,
    type LintRulesetName
} from "./rule-level-presets.js";

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

    const normalizedRules: Record<string, LintRuleLevelAlias> = {
        ...rulesetRules
    };
    for (const [ruleId, rawLevel] of Object.entries(rawLintRules)) {
        if (!isLintRuleLevel(rawLevel)) {
            throw new TypeError(
                `gmloop.json lintRules.${ruleId} must be one of ${Object.values(LintRuleLevel).join(", ")}.`
            );
        }
        normalizedRules[ruleId] = normalizeLintRuleLevel(rawLevel);
    }

    return Object.freeze(normalizedRules);
}

/**
 * Normalize `lintRules` from a shared `gmloop.json` object.
 *
 * Returns `null` when the config contains invalid `lintRules`, an invalid
 * `lintRuleset` value, or malformed rule-level entries, making it suitable
 * for project-open flows where unknown gmloop properties should not crash the UI.
 *
 * @param config Shared top-level project config.
 * @returns Normalized rule-level overrides, or `null` when the config is invalid.
 */
export function normalizeLintRulesConfigOrNull(
    config: GmloopProjectConfig
): Readonly<Record<string, "off" | "warn" | "error">> | null {
    try {
        return normalizeLintRulesConfig(config);
    } catch {
        return null;
    }
}
