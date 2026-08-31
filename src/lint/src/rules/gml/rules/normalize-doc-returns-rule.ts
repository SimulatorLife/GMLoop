import type { Rule } from "eslint";

import { gmlRuleDocCommentServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import { createLineNormalizationRule } from "../rule-base-helpers.js";

const { convertLegacyReturnsDescriptionLineToMetadata } = gmlRuleDocCommentServices;

/**
 * Creates the rule module that owns legacy return description cleanup.
 *
 * @param definition Static catalog metadata for the rule.
 * @returns ESLint rule module for `gml/normalize-doc-returns`.
 */
export function createNormalizeDocReturnsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return createLineNormalizationRule(
        definition,
        "Convert legacy doc-comment return descriptions to @returns metadata.",
        convertLegacyReturnsDescriptionLineToMetadata
    );
}
