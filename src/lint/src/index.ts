import { createLintRuleEntriesFromProjectConfig } from "./configs/rule-entries.js";
import { configs, featherPlugin, plugin } from "./plugin.js";
import { ruleIds } from "./rules/catalog.js";
import { listLintRuleCatalogEntries } from "./rules/rule-catalog.js";
import { services } from "./services/index.js";

export const Lint = Object.freeze({
    plugin,
    featherPlugin,
    configs,
    ruleIds,
    createLintRuleEntriesFromProjectConfig,
    listLintRuleCatalogEntries,
    services
});
