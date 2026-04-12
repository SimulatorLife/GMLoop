import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import {
    createMeta,
    getNodeEndIndex,
    getNodeStartIndex,
    isAssignmentExpressionNodeWithOperator,
    isAstNodeRecord,
    isStandaloneStatementParentKey,
    sourceRangeContainsCommentToken,
    walkAstNodesWithParent
} from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

type IncrementDecrementAssignmentOperator = "+=" | "-=";
type IncrementDecrementOperator = "++" | "--";

type AssignmentExpressionNode = Readonly<{
    type: "AssignmentExpression";
    operator: IncrementDecrementAssignmentOperator;
    left: unknown;
    right: unknown;
}>;

type PreferIncrementDecrementCandidate = Readonly<{
    assignmentExpression: AssignmentExpressionNode;
    operator: IncrementDecrementOperator;
}>;

type UnwrapParenthesizedExpressionInput = Parameters<typeof Core.unwrapParenthesizedExpression>[0];

const INCREMENT_DECREMENT_OPERATOR_BY_ASSIGNMENT_OPERATOR = Object.freeze({
    "+=": "++",
    "-=": "--"
} as const satisfies Readonly<Record<IncrementDecrementAssignmentOperator, IncrementDecrementOperator>>);

function isIncrementDecrementAssignmentOperator(operator: unknown): operator is IncrementDecrementAssignmentOperator {
    return operator === "+=" || operator === "-=";
}

function isAssignmentExpressionNode(node: unknown): node is AssignmentExpressionNode {
    return isAssignmentExpressionNodeWithOperator(node, isIncrementDecrementAssignmentOperator);
}

function isNumericLiteralOne(node: unknown, sourceText: string): boolean {
    const unwrappedNode = Core.unwrapParenthesizedExpression(node as UnwrapParenthesizedExpressionInput);
    if (!isAstNodeRecord(unwrappedNode) || unwrappedNode.type !== "Literal") {
        return false;
    }

    const literalStart = getNodeStartIndex(unwrappedNode);
    const literalEnd = getNodeEndIndex(unwrappedNode);
    if (typeof literalStart !== "number" || typeof literalEnd !== "number") {
        return false;
    }

    const literalText = sourceText.slice(literalStart, literalEnd).trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(literalText)) {
        return false;
    }

    return Number(literalText) === 1;
}

function tryGetPreferIncrementDecrementCandidate(
    node: unknown,
    sourceText: string
): PreferIncrementDecrementCandidate | null {
    if (!isAssignmentExpressionNode(node)) {
        return null;
    }

    if (!isNumericLiteralOne(node.right, sourceText)) {
        return null;
    }

    return Object.freeze({
        assignmentExpression: node,
        operator: INCREMENT_DECREMENT_OPERATOR_BY_ASSIGNMENT_OPERATOR[node.operator]
    });
}

/**
 * Creates the `gml/prefer-increment-decrement-operators` rule.
 *
 * Rewrites standalone `+= 1` and `-= 1` statement forms to `++` and `--`
 * respectively when the increment amount is a numeric literal equal to one.
 */
export function createPreferIncrementDecrementOperatorsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program(programNode) {
                    const sourceText = context.sourceCode.text;

                    walkAstNodesWithParent(programNode, ({ node, parentKey }) => {
                        if (!isStandaloneStatementParentKey(parentKey)) {
                            return;
                        }

                        const candidate = tryGetPreferIncrementDecrementCandidate(node, sourceText);
                        if (!candidate) {
                            return;
                        }

                        const assignmentStart = getNodeStartIndex(candidate.assignmentExpression);
                        const assignmentEnd = getNodeEndIndex(candidate.assignmentExpression);
                        const leftStart = getNodeStartIndex(candidate.assignmentExpression.left);
                        const leftEnd = getNodeEndIndex(candidate.assignmentExpression.left);
                        if (
                            typeof assignmentStart !== "number" ||
                            typeof assignmentEnd !== "number" ||
                            typeof leftStart !== "number" ||
                            typeof leftEnd !== "number"
                        ) {
                            return;
                        }

                        if (sourceRangeContainsCommentToken(sourceText, assignmentStart, assignmentEnd)) {
                            return;
                        }

                        const leftText = sourceText.slice(leftStart, leftEnd);
                        context.report({
                            node: candidate.assignmentExpression as Rule.Node,
                            messageId: definition.messageId,
                            fix: (fixer) =>
                                fixer.replaceTextRange(
                                    [assignmentStart, assignmentEnd],
                                    `${leftText}${candidate.operator}`
                                )
                        });
                    });
                }
            });
        }
    });
}
