import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { collectSourceLines, createMeta, resolveLocFromIndex } from "../rule-base-helpers.js";

const DOC_FUNCTION_TAG_LINE_PATTERN = /^\s*\/\/\/\s*@(?:func|funct|function|method)\b.*$/u;

function reportDocFunctionTagLineFixes(context: Rule.RuleContext, definition: GmlRuleDefinition): void {
    const sourceText = context.sourceCode.text;
    for (const line of collectSourceLines(sourceText)) {
        if (!DOC_FUNCTION_TAG_LINE_PATTERN.test(line.text)) {
            continue;
        }

        let endOffset = line.startOffset + line.text.length;
        if (sourceText.slice(endOffset, endOffset + 2) === "\r\n") {
            endOffset += 2;
        } else if (sourceText[endOffset] === "\n" || sourceText[endOffset] === "\r") {
            endOffset += 1;
        }

        context.report({
            loc: resolveLocFromIndex(context, sourceText, line.startOffset),
            messageId: definition.messageId,
            fix: (fixer) => fixer.replaceTextRange([line.startOffset, endOffset], "")
        });
    }
}

/**
 * Creates the `gml/remove-doc-function-tags` rule.
 *
 * Removes legacy `/// @function ...` / `/// @func ...` /
 * `/// @funct ...` / `/// @method ...` marker lines from documentation
 * blocks without changing neighboring doc-comment metadata.
 */
export function createRemoveDocFunctionTagsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    reportDocFunctionTagLineFixes(context, definition);
                }
            });
        }
    });
}
