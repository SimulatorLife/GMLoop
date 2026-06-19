import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createRequireEnabledResetRule } from "../rule-base-helpers.js";

const DISABLE_PATTERN = /\bgpu_set_zwriteenable\s*\(\s*false\s*\)\s*;/gu;
const ENABLE_PATTERN = /\bgpu_set_zwriteenable\s*\(\s*true\s*\)\s*;/gu;

export function createRequireZwriteEnabledResetRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return createRequireEnabledResetRule(
        definition,
        DISABLE_PATTERN,
        ENABLE_PATTERN,
        "gpu_set_zwriteenable(true);",
        "Restore z-writing with gpu_set_zwriteenable(true) before the script ends."
    );
}
