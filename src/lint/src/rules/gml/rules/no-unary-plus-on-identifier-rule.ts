import type { Rule } from "eslint";

import { createMeta, getNodeEndIndex, getNodeStartIndex, isAstNodeRecord } from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

/**
 * Unwraps chains of `ParenthesizedExpression` nodes to retrieve the innermost
 * expression. Returns the original node when no wrapping is present.
 */
function unwrapParenthesizedExpression(node: unknown): unknown {
    let current = node;

    while (isAstNodeRecord(current) && current.type === "ParenthesizedExpression") {
        current = current.expression;
    }

    return current;
}

/**
 * Reports and autofixes unary `+` applied directly to an identifier such as
 * `+count` → `count`. In GML the unary-plus operator has numeric-coercion
 * semantics (it converts its operand to a number), so `+x` is only equivalent
 * to `x` when the variable is already known to hold a numeric value.
 *
 * Because the formatter cannot guarantee the operand type, it must preserve the
 * expression verbatim. This rule gives the developer an explicit, auditable
 * autofix to remove the operator when it is safe to do so.
 *
 * Ownership boundary: this rule lives in `@gmloop/lint` because replacing
 * `+identifier` with `identifier` is a semantic content rewrite, not a layout
 * transform. (target-state.md §2.1, §3.2)
 */
export function createNoUnaryPlusOnIdentifierRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText:
                "Unnecessary unary `+` before identifier — the operator coerces to number and may be removed if the variable is always numeric. Use autofix to apply."
        }),
        create(context) {
            return Object.freeze({
                UnaryExpression(node) {
                    if (node.operator !== "+") {
                        return;
                    }

                    // Only flag prefix form (`+x`), not postfix (which doesn't exist for `+`).
                    if (!node.prefix) {
                        return;
                    }

                    const innerExpression = unwrapParenthesizedExpression(node.argument);

                    if (!isAstNodeRecord(innerExpression) || innerExpression.type !== "Identifier") {
                        return;
                    }

                    const start = getNodeStartIndex(node);
                    const end = getNodeEndIndex(node);
                    const argumentStart = getNodeStartIndex(node.argument);
                    const argumentEnd = getNodeEndIndex(node.argument);

                    if (
                        typeof start !== "number" ||
                        typeof end !== "number" ||
                        typeof argumentStart !== "number" ||
                        typeof argumentEnd !== "number"
                    ) {
                        return;
                    }

                    const argumentText = context.sourceCode.text.slice(argumentStart, argumentEnd);

                    context.report({
                        node,
                        messageId: definition.messageId,
                        fix: (fixer) => fixer.replaceTextRange([start, end], argumentText)
                    });
                }
            });
        }
    });
}
