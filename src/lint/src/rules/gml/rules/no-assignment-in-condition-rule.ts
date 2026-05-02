import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { createMeta, reportFullTextRewrite, type GmlRuleDefinition } from "../rule-base-helpers.js";

function normalizeConditionAssignments(conditionText: string): string {
    return conditionText.replaceAll(/(?<![=!<>+\-*/%])=(?![=])/g, "==");
}

function rewriteControlConditionAssignments(sourceText: string): string {
    const lineEnding = Core.dominantLineEnding(sourceText);
    const lines = sourceText.split(/\r?\n/u);
    const rewrittenLines = lines.map((line) =>
        line.replaceAll(/(if|while|do\s+until)\s*\(([^)]*)\)/giu, (_full, keyword: string, condition: string) => {
            const rewrittenCondition = normalizeConditionAssignments(condition);
            return `${keyword} (${rewrittenCondition})`;
        })
    );
    return rewrittenLines.join(lineEnding);
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
