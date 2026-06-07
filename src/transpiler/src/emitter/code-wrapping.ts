/**
 * Code formatting utilities for wrapping statements and expressions in the transpiler.
 *
 * This module provides functions for formatting GML statements and expressions
 * into well-formed JavaScript code blocks, handling edge cases like empty bodies,
 * block statements vs single statements, and semicolon insertion.
 */

import type { GmlNode } from "./ast.js";
import { ensureStatementTerminated } from "./statement-termination-policy.js";
import { isBlockStatementNode, isParenthesizedExpressionNode } from "./type-guards.js";

/**
 * Wraps an expression in parentheses for use in conditionals (if, while, etc.).
 *
 * If the node is already a parenthesized expression, unwraps it first to avoid
 * double-wrapping. The `raw` parameter controls whether to return just the
 * expression or wrap it in parentheses.
 *
 * @param node - The AST node to wrap, or null/undefined for empty expressions
 * @param visitor - Visitor function to emit code for child nodes
 * @param raw - If true, returns the expression without wrapping in parens
 * @returns The formatted conditional expression
 *
 * @example
 * ```typescript
 * // With raw=false (default for if/while test expressions)
 * wrapConditional(binaryNode, visit)  // → "(x > 5)"
 *
 * // With raw=true (for extracting expression value)
 * wrapConditional(binaryNode, visit, true)  // → "x > 5"
 *
 * // Null node handling
 * wrapConditional(null, visit)  // → "(undefined)"
 * wrapConditional(null, visit, true)  // → ""
 * ```
 */
export function wrapConditional(
    node: GmlNode | null | undefined,
    visitor: (n: GmlNode) => string,
    raw = false
): string {
    if (!node) {
        return raw ? "" : "(undefined)";
    }
    const expression = isParenthesizedExpressionNode(node) ? visitor(node.expression) : visitor(node);
    return raw ? expression : `(${expression})`;
}

/**
 * Wraps a statement node in a block body suitable for control flow statements.
 *
 * Handles three cases:
 * 1. Null/undefined → empty block `{ }`
 * 2. BlockStatement → use as-is with leading space
 * 3. Single statement → wrap in block with a required terminator
 *
 * @param node - The statement node to wrap
 * @param visitor - Visitor function to emit code for the statement
 * @returns The formatted block body with leading space
 *
 * @example
 * ```typescript
 * // Empty body
 * wrapConditionalBody(null, visit)  // → " {\n}\n"
 *
 * // Block statement (already has braces)
 * wrapConditionalBody(blockNode, visit)  // → " {\n  x = 1;\n}"
 *
 * // Single statement (needs wrapping)
 * wrapConditionalBody(exprNode, visit)  // → " {\nx = 1;\n}"
 * ```
 */
export function wrapConditionalBody(node: GmlNode | null | undefined, visitor: (n: GmlNode) => string): string {
    if (!node) {
        return " {\n}\n";
    }
    if (isBlockStatementNode(node)) {
        return ` ${visitor(node)}`;
    }
    const statement = ensureStatementTerminated(visitor(node));
    return ` {\n${statement}\n}`;
}

/**
 * Wraps a statement node in a raw block (used for `with` statement lowering).
 *
 * Similar to `wrapConditionalBody` but returns a raw block without leading
 * space and uses `.trim()` to clean up formatting.
 *
 * @param node - The statement node to wrap
 * @param visitor - Visitor function to emit code for the statement
 * @returns The formatted block body without leading space
 *
 * @example
 * ```typescript
 * // Empty body
 * wrapRawBody(null, visit)  // → "{\n}\n"
 *
 * // Block statement
 * wrapRawBody(blockNode, visit)  // → "{\n  x = 1;\n}"
 *
 * // Single statement
 * wrapRawBody(exprNode, visit)  // → "{\nx = 1;\n}"
 * ```
 */
export function wrapRawBody(node: GmlNode | null | undefined, visitor: (n: GmlNode) => string): string {
    if (!node) {
        return "{\n}\n";
    }
    if (isBlockStatementNode(node)) {
        return visitor(node);
    }
    const statement = ensureStatementTerminated(visitor(node));
    return `\n{\n${statement}\n}`.trim();
}
