import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportLineTextFixes, rewriteSourceLines } from "../rule-base-helpers.js";

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
 * Removes explicit `undefined` defaults from optional `@param` doc names.
 *
 * @param text Full source text to normalize.
 * @returns Source text with `[name=undefined]` doc params rewritten to `[name]`.
 */
export function sanitizeDocCommentUndefinedOptionalParamDefaults(text: string): string {
    return rewriteSourceLines(text, (line) => normalizeUndefinedOptionalDefaultLine(line));
}

/**
 * Creates the rule module that owns explicit `undefined` optional `@param`
 * default cleanup.
 *
 * @param definition Static catalog metadata for the rule.
 * @returns ESLint rule module for `gml/normalize-doc-param-undefined-defaults`.
 */
export function createNormalizeDocParamUndefinedDefaultsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Remove explicit undefined defaults from optional @param documentation."
        }),
        create(context: Rule.RuleContext): Rule.RuleListener {
            return {
                Program() {
                    reportLineTextFixes(context, definition, normalizeUndefinedOptionalDefaultLine);
                }
            };
        }
    });
}
