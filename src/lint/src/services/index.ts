import { PERFORMANCE_OVERRIDE_RULE_IDS } from "../configs/rule-level-presets.js";
import { type FeatherManifest, featherManifest } from "../rules/feather/manifest.js";
import { type DocCommentCoreServices, docCommentCoreServices } from "./doc-comment.js";

export interface LintServices {
    readonly featherManifest: FeatherManifest;
    readonly performanceOverrideRuleIds: readonly string[];
    readonly docCommentCoreServices: DocCommentCoreServices;
}

export const services: LintServices = Object.freeze({
    featherManifest,
    performanceOverrideRuleIds: PERFORMANCE_OVERRIDE_RULE_IDS,
    docCommentCoreServices
});
