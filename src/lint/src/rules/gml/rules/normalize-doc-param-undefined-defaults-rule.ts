import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createLineNormalizationRule } from "../rule-base-helpers.js";

const undefinedOptionalDefaultPattern =
    /^(\s*\/\/\/\s*@param(?:\s+\{[^}\r\n]+\})?\s+)\[([A-Za-z0-9_]+)\s*=\s*undefined\](.*)$/u;

function normalizeUndefinedOptionalDefaultLine(line: string): string {
    const normalized = undefinedOptionalDefaultPattern.exec(line);
    if (!normalized) {
        return line;
    }

    return `${normalized[1]}[${normalized[2]}]${normalized[3]}`;
}

/**
 * Creates the rule module that owns explicit `undefined` optional `@param`
 * default cleanup.
 *
 * @param definition Static catalog metadata for the rule.
 * @returns ESLint rule module for `gml/normalize-doc-param-undefined-defaults`.
 */
export function createNormalizeDocParamUndefinedDefaultsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return createLineNormalizationRule(
        definition,
        "Remove explicit undefined defaults from optional @param documentation.",
        normalizeUndefinedOptionalDefaultLine
    );
}
