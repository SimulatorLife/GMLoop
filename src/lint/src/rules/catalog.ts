import type { Rule } from "eslint";

import { createFeatherRule, featherManifest } from "./feather/index.js";
import { createGmlRule } from "./gml/index.js";
import type { GmlRuleDefinition } from "./gml/rule-definition.js";

export const gmlRuleDefinitions: ReadonlyArray<GmlRuleDefinition> = Object.freeze([
    {
        mapKey: "GmlPreferHoistableLoopAccessors",
        shortName: "prefer-hoistable-loop-accessors",
        fullId: "gml/prefer-hoistable-loop-accessors",
        messageId: "preferHoistableLoopAccessor",
        schema: Object.freeze([
            {
                type: "object",
                additionalProperties: false,
                properties: {
                    minOccurrences: { type: "integer", minimum: 2, default: 2 },
                    functionSuffixes: {
                        type: "object",
                        additionalProperties: {
                            anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
                        }
                    },
                    reportUnsafe: { type: "boolean", default: true }
                }
            }
        ])
    },
    {
        mapKey: "GmlPreferLoopInvariantExpressions",
        shortName: "prefer-loop-invariant-expressions",
        fullId: "gml/prefer-loop-invariant-expressions",
        messageId: "preferLoopInvariantExpressions"
    },
    {
        mapKey: "GmlPreferRepeatLoops",
        shortName: "prefer-repeat-loops",
        fullId: "gml/prefer-repeat-loops",
        messageId: "preferRepeatLoops"
    },
    {
        mapKey: "GmlPreferStructLiteralAssignments",
        shortName: "prefer-struct-literal-assignments",
        fullId: "gml/prefer-struct-literal-assignments",
        messageId: "preferStructLiteralAssignments",
        schema: Object.freeze([
            {
                type: "object",
                additionalProperties: false,
                properties: {
                    reportUnsafe: { type: "boolean", default: true }
                }
            }
        ])
    },
    {
        mapKey: "GmlPreferArrayPush",
        shortName: "prefer-array-push",
        fullId: "gml/prefer-array-push",
        messageId: "preferArrayPush"
    },
    {
        mapKey: "GmlPreferCompoundAssignments",
        shortName: "prefer-compound-assignments",
        fullId: "gml/prefer-compound-assignments",
        messageId: "preferCompoundAssignments"
    },
    {
        mapKey: "GmlPreferIncrementDecrementOperators",
        shortName: "prefer-increment-decrement-operators",
        fullId: "gml/prefer-increment-decrement-operators",
        messageId: "preferIncrementDecrementOperators"
    },
    {
        mapKey: "GmlPreferDirectReturn",
        shortName: "prefer-direct-return",
        fullId: "gml/prefer-direct-return",
        messageId: "preferDirectReturn"
    },
    {
        mapKey: "GmlOptimizeLogicalFlow",
        shortName: "optimize-logical-flow",
        fullId: "gml/optimize-logical-flow",
        messageId: "optimizeLogicalFlow",
        schema: Object.freeze([
            {
                type: "object",
                additionalProperties: false,
                properties: {
                    maxBooleanVariables: { type: "integer", minimum: 1, maximum: 10, default: 10 }
                }
            }
        ])
    },
    {
        // Read-only rule with NO auto-fix
        // globalvar replacement cannot be done safely on a per-file bases
        mapKey: "GmlNoGlobalvar",
        shortName: "no-globalvar",
        fullId: "gml/no-globalvar",
        messageId: "noGlobalvar",
        schema: Object.freeze([])
    },
    {
        mapKey: "GmlNoEmptyRegions",
        shortName: "no-empty-regions",
        fullId: "gml/no-empty-regions",
        messageId: "noEmptyRegions"
    },
    {
        mapKey: "GmlNoLegacyApi",
        shortName: "no-legacy-api",
        fullId: "gml/no-legacy-api",
        messageId: "noLegacyApi"
    },
    {
        mapKey: "GmlNoScientificNotation",
        shortName: "no-scientific-notation",
        fullId: "gml/no-scientific-notation",
        messageId: "noScientificNotation"
    },
    {
        mapKey: "GmlNoUnnecessaryStringInterpolation",
        shortName: "no-unnecessary-string-interpolation",
        fullId: "gml/no-unnecessary-string-interpolation",
        messageId: "noUnnecessaryStringInterpolation"
    },
    {
        mapKey: "GmlRemoveDefaultComments",
        shortName: "remove-default-comments",
        fullId: "gml/remove-default-comments",
        messageId: "removeDefaultComments"
    },
    {
        mapKey: "GmlNormalizeDocComments",
        shortName: "normalize-doc-comments",
        fullId: "gml/normalize-doc-comments",
        messageId: "normalizeDocComments"
    },
    {
        mapKey: "GmlNormalizeBannerComments",
        shortName: "normalize-banner-comments",
        fullId: "gml/normalize-banner-comments",
        messageId: "normalizeBannerComments"
    },
    {
        mapKey: "GmlNormalizeDirectives",
        shortName: "normalize-directives",
        fullId: "gml/normalize-directives",
        messageId: "normalizeDirectives"
    },
    {
        mapKey: "GmlRequireControlFlowBraces",
        shortName: "require-control-flow-braces",
        fullId: "gml/require-control-flow-braces",
        messageId: "requireControlFlowBraces"
    },
    {
        mapKey: "GmlRequireRegionPairs",
        shortName: "require-region-pairs",
        fullId: "gml/require-region-pairs",
        messageId: "requireRegionPairs"
    },
    {
        mapKey: "GmlNoAssignmentInCondition",
        shortName: "no-assignment-in-condition",
        fullId: "gml/no-assignment-in-condition",
        messageId: "noAssignmentInCondition"
    },
    {
        mapKey: "GmlPreferIsUndefinedCheck",
        shortName: "prefer-is-undefined-check",
        fullId: "gml/prefer-is-undefined-check",
        messageId: "preferIsUndefinedCheck"
    },
    {
        mapKey: "GmlPreferEpsilonComparisons",
        shortName: "prefer-epsilon-comparisons",
        fullId: "gml/prefer-epsilon-comparisons",
        messageId: "preferEpsilonComparisons"
    },
    {
        mapKey: "GmlNormalizeOperatorAliases",
        shortName: "normalize-operator-aliases",
        fullId: "gml/normalize-operator-aliases",
        messageId: "normalizeOperatorAliases"
    },
    {
        mapKey: "GmlPreferStringInterpolation",
        shortName: "prefer-string-interpolation",
        fullId: "gml/prefer-string-interpolation",
        messageId: "preferStringInterpolation",
        schema: Object.freeze([
            {
                type: "object",
                additionalProperties: false,
                properties: {
                    reportUnsafe: { type: "boolean", default: true }
                }
            }
        ])
    },
    {
        mapKey: "GmlOptimizeMathExpressions",
        shortName: "optimize-math-expressions",
        fullId: "gml/optimize-math-expressions",
        messageId: "optimizeMathExpressions"
    },
    {
        mapKey: "GmlRequireArgumentSeparators",
        shortName: "require-argument-separators",
        fullId: "gml/require-argument-separators",
        messageId: "requireArgumentSeparators",
        schema: Object.freeze([
            { type: "object", additionalProperties: false, properties: { repair: { type: "boolean", default: true } } }
        ])
    },
    {
        mapKey: "GmlNormalizeDataStructureAccessors",
        shortName: "normalize-data-structure-accessors",
        fullId: "gml/normalize-data-structure-accessors",
        messageId: "normalizeDataStructureAccessors"
    },
    {
        mapKey: "GmlRequireTrailingOptionalDefaults",
        shortName: "require-trailing-optional-defaults",
        fullId: "gml/require-trailing-optional-defaults",
        messageId: "requireTrailingOptionalDefaults"
    },
    {
        mapKey: "GmlSimplifyRealCalls",
        shortName: "simplify-real-calls",
        fullId: "gml/simplify-real-calls",
        messageId: "simplifyRealCalls"
    },
    {
        mapKey: "GmlNoUnaryPlusOnIdentifier",
        shortName: "no-unary-plus-on-identifier",
        fullId: "gml/no-unary-plus-on-identifier",
        messageId: "noUnaryPlusOnIdentifier"
    },
    {
        mapKey: "GmlNoNegativeZero",
        shortName: "no-negative-zero",
        fullId: "gml/no-negative-zero",
        messageId: "noNegativeZero"
    }
]);

