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

const lintProjectConfigHelpers = Object.freeze({
    normalizeLintRulesConfig,
    createLintRuleEntriesFromProjectConfig
});

const lintConfigNamespace = Object.freeze({
    ...lintConfigs,
    projectConfig: lintProjectConfigHelpers
});

export const plugin = gmlPluginObject;
export const featherPlugin = featherPluginObject;
export const configs = lintConfigNamespace;
