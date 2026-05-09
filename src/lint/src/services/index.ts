import { PERFORMANCE_OVERRIDE_RULE_IDS } from "../configs/rule-level-presets.js";
import { featherManifest } from "../rules/feather/manifest.js";

export const services = Object.freeze({
    featherManifest,
    performanceOverrideRuleIds: PERFORMANCE_OVERRIDE_RULE_IDS
});