function toFeatherMapKey(ruleId: `feather/${string}`): `FeatherGM${string}` {
    const normalized = ruleId.replace("feather/gm", "");
    return `FeatherGM${normalized}`;
}

function createRuleIdMap(): Record<`Gml${string}` | `FeatherGM${string}`, `gml/${string}` | `feather/${string}`> {
    const map: Record<`Gml${string}` | `FeatherGM${string}`, `gml/${string}` | `feather/${string}`> = {};
    for (const definition of gmlRuleDefinitions) {
        map[definition.mapKey] = definition.fullId;
    }
    for (const entry of featherManifest.entries) {
        map[toFeatherMapKey(entry.ruleId)] = entry.ruleId;
    }
    return map;
}

function createGmlPluginRuleMap(): Record<string, Rule.RuleModule> {
    const map: Record<string, Rule.RuleModule> = {};
    for (const definition of gmlRuleDefinitions) {
        map[definition.shortName] = createGmlRule(definition);
    }
    return map;
}

function createFeatherPluginRuleMap(): Record<string, Rule.RuleModule> {
    const map: Record<string, Rule.RuleModule> = {};
    for (const entry of featherManifest.entries) {
        const shortName = entry.ruleId.replace("feather/", "");
        map[shortName] = createFeatherRule(entry);
    }
    return map;
}

export const ruleIds = Object.freeze(createRuleIdMap());
export const gmlLintRuleMap = Object.freeze(createGmlPluginRuleMap());
export const featherLintRuleMap = Object.freeze(createFeatherPluginRuleMap());
export const lintRuleMap = Object.freeze({
    ...gmlLintRuleMap,
    ...featherLintRuleMap
});
