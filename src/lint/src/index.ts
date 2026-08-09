import { Core } from "@gmloop/core";

import { normalizeDocParamName } from "./doc-comment/normalize-param-name.js";
import { gmlLanguage } from "./language/gml-language.js";
import { configs, featherPlugin, plugin } from "./plugin.js";
import { services } from "./services/index.js";

/**
 * Flattened lint namespace that exposes frequently-accessed properties directly
 * alongside the nested namespaces (plugin, configs, services).
 *
 * This flattens the hierarchy by exposing `gmlLanguage` and the malformed
 * helpers directly on `Lint` rather than nested under deeper paths. This
 * reduces chain depth, improving discoverability and reducing verbosity for
 * high-traffic access patterns.
 */
export const Lint = Object.freeze({
    plugin,
    featherPlugin,
    configs,
    services,

    // Flattened language access
    gmlLanguage,

    // Shared utilities (from doc-comment)
    normalizeDocParamName,

    // Malformed-source helpers (from core — avoids deep "../.." imports)
    forEachScientificNotationToken: Core.forEachScientificNotationToken,
    toPlainDecimalFromScientificLiteral: Core.toPlainDecimalFromScientificLiteral
});

// Direct exports of rule catalog functions for consumers who prefer explicit
// imports over namespace access. The functions are defined in the rules/
// subdirectory and re-exported here for convenience.
export { ruleIds } from "./rules/catalog.js";
export { listLintRuleCatalogEntries } from "./rules/rule-catalog.js";
