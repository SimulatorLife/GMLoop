import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, resolveLocFromIndex } from "../rule-base-helpers.js";

const DISABLE_PATTERN = /\bgpu_set_ztestenable\s*\(\s*false\s*\)\s*;/gu;
const ENABLE_PATTERN = /\bgpu_set_ztestenable\s*\(\s*true\s*\)\s*;/gu;

export function createRequireZtestEnabledResetRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Restore z-testing with gpu_set_ztestenable(true) before the script ends."
        }),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const disableMatches = [...sourceText.matchAll(DISABLE_PATTERN)];
                    const lastDisable = disableMatches.at(-1);
                    if (!lastDisable) {
                        return;
                    }

                    const lastDisableEnd = (lastDisable.index ?? 0) + lastDisable[0].length;
                    ENABLE_PATTERN.lastIndex = lastDisableEnd;
                    if (ENABLE_PATTERN.exec(sourceText) !== null) {
                        return;
                    }

                    context.report({
                        loc: resolveLocFromIndex(context, sourceText, lastDisable.index ?? 0),
                        messageId: definition.messageId,
                        fix: (fixer) => {
                            const prefix = sourceText.endsWith("\n") ? "" : "\n";
                            return fixer.insertTextAfterRange(
                                [sourceText.length, sourceText.length],
                                `${prefix}gpu_set_ztestenable(true);\n`
                            );
                        }
                    });
                }
            });
        }
    });
}
