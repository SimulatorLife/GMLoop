import { asArray } from "../../utils/array.js";
import { getOptionalString } from "../../utils/object.js";
import { isNonEmptyString } from "../../utils/string.js";
import { assignClonedLocation } from "../locations.js";
import {
    ASSIGNMENT_PATTERN,
    CALL_EXPRESSION,
    IDENTIFIER,
    LITERAL,
    MEMBER_DOT_EXPRESSION,
    MEMBER_INDEX_EXPRESSION,
    VARIABLE_DECLARATION,
    VARIABLE_DECLARATOR
} from "../node-types.js";
import type {
    AssignmentPatternNode,
    CallExpressionNode,
    GameMakerAstLocation,
    GameMakerAstNode,
    IdentifierNode,
    LiteralNode,
    MemberIndexExpressionNode,
    VariableDeclarationNode,
    VariableDeclaratorNode
} from "../types.js";
import { getNodeType, hasType, isNode, unwrapParenthesizedExpression } from "./basics.js";

const identifierResolvers: Readonly<Record<string, (node: GameMakerAstNode) => string | null>> = Object.freeze({
    Identifier: resolveNodeName,
    Literal: (literal) =>
        typeof (literal as LiteralNode).value === "string" ? ((literal as LiteralNode).value as string) : null,
    MemberDotExpression: (expression) => {
        const { object, property } = expression as { object: unknown; property: unknown };
        if (!isIdentifierNode(object) || !isIdentifierNode(property)) {
            return null;
        }

        return `${object.name}_${property.name}`;
    },
    MemberIndexExpression: (expression) => {
        const { object, property } = expression as { object: unknown; property: unknown };
        if (!isIdentifierNode(object) || !Array.isArray(property) || property.length !== 1) {
            return null;
        }

        const indexText = getMemberIndexText(property[0]);
        return indexText === null ? null : `${object.name}_${indexText}`;
    }
});

/**
 * Retrieve the sole declarator from a variable declaration node.
 *
 * @param node Potential variable declaration node to inspect.
 * @returns The single declarator when present, otherwise `null`.
 */
export function getSingleVariableDeclarator(node: GameMakerAstNode | null | undefined): VariableDeclaratorNode | null {
    if (node?.type !== VARIABLE_DECLARATION) {
        return null;
    }

    const { declarations } = node;
    if (!Array.isArray(declarations) || declarations.length !== 1) {
        return null;
    }

    const [declarator] = declarations;
    if (declarator?.type !== VARIABLE_DECLARATOR) {
        return null;
    }

    return declarator as VariableDeclaratorNode;
}

/**
 * Read and normalize the `kind` field from a variable declaration node.
 *
 * @param node Possible variable declaration wrapper exposed by the parser.
 * @returns Lowercase declaration keyword when present, or `null` when missing.
 */
export function getVariableDeclarationKind(
    node: GameMakerAstNode | null | undefined
): "var" | "global" | "static" | (string & {}) | null {
    if (node?.type !== VARIABLE_DECLARATION) {
        return null;
    }

    const { kind } = node as VariableDeclarationNode;
    if (!isNonEmptyString(kind)) {
        return null;
    }

    return kind.toLowerCase();
}

/**
 * Compare a declaration node against a specific keyword.
 *
 * @param node Candidate variable declaration.
 * @param expectedKind Keyword to match.
 * @returns `true` when `node.kind` resolves to the provided keyword.
 */
export function isVariableDeclarationOfKind(
    node: GameMakerAstNode | null | undefined,
    expectedKind: string | null | undefined
): boolean {
    if (!isNonEmptyString(expectedKind)) {
        return false;
    }

    const normalizedKind = getVariableDeclarationKind(node);
    return normalizedKind !== null && normalizedKind === expectedKind.toLowerCase();
}

/**
 * Determine whether `node` is a `var` variable declaration.
 *
 * @param node Candidate variable declaration node.
 * @returns `true` when `node` declares a `var` variable.
 */
export function isVarVariableDeclaration(node: GameMakerAstNode | null | undefined): boolean {
    return isVariableDeclarationOfKind(node, "var");
}

/**
 * Extract the `name` field from an identifier-like node.
 *
 * @param node Potential identifier or node carrying a `name` property.
 * @returns The `name` string when present, otherwise `null`.
 */
export function resolveNodeName(node: GameMakerAstNode | null | undefined): string | null {
    if (isIdentifierNode(node)) {
        return node.name;
    }

    return getOptionalString(node, "name");
}

/**
 * Determine whether `node` is a well-formed identifier node.
 *
 * @param node Candidate value to inspect.
 * @returns `true` when `node` is an identifier with a string `name`.
 */
export function isIdentifierNode(node: unknown): node is IdentifierNode {
    if (!isNode(node)) {
        return false;
    }

    const candidate = node as { type?: unknown; name?: unknown };
    return candidate.type === IDENTIFIER && typeof candidate.name === "string";
}

/**
 * Determine whether `node` is a literal node.
 *
 * @param node Candidate value to inspect.
 * @returns `true` when `node` is a literal.
 */
