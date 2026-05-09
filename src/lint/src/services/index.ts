import { PERFORMANCE_OVERRIDE_RULE_IDS } from "../configs/rule-level-presets.js";
import { featherManifest } from "../rules/feather/manifest.js";

export const services = Object.freeze({
    featherManifest,
    performanceOverrideRuleIds: PERFORMANCE_OVERRIDE_RULE_IDS
});

// Re-export for direct access on Lint namespace (reduces chain depth from
// Lint.services.performanceOverrideRuleIds to Lint.performanceOverrideRuleIds)
export { PERFORMANCE_OVERRIDE_RULE_IDS as performanceOverrideRuleIds } from "../configs/rule-level-presets.js";
