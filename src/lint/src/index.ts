import { configs, featherPlugin, plugin } from "./plugin.js";
import { ruleIds } from "./rules/catalog.js";
import { listLintRuleCatalogEntries } from "./rules/rule-catalog.js";
import { services } from "./services/index.js";

// createLintRuleEntriesFromProjectConfig is intentionally NOT part of the top-level
// Lint namespace (target-state.md §2.3).  It is accessible through
// Lint.configs.projectConfig.createLintRuleEntriesFromProjectConfig for consumers
// that need it, keeping internal helpers out of the public surface.
export const Lint = Object.freeze({
    plugin,
    featherPlugin,
    configs,
    ruleIds,
    listLintRuleCatalogEntries,
    services
});
