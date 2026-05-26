import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "./index.js";
import { createNoAssignmentInConditionRule } from "./rules/no-assignment-in-condition-rule.js";
import { createNoEmptyCommentsRule } from "./rules/no-empty-comments-rule.js";
import { createNoEmptyRegionsRule } from "./rules/no-empty-regions-rule.js";
import { createNoGlobalvarRule } from "./rules/no-globalvar-rule.js";
import { createNoLegacyApiRule } from "./rules/no-legacy-api-rule.js";
import { createNoNegativeZeroRule } from "./rules/no-negative-zero-rule.js";
import { createNoScientificNotationRule } from "./rules/no-scientific-notation-rule.js";
import { createNoUnaryPlusOnIdentifierRule } from "./rules/no-unary-plus-on-identifier-rule.js";
import { createNoUnnecessaryStringInterpolationRule } from "./rules/no-unnecessary-string-interpolation-rule.js";
import { createNormalizeBannerCommentsRule } from "./rules/normalize-banner-comments-rule.js";
import { createNormalizeDataStructureAccessorsRule } from "./rules/normalize-data-structure-accessors-rule.js";
import { createNormalizeDirectivesRule } from "./rules/normalize-directives-rule.js";
import { createNormalizeDocCommentsRule } from "./rules/normalize-doc-comments-multiline-defaults-rule.js";
import { createNormalizeOperatorAliasesRule } from "./rules/normalize-operator-aliases-rule.js";
import { createOptimizeLogicalFlowRule } from "./rules/optimize-logical-flow-rule.js";
import { createOptimizeMathExpressionsRule } from "./rules/optimize-math-expressions-rule.js";
import { createPreferArrayPushRule } from "./rules/prefer-array-push-rule.js";
import { createPreferCompoundAssignmentsRule } from "./rules/prefer-compound-assignments-rule.js";
import { createPreferDirectReturnRule } from "./rules/prefer-direct-return-rule.js";
import { createPreferEpsilonComparisonsRule } from "./rules/prefer-epsilon-comparisons-rule.js";
import { createPreferHoistableLoopAccessorsRule } from "./rules/prefer-hoistable-loop-accessors-rule.js";
import { createPreferIncrementDecrementOperatorsRule } from "./rules/prefer-increment-decrement-operators-rule.js";
import { createPreferIsUndefinedCheckRule } from "./rules/prefer-is-undefined-check-rule.js";
import { createPreferLoopInvariantExpressionsRule } from "./rules/prefer-loop-invariant-expressions-rule.js";
import { createPreferRepeatLoopsRule } from "./rules/prefer-repeat-loops-rule.js";
import { createPreferStringInterpolationRule } from "./rules/prefer-string-interpolation-rule.js";
import { createPreferStructLiteralAssignmentsRule } from "./rules/prefer-struct-literal-assignments-rule.js";
import { createRemoveDefaultCommentsRule } from "./rules/remove-default-comments-rule.js";
import { createRequireArgumentSeparatorsRule } from "./rules/require-argument-separators-rule.js";
import { createRequireControlFlowBracesRule } from "./rules/require-control-flow-braces-rule.js";
import { createRequireRegionPairsRule } from "./rules/require-region-pairs-rule.js";
import { createRequireTrailingOptionalDefaultsRule } from "./rules/require-trailing-optional-defaults-rule.js";
import { createSimplifyRealCallsRule } from "./rules/simplify-real-calls-rule.js";

type GmlRuleFactory = (definition: GmlRuleDefinition) => Rule.RuleModule;

const gmlRuleFactoriesByShortName = Object.freeze(
    new Map<string, GmlRuleFactory>([
        ["prefer-hoistable-loop-accessors", createPreferHoistableLoopAccessorsRule],
        ["prefer-loop-invariant-expressions", createPreferLoopInvariantExpressionsRule],
        ["prefer-repeat-loops", createPreferRepeatLoopsRule],
        ["prefer-struct-literal-assignments", createPreferStructLiteralAssignmentsRule],
        ["prefer-array-push", createPreferArrayPushRule],
        ["prefer-compound-assignments", createPreferCompoundAssignmentsRule],
        ["prefer-increment-decrement-operators", createPreferIncrementDecrementOperatorsRule],
        ["prefer-direct-return", createPreferDirectReturnRule],
        ["optimize-logical-flow", createOptimizeLogicalFlowRule],
        ["no-globalvar", createNoGlobalvarRule],
        ["no-empty-comments", createNoEmptyCommentsRule],
        ["no-empty-regions", createNoEmptyRegionsRule],
        ["no-legacy-api", createNoLegacyApiRule],
        ["no-scientific-notation", createNoScientificNotationRule],
        ["no-unnecessary-string-interpolation", createNoUnnecessaryStringInterpolationRule],
        ["remove-default-comments", createRemoveDefaultCommentsRule],
        ["normalize-doc-comments", createNormalizeDocCommentsRule],
        ["normalize-banner-comments", createNormalizeBannerCommentsRule],
        ["normalize-directives", createNormalizeDirectivesRule],
        ["require-control-flow-braces", createRequireControlFlowBracesRule],
        ["require-region-pairs", createRequireRegionPairsRule],
        ["no-assignment-in-condition", createNoAssignmentInConditionRule],
        ["prefer-is-undefined-check", createPreferIsUndefinedCheckRule],
        ["prefer-epsilon-comparisons", createPreferEpsilonComparisonsRule],
        ["normalize-operator-aliases", createNormalizeOperatorAliasesRule],
        ["prefer-string-interpolation", createPreferStringInterpolationRule],
        ["optimize-math-expressions", createOptimizeMathExpressionsRule],
        ["require-argument-separators", createRequireArgumentSeparatorsRule],
        ["normalize-data-structure-accessors", createNormalizeDataStructureAccessorsRule],
        ["require-trailing-optional-defaults", createRequireTrailingOptionalDefaultsRule],
        ["simplify-real-calls", createSimplifyRealCallsRule],
        ["no-unary-plus-on-identifier", createNoUnaryPlusOnIdentifierRule],
        ["no-negative-zero", createNoNegativeZeroRule]
    ])
);

export function createGmlRule(definition: GmlRuleDefinition): Rule.RuleModule {
    const createRule = gmlRuleFactoriesByShortName.get(definition.shortName);
    if (!createRule) {
        throw new Error(`Missing gml rule implementation for shortName '${definition.shortName}'.`);
    }
    return createRule(definition);
}
