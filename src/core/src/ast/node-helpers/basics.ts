import { hasComment } from "../../comments/comment-utils.js";
import { asArray, isNonEmptyArray } from "../../utils/array.js";
import { isNonEmptyString } from "../../utils/string.js";
import { BINARY_EXPRESSION, BLOCK_STATEMENT, PARENTHESIZED_EXPRESSION } from "../node-types.js";
import type { GameMakerAstNode, ParenthesizedExpressionNode } from "../types.js";

/**
 * Extract the sole statement from a block statement node when present and
 * optionally apply comment guards to ensure safe transformation.
 *
 * @param node Potential block statement node to inspect.
 * @param options Optional configuration for validation.
 * @param options.skipBlockCommentCheck When true, allows blocks with comments.
 * @param options.skipStatementCommentCheck When true, allows statements with comments.
 * @returns The single body statement when present and all guards pass, otherwise `null`.
 */
export function getSingleBodyStatement(
    node: GameMakerAstNode | null | undefined,
    {
        skipBlockCommentCheck = false,
        skipStatementCommentCheck = false
    }: {
        skipBlockCommentCheck?: boolean;
        skipStatementCommentCheck?: boolean;
    } = {}
): GameMakerAstNode | null {
    if (!node || node.type !== BLOCK_STATEMENT) {
        return null;
    }

    if (!skipBlockCommentCheck && hasComment(node)) {
        return null;
    }

    const statements = getBodyStatements(node);
    if (!Array.isArray(statements) || statements.length !== 1) {
        return null;
    }

    const [statement] = statements;
    if (!statement) {
        return null;
    }

    if (!skipStatementCommentCheck && hasComment(statement)) {
        return null;
    }

    return statement as GameMakerAstNode;
}

/**
 * Unwrap an expression statement to retrieve its inner expression.
 *
 * @param node Potential expression statement or expression node to unwrap.
 * @returns The inner expression when `node` is an ExpressionStatement, otherwise the original node.
 */
export function unwrapExpressionStatement(node: GameMakerAstNode | null | undefined): GameMakerAstNode | null {
    if (!node) {
        return null;
    }

    if (node.type === "ExpressionStatement") {
        const expressionNode = node as { expression?: unknown };
        return isNode(expressionNode.expression) ? expressionNode.expression : null;
    }

    return node;
}

/**
 * Check whether `node` has a specific node type.
 *
 * @param node Candidate value to inspect.
 * @param type Expected node type string.
 * @returns `true` when `node` has the specified type.
 */
export function hasType(node: unknown, type: string): node is Record<string, unknown> & { type: string } {
    return isNode(node) && (node as { type?: string }).type === type;
}

/**
 * Retrieve the `type` string from an AST node when present.
 *
 * @param node Candidate AST node-like value.
 * @returns The node's `type` when available, otherwise `null`.
 */
export function getNodeType(node?: unknown): string | null {
    if (!isNode(node)) {
        return null;
    }

    const { type } = node;
    return typeof type === "string" ? type : null;
}

/**
 * Check whether `value` is a valid AST node.
 *
 * @param value Candidate value to inspect.
 * @returns `true` when `value` is a non-null object.
 */
export function isNode(value: unknown): value is GameMakerAstNode {
    return value != null && typeof value === "object";
}

/**
 * Safely retrieve an array-valued property from an AST node.
 *
 * @param node Potential AST node to inspect.
 * @param propertyName Name of the array-valued property to retrieve.
 * @returns Normalized array of child nodes or an empty array when the property is missing.
 */
export function getArrayProperty(node: unknown, propertyName: string): readonly GameMakerAstNode[] {
    if (!isNode(node)) {
        return [];
    }

    if (!isNonEmptyString(propertyName)) {
        return [];
    }

    const astNode = node as Record<PropertyKey, unknown>;
    return asArray(astNode[propertyName] as GameMakerAstNode[] | null | undefined);
}