export function isLiteralNode(node: unknown): node is LiteralNode {
    return hasType(node, LITERAL);
}

/**
 * Determine whether `node` is an assignment pattern node.
 *
 * @param node Candidate value to inspect.
 * @returns `true` when `node` is an assignment pattern.
 */
export function isAssignmentPatternNode(node: unknown): node is AssignmentPatternNode {
    return hasType(node, ASSIGNMENT_PATTERN);
}

/**
 * Determine whether `node` is a call expression node.
 *
 * @param node Candidate value to inspect.
 * @returns `true` when `node` is a call expression.
 */
export function isCallExpressionNode(node: unknown): node is CallExpressionNode {
    return hasType(node, CALL_EXPRESSION);
}

/**
 * Determine whether `node` is a member index expression node.
 *
 * @param node Candidate value to inspect.
 * @returns `true` when `node` is a member index expression.
 */
export function isMemberIndexExpressionNode(node: unknown): node is MemberIndexExpressionNode {
    return hasType(node, MEMBER_INDEX_EXPRESSION);
}

/**
 * Check whether `node` is an identifier with the exact `name`.
 *
 * @param node Candidate identifier node to inspect.
 * @param name Expected identifier name.
 * @returns `true` when `node` is an identifier matching `name`.
 */
export function isIdentifierWithName(node: GameMakerAstNode | null | undefined, name: string) {
    const identifierDetails = getIdentifierDetails(node);
    return identifierDetails?.name === name;
}

/**
 * Extract normalized identifier text from a node or string.
 *
 * @param node Candidate identifier-like value.
 * @returns Comparable identifier text, or `null` when unavailable.
 */
export function getIdentifierText(node: GameMakerAstNode | string | null | undefined): string | null {
    if (node == null) {
        return null;
    }

    if (typeof node === "string") {
        return node;
    }

    const nodeType = getNodeType(node);
    const resolver = nodeType === null ? resolveNodeName : (identifierResolvers[nodeType] ?? resolveNodeName);
    return resolver(node);
}

/**
 * Synthesize an identifier node while cloning the source location metadata.
 *
 * @param name Potential identifier name to assign to the node.
 * @param template Node whose location metadata should be copied.
 * @returns Identifier node with cloned locations when `name` is a non-empty string.
 */
export function createIdentifierNode(
    name: unknown,
    template: GameMakerAstNode | null | undefined
): IdentifierNode | null {
    if (!isNonEmptyString(name)) {
        return null;
    }

    const identifier: IdentifierNode = {
        type: IDENTIFIER,
        name
    };
    assignClonedLocation(identifier, template);
    return identifier;
}

/**
 * Clone an `IdentifierNode` while preserving its location metadata.
 *
 * @param node Candidate identifier to clone.
 * @returns Cloned identifier or `null`.
 */
export function cloneIdentifier(node?: unknown): IdentifierNode | null {
    const identifierDetails = getIdentifierDetails(node);
    return identifierDetails ? createIdentifierNode(identifierDetails.name, identifierDetails.identifier) : null;
}

/**
 * Extract the printable index portion of a `MemberIndexExpression`.
 *
 * @param indexNode Possible node nested within `MemberIndexExpression.property`.
 * @returns Resolved index name or `null`.
 */
export function getMemberIndexText(indexNode: GameMakerAstNode | string | null | undefined): string | null {
    if (typeof indexNode === "string") {
        return indexNode;
    }

    if (indexNode == null) {
        return null;
    }

    const directName = resolveNodeName(indexNode);
    return directName === null ? getIdentifierText(indexNode) : directName;
}

/**
 * Return the sole property entry from a `MemberIndexExpression`.
 *
 * @param node Candidate member index expression.
 * @returns The single property entry or `null` when missing.
 */
export function getSingleMemberIndexPropertyEntry(node: unknown): GameMakerAstNode | null {
    if (!isNode(node) || node.type !== MEMBER_INDEX_EXPRESSION) {
        return null;
    }

    const { property } = node as MemberIndexExpressionNode;
    if (!Array.isArray(property) || property.length !== 1) {
        return null;
    }

    const [propertyEntry] = property;
    return propertyEntry ?? null;
}

/**
 * Safely read the argument array from a call-like AST node.
 *
 * @param callExpression Potential call expression node.
 * @returns Normalized argument collection.
 */
export function getCallExpressionArguments(
    callExpression: GameMakerAstNode | null | undefined
): readonly GameMakerAstNode[] {
    if (!isNode(callExpression)) {
        return asArray();
    }

    return asArray((callExpression as CallExpressionNode).arguments);
}

/**
 * Extract the identifier from a call expression's callee when present.
 *
 * @param callExpression Potential call expression node.
 * @returns The callee identifier when present, otherwise `null`.
 */
export function getCallExpressionIdentifier(
    callExpression: GameMakerAstNode | null | undefined
): IdentifierNode | null {
    if (!isNode(callExpression) || callExpression.type !== CALL_EXPRESSION) {
        return null;
    }

    const callee = (callExpression as CallExpressionNode).object;
    return isIdentifierNode(callee) ? callee : null;
}

