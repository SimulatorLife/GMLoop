import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportLineTextFixes, rewriteSourceLines } from "../rule-base-helpers.js";

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
 * Rewrites legacy `@param name - description` separator hyphens to the
 * canonical `@param name description` form.
 *
 * @param text Full source text to normalize.
 * @returns Source text with doc-param separator hyphens removed.
 */
export function sanitizeDocCommentParamDescriptionSeparators(text: string): string {
    return rewriteSourceLines(text, (line) => normalizeDocParamSeparatorLine(line));
}

/**
 * Creates the rule module that owns single-line `@param` description
 * separator cleanup.
 *
 * @param definition Static catalog metadata for the rule.
 * @returns ESLint rule module for `gml/normalize-doc-param-separators`.
 */
export function createNormalizeDocParamSeparatorsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Remove separator hyphens from @param descriptions."
        }),
        create(context: Rule.RuleContext): Rule.RuleListener {
            return {
                Program() {
                    reportLineTextFixes(context, definition, normalizeDocParamSeparatorLine);
                }
            };
        }
    });
}
