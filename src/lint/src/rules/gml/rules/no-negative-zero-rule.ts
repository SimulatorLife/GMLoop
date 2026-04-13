import type { Rule } from "eslint";

import { createMeta, getNodeEndIndex, getNodeStartIndex, isAstNodeRecord } from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

/**
 * Reports and autofixes unary minus applied to a literal zero (`-0`, `-0.`,
 * `-0.0`, `-0.000`, etc.) by replacing the entire expression with `0`.
 *
 * In GML, negative zero is numerically identical to positive zero. Keeping
 * `-0` in source is misleading and creates unnecessary churn when the
 * formatter normalizes trailing-zero decimals (e.g. `-0.` → `-0`). This
 * rule gives developers an explicit, auditable autofix.
 *
 * Ownership boundary: this rule lives in `@gmloop/lint` because collapsing
 * a unary-minus expression into a bare literal is a structural/semantic
 * rewrite, not a layout transform. (target-state.md §2.1, §3.2)
 */
export function createNoNegativeZeroRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText:
                "Unnecessary unary `-` before zero literal — negative zero is identical to `0` in GML. Use autofix to simplify."
        }),
        create(context) {
            return Object.freeze({
                UnaryExpression(node) {
                    if (node.operator !== "-") {
                        return;
                    }

                    if (!node.prefix) {
                        return;
                    }

                    const argument = node.argument;
                    if (!isAstNodeRecord(argument) || argument.type !== "Literal") {
                        return;
                    }

                    if (Number(argument.value) !== 0) {
                        return;
                    }

                    const start = getNodeStartIndex(node);
                    const end = getNodeEndIndex(node);

                    if (typeof start !== "number" || typeof end !== "number") {
                        return;
                    }

                    context.report({
                        node,
                        messageId: definition.messageId,
                        fix: (fixer) => fixer.replaceTextRange([start, end], "0")
                    });
                }
            });
        }
    });
}
