import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createRequireEnabledResetRule } from "../rule-base-helpers.js";

const DISABLE_PATTERN = /\bgpu_set_ztestenable\s*\(\s*false\s*\)\s*;/gu;
const ENABLE_PATTERN = /\bgpu_set_ztestenable\s*\(\s*true\s*\)\s*;/gu;

export function createRequireZtestEnabledResetRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return createRequireEnabledResetRule(
        definition,
        DISABLE_PATTERN,
        ENABLE_PATTERN,
        "gpu_set_ztestenable(true);",
        "Restore z-testing with gpu_set_ztestenable(true) before the script ends."
    );
}
