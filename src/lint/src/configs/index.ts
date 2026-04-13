import type { LintPluginShape } from "../plugin.js";
import {
    FEATHER_RULE_LEVELS,
    PERFORMANCE_RULE_LEVELS,
    RECOMMENDED_GML_RULE_LEVELS,
    RECOMMENDED_SAFE_FEATHER_RULE_LEVELS
} from "./rule-level-presets.js";

export { normalizeLintRulesConfig } from "./project-config.js";
export { createLintRuleEntriesFromProjectConfig } from "./rule-entries.js";

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
    rules: Readonly<Record<string, "off" | "warn" | "error">>;
}>;

export const GML_LINT_FILES_GLOB = Object.freeze(["**/*.gml"]);

/**
 * Represents the immutable lint config sets exported through `Lint.configs`.
 */
export type LintConfigSets = Readonly<{
    recommended: ReadonlyArray<FlatConfig>;
    feather: ReadonlyArray<FlatConfig>;
    performance: ReadonlyArray<FlatConfig>;
}>;

/**
 * Legacy helper that builds all config sets from a single plugin object.
 * Prefer `createLintConfigsWithPlugins` when gml/feather plugins differ.
 */
export function createLintConfigs(plugin: LintPluginShape): LintConfigSets {
    return createLintConfigsWithPlugins({
        gmlPlugin: plugin,
        featherPlugin: plugin
    });
}

type LintConfigPluginSet = Readonly<{
    gmlPlugin: LintPluginShape;
    featherPlugin: LintPluginShape;
}>;

export function createLintConfigsWithPlugins(plugins: LintConfigPluginSet): LintConfigSets {
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

    return Object.freeze({ recommended, feather, performance });
}
