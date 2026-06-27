import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, sourceRangeContainsCommentToken } from "../rule-base-helpers.js";

type BooleanComparisonOperand = Readonly<{
    comparedBoolean: boolean;
    comparedExpression: unknown;
}>;

function readBooleanLiteralComparisonOperands(
    leftOperand: unknown,
    rightOperand: unknown
): BooleanComparisonOperand | null {
    const left = Core.unwrapParenthesizedExpression(leftOperand);
    const right = Core.unwrapParenthesizedExpression(rightOperand);
    if (!left || !right) {
        return null;
    }

    const leftBoolean = Core.getBooleanLiteralValue(left, { acceptBooleanPrimitives: true });
    const rightBoolean = Core.getBooleanLiteralValue(right, { acceptBooleanPrimitives: true });
    const hasLeftBoolean = leftBoolean === "true" || leftBoolean === "false";
    const hasRightBoolean = rightBoolean === "true" || rightBoolean === "false";
    if (hasLeftBoolean === hasRightBoolean) {
        return null;
    }

    if (hasLeftBoolean) {
        return Object.freeze({
            comparedBoolean: leftBoolean === "true",
            comparedExpression: rightOperand
        });
    }

    return Object.freeze({
        comparedBoolean: rightBoolean === "true",
        comparedExpression: leftOperand
    });
}

/**
 * Creates the `gml/no-boolean-literal-comparisons` rule.
 *
 * The rule owns only local boolean-literal comparison cleanup, for example
 * `ready == true` to `ready` and `ready == false` to `!ready`.
 */
export function createNoBooleanLiteralComparisonsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Avoid comparing boolean expressions to boolean literals."
        }),
        create(context) {
            return Object.freeze({
                BinaryExpression(node) {
                    const operator = Core.getNormalizedOperator(node);
                    if (operator !== "==" && operator !== "!=") {
                        return;
                    }

                    const comparisonOperands = readBooleanLiteralComparisonOperands(node.left, node.right);
                    if (comparisonOperands === null) {
                        return;
                    }

                    const start = Core.getNodeStartIndex(node);
                    const end = Core.getNodeEndIndex(node);
                    const expressionStart = Core.getNodeStartIndex(comparisonOperands.comparedExpression);
                    const expressionEnd = Core.getNodeEndIndex(comparisonOperands.comparedExpression);
                    if (
                        typeof start !== "number" ||
                        typeof end !== "number" ||
                        typeof expressionStart !== "number" ||
                        typeof expressionEnd !== "number"
                    ) {
                        return;
                    }

                    const sourceText = context.sourceCode.text;
                    if (Core.hasComment(node) || sourceRangeContainsCommentToken(sourceText, start, end)) {
                        return;
                    }

                    const comparedExpressionText = sourceText.slice(expressionStart, expressionEnd);
                    const shouldNegate =
                        operator === "=="
                            ? comparisonOperands.comparedBoolean === false
                            : comparisonOperands.comparedBoolean === true;
                    const replacementText = shouldNegate ? `!${comparedExpressionText}` : comparedExpressionText;

                    context.report({
                        node,
                        messageId: definition.messageId,
                        fix: (fixer) => fixer.replaceTextRange([start, end], replacementText)
                    });
                }
            });
        }
    });
}
