/**
 * Normalize data structure accessor operators only when the access shape makes
 * the current accessor provably invalid.
 *
 * Multi-coordinate structured access can only target grids in GameMaker, so a
 * `MemberIndexExpression` with more than one property entry is rewritten to use
 * `[#` because that arity proves grid access.
 */

import { Core, type EmptyTransformOptions, type MutableGameMakerAstNode } from "@gmloop/core";

import {
    type AssignmentExpressionNode,
    isAssignmentExpressionNode,
    isIdentifierNode,
    isMemberIndexExpressionNode,
    isVariableDeclaratorNode,
    type MemberIndexExpressionNode,
    type VariableDeclaratorNode
} from "../rule-base-helpers.js";

const { isObjectLike } = Core;

type ProvenAccessorToken = "[#" | "[?" | "[|";

type AccessorEventNode = AssignmentExpressionNode | MemberIndexExpressionNode | VariableDeclaratorNode;

const EXPLICIT_DATA_STRUCTURE_CONSTRUCTOR_ACCESSORS = new Map<string, ProvenAccessorToken>([
    ["ds_grid_create", "[#"],
    ["ds_list_create", "[|"],
    ["ds_map_create", "[?"]
]);

function shouldNormalizeMemberIndexAccessorToGrid(memberNode: MemberIndexExpressionNode): boolean {
    if (memberNode.accessor === "[#") {
        return false;
    }

    return Array.isArray(memberNode.property) && memberNode.property.length > 1;
}

function getNormalizedIdentifierName(node: unknown): string | null {
    if (!isIdentifierNode(node)) {
        return null;
    }

    return node.name.toLowerCase();
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

function getPropertyCount(memberNode: MemberIndexExpressionNode): number {
    return Array.isArray(memberNode.property) ? memberNode.property.length : 0;
}

function resolveProvenAccessorForMemberIndex(
    memberNode: MemberIndexExpressionNode,
    explicitConstructorAccessorsByIdentifier: ReadonlyMap<string, ProvenAccessorToken>
): ProvenAccessorToken | null {
    if (shouldNormalizeMemberIndexAccessorToGrid(memberNode)) {
        return "[#";
    }

    if (getPropertyCount(memberNode) !== 1) {
        return null;
    }

    const identifierName = getNormalizedIdentifierName(memberNode.object);
    if (!identifierName) {
        return null;
    }

    const trackedAccessor = explicitConstructorAccessorsByIdentifier.get(identifierName);
    if (trackedAccessor === "[?" || trackedAccessor === "[|") {
        return trackedAccessor;
    }

    return null;
}

function collectAccessorEventNodes(node: unknown, collectedNodes: Array<AccessorEventNode>): void {
    if (Core.shouldSkipTraversal(node)) {
        return;
    }

    if (Array.isArray(node)) {
        for (const item of node) {
            collectAccessorEventNodes(item, collectedNodes);
        }
        return;
    }

    if (isMemberIndexExpressionNode(node) || isVariableDeclaratorNode(node) || isAssignmentExpressionNode(node)) {
        collectedNodes.push(node);
    }

    const typedNode = node as { [key: string]: unknown };
    for (const value of Object.values(typedNode)) {
        if (value && typeof value === "object") {
            collectAccessorEventNodes(value, collectedNodes);
        }
    }
}

/**
 * Traverse and normalize accessor operators in the AST.
 */
function visitAndNormalize(node: unknown): void {
    const eventNodes: Array<AccessorEventNode> = [];
    collectAccessorEventNodes(node, eventNodes);

    const explicitConstructorAccessorsByIdentifier = new Map<string, ProvenAccessorToken>();
    const orderedNodes = eventNodes.toSorted((left, right) => {
        const leftStart = Core.getNodeStartIndex(left as never);
        const rightStart = Core.getNodeStartIndex(right as never);
        const normalizedLeftStart = typeof leftStart === "number" && Number.isFinite(leftStart) ? leftStart : 0;
        const normalizedRightStart = typeof rightStart === "number" && Number.isFinite(rightStart) ? rightStart : 0;
        return normalizedLeftStart - normalizedRightStart;
    });

    for (const eventNode of orderedNodes) {
        if (isVariableDeclaratorNode(eventNode) || isAssignmentExpressionNode(eventNode)) {
            const identifierName = resolveAssignmentTargetIdentifierName(eventNode);
            if (!identifierName) {
                continue;
            }

            const explicitAccessor = resolveExplicitConstructorAccessor(resolveAssignmentSource(eventNode));
            if (explicitAccessor) {
                explicitConstructorAccessorsByIdentifier.set(identifierName, explicitAccessor);
                continue;
            }

            explicitConstructorAccessorsByIdentifier.delete(identifierName);
            continue;
        }

        const replacementAccessor = resolveProvenAccessorForMemberIndex(
            eventNode,
            explicitConstructorAccessorsByIdentifier
        );
        if (replacementAccessor && eventNode.accessor !== replacementAccessor) {
            Reflect.set(eventNode, "accessor", replacementAccessor);
        }
    }
}

/**
 * Normalize accessor operators in MemberIndexExpression nodes only when the
 * property arity proves grid access is required.
 */
function normalizeAccessors(ast: MutableGameMakerAstNode): void {
    if (!isObjectLike(ast)) {
        return;
    }

    visitAndNormalize(ast);
}

/**
 * Transform that normalizes only syntactically provable grid accessors.
 *
 * This transform intentionally avoids list/map rewrites based on naming
 * conventions because names alone do not provide enough evidence.
 */
export const normalizeDataStructureAccessorsTransform = Core.createParserTransform<EmptyTransformOptions>(
    "normalize-data-structure-accessors",
    {},
    (ast: MutableGameMakerAstNode) => {
        normalizeAccessors(ast);
        return ast;
    }
);
