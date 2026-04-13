import { featherManifest } from "../rules/feather/manifest.js";
import { PERFORMANCE_OVERRIDE_RULE_IDS } from "./performance-rule-ids.js";

export type LintRuleLevel = "off" | "warn" | "error";
export type LintRulesetName = "recommended" | "feather" | "performance";

const RECOMMENDED_RULES: Readonly<Record<string, LintRuleLevel>> = Object.freeze({
    "gml/prefer-hoistable-loop-accessors": "warn",
    "gml/prefer-loop-invariant-expressions": "warn",
    "gml/prefer-repeat-loops": "warn",
    "gml/prefer-struct-literal-assignments": "warn",
    "gml/prefer-array-push": "warn",
    "gml/prefer-compound-assignments": "warn",
    "gml/prefer-increment-decrement-operators": "warn",
    "gml/prefer-direct-return": "warn",
    "gml/optimize-logical-flow": "warn",
    "gml/no-globalvar": "warn",
    "gml/no-empty-regions": "warn",
    "gml/no-legacy-api": "warn",
    "gml/no-scientific-notation": "error",
    "gml/no-unnecessary-string-interpolation": "warn",
    "gml/remove-default-comments": "warn",
    "gml/normalize-doc-comments": "warn",
    "gml/normalize-banner-comments": "warn",
    "gml/normalize-directives": "warn",
    "gml/require-control-flow-braces": "warn",
    "gml/require-region-pairs": "error",
    "gml/no-assignment-in-condition": "warn",
    "gml/prefer-is-undefined-check": "warn",
    "gml/prefer-epsilon-comparisons": "warn",
    "gml/normalize-operator-aliases": "warn",
    "gml/prefer-string-interpolation": "warn",
    "gml/optimize-math-expressions": "warn",
    "gml/require-argument-separators": "error",
    "gml/normalize-data-structure-accessors": "warn",
    "gml/require-trailing-optional-defaults": "warn",
    "gml/simplify-real-calls": "warn",
    "gml/no-negative-zero": "warn"
});

const RECOMMENDED_SAFE_FEATHER_RULES: Readonly<Record<`feather/${string}`, LintRuleLevel>> = Object.freeze({
    "feather/gm1003": "warn",
    "feather/gm1009": "warn",
    "feather/gm1033": "warn",
    "feather/gm1041": "warn",
    "feather/gm2007": "warn",
    "feather/gm2020": "warn"
});

const FEATHER_RULES: Readonly<Record<`feather/${string}`, LintRuleLevel>> = Object.freeze(
    Object.fromEntries(featherManifest.entries.map((entry) => [entry.ruleId, entry.defaultSeverity])) as Record<
        `feather/${string}`,
        LintRuleLevel
    >
);

function createPerformanceRuleSet(): Readonly<Record<string, LintRuleLevel>> {
    const rules: Record<string, LintRuleLevel> = {
        "gml/prefer-hoistable-loop-accessors": "off",
        "gml/prefer-loop-invariant-expressions": "off",
        "gml/prefer-struct-literal-assignments": "off",
        "gml/no-globalvar": "warn",
        "gml/prefer-string-interpolation": "off"
    };

    for (const ruleId of PERFORMANCE_OVERRIDE_RULE_IDS) {
        if (!(ruleId in rules)) {
            rules[ruleId] = "off";
        }
    }

    return Object.freeze(rules);
}

const PERFORMANCE_RULES = createPerformanceRuleSet();

export const LINT_RULESET_NAMES: ReadonlyArray<LintRulesetName> = Object.freeze([
    "recommended",
    "feather",
    "performance"
]);

export const LINT_RULESET_RULE_LEVELS: Readonly<Record<LintRulesetName, Readonly<Record<string, LintRuleLevel>>>> =
    Object.freeze({
        recommended: Object.freeze({
            ...RECOMMENDED_RULES,
            ...RECOMMENDED_SAFE_FEATHER_RULES
        }),
        feather: FEATHER_RULES,
        performance: PERFORMANCE_RULES
    });

export const RECOMMENDED_GML_RULE_LEVELS = RECOMMENDED_RULES;
export const RECOMMENDED_SAFE_FEATHER_RULE_LEVELS = RECOMMENDED_SAFE_FEATHER_RULES;
export const FEATHER_RULE_LEVELS = FEATHER_RULES;
export const PERFORMANCE_RULE_LEVELS = PERFORMANCE_RULES;
