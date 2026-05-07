import {
    createLintConfigsWithPlugins,
    createLintRuleEntriesFromProjectConfig,
    normalizeLintRulesConfig
} from "./configs/index.js";
import { gmlLanguage } from "./language/index.js";
import { featherLintRules, gmlLintRules } from "./rules/index.js";

const gmlPluginObject = Object.freeze({
    rules: gmlLintRules,
    languages: Object.freeze({
        gml: gmlLanguage
    })
});

const featherPluginObject = Object.freeze({
    rules: featherLintRules,
    languages: Object.freeze({
        gml: gmlLanguage
    })
});

const lintConfigs = createLintConfigsWithPlugins({
    gmlPlugin: gmlPluginObject,
    featherPlugin: featherPluginObject
});

/**
 * Flattened lint config namespace that exposes project configuration helpers
 * directly alongside the config sets (recommended, feather, performance).
 *
 * This flattens the hierarchy by placing helpers like `normalizeLintRulesConfig`
 * and `createLintRuleEntriesFromProjectConfig` directly on `Lint.configs` rather
 * than nested under `Lint.configs.projectConfig`, reducing chain depth from
 * 4 segments to 3 segments and improving discoverability.
 */
export const configs = Object.freeze({
    ...lintConfigs,
    normalizeLintRulesConfig,
    createLintRuleEntriesFromProjectConfig
});

export const plugin = gmlPluginObject;
export const featherPlugin = featherPluginObject;
