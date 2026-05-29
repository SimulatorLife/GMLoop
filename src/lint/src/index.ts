import { normalizeDocParamName } from "./doc-comment/normalize-param-name.js";
import { gmlLanguage } from "./language/gml-language.js";
import { forEachScientificNotationToken, toPlainDecimalFromScientificLiteral } from "./malformed/index.js";
import { configs, featherPlugin, plugin } from "./plugin.js";
import { ruleIds } from "./rules/catalog.js";
import { listLintRuleCatalogEntries } from "./rules/rule-catalog.js";
import { services } from "./services/index.js";

const { performanceOverrideRuleIds } = services;

/**
 * Flattened lint namespace that exposes frequently-accessed properties directly
 * alongside the nested namespaces (plugin, configs, services).
 *
 * This flattens the hierarchy by exposing `gmlLanguage`,
 * `performanceOverrideRuleIds`, and the malformed helpers directly on `Lint`
 * rather than nested under deeper paths. This reduces chain depth from 3
 * segments to 1 segment, improving discoverability and reducing verbosity for
 * high-traffic access patterns.
 */
export const Lint = Object.freeze({
    plugin,
    featherPlugin,
    configs,
    services,

    // Flattened aliases for high-traffic access patterns
    gmlLanguage,
    performanceOverrideRuleIds,

    // Shared utilities (from doc-comment)
    normalizeDocParamName,

    // Malformed-source helpers (from malformed — avoids deep "../.." imports)
    forEachScientificNotationToken,
    toPlainDecimalFromScientificLiteral,

    // Rule catalog access — kept on Lint for backward compatibility with existing
    // external consumers. Internal lint code should import directly from the
    // rules/catalog and rules/rule-catalog modules instead.
    listLintRuleCatalogEntries,
    ruleIds
});