/**
 * Extract the name of the function being called in a call expression.
 *
 * @param callExpression Potential call expression node.
 * @returns The callee's name when present and valid, otherwise `null`.
 */
export function getCallExpressionIdentifierName(callExpression: GameMakerAstNode | null | undefined): string | null {
    const identifier = getCallExpressionIdentifier(callExpression);
    return identifier !== null && typeof identifier.name === "string" ? identifier.name : null;
}

/**
 * Extract validated identifier metadata from `node`.
 *
 * @param node Candidate identifier node.
 * @returns A descriptor with the identifier and its name, or `null`.
 */
export function getIdentifierDetails(node: unknown): { identifier: IdentifierNode; name: string } | null {
    if (!isIdentifierNode(node)) {
        return null;
    }

    const name = resolveNodeName(node);
    return typeof name === "string" ? { identifier: node, name } : null;
}

/**
 * Extract the `name` field from an identifier node when present.
 *
 * @param node Potential identifier node.
 * @returns The identifier's `name` when available, otherwise `null`.
 */
export function getIdentifierName(node: GameMakerAstNode | null | undefined): string | null {
    const details = getIdentifierDetails(node);
    return details ? details.name : null;
}

/**
 * Extract the name of an identifier expression after unwrapping parenthesized layers.
 *
 * This helper is the canonical home for identifier-name checks that should not
 * depend on lint-rule or transform-specific modules. Math normalization used to
 * keep an equivalent predicate inline, but the logic is general AST traversal
 * behavior and belongs alongside the rest of Core's identifier helpers.
 *
 * @param node Candidate expression or identifier node.
 * @returns The unwrapped identifier name, or `null` when the expression is not
 *          ultimately an identifier.
 */
export function getUnwrappedIdentifierName(node: GameMakerAstNode | null | undefined): string | null {
    const expression = unwrapParenthesizedExpression(node);
    return expression ? getIdentifierName(expression) : null;
}

/**
 * Check whether `node` resolves to an identifier with the exact `name` after
 * unwrapping any parenthesized layers.
 *
 * @param node Candidate identifier expression.
 * @param name Expected identifier text.
 * @returns `true` when the unwrapped expression is an identifier named `name`.
 */
export function isUnwrappedIdentifierWithName(node: GameMakerAstNode | null | undefined, name: string): boolean {
    return getUnwrappedIdentifierName(node) === name;
}

/**
 * Check whether a call expression invokes a function with the expected name.
 *
 * @param callExpression Candidate call expression node.
 * @param expectedName Function name to match against.
 * @param options Optional configuration for case-sensitive matching.
 * @returns `true` when the call expression's callee matches `expectedName`.
 */
export function isCallExpressionIdentifierMatch(
    callExpression: GameMakerAstNode | null | undefined,
    expectedName: string,
    { caseInsensitive = false } = {}
): boolean {
    if (!isNonEmptyString(expectedName)) {
        return false;
    }

    const identifierName = getCallExpressionIdentifierName(callExpression);
    if (!identifierName) {
        return false;
    }

    return caseInsensitive
        ? identifierName.toLowerCase() === expectedName.toLowerCase()
        : identifierName === expectedName;
}

/**
 * Extract the name of a node when present.
 *
 * @param node Potential named node.
 * @returns The node's name when available, otherwise `null`.
 */
export function getNodeName(node: GameMakerAstNode | null | undefined): string | null {
    if (!node) {
        return null;
    }

    if ((node as { id?: unknown }).id !== undefined) {
        const idName = getIdentifierText((node as { id: GameMakerAstNode }).id);
        if (idName) {
            return idName;
        }
    }

    if ((node as { key?: unknown }).key !== undefined) {
        const keyName = getIdentifierText((node as { key: GameMakerAstNode }).key);
        if (keyName) {
            return keyName;
        }
    }

    return getIdentifierText(node);
}

/**
 * Inspect a member expression to extract property access information.
 *
 * @param left Potential member expression node to inspect.
 * @param identifierName Optional identifier name to match against.
 * @returns A descriptor object containing the property node and its start location.
 */
export function getStructPropertyAccess(
    left: GameMakerAstNode | null | undefined,
    identifierName?: string
): {
    propertyNode: GameMakerAstNode;
    propertyStart: number | GameMakerAstLocation | null | undefined;
} | null {
    if (!isNode(left)) {
        return null;
    }

    const object = (left as { object?: GameMakerAstNode }).object;
    if (!isIdentifierNode(object)) {
        return null;
    }

    if (identifierName !== undefined && object.name !== identifierName) {
        return null;
    }

    if (left.type === MEMBER_DOT_EXPRESSION && isNode(left.property)) {
        return {
            propertyNode: left.property,
            propertyStart: left.property?.start
        };
    }

    if (left.type === MEMBER_INDEX_EXPRESSION) {
        const propertyNode = getSingleMemberIndexPropertyEntry(left);
        if (!isNode(propertyNode)) {
            return null;
        }

        return {
            propertyNode,
            propertyStart: propertyNode?.start
        };
    }

    return null;
}
