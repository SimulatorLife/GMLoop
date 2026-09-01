import {
    ALL_RULE_LEVELS,
    FEATHER_RULE_LEVELS,
    FIXIBLE_RULE_LEVELS,
    type LintRuleLevel,
    PERFORMANCE_RULE_LEVELS,
    RECOMMENDED_GML_RULE_LEVELS,
    RECOMMENDED_SAFE_FEATHER_RULE_LEVELS
} from "./rule-level-presets.js";

export {
    formatLintRuleLevelList,
    getLintRuleLevelValues,
    isLintRuleLevel,
    LintRuleLevel,
    normalizeLintRuleLevel,
    normalizeLintRuleLevelWithFallback
} from "./lint-rule-level.js";
export { normalizeLintRulesConfig, normalizeLintRulesConfigOrNull } from "./project-config.js";
export {
    createLintRuleEntriesFromProjectConfig,
    createLintRuleEntriesFromProjectConfigOrNull
} from "./rule-entries.js";

/**
 * Minimal runtime shape for the lint plugin objects consumed by lint config
 * presets. Lives next to the configs that consume it so the config layer has
 * a single, direct dependency without a separate contract module.
 */
export type LintPluginShape = Readonly<{
    rules: Record<string, unknown>;
    languages?: Record<string, unknown>;
}>;

/**
 * Represents a pinned lint flat-config entry exposed by the lint namespace.
 */
export type FlatConfig = Readonly<{
    files: ReadonlyArray<string>;
    plugins?: Readonly<Record<string, LintPluginShape>>;
    language?: string;
    languageOptions?: Readonly<{
        recovery: "none" | "limited";
    }>;
    rules: Readonly<Record<string, LintRuleLevel>>;
}>;

export const GML_LINT_FILES_GLOB = Object.freeze(["**/*.gml"]);

/**
 * Represents the immutable lint config sets exported through `Lint.configs`.
 */
export type LintConfigSets = Readonly<{
    all: ReadonlyArray<FlatConfig>;
    recommended: ReadonlyArray<FlatConfig>;
    feather: ReadonlyArray<FlatConfig>;
    performance: ReadonlyArray<FlatConfig>;
    fixible: ReadonlyArray<FlatConfig>;
}>;

/**
 * Builds all config sets from separate gml and feather plugin objects.
 * The gml and feather configs may differ; pass the same plugin instance
 * to both fields to replicate the deprecated single-plugin behavior.
 */
type LintConfigPluginSet = Readonly<{
    gmlPlugin: LintPluginShape;
    featherPlugin: LintPluginShape;
}>;

export function createLintConfigsWithPlugins(plugins: LintConfigPluginSet): LintConfigSets {
    const all: ReadonlyArray<FlatConfig> = Object.freeze([
        Object.freeze({
            files: GML_LINT_FILES_GLOB,
            plugins: Object.freeze({
                gml: plugins.gmlPlugin,
                feather: plugins.featherPlugin
            }),
            language: "gml/gml",
            languageOptions: Object.freeze({ recovery: "limited" }),
            rules: ALL_RULE_LEVELS
        })
    ]);

    const recommended: ReadonlyArray<FlatConfig> = Object.freeze([
        Object.freeze({
            files: GML_LINT_FILES_GLOB,
            plugins: Object.freeze({ gml: plugins.gmlPlugin }),
            language: "gml/gml",
            // Run the recommended GML config in limited recovery mode so malformed
            // files still flow through the tolerant/token-safe phase before AST
            // rules consume the recovered tree (target-state.md §3.1).
            languageOptions: Object.freeze({ recovery: "limited" }),
            rules: RECOMMENDED_GML_RULE_LEVELS
        }),
        Object.freeze({
            files: GML_LINT_FILES_GLOB,
            plugins: Object.freeze({ feather: plugins.featherPlugin }),
            rules: RECOMMENDED_SAFE_FEATHER_RULE_LEVELS
        })
    ]);

    const feather: ReadonlyArray<FlatConfig> = Object.freeze([
        Object.freeze({
            files: GML_LINT_FILES_GLOB,
            plugins: Object.freeze({ feather: plugins.featherPlugin }),
            rules: FEATHER_RULE_LEVELS
        })
    ]);

    const performance: ReadonlyArray<FlatConfig> = Object.freeze([
        Object.freeze({
            files: GML_LINT_FILES_GLOB,
            rules: PERFORMANCE_RULE_LEVELS
        })
    ]);

    const fixible: ReadonlyArray<FlatConfig> = Object.freeze([
        Object.freeze({
            files: GML_LINT_FILES_GLOB,
            plugins: Object.freeze({
                gml: plugins.gmlPlugin,
                feather: plugins.featherPlugin
            }),
            language: "gml/gml",
            languageOptions: Object.freeze({ recovery: "limited" }),
            rules: FIXIBLE_RULE_LEVELS
        })
    ]);

    return Object.freeze({ recommended, all, feather, performance, fixible });
}
