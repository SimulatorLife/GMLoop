import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, isAstNodeRecord } from "../rule-base-helpers.js";

const { unwrapParenthesizedExpression } = Core;

function isUndefinedIdentifier(expression: unknown): boolean {
    if (!isAstNodeRecord(expression)) {
        return false;
    }

    if (expression.type === "Identifier") {
        return typeof expression.name === "string" && expression.name.toLowerCase() === "undefined";
    }

    if (expression.type === "Literal" && typeof expression.value === "string") {
        return expression.value.toLowerCase() === "undefined";
    }

    return false;
}

function resolveImmediateNegatedWrapperRange(sourceText: string, start: number, end: number): [number, number] | null {
    const wrapperStart = start - 2;
    if (wrapperStart < 0 || end >= sourceText.length) {
        return null;
    }

    return sourceText.slice(wrapperStart, start) === "!(" && sourceText[end] === ")" ? [wrapperStart, end + 1] : null;
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
                            const negatedWrapperRange = resolveImmediateNegatedWrapperRange(
                                context.sourceCode.text,
                                start,
                                end
                            );
                            const isNegated = negatedWrapperRange !== null;
                            const replacement =
                                (node.operator === "==") === !isNegated
                                    ? `is_undefined(${otherExprText})`
                                    : `!is_undefined(${otherExprText})`;
                            const replacementRange = negatedWrapperRange ?? [start, end];

                            context.report({
                                node,
                                messageId: definition.messageId,
                                fix: (fixer) => fixer.replaceTextRange(replacementRange, replacement)
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
