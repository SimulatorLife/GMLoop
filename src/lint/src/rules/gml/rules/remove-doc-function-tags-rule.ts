import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportFullTextRewrite } from "../rule-base-helpers.js";

const DOC_FUNCTION_TAG_LINE_PATTERN = /^\s*\/\/\/\s*@function\b.*$/u;

function removeDocFunctionTagLines(sourceText: string): string {
    const lineBreakSpans = Core.getLineBreakSpans(sourceText);
    let rewrittenText = "";
    let lineStartIndex = 0;

    for (const lineBreakSpan of lineBreakSpans) {
        const lineText = sourceText.slice(lineStartIndex, lineBreakSpan.index);
        const lineBreakText = sourceText.slice(lineBreakSpan.index, lineBreakSpan.index + lineBreakSpan.length);
        if (!DOC_FUNCTION_TAG_LINE_PATTERN.test(lineText)) {
            rewrittenText += `${lineText}${lineBreakText}`;
        }
        lineStartIndex = lineBreakSpan.index + lineBreakSpan.length;
    }

    const finalLineText = sourceText.slice(lineStartIndex);
    if (!DOC_FUNCTION_TAG_LINE_PATTERN.test(finalLineText)) {
        rewrittenText += finalLineText;
    }

    return rewrittenText;
}

/**
 * Creates the `gml/remove-doc-function-tags` rule.
 *
 * Removes legacy `/// @function ...` marker lines from documentation blocks
 * without changing neighboring doc-comment metadata.
 */
export function createRemoveDocFunctionTagsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const rewrittenText = removeDocFunctionTagLines(sourceText);
                    reportFullTextRewrite(context, definition.messageId, sourceText, rewrittenText);
                }
            });
        }
    });
}
