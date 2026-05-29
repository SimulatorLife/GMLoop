import type { Linter } from "eslint";

import { featherLintRuleMap, gmlLintRuleMap } from "../rules/catalog.js";
import { normalizeLintRulesConfig, normalizeLintRulesConfigOrNull } from "./project-config.js";

function extractRuleOptionCandidates(config: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(config).filter(([key]) => key !== "fixture" && key !== "lintRules" && key !== "refactor")
    );
}

function isRuleOptionsSchemaEntry(
    schemaEntry: unknown
): schemaEntry is Readonly<{ properties: Readonly<Record<string, unknown>> }> {
    if (!schemaEntry || typeof schemaEntry !== "object" || Array.isArray(schemaEntry)) {
        return false;
    }

    if (!("properties" in schemaEntry)) {
        return false;
    }

    const properties = schemaEntry.properties;
    return Boolean(properties) && typeof properties === "object" && !Array.isArray(properties);
}

function resolveRuleSchemaPropertyNames(ruleId: string): ReadonlySet<string> {
    const [pluginId, ruleName] = ruleId.split("/", 2);
    const pluginRules = pluginId === "gml" ? gmlLintRuleMap : pluginId === "feather" ? featherLintRuleMap : {};
    const schemaEntry = pluginRules[ruleName]?.meta?.schema?.[0];

    if (!isRuleOptionsSchemaEntry(schemaEntry)) {
        return new Set();
    }

    return new Set(Object.keys(schemaEntry.properties));
}

function extractRuleOptions(config: Record<string, unknown>, ruleId: string): Record<string, unknown> {
    const schemaPropertyNames = resolveRuleSchemaPropertyNames(ruleId);
    if (schemaPropertyNames.size === 0) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(extractRuleOptionCandidates(config)).filter(([key]) => schemaPropertyNames.has(key))
    );
}

/**
 * Build ESLint rule entries from the top-level shared `gmloop.json` object.
 *
 * Rule severities come from `lintRules`, while rule options are sourced from
 * top-level config keys that match the enabled rule schema.
 *
 * @param config Parsed shared project config.
 * @returns ESLint rule entries for all enabled lint rules.
 */
export function createLintRuleEntriesFromProjectConfig(
    config: Record<string, unknown>
): Readonly<Record<string, Linter.RuleEntry>> {
    const normalizedRules = normalizeLintRulesConfig(config);
    const enabledRules = Object.entries(normalizedRules).filter(([, level]) => level !== "off");

    return Object.freeze(
        Object.fromEntries(
            enabledRules.map(([ruleId, level]) => {
                const ruleOptions = extractRuleOptions(config, ruleId);
                return [
                    ruleId,
                    Object.keys(ruleOptions).length > 0 ? ([level, ruleOptions] as Linter.RuleEntry) : level
                ];
            })
        )
    );
}

/**
 * Build ESLint rule entries from the top-level shared `gmloop.json` object.
 *
 * Returns an empty object when the config contains invalid `lintRules` or
 * `lintRuleset` values, making it suitable for project-open flows where unknown
 * gmloop properties should not crash the UI.
 *
 * @param config Parsed shared project config.
 * @returns ESLint rule entries for all enabled lint rules, or `null` on error.
 */
export function createLintRuleEntriesFromProjectConfigOrNull(
    config: Record<string, unknown>
): Readonly<Record<string, Linter.RuleEntry>> | null {
    const normalizedRules = normalizeLintRulesConfigOrNull(config);
    if (normalizedRules === null) {
        return null;
    }
    const enabledRules = Object.entries(normalizedRules).filter(([, level]) => level !== "off");

    return Object.freeze(
        Object.fromEntries(
            enabledRules.map(([ruleId, level]) => {
                const ruleOptions = extractRuleOptions(config, ruleId);
                return [
                    ruleId,
                    Object.keys(ruleOptions).length > 0 ? ([level, ruleOptions] as Linter.RuleEntry) : level
                ];
            })
        )
    );
}
