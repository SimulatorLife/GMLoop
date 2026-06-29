import type { Rule } from "eslint";

import { createFeatherRule, featherManifest } from "./feather/index.js";
import { createGmlRule, type GmlRuleDefinition } from "./gml/index.js";

export const gmlRuleDefinitions: ReadonlyArray<GmlRuleDefinition> = Object.freeze([
    {
        description:
            "Find repeated length and collection accessor calls inside loops so they can be hoisted into a local value.",
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
        description: "Detect expressions inside loops that can be calculated once before the loop runs.",
        mapKey: "GmlPreferLoopInvariantExpressions",
        shortName: "prefer-loop-invariant-expressions",
        fullId: "gml/prefer-loop-invariant-expressions",
        messageId: "preferLoopInvariantExpressions",
        schema: Object.freeze([
            {
                type: "object",
                additionalProperties: false,
                properties: {
                    minComplexity: { type: "integer", minimum: 2, default: 3 }
                }
            }
        ])
    },
    {
        description:
            "Prefer initializing structs with literal properties instead of assigning each property after creation.",
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
        description: "Prefer array_push for appending values instead of manually assigning at array_length.",
        mapKey: "GmlPreferArrayPush",
        shortName: "prefer-array-push",
        fullId: "gml/prefer-array-push",
        messageId: "preferArrayPush"
    },
    {
        description: "Prefer compound assignment operators when a variable is updated from its own value.",
        mapKey: "GmlPreferCompoundAssignments",
        shortName: "prefer-compound-assignments",
        fullId: "gml/prefer-compound-assignments",
        messageId: "preferCompoundAssignments"
    },
    {
        description: "Prefer ++ and -- for simple increment or decrement assignments.",
        mapKey: "GmlPreferIncrementDecrementOperators",
        shortName: "prefer-increment-decrement-operators",
        fullId: "gml/prefer-increment-decrement-operators",
        messageId: "preferIncrementDecrementOperators"
    },
    {
        description: "Return expressions directly instead of assigning to a temporary immediately before returning.",
        mapKey: "GmlPreferDirectReturn",
        shortName: "prefer-direct-return",
        fullId: "gml/prefer-direct-return",
        messageId: "preferDirectReturn"
    },
    {
        description: "Return boolean conditions directly instead of routing through true and false branches.",
        mapKey: "GmlPreferDirectBooleanReturn",
        shortName: "prefer-direct-boolean-return",
        fullId: "gml/prefer-direct-boolean-return",
        messageId: "preferDirectBooleanReturn"
    },
    {
        description: "Avoid comparing boolean expressions to boolean literals.",
        mapKey: "GmlNoBooleanLiteralComparisons",
        shortName: "no-boolean-literal-comparisons",
        fullId: "gml/no-boolean-literal-comparisons",
        messageId: "noBooleanLiteralComparisons"
    },
    {
        description: "Simplify boolean control flow by removing redundant branches and temporary boolean variables.",
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
        description: "Report legacy globalvar declarations that require a project-aware migration.",
        mapKey: "GmlNoGlobalvar",
        shortName: "no-globalvar",
        fullId: "gml/no-globalvar",
        messageId: "noGlobalvar",
        schema: Object.freeze([])
    },
    {
        description: "Report region blocks that do not contain any meaningful code or comments.",
        mapKey: "GmlNoEmptyRegions",
        shortName: "no-empty-regions",
        fullId: "gml/no-empty-regions",
        messageId: "noEmptyRegions"
    },
    {
        description: "Remove comments that contain no useful text after comment markers are stripped.",
        mapKey: "GmlNoEmptyComments",
        shortName: "no-empty-comments",
        fullId: "gml/no-empty-comments",
        messageId: "noEmptyComments"
    },
    {
        description: "Report scientific notation literals because GameMaker does not accept them in all GML contexts.",
        mapKey: "GmlNoScientificNotation",
        shortName: "no-scientific-notation",
        fullId: "gml/no-scientific-notation",
        messageId: "noScientificNotation"
    },
    {
        description: "Replace string interpolation that contains only a plain string literal with that literal.",
        mapKey: "GmlNoUnnecessaryStringInterpolation",
        shortName: "no-unnecessary-string-interpolation",
        fullId: "gml/no-unnecessary-string-interpolation",
        messageId: "noUnnecessaryStringInterpolation"
    },
    {
        description: "Remove GameMaker's generated placeholder comments from otherwise empty event code.",
        mapKey: "GmlRemoveDefaultComments",
        shortName: "remove-default-comments",
        fullId: "gml/remove-default-comments",
        messageId: "removeDefaultComments"
    },
    {
        description: "Normalize triple-slash function documentation tags into GMLoop's canonical doc-comment shape.",
        mapKey: "GmlNormalizeDocComments",
        shortName: "normalize-doc-comments",
        fullId: "gml/normalize-doc-comments",
        messageId: "normalizeDocComments"
    },
    {
        description: "Convert legacy return description lines into canonical @returns doc-comment metadata.",
        mapKey: "GmlNormalizeDocReturns",
        shortName: "normalize-doc-returns",
        fullId: "gml/normalize-doc-returns",
        messageId: "normalizeDocReturns"
    },
    {
        description: "Normalize optional @param defaults that cannot be represented safely on one doc-comment line.",
        mapKey: "GmlNormalizeDocParamDefaults",
        shortName: "normalize-doc-param-defaults",
        fullId: "gml/normalize-doc-param-defaults",
        messageId: "normalizeDocParamDefaults"
    },
    {
        description: "Remove legacy separator hyphens from @param description text.",
        mapKey: "GmlNormalizeDocParamSeparators",
        shortName: "normalize-doc-param-separators",
        fullId: "gml/normalize-doc-param-separators",
        messageId: "normalizeDocParamSeparators"
    },
    {
        description: "Remove explicit undefined defaults from optional @param doc names.",
        mapKey: "GmlNormalizeDocParamUndefinedDefaults",
        shortName: "normalize-doc-param-undefined-defaults",
        fullId: "gml/normalize-doc-param-undefined-defaults",
        messageId: "normalizeDocParamUndefinedDefaults"
    },
    {
        description: "Normalize banner comments so decorative separators use one consistent project style.",
        mapKey: "GmlNormalizeBannerComments",
        shortName: "normalize-banner-comments",
        fullId: "gml/normalize-banner-comments",
        messageId: "normalizeBannerComments"
    },
    {
        description:
            "Normalize compiler directives and macro-like comment directives to the supported spelling and layout.",
        mapKey: "GmlNormalizeDirectives",
        shortName: "normalize-directives",
        fullId: "gml/normalize-directives",
        messageId: "normalizeDirectives"
    },
    {
        description: "Require braces around control-flow bodies so nested statements remain unambiguous.",
        mapKey: "GmlRequireControlFlowBraces",
        shortName: "require-control-flow-braces",
        fullId: "gml/require-control-flow-braces",
        messageId: "requireControlFlowBraces"
    },
    {
        description: "Require matching #region and #endregion directive pairs.",
        mapKey: "GmlRequireRegionPairs",
        shortName: "require-region-pairs",
        fullId: "gml/require-region-pairs",
        messageId: "requireRegionPairs"
    },
    {
        description: "Require zwrite_enable to be restored after code temporarily disables depth-buffer writes.",
        mapKey: "GmlRequireZwriteEnabledReset",
        shortName: "require-zwrite-enabled-reset",
        fullId: "gml/require-zwrite-enabled-reset",
        messageId: "requireZwriteEnabledReset"
    },
    {
        description: "Require ztest_enable to be restored after code temporarily disables depth testing.",
        mapKey: "GmlRequireZtestEnabledReset",
        shortName: "require-ztest-enabled-reset",
        fullId: "gml/require-ztest-enabled-reset",
        messageId: "requireZtestEnabledReset"
    },
    {
        description: "Report assignments used inside conditions, where equality checks are usually intended.",
        mapKey: "GmlNoAssignmentInCondition",
        shortName: "no-assignment-in-condition",
        fullId: "gml/no-assignment-in-condition",
        messageId: "noAssignmentInCondition"
    },
    {
        description: "Prefer is_undefined checks over direct comparisons that can be confused with ordinary values.",
        mapKey: "GmlPreferIsUndefinedCheck",
        shortName: "prefer-is-undefined-check",
        fullId: "gml/prefer-is-undefined-check",
        messageId: "preferIsUndefinedCheck"
    },
    {
        description: "Prefer epsilon-based floating-point comparisons over exact equality checks.",
        mapKey: "GmlPreferEpsilonComparisons",
        shortName: "prefer-epsilon-comparisons",
        fullId: "gml/prefer-epsilon-comparisons",
        messageId: "preferEpsilonComparisons"
    },
    {
        description: "Normalize textual operator aliases such as and, or, not, div, and mod to canonical operators.",
        mapKey: "GmlNormalizeOperatorAliases",
        shortName: "normalize-operator-aliases",
        fullId: "gml/normalize-operator-aliases",
        messageId: "normalizeOperatorAliases"
    },
    {
        description: "Prefer string interpolation when it makes string concatenation clearer and safer.",
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
        description: "Simplify constant math expressions and redundant numeric operations.",
        mapKey: "GmlOptimizeMathExpressions",
        shortName: "optimize-math-expressions",
        fullId: "gml/optimize-math-expressions",
        messageId: "optimizeMathExpressions"
    },
    {
        description: "Require commas between function arguments and optionally repair missing separators.",
        mapKey: "GmlRequireArgumentSeparators",
        shortName: "require-argument-separators",
        fullId: "gml/require-argument-separators",
        messageId: "requireArgumentSeparators",
        schema: Object.freeze([
            { type: "object", additionalProperties: false, properties: { repair: { type: "boolean", default: true } } }
        ])
    },
    {
        description: "Remove unnecessary real() calls around values that are already numeric.",
        mapKey: "GmlSimplifyRealCalls",
        shortName: "simplify-real-calls",
        fullId: "gml/simplify-real-calls",
        messageId: "simplifyRealCalls"
    },
    {
        description:
            "Report unary plus before identifiers because it is visually subtle and rarely intentional in GML.",
        mapKey: "GmlNoUnaryPlusOnIdentifier",
        shortName: "no-unary-plus-on-identifier",
        fullId: "gml/no-unary-plus-on-identifier",
        messageId: "noUnaryPlusOnIdentifier"
    },
    {
        description: "Replace negative zero literals with plain zero to avoid misleading numeric intent.",
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
