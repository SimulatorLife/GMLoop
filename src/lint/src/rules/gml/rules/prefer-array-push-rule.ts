import { Core, MEMBER_ACCESSOR_ARRAY } from "@gmloop/core";
import type { Rule } from "eslint";

import {
    createMeta,
    isAssignmentExpressionNodeWithOperator,
    isAstNodeRecord,
    isMemberIndexExpressionNode,
    isStandaloneStatementParentKey,
    sourceRangeContainsCommentToken,
    walkAstNodesWithParent
} from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

type AssignmentExpressionNode = Readonly<{
    type: "AssignmentExpression";
    operator: "=";
    left: unknown;
    right: unknown;
}>;

type CallExpressionNode = Readonly<{
    type: "CallExpression";
    arguments?: Array<unknown> | null;
}>;

type PreferArrayPushCandidate = Readonly<{
    assignmentExpression: AssignmentExpressionNode;
    arrayExpression: unknown;
    valueExpression: unknown;
}>;

type UnwrapParenthesizedExpressionInput = Parameters<typeof Core.unwrapParenthesizedExpression>[0];

function isAssignmentExpressionNode(node: unknown): node is AssignmentExpressionNode {
    return isAssignmentExpressionNodeWithOperator(node, (operator): operator is "=" => operator === "=");
}

function isCallExpressionNode(node: unknown): node is CallExpressionNode {
    return isAstNodeRecord(node) && node.type === "CallExpression";
}

function isSafeArrayReceiver(node: unknown): boolean {
    if (!isAstNodeRecord(node)) {
        return false;
    }

    switch (node.type) {
        case "Identifier":
        case "Literal": {
            return true;
        }
        case "ParenthesizedExpression": {
            return isSafeArrayReceiver(node.expression);
        }
        case "MemberDotExpression": {
            return (
                isSafeArrayReceiver(node.object) &&
                isAstNodeRecord(node.property) &&
                node.property.type === "Identifier"
            );
        }
        case "MemberIndexExpression": {
            if (!isSafeArrayReceiver(node.object)) {
                return false;
            }

            const propertyEntry = Core.getSingleMemberIndexPropertyEntry(node as never);
            return propertyEntry !== null && isSafeArrayReceiver(propertyEntry);
        }
        default: {
            return false;
        }
    }
}

function sliceNodeText(sourceText: string, node: unknown): string | null {
    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
    if (typeof start !== "number" || typeof end !== "number") {
        return null;
    }

    return sourceText.slice(start, end);
}

function tryGetPreferArrayPushCandidate(node: unknown, sourceText: string): PreferArrayPushCandidate | null {
    if (!isAssignmentExpressionNode(node)) {
        return null;
    }

    if (!isMemberIndexExpressionNode(node.left) || node.left.accessor !== MEMBER_ACCESSOR_ARRAY) {
        return null;
    }

    const arrayExpression = Core.unwrapParenthesizedExpression(node.left.object as UnwrapParenthesizedExpressionInput);
    if (!arrayExpression || !isSafeArrayReceiver(arrayExpression)) {
        return null;
    }

    const indexExpression = Core.getSingleMemberIndexPropertyEntry(node.left as never);
    if (!isCallExpressionNode(indexExpression)) {
        return null;
    }

    if (
        !Core.isCallExpressionIdentifierMatch(indexExpression as never, "array_length", {
            caseInsensitive: true
        })
    ) {
        return null;
    }

    const indexArguments = Core.getCallExpressionArguments(indexExpression as never);
    if (indexArguments.length !== 1) {
        return null;
    }

    const arrayExpressionText = sliceNodeText(sourceText, arrayExpression);
    const argumentText = sliceNodeText(sourceText, indexArguments[0]);
    if (arrayExpressionText === null || argumentText === null) {
        return null;
    }

    if (arrayExpressionText.trim() !== argumentText.trim()) {
        return null;
    }

    return Object.freeze({
        assignmentExpression: node,
        arrayExpression,
        valueExpression: node.right
    });
}

/**
 * Creates the `gml/prefer-array-push` rule.
 *
 * Rewrites direct append assignments such as `items[array_length(items)] = value`
 * to `array_push(items, value)` when the receiver expression is side-effect-free
 * and the replacement stays within a single statement.
 */
export function createPreferArrayPushRule(definition: GmlRuleDefinition): Rule.RuleModule {
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

                        const candidate = tryGetPreferArrayPushCandidate(node, sourceText);
                        if (!candidate) {
                            return;
                        }

                        const assignmentStart = Core.getNodeStartIndex(candidate.assignmentExpression);
                        const assignmentEnd = Core.getNodeEndIndex(candidate.assignmentExpression);
                        if (typeof assignmentStart !== "number" || typeof assignmentEnd !== "number") {
                            return;
                        }

                        if (sourceRangeContainsCommentToken(sourceText, assignmentStart, assignmentEnd)) {
                            return;
                        }

                        const arrayText = sliceNodeText(sourceText, candidate.arrayExpression);
                        const valueText = sliceNodeText(sourceText, candidate.valueExpression);
                        if (arrayText === null || valueText === null) {
                            return;
                        }

                        context.report({
                            node: candidate.assignmentExpression as Rule.Node,
                            messageId: definition.messageId,
                            fix: (fixer) =>
                                fixer.replaceTextRange(
                                    [assignmentStart, assignmentEnd],
                                    `array_push(${arrayText}, ${valueText})`
                                )
                        });
                    });
                }
            });
        }
    });
}
