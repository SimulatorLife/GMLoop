import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportFullTextRewrite, rewriteSourceLines } from "../rule-base-helpers.js";

function normalizeConditionAssignments(conditionText: string): string {
    // The lookbehind set enumerates every GML operator whose terminal `=`
    // must NOT be rewritten: `==`, `!=`, `<=`, `>=`, `+=`, `-=`, `*=`, `/=`,
    // `%=`, `<<=`, `>>=`, `??=`, plus the bitwise compound forms `&=`, `^=`,
    // `|=`. Omitting the bitwise characters mangles `if (x |= y)` into the
    // syntactically invalid `if (x |== y)`, and omitting `?` mangles
    // `if (x ??= y)` into the equally invalid `if (x ??== y)`.
    return conditionText.replaceAll(/(?<![=!<>+\-*/%&|^?])=(?![=])/g, "==");
}

function rewriteControlConditionAssignments(sourceText: string): string {
    return rewriteSourceLines(sourceText, (line) =>
        line.replaceAll(/(if|while|do\s+until)\s*\(([^)]*)\)/giu, (_full, keyword: string, condition: string) => {
            const rewrittenCondition = normalizeConditionAssignments(condition);
            return `${keyword} (${rewrittenCondition})`;
        })
    );
}

export function createNoAssignmentInConditionRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const rewrittenText = rewriteControlConditionAssignments(sourceText);
                    reportFullTextRewrite(context, definition.messageId, sourceText, rewrittenText);
                }
            });
        }
    });
}
