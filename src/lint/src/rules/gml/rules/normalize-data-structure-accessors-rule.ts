import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import {
    applySourceTextEdits,
    type AssignmentExpressionNode,
    createMeta,
    isAssignmentExpressionNode,
    isIdentifierNode,
    isMemberIndexExpressionNode,
    isVariableDeclaratorNode,
    type MemberIndexExpressionNode,
    reportFullTextRewrite,
    type VariableDeclaratorNode,
    walkAstNodes
} from "../rule-base-helpers.js";

type ProvenAccessorToken = "[#" | "[?" | "[|";

type AccessorEventNode = AssignmentExpressionNode | MemberIndexExpressionNode | VariableDeclaratorNode;

const EXPLICIT_DATA_STRUCTURE_CONSTRUCTOR_ACCESSORS = new Map<string, ProvenAccessorToken>([
    ["ds_grid_create", "[#"],
    ["ds_list_create", "[|"],
    ["ds_map_create", "[?"]
]);

function getPropertyCount(node: MemberIndexExpressionNode): number {
    return Array.isArray(node.property) ? node.property.length : 0;
}

function shouldNormalizeMemberIndexAccessorToGrid(node: MemberIndexExpressionNode): boolean {
    return node.accessor !== "[#" && getPropertyCount(node) > 1;
}

function getNormalizedIdentifierName(node: unknown): string | null {
    if (!isIdentifierNode(node)) {
        return null;
    }

    const identifierName = node.name;
    if (typeof identifierName !== "string") {
        return null;
    }

    return identifierName.toLowerCase();
}

function resolveExplicitConstructorAccessor(node: unknown): ProvenAccessorToken | null {
    const callIdentifierName = Core.getCallExpressionIdentifierName(node as never);
    if (!callIdentifierName) {
        return null;
    }

    return EXPLICIT_DATA_STRUCTURE_CONSTRUCTOR_ACCESSORS.get(callIdentifierName.toLowerCase()) ?? null;
}

function resolveAssignmentTargetIdentifierName(node: AssignmentExpressionNode | VariableDeclaratorNode): string | null {
    if (isVariableDeclaratorNode(node)) {
        return getNormalizedIdentifierName(node.id);
    }

    if (node.operator !== "=") {
        return null;
    }

    return getNormalizedIdentifierName(node.left);
}

function resolveAssignmentSource(node: AssignmentExpressionNode | VariableDeclaratorNode): unknown {
    return isVariableDeclaratorNode(node) ? node.init : node.right;
}

function getNodeOrderStart(node: AccessorEventNode): number | null {
    const startIndex = Core.getNodeStartIndex(node as never);
    return typeof startIndex === "number" && Number.isFinite(startIndex) ? startIndex : null;
}

function collectAccessorEventNodes(programNode: unknown): Array<AccessorEventNode> {
    const collectedNodes: Array<AccessorEventNode> = [];

    walkAstNodes(programNode, (node: unknown) => {
        if (isMemberIndexExpressionNode(node) || isVariableDeclaratorNode(node) || isAssignmentExpressionNode(node)) {
            collectedNodes.push(node);
        }
    });

    return collectedNodes.toSorted((left, right) => {
        const leftStart = getNodeOrderStart(left) ?? Number.POSITIVE_INFINITY;
        const rightStart = getNodeOrderStart(right) ?? Number.POSITIVE_INFINITY;
        return leftStart - rightStart;
    });
}

function resolveProvenAccessorForMemberIndex(
    node: MemberIndexExpressionNode,
    explicitConstructorAccessorsByIdentifier: ReadonlyMap<string, ProvenAccessorToken>
): ProvenAccessorToken | null {
    if (shouldNormalizeMemberIndexAccessorToGrid(node)) {
        return "[#";
    }

    if (getPropertyCount(node) !== 1) {
        return null;
    }

    const identifierName = getNormalizedIdentifierName(node.object);
    if (!identifierName) {
        return null;
    }

    const trackedAccessor = explicitConstructorAccessorsByIdentifier.get(identifierName);
    if (trackedAccessor === "[?" || trackedAccessor === "[|") {
        return trackedAccessor;
    }

    return null;
}

function findMemberIndexAccessorRange(
    sourceText: string,
    memberIndexExpression: MemberIndexExpressionNode
): { start: number; end: number } | null {
    const objectEnd = Core.getNodeEndIndex(memberIndexExpression.object);
    const nodeEnd = Core.getNodeEndIndex(memberIndexExpression);
    if (
        typeof objectEnd !== "number" ||
        !Number.isFinite(objectEnd) ||
        typeof nodeEnd !== "number" ||
        !Number.isFinite(nodeEnd) ||
        nodeEnd <= objectEnd
    ) {
        return null;
    }

    const memberText = sourceText.slice(objectEnd, nodeEnd);
    const bracketOffset = memberText.indexOf("[");
    if (bracketOffset === -1) {
        return null;
    }

    const start = objectEnd + bracketOffset;
    return { start, end: start + 2 };
}

export function createNormalizeDataStructureAccessorsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program(programNode: unknown) {
                    const sourceText = context.sourceCode.text;
                    const edits: Array<{ start: number; end: number; text: string }> = [];
                    const explicitConstructorAccessorsByIdentifier = new Map<string, ProvenAccessorToken>();

                    for (const node of collectAccessorEventNodes(programNode)) {
                        if (isVariableDeclaratorNode(node) || isAssignmentExpressionNode(node)) {
                            const identifierName = resolveAssignmentTargetIdentifierName(node);
                            if (!identifierName) {
                                continue;
                            }

                            const explicitAccessor = resolveExplicitConstructorAccessor(resolveAssignmentSource(node));
                            if (explicitAccessor) {
                                explicitConstructorAccessorsByIdentifier.set(identifierName, explicitAccessor);
                                continue;
                            }

                            explicitConstructorAccessorsByIdentifier.delete(identifierName);
                            continue;
                        }

                        const replacementAccessor = resolveProvenAccessorForMemberIndex(
                            node,
                            explicitConstructorAccessorsByIdentifier
                        );
                        if (!replacementAccessor || node.accessor === replacementAccessor) {
                            continue;
                        }

                        const accessorRange = findMemberIndexAccessorRange(sourceText, node);
                        if (!accessorRange) {
                            continue;
                        }

                        edits.push({
                            start: accessorRange.start,
                            end: accessorRange.end,
                            text: replacementAccessor
                        });
                    }

                    const rewrittenText = applySourceTextEdits(sourceText, edits);
                    reportFullTextRewrite(context, definition.messageId, sourceText, rewrittenText);
                }
            });
        }
    });
}
