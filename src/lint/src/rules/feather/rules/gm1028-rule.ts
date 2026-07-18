import {
    Core,
    MEMBER_ACCESSOR_GRID,
    MEMBER_ACCESSOR_LIST,
    MEMBER_ACCESSOR_MAP,
    type MemberAccessor
} from "@gmloop/core";
import type { Rule } from "eslint";

import { gmlRuleBaseHelpersServices } from "../../gml/gml-rule-services.js";
import { createFeatherRuleMeta } from "../feather-rule-helpers.js";
import type { FeatherManifestEntry } from "../manifest.js";

const {
    applySourceTextEdits,
    isAssignmentExpressionNode,
    isIdentifierNode,
    isMemberIndexExpressionNode,
    isVariableDeclaratorNode,
    reportFullTextRewrite,
    walkAstNodes
} = gmlRuleBaseHelpersServices;

type AccessorEventNode = unknown;

const EXPLICIT_DATA_STRUCTURE_CONSTRUCTOR_ACCESSORS = new Map<string, MemberAccessor>([
    ["ds_grid_create", MEMBER_ACCESSOR_GRID],
    ["ds_list_create", MEMBER_ACCESSOR_LIST],
    ["ds_map_create", MEMBER_ACCESSOR_MAP]
]);

function getPropertyCount(node: unknown): number {
    if (!isMemberIndexExpressionNode(node)) {
        return 0;
    }
    return Array.isArray(node.property) ? node.property.length : 0;
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

function resolveExplicitConstructorAccessor(node: unknown): MemberAccessor | null {
    const callIdentifierName = Core.getCallExpressionIdentifierName(node);
    if (!callIdentifierName) {
        return null;
    }

    return EXPLICIT_DATA_STRUCTURE_CONSTRUCTOR_ACCESSORS.get(callIdentifierName.toLowerCase()) ?? null;
}

function resolveAssignmentTargetIdentifierName(node: unknown): string | null {
    if (isVariableDeclaratorNode(node)) {
        return getNormalizedIdentifierName(node.id);
    }

    if (!isAssignmentExpressionNode(node) || node.operator !== "=") {
        return null;
    }

    return getNormalizedIdentifierName(node.left);
}

function resolveAssignmentSource(node: unknown): unknown {
    if (isVariableDeclaratorNode(node)) {
        return node.init;
    }
    return isAssignmentExpressionNode(node) ? node.right : null;
}

function getNodeOrderStart(node: unknown): number | null {
    const startIndex = Core.getNodeStartIndex(node);
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
    node: unknown,
    explicitConstructorAccessorsByIdentifier: ReadonlyMap<string, MemberAccessor>
): MemberAccessor | null {
    if (!isMemberIndexExpressionNode(node)) {
        return null;
    }
    const identifierName = getNormalizedIdentifierName(node.object);
    if (!identifierName) {
        return null;
    }

    const trackedAccessor = explicitConstructorAccessorsByIdentifier.get(identifierName);
    if (!trackedAccessor) {
        return null;
    }

    // A grid constructor proves that multi-coordinate access uses the grid
    // accessor. Lists and maps only support one coordinate, so do not invent
    // a fix for multi-coordinate access when their constructor is known.
    if (trackedAccessor !== MEMBER_ACCESSOR_GRID && getPropertyCount(node) !== 1) {
        return null;
    }

    return trackedAccessor;
}

function findMemberIndexAccessorRange(
    sourceText: string,
    memberIndexExpression: unknown
): { start: number; end: number } | null {
    if (!isMemberIndexExpressionNode(memberIndexExpression)) {
        return null;
    }
    const accessor = memberIndexExpression.accessor;
    if (typeof accessor !== "string" || accessor.length === 0) {
        return null;
    }
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
    return { start, end: start + accessor.length };
}

export function createGm1028Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return Object.freeze({
        meta: createFeatherRuleMeta(entry),
        create(context) {
            return Object.freeze({
                Program(programNode: unknown) {
                    const sourceText = context.sourceCode.text;
                    const edits: Array<{ start: number; end: number; text: string }> = [];
                    const explicitConstructorAccessorsByIdentifier = new Map<string, MemberAccessor>();

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
                        if (
                            !replacementAccessor ||
                            !isMemberIndexExpressionNode(node) ||
                            node.accessor === replacementAccessor
                        ) {
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
                    reportFullTextRewrite(context, "diagnostic", sourceText, rewrittenText);
                }
            });
        }
    });
}
