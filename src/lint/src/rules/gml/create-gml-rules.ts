import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "./index.js";
import { createNoAssignmentInConditionRule } from "./rules/no-assignment-in-condition-rule.js";
import { createNoBooleanLiteralComparisonsRule } from "./rules/no-boolean-literal-comparisons-rule.js";
import { createNoEmptyCommentsRule } from "./rules/no-empty-comments-rule.js";
import { createNoEmptyRegionsRule } from "./rules/no-empty-regions-rule.js";
import { createNoEventCallbackOtherReferencesRule } from "./rules/no-event-callback-other-references-rule.js";
import { createNoGlobalvarRule } from "./rules/no-globalvar-rule.js";
import { createNoMultiVarDeclarationsRule } from "./rules/no-multi-var-declarations-rule.js";
import { createNoNegativeZeroRule } from "./rules/no-negative-zero-rule.js";
import { createNoScientificNotationRule } from "./rules/no-scientific-notation-rule.js";
import { createNoUnaryPlusOnIdentifierRule } from "./rules/no-unary-plus-on-identifier-rule.js";
import { createNoUnnecessaryStringInterpolationRule } from "./rules/no-unnecessary-string-interpolation-rule.js";
import { createNormalizeBannerCommentsRule } from "./rules/normalize-banner-comments-rule.js";
import { createNormalizeBlockKeywordAliasesRule } from "./rules/normalize-block-keyword-aliases-rule.js";
import { createNormalizeDirectivesRule } from "./rules/normalize-directives-rule.js";
import { createNormalizeDocCommentTagsRule } from "./rules/normalize-doc-comment-tags-rule.js";
import { createNormalizeDocCommentsRule } from "./rules/normalize-doc-comments-rule.js";
import { createNormalizeDocParamDefaultsRule } from "./rules/normalize-doc-param-defaults-rule.js";
import { createNormalizeDocParamSeparatorsRule } from "./rules/normalize-doc-param-separators-rule.js";
import { createNormalizeDocParamUndefinedDefaultsRule } from "./rules/normalize-doc-param-undefined-defaults-rule.js";
import { createNormalizeDocReturnsRule } from "./rules/normalize-doc-returns-rule.js";
import { createNormalizeOperatorAliasesRule } from "./rules/normalize-operator-aliases-rule.js";
import { createOptimizeMathExpressionsRule } from "./rules/optimize-math-expressions-rule.js";
import { createPreferArrayPushRule } from "./rules/prefer-array-push-rule.js";
import { createPreferCompoundAssignmentsRule } from "./rules/prefer-compound-assignments-rule.js";
import { createPreferDirectBooleanReturnRule } from "./rules/prefer-direct-boolean-return-rule.js";
import { createPreferDirectReturnRule } from "./rules/prefer-direct-return-rule.js";
import { createPreferEpsilonComparisonsRule } from "./rules/prefer-epsilon-comparisons-rule.js";
import { createPreferHoistableLoopAccessorsRule } from "./rules/prefer-hoistable-loop-accessors-rule.js";
import { createPreferIncrementDecrementOperatorsRule } from "./rules/prefer-increment-decrement-operators-rule.js";
import { createPreferIsUndefinedCheckRule } from "./rules/prefer-is-undefined-check-rule.js";
import { createPreferLoopInvariantExpressionsRule } from "./rules/prefer-loop-invariant-expressions-rule.js";
import { createPreferStringInterpolationRule } from "./rules/prefer-string-interpolation-rule.js";
import { createPreferStructLiteralAssignmentsRule } from "./rules/prefer-struct-literal-assignments-rule.js";
import { createRemoveDefaultCommentsRule } from "./rules/remove-default-comments-rule.js";
import { createRemoveDocFunctionTagsRule } from "./rules/remove-doc-function-tags-rule.js";
import { createRequireArgumentSeparatorsRule } from "./rules/require-argument-separators-rule.js";
import { createRequireControlFlowBracesRule } from "./rules/require-control-flow-braces-rule.js";
import {
    createRequireZtestEnabledResetRule,
    createRequireZwriteEnabledResetRule
} from "./rules/require-gpu-toggle-reset-rule.js";
import { createRequireRegionPairsRule } from "./rules/require-region-pairs-rule.js";
import { createSimplifyRealCallsRule } from "./rules/simplify-real-calls-rule.js";
import { createLogicalNormalizationRule } from "./rules/logical-normalization-rule-factory.js";

