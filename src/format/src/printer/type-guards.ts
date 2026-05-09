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
 *
 * @param comment - The comment object to inspect.
 * @returns `true` if the comment is an inline empty block comment, `false` otherwise.
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
 *
 * @param node - The AST node to inspect.
 * @returns `true` if the call expression is simple and can be formatted compactly, `false` otherwise.
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
 * These nodes typically need indentation, line breaks, or other layout adjustments.
 *
 * @param node - The AST node to inspect as a call argument.
 * @returns `true` if the argument requires special formatting treatment, `false` otherwise.
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
 * Simple call arguments are identifiers, literals, member expressions, and certain
 * string values that don't require special indentation or line breaking.
 *
 * @param node - The AST node to inspect as a call argument.
 * @returns `true` if the node is a simple call argument, `false` otherwise.
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
 *
 * Callback arguments represent callable constructs that may need special
 * formatting treatment (indentation, line breaks) in function calls.
 *
 * @param argument - The AST node to inspect as a function call argument.
 * @returns `true` if the argument is a function, constructor, or struct expression, `false` otherwise.
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
 *
 * Numeric computation nodes include literals with numeric values, unary expressions
 * with +/- operators on numeric values, binary expressions with arithmetic operators,
 * parenthesized numeric expressions, and call expressions that return numbers.
 *
 * @param node - The AST node to inspect.
 * @returns `true` if the node represents a numeric computation, `false` otherwise.
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
 *
 * Used to detect when formatting code that appears within a constructor declaration
 * body, where certain formatting rules may apply differently.
 *
 * @param path - The AST path for traversal.
 * @returns `true` if the current node is inside a constructor function, `false` otherwise.
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
 * Returns `true` unconditionally. The GML formatter always strips redundant
 * synthetic parentheses because they are parser-inserted disambiguation
 * wrappers with no semantic or readability value in GML output. The decision
 * is purely layout-focused and owned exclusively by the formatter; no flag
 * from the parser or any external config is required. (target-state.md §2.1,
 * §3.2 – formatter owns layout-only canonicalization)
 */
export function isSyntheticParenFlatteningEnabled(_path: any): boolean {
    return true;
}

/**
 * Determines if the current node is in an l-value chain (left-hand side of assignment).
 *
 * L-value expressions appear on the left side of assignment operations and determine
 * what is being assigned to. This is important for parenthesization decisions where
 * synthetic parentheses around the left-hand side may affect parsing.
 *
 * @param path - The AST path for the node being checked.
 * @returns `true` if the node is in an l-value position, `false` otherwise.
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
 *
 * L-value expressions can appear on the left-hand side of assignments.
 * In GML, these include member index expressions (array access), call expressions
 * (function calls), and member dot expressions (property access).
 *
 * @param nodeType - The AST node type string to check.
 * @returns `true` if the node type is an l-value, `false` otherwise.
 */
export function isLValueExpression(nodeType: string): boolean {
    return nodeType === "MemberIndexExpression" || nodeType === "CallExpression" || nodeType === "MemberDotExpression";
}

/**
 * Determines if a node type is an expression that can be used in a single-line
 * `with` statement.
 *
 * Single-line `with` statements in GML only support certain expression types.
 * This guard identifies which node types are valid for `with (expr)` where
 * the block can remain on a single line.
 *
 * @param nodeType - The AST node type string to check.
 * @returns `true` if the node type can be used in a single-line `with` statement, `false` otherwise.
 */
export function isSingleLineWithExpression(nodeType: string): boolean {
    return (
        nodeType === "Identifier" ||
        nodeType === "CallExpression" ||
        nodeType === "MemberDotExpression" ||
        nodeType === "MemberIndexExpression"
    );
}

// ============================================================================
// Helper Functions (Internal)
// ============================================================================

/**
 * Determines if an expression produces a string-like value.
 *
 * String-like expressions include string literals, parenthesized string expressions,
 * concatenation with string operands, and calls to string conversion functions
 * (e.g., `string()`, `string_*` functions).
 *
 * @param node - The AST node to inspect.
 * @returns `true` if the expression produces a string-like value, `false` otherwise.
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
 *
 * Used to detect line breaks in comment whitespace or string content to determine
 * if formatting should treat a comment as inline or multi-line.
 *
 * @param text - The text string to check for line breaks.
 * @returns `true` if the text contains any line break character (`\r`, `\n`, `\u2028`, or `\u2029`), `false` otherwise.
 */
export function hasLineBreak(text: any): boolean {
    return typeof text === STRING_TYPE && /[\r\n\u2028\u2029]/.test(text);
}
