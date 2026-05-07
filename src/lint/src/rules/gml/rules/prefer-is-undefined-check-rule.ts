import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { createMeta, isAstNodeRecord, type GmlRuleDefinition } from "../rule-base-helpers.js";

const { unwrapParenthesizedExpression } = Core;

function isUndefinedIdentifier(expression: unknown): boolean {
    if (!isAstNodeRecord(expression)) {
        return false;
    }

    if (expression.type === "Identifier") {
        return expression.name === "undefined";
    }

    return expression.type === "Literal" && expression.value === "undefined";
}

export function createPreferIsUndefinedCheckRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                BinaryExpression(node) {
                    if (node.operator !== "==" && node.operator !== "!=") {
                        return;
                    }

                    if (isUndefinedIdentifier(node.left) || isUndefinedIdentifier(node.right)) {
                        const otherSide = isUndefinedIdentifier(node.left) ? node.right : node.left;
                        const start = Core.getNodeStartIndex(node);
                        const end = Core.getNodeEndIndex(node);
                        const otherStart = Core.getNodeStartIndex(otherSide);
                        const otherEnd = Core.getNodeEndIndex(otherSide);

                        if (
                            typeof start === "number" &&
                            typeof end === "number" &&
                            typeof otherStart === "number" &&
                            typeof otherEnd === "number"
                        ) {
                            const otherExprText = context.sourceCode.text.slice(otherStart, otherEnd);
                            const replacement =
                                node.operator === "=="
                                    ? `is_undefined(${otherExprText})`
                                    : `!is_undefined(${otherExprText})`;

                            context.report({
                                node,
                                messageId: definition.messageId,
                                fix: (fixer) => fixer.replaceTextRange([start, end], replacement)
                            });
                        }
                    }
                },
                UnaryExpression(node) {
                    if (node.operator !== "!") {
                        return;
                    }

                    const inner = unwrapParenthesizedExpression(node.argument);
                    if (!isAstNodeRecord(inner) || inner.type !== "BinaryExpression") {
                        return;
                    }

                    if (inner.operator !== "==" && inner.operator !== "!=") {
                        return;
                    }

                    if (!isUndefinedIdentifier(inner.left) && !isUndefinedIdentifier(inner.right)) {
                        return;
                    }

                    const comparedExpression = isUndefinedIdentifier(inner.left) ? inner.right : inner.left;
                    const comparedStart = Core.getNodeStartIndex(comparedExpression);
                    const comparedEnd = Core.getNodeEndIndex(comparedExpression);
                    const start = Core.getNodeStartIndex(node);
                    const end = Core.getNodeEndIndex(node);
                    if (
                        typeof comparedStart !== "number" ||
                        typeof comparedEnd !== "number" ||
                        typeof start !== "number" ||
                        typeof end !== "number"
                    ) {
                        return;
                    }

                    const comparedText = context.sourceCode.text.slice(comparedStart, comparedEnd);
                    const replacement =
                        inner.operator === "==" ? `!is_undefined(${comparedText})` : `is_undefined(${comparedText})`;
                    context.report({
                        node,
                        messageId: definition.messageId,
                        fix: (fixer) => fixer.replaceTextRange([start, end], replacement)
                    });
                }
            });
        }
    });
}
