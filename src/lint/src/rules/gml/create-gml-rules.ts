import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "./rule-definition.js";
import { createNoAssignmentInConditionRule } from "./rules/no-assignment-in-condition-rule.js";
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
import { createNormalizeDocCommentsRule } from "./rules/normalize-doc-comments-rule.js";
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

export function createGmlRule(definition: GmlRuleDefinition): Rule.RuleModule {
    switch (definition.shortName) {
        case "prefer-hoistable-loop-accessors": {
            return createPreferHoistableLoopAccessorsRule(definition);
        }
        case "prefer-loop-invariant-expressions": {
            return createPreferLoopInvariantExpressionsRule(definition);
        }
        case "prefer-repeat-loops": {
            return createPreferRepeatLoopsRule(definition);
        }
        case "prefer-struct-literal-assignments": {
            return createPreferStructLiteralAssignmentsRule(definition);
        }
        case "prefer-array-push": {
            return createPreferArrayPushRule(definition);
        }
        case "prefer-compound-assignments": {
            return createPreferCompoundAssignmentsRule(definition);
        }
        case "prefer-increment-decrement-operators": {
            return createPreferIncrementDecrementOperatorsRule(definition);
        }
        case "prefer-direct-return": {
            return createPreferDirectReturnRule(definition);
        }
        case "optimize-logical-flow": {
            return createOptimizeLogicalFlowRule(definition);
        }
        case "no-globalvar": {
            return createNoGlobalvarRule(definition);
        }
        case "no-empty-regions": {
            return createNoEmptyRegionsRule(definition);
        }
        case "no-legacy-api": {
            return createNoLegacyApiRule(definition);
        }
        case "no-scientific-notation": {
            return createNoScientificNotationRule(definition);
        }
        case "no-unnecessary-string-interpolation": {
            return createNoUnnecessaryStringInterpolationRule(definition);
        }
        case "remove-default-comments": {
            return createRemoveDefaultCommentsRule(definition);
        }
        case "normalize-doc-comments": {
            return createNormalizeDocCommentsRule(definition);
        }
        case "normalize-banner-comments": {
            return createNormalizeBannerCommentsRule(definition);
        }
        case "normalize-directives": {
            return createNormalizeDirectivesRule(definition);
        }
        case "require-control-flow-braces": {
            return createRequireControlFlowBracesRule(definition);
        }
        case "require-region-pairs": {
            return createRequireRegionPairsRule(definition);
        }
        case "no-assignment-in-condition": {
            return createNoAssignmentInConditionRule(definition);
        }
        case "prefer-is-undefined-check": {
            return createPreferIsUndefinedCheckRule(definition);
        }
        case "prefer-epsilon-comparisons": {
            return createPreferEpsilonComparisonsRule(definition);
        }
        case "normalize-operator-aliases": {
            return createNormalizeOperatorAliasesRule(definition);
        }
        case "prefer-string-interpolation": {
            return createPreferStringInterpolationRule(definition);
        }
        case "optimize-math-expressions": {
            return createOptimizeMathExpressionsRule(definition);
        }
        case "require-argument-separators": {
            return createRequireArgumentSeparatorsRule(definition);
        }
        case "normalize-data-structure-accessors": {
            return createNormalizeDataStructureAccessorsRule(definition);
        }
        case "require-trailing-optional-defaults": {
            return createRequireTrailingOptionalDefaultsRule(definition);
        }
        case "simplify-real-calls": {
            return createSimplifyRealCallsRule(definition);
        }
        case "no-unary-plus-on-identifier": {
            return createNoUnaryPlusOnIdentifierRule(definition);
        }
        case "no-negative-zero": {
            return createNoNegativeZeroRule(definition);
        }
        default: {
            throw new Error(`Missing gml rule implementation for shortName '${definition.shortName}'.`);
        }
    }
}