type GmlRuleFactory = (definition: GmlRuleDefinition) => Rule.RuleModule;

const gmlRuleFactoriesByShortName = Object.freeze(
    new Map<string, GmlRuleFactory>([
        ["prefer-hoistable-loop-accessors", createPreferHoistableLoopAccessorsRule],
        ["prefer-loop-invariant-expressions", createPreferLoopInvariantExpressionsRule],
        ["prefer-struct-literal-assignments", createPreferStructLiteralAssignmentsRule],
        ["prefer-array-push", createPreferArrayPushRule],
        ["prefer-compound-assignments", createPreferCompoundAssignmentsRule],
        ["prefer-increment-decrement-operators", createPreferIncrementDecrementOperatorsRule],
        ["prefer-direct-return", createPreferDirectReturnRule],
        ["prefer-direct-boolean-return", createPreferDirectBooleanReturnRule],
        ["no-boolean-literal-comparisons", createNoBooleanLiteralComparisonsRule],
        ["no-double-negation", (definition) => createLogicalNormalizationRule(definition, "double-negation")],
        ["prefer-de-morgan", (definition) => createLogicalNormalizationRule(definition, "de-morgan")],
        [
            "no-redundant-negation-parentheses",
            (definition) => createLogicalNormalizationRule(definition, "negation-parentheses")
        ],
        [
            "no-redundant-logical-operands",
            (definition) => createLogicalNormalizationRule(definition, "logical-identities")
        ],
        ["no-logical-absorption", (definition) => createLogicalNormalizationRule(definition, "logical-absorption")],
        [
            "prefer-logical-factorization",
            (definition) => createLogicalNormalizationRule(definition, "logical-factorization")
        ],
        ["no-logical-complements", (definition) => createLogicalNormalizationRule(definition, "logical-complement")],
        ["prefer-logical-xor", (definition) => createLogicalNormalizationRule(definition, "logical-xor")],
        [
            "prefer-conditional-assignment",
            (definition) => createLogicalNormalizationRule(definition, "conditional-assignment")
        ],
        ["no-globalvar", createNoGlobalvarRule],
        ["no-multi-var-declarations", createNoMultiVarDeclarationsRule],
        ["no-event-callback-other-references", createNoEventCallbackOtherReferencesRule],
        ["no-empty-comments", createNoEmptyCommentsRule],
        ["no-empty-regions", createNoEmptyRegionsRule],
        ["no-scientific-notation", createNoScientificNotationRule],
        ["no-unnecessary-string-interpolation", createNoUnnecessaryStringInterpolationRule],
        ["remove-default-comments", createRemoveDefaultCommentsRule],
        ["remove-doc-function-tags", createRemoveDocFunctionTagsRule],
        ["normalize-doc-comment-tags", createNormalizeDocCommentTagsRule],
        ["normalize-doc-comments", createNormalizeDocCommentsRule],
        ["normalize-doc-returns", createNormalizeDocReturnsRule],
        ["normalize-doc-param-defaults", createNormalizeDocParamDefaultsRule],
        ["normalize-doc-param-separators", createNormalizeDocParamSeparatorsRule],
        ["normalize-doc-param-undefined-defaults", createNormalizeDocParamUndefinedDefaultsRule],
        ["normalize-banner-comments", createNormalizeBannerCommentsRule],
        ["normalize-directives", createNormalizeDirectivesRule],
        ["normalize-block-keyword-aliases", createNormalizeBlockKeywordAliasesRule],
        ["require-control-flow-braces", createRequireControlFlowBracesRule],
        ["require-region-pairs", createRequireRegionPairsRule],
        ["require-zwrite-enabled-reset", createRequireZwriteEnabledResetRule],
        ["require-ztest-enabled-reset", createRequireZtestEnabledResetRule],
        ["no-assignment-in-condition", createNoAssignmentInConditionRule],
        ["prefer-is-undefined-check", createPreferIsUndefinedCheckRule],
        ["prefer-epsilon-comparisons", createPreferEpsilonComparisonsRule],
        ["normalize-operator-aliases", createNormalizeOperatorAliasesRule],
        ["prefer-string-interpolation", createPreferStringInterpolationRule],
        ["optimize-math-expressions", createOptimizeMathExpressionsRule],
        ["require-argument-separators", createRequireArgumentSeparatorsRule],
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
