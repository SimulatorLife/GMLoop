import { gmlLanguage } from "./language/gml-language.js";
import { configs, featherPlugin, plugin } from "./plugin.js";
import { ruleIds } from "./rules/catalog.js";
import { listLintRuleCatalogEntries } from "./rules/rule-catalog.js";
import { performanceOverrideRuleIds, services } from "./services/index.js";

/**
 * Flattened lint namespace that exposes frequently-accessed properties directly
 * alongside the nested namespaces (plugin, configs, services).
 *
 * This flattens the hierarchy by exposing `gmlLanguage` and
 * `performanceOverrideRuleIds` directly on `Lint` rather than nested under
 * `Lint.plugin.languages.gml` and `Lint.services.performanceOverrideRuleIds`.
 * This reduces chain depth from 3 segments to 1 segment, improving discoverability
 * and reducing verbosity for these high-traffic access patterns.
 */
export const Lint = Object.freeze({
    plugin,
    featherPlugin,
    configs,
    ruleIds,
    listLintRuleCatalogEntries,
    services,

    // Flattened aliases for high-traffic access patterns
    gmlLanguage,
    performanceOverrideRuleIds
});
