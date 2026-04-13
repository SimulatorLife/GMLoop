/**
 * Type guard and predicate functions for the GML printer.
 *
 * This module contains type guards and predicates that help classify AST nodes,
 * comments, and expressions during the printing process. These helpers were extracted
 * from print.ts to improve code organization and maintainability.
 *
 * @module printer/type-guards
 */

import { Core } from "@gmloop/core";

import { safeGetParentNode } from "./path-utils.js";

// Re-export type constants for convenience
const STRING_TYPE = "string";
const NUMBER_TYPE = "number";
const OBJECT_TYPE = "object";
const UNDEFINED_TYPE = "undefined";

/**
 * Set of node types considered simple call arguments for formatting purposes.
 */
const SIMPLE_CALL_ARGUMENT_TYPES = new Set([
    "Identifier",
    "Literal",
    "MemberDotExpression",
    "MemberIndexExpression",
    "ThisExpression",
    "BooleanLiteral",
    "UndefinedLiteral"
]);

// ============================================================================
// Comment Type Guards
// ============================================================================

/**
 * Determines if a comment is an inline empty block comment.
 *
 * An inline empty block comment is a block comment that:
 * - Does not have line breaks in its leading or trailing whitespace
 * - Consists of a single line
 * - Does not have line breaks in its content
 */
export function isInlineEmptyBlockComment(comment: any): boolean {
    if (!comment || comment.type !== "CommentBlock") {
        return false;
    }

    if (hasLineBreak(comment.leadingWS) || hasLineBreak(comment.trailingWS)) {
        return false;
    }

    if (typeof comment.lineCount === NUMBER_TYPE && comment.lineCount > 1) {
        return false;
    }

    if (typeof comment.value === STRING_TYPE && hasLineBreak(comment.value)) {
        return false;
    }

    return true;
}

// ============================================================================
// Call Expression Type Guards
// ============================================================================

/**
 * Determines if a call expression is "simple" for formatting purposes.
 *
 * A simple call expression:
 * - Has an identifier as the callee
 * - Has zero arguments, OR exactly one simple argument without comments
 */
export function isSimpleCallExpression(node: any): boolean {
    if (!node || node.type !== "CallExpression") {
        return false;
    }

    if (!Core.getCallExpressionIdentifier(node)) {
        return false;
    }

    const args = Core.getCallExpressionArguments(node);
    if (args.length === 0) {
        return true;
    }

    if (args.length > 1) {
        return false;
    }

    const [onlyArgument] = args;
    const argumentType = Core.getNodeType(onlyArgument);

    if (
        argumentType === "FunctionDeclaration" ||
        argumentType === "StructExpression" ||
        argumentType === "CallExpression"
    ) {
        return false;
    }

    if (Core.hasComment(onlyArgument)) {
        return false;
    }

    return true;
}

/**
 * Determines if an argument node is complex (requires special formatting).
 *
 * Complex arguments include functions, constructors, structs, and non-simple call expressions.
 */
export function isComplexArgumentNode(node: any): boolean {
    const nodeType = Core.getNodeType(node);
    if (!nodeType) {
        return false;
    }

    if (nodeType === "CallExpression") {
        return !isSimpleCallExpression(node);
    }

    return (
        nodeType === "FunctionDeclaration" ||
        nodeType === "FunctionExpression" ||
        nodeType === "ConstructorDeclaration" ||
        nodeType === "StructExpression"
    );
}

/**
 * Determines if a node is a simple call argument.
 *
 * Simple call arguments are identifiers, literals, member expressions, etc.
 * that don't require special indentation or breaking.
 */
export function isSimpleCallArgument(node: any): boolean {
    const nodeType = Core.getNodeType(node);
    if (!nodeType) {
        return false;
    }

    if (isComplexArgumentNode(node)) {
        return false;
    }

    if (SIMPLE_CALL_ARGUMENT_TYPES.has(nodeType)) {
        return true;
    }

    if (nodeType === "Literal" && typeof node.value === STRING_TYPE) {
        const literalValue = node.value.toLowerCase();
        if (literalValue === UNDEFINED_TYPE || literalValue === "noone") {
            return true;
        }
    }

    return false;
}

/**
 * Determines if an argument is a callback (function/constructor/struct).
 */
export function isCallbackArgument(argument: any): boolean {
    const argumentType = argument?.type;
    return (
        argumentType === "FunctionDeclaration" ||
        argumentType === "FunctionExpression" ||
        argumentType === "ConstructorDeclaration" ||
        argumentType === "StructExpression"
    );
}

/**
 * Determines if a node represents a numeric computation.
 */
