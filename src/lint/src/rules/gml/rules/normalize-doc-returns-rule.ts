import type { Rule } from "eslint";

import { gmlRuleDocCommentServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportLineTextFixes } from "../rule-base-helpers.js";

const { convertLegacyReturnsDescriptionLineToMetadata } = gmlRuleDocCommentServices;

/**
 * Converts legacy doc-comment return descriptions into canonical `@returns`
 * metadata.
 *
 * @param text Full source text to normalize.
 * @returns Source text with legacy return descriptions converted.
 */
export function sanitizeLegacyDocReturnDescriptions(text: string): string {
    const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
    return text
        .split(/\r?\n/u)
        .map((line) => convertLegacyReturnsDescriptionLineToMetadata(line))
        .join(lineEnding);
}

/**
 * Creates the rule module that owns legacy return description cleanup.
 *
 * @param definition Static catalog metadata for the rule.
 * @returns ESLint rule module for `gml/normalize-doc-returns`.
 */
export function createNormalizeDocReturnsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Convert legacy doc-comment return descriptions to @returns metadata."
        }),
        create(context: Rule.RuleContext): Rule.RuleListener {
            return {
                Program() {
                    reportLineTextFixes(context, definition, convertLegacyReturnsDescriptionLineToMetadata);
                }
            };
        }
    });
}
