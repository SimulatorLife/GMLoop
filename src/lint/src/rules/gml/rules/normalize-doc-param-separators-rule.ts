import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createLineNormalizationRule } from "../rule-base-helpers.js";

const paramDescriptionSeparatorPattern =
    /^(\s*\/\/\/\s*@param(?:\s+\{[^}\r\n]+\})?\s+(?:\[[^\]\r\n]+\]|[A-Za-z0-9_]+))\s+-\s+(.+)$/u;

function normalizeDocParamSeparatorLine(line: string): string {
    const normalized = paramDescriptionSeparatorPattern.exec(line);
    if (!normalized) {
        return line;
    }

    return `${normalized[1]} ${normalized[2]}`;
}

/**
 * Creates the rule module that owns single-line `@param` description
 * separator cleanup.
 *
 * @param definition Static catalog metadata for the rule.
 * @returns ESLint rule module for `gml/normalize-doc-param-separators`.
 */
export function createNormalizeDocParamSeparatorsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return createLineNormalizationRule(
        definition,
        "Remove separator hyphens from @param descriptions.",
        normalizeDocParamSeparatorLine
    );
}