export function isNumericComputationNode(node: any): boolean {
    if (!node || typeof node !== OBJECT_TYPE) {
        return false;
    }

    switch (node.type) {
        case "Literal": {
            return typeof node.value === NUMBER_TYPE || /^-?\d+(\.\d+)?$/.test(node.value);
        }
        case "UnaryExpression": {
            if (node.operator === "-" || node.operator === "+") {
                return isNumericComputationNode(node.argument);
            }

            return false;
        }
        case "BinaryExpression": {
            const isArithmetic =
                node.operator === "+" ||
                node.operator === "-" ||
                node.operator === "*" ||
                node.operator === "/" ||
                node.operator === "div" ||
                node.operator === "%" ||
                node.operator === "mod";

            if (!isArithmetic) {
                return false;
            }

            return isNumericComputationNode(node.left) && isNumericComputationNode(node.right);
        }
        case "ParenthesizedExpression": {
            return isNumericComputationNode(node.expression);
        }
        case "CallExpression": {
            if (expressionIsStringLike(node)) {
                return false;
            }

            return true;
        }
        default: {
            return false;
        }
    }
}

// ============================================================================
// Context-Aware Type Guards (require path)
// ============================================================================

/**
 * Determines if the current node is inside a constructor function.
 */
export function isInsideConstructorFunction(path: any): boolean {
    if (!path || typeof path.getParentNode !== "function") {
        return false;
    }

    let foundEnclosingFunctionDeclaration = false;

    for (let depth = 0; ; depth += 1) {
        const ancestor = safeGetParentNode(path, depth);
        if (!ancestor || ancestor.type === "Program") {
            return false;
        }

        if (ancestor.type === "FunctionDeclaration") {
            const functionParent = safeGetParentNode(path, depth + 1);
            if (!functionParent || functionParent.type !== "BlockStatement") {
                return false;
            }

            foundEnclosingFunctionDeclaration = true;
            continue;
        }

        if (ancestor.type === "ConstructorDeclaration") {
            return foundEnclosingFunctionDeclaration;
        }
    }
}

/**
 * Checks if synthetic parenthesis flattening is enabled in the current context.
 */
export function isSyntheticParenFlatteningEnabled(path: any): boolean {
    return checkSyntheticParenFlattening(path);
}

/**
 * Determines if the current node is in an l-value chain (left-hand side of assignment).
 */
export function isInLValueChain(path: any): boolean {
    if (!path || typeof path.getParentNode !== "function") {
        return false;
    }

    const node = path.getValue();
    const parent = safeGetParentNode(path);

    if (!parent || typeof parent.type !== STRING_TYPE) {
        return false;
    }

    if (parent.type === "CallExpression" && Array.isArray(parent.arguments) && parent.arguments.includes(node)) {
        return false;
    }

    if (parent.type === "CallExpression" && parent.object === node) {
        const grandparent = path.getParentNode(1);

        if (!grandparent || typeof grandparent.type !== STRING_TYPE) {
            return false;
        }

        return isLValueExpression(grandparent.type);
    }

    return isLValueExpression(parent.type);
}

// ============================================================================
// Simple Predicates
// ============================================================================

/**
 * Determines if a node type represents an l-value expression.
 */
export function isLValueExpression(nodeType: string): boolean {
    return nodeType === "MemberIndexExpression" || nodeType === "CallExpression" || nodeType === "MemberDotExpression";
}

// ============================================================================
// Helper Functions (Internal)
// ============================================================================

/**
 * Checks if synthetic parenthesis flattening is configured in the AST.
 *
 * @internal
 */
function checkSyntheticParenFlattening(path: any): boolean {
    let depth = 1;
    while (true) {
        const ancestor = safeGetParentNode(path, depth - 1);

        if (!ancestor) {
            return false;
        }

        if (ancestor.type === "FunctionDeclaration" || ancestor.type === "ConstructorDeclaration") {
            if (ancestor._flattenSyntheticNumericParens === true) {
                return true;
            }
        } else if (ancestor.type === "Program") {
            return ancestor._flattenSyntheticNumericParens === true;
        }

        depth += 1;
    }
}

/**
 * Determines if an expression produces a string-like value.
 */
export function expressionIsStringLike(node: any): boolean {
    if (!node || typeof node !== OBJECT_TYPE) {
        return false;
    }

    if (node.type === "Literal") {
        if (typeof node.value === STRING_TYPE && /^".*"$/.test(node.value)) {
            return true;
        }

        return false;
    }

    if (node.type === "ParenthesizedExpression") {
        return expressionIsStringLike(node.expression);
    }

    if (node.type === "BinaryExpression" && node.operator === "+") {
        return expressionIsStringLike(node.left) || expressionIsStringLike(node.right);
    }

    if (node.type === "CallExpression") {
        const calleeName = Core.getIdentifierText(node.object);
        if (typeof calleeName === STRING_TYPE) {
            const normalized = calleeName.toLowerCase();
            if (normalized === STRING_TYPE || normalized.startsWith("string_")) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Checks if text contains any line break characters.
 */
export function hasLineBreak(text: any): boolean {
    return typeof text === STRING_TYPE && /[\r\n\u2028\u2029]/.test(text);
}
