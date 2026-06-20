import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createRequireEnabledResetRule } from "../rule-base-helpers.js";

/**
 * Configuration for a `require-<toggle>-enabled-reset` rule.
 *
 * Each entry describes a toggleable GPU-state API and the reset line that
 * must appear after every `gpu_set_<functionName>(false)` call so the
 * runtime is restored to its prior state. The factory helper in this file
 * reads the entry and returns a `createX` rule factory bound to the matching
 * disable/enable patterns.
 */
type GpuToggleResetConfig = Readonly<{
    functionName: string;
    resetMessage: string;
}>;

const GPU_TOGGLE_RESET_CONFIGS: ReadonlyArray<GpuToggleResetConfig> = Object.freeze([
    Object.freeze({
        functionName: "ztestenable",
        resetMessage: "Restore z-testing with gpu_set_ztestenable(true) before the script ends."
    }),
    Object.freeze({
        functionName: "zwriteenable",
        resetMessage: "Restore z-writing with gpu_set_zwriteenable(true) before the script ends."
    })
]);

function buildCreateRequireGpuToggleResetRule(
    config: GpuToggleResetConfig
): (definition: GmlRuleDefinition) => Rule.RuleModule {
    // Each factory must own its own regex instances. The shared
    // `createRequireEnabledResetRule` helper advances `enablePattern.lastIndex`
    // between uses, so sharing the regex across rules would couple their state.
    // `String.raw` keeps the regex source readable by avoiding the doubled
    // backslashes that an interpolated `\\b`/`\\(` would otherwise require.
    const disablePattern = new RegExp(String.raw`\bgpu_set_${config.functionName}\s*\(\s*false\s*\)\s*;`, "gu");
    const enablePattern = new RegExp(String.raw`\bgpu_set_${config.functionName}\s*\(\s*true\s*\)\s*;`, "gu");
    const resetLine = `gpu_set_${config.functionName}(true);`;

    return function createRequireGpuToggleResetRule(definition: GmlRuleDefinition): Rule.RuleModule {
        return createRequireEnabledResetRule(definition, disablePattern, enablePattern, resetLine, config.resetMessage);
    };
}

export const createRequireZtestEnabledResetRule = buildCreateRequireGpuToggleResetRule(GPU_TOGGLE_RESET_CONFIGS[0]);

export const createRequireZwriteEnabledResetRule = buildCreateRequireGpuToggleResetRule(GPU_TOGGLE_RESET_CONFIGS[1]);