/**
 * Check whether an AST node's array-valued property contains any entries.
 *
 * @param node Potential AST node to inspect.
 * @param propertyName Name of the array-valued property to check.
 * @returns `true` when the property exists and contains at least one element.
 */
export function hasArrayPropertyEntries(node: unknown, propertyName: string): boolean {
    if (!isNode(node)) {
        return false;
    }

    if (!isNonEmptyString(propertyName)) {
        return false;
    }

    const astNode = node as Record<PropertyKey, unknown>;
    return isNonEmptyArray(astNode[propertyName]);
}

/**
 * Extract the statement list from a block statement or program node.
 *
 * @param node Potential block statement or program node.
 * @returns Array of body statements or an empty array when the body is missing.
 */
export function getBodyStatements(node: unknown): readonly GameMakerAstNode[] {
    if (!isNode(node)) {
        return [];
    }

    return asArray((node as { body?: unknown }).body);
}

/**
 * Check whether a node contains any body statements.
 *
 * @param node Potential block statement or program node.
 * @returns `true` when the node has at least one body statement.
 */
export function hasBodyStatements(node: unknown): boolean {
    return hasArrayPropertyEntries(node, "body");
}

/**
 * Determine whether `node` is a program or block statement.
 *
 * @param node Candidate value to inspect.
 * @returns `true` when `node` is either a `Program` or `BlockStatement`.
 */
export function isProgramOrBlockStatement(node: unknown): boolean {
    const nodeType = getNodeType(node);
    return nodeType === "Program" || nodeType === "BlockStatement";
}

/**
 * Determine whether `node` represents a function-like declaration or expression.
 *
 * @param node Potential function-like node.
 * @returns `true` when `node` is any function-like construct.
 */
const FUNCTION_LIKE_NODE_TYPES: ReadonlyArray<string> = Object.freeze([
    "FunctionDeclaration",
    "FunctionExpression",
    "LambdaExpression",
    "ConstructorDeclaration",
    "MethodDeclaration",
    "StructFunctionDeclaration",
    "StructDeclaration"
]);
const FUNCTION_LIKE_NODE_TYPE_SET = new Set(FUNCTION_LIKE_NODE_TYPES);
export function isFunctionLikeNode(node: GameMakerAstNode | null | undefined): boolean {
    const nodeType = getNodeType(node);
    return nodeType !== null && FUNCTION_LIKE_NODE_TYPE_SET.has(nodeType);
}

/**
 * Unwrap nested parenthesized expressions to reveal the inner expression.
 *
 * @param node Potential parenthesized expression or inner expression.
 * @returns The innermost non-parenthesized expression, or the original `node`.
 */
export function unwrapParenthesizedExpression(
    node: GameMakerAstNode | null | undefined
): GameMakerAstNode | null | undefined {
    let current = node;

    while (isNode(current) && current.type === PARENTHESIZED_EXPRESSION) {
        const expression = (current as ParenthesizedExpressionNode).expression;
        if (!isNode(expression)) {
            break;
        }

        current = expression;
    }

    return current;
}

/**
 * Extract and normalize the operator from an AST node.
 *
 * @param node AST node that may contain an operator property.
 * @returns Lowercase operator string, or `null` if missing.
 */
export function getNormalizedOperator(node: GameMakerAstNode | null | undefined): string | null {
    if (!node) {
        return null;
    }

    const operator = (node as { operator?: unknown }).operator;
    return typeof operator === "string" && operator.length > 0 ? operator.toLowerCase() : null;
}

/**
 * Check whether `node` is a binary expression with the specified operator.
 *
 * @param node Potential binary expression node.
 * @param operator Expected operator string.
 * @returns `true` when `node` is a binary expression using `operator`.
 */
export function isBinaryOperator(node: GameMakerAstNode | null | undefined, operator: string): boolean {
    return node?.type === BINARY_EXPRESSION && getNormalizedOperator(node) === operator;
}
