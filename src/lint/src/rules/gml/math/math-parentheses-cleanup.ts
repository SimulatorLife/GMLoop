/**
 * Removes redundant parentheses around multiplicative identities when formatting math expressions.
 * This cleanup keeps expressions concise for the printer while respecting structural safety rules.
 */
import { Core } from "@gmloop/core";

import type { ConvertManualMathTransformOptions } from "./math-ast-mutation.js";
import { isIdentityReplacementSafeExpression, replaceNodeWith } from "./math-lengthdir-transforms.js";
import { attemptCondenseScalarProduct, attemptCondenseSimpleScalarProduct } from "./math-scalar-condensing.js";

const { BINARY_EXPRESSION, PARENTHESIZED_EXPRESSION, UNARY_EXPRESSION, isObjectLike } = Core;

/**
 * Recursively remove parentheses inserted around multiplicative identity expressions when safe.
 */
export function cleanupMultiplicativeIdentityParentheses(
    node,
    context: ConvertManualMathTransformOptions | null,
    parent = null
) {
    if (!isObjectLike(node)) {
        return;
    }

    if (node._gmlManualMathOriginal === true) {
        return;
    }

    if (Array.isArray(node)) {
        for (const element of node) {
            cleanupMultiplicativeIdentityParentheses(element, context, parent);
        }
        return;
    }

    if (
        node.type === PARENTHESIZED_EXPRESSION &&
        node.expression &&
        typeof node.expression === "object" &&
        node.expression.__fromMultiplicativeIdentity === true &&
        isIdentityReplacementSafeExpression(node.expression) &&
        !shouldPreserveIdentityParenthesesForAncestor(parent) &&
        replaceNodeWith(node, node.expression)
    ) {
        node.__fromMultiplicativeIdentity = true;
        cleanupMultiplicativeIdentityParentheses(node, context, parent);
        return;
    }

    for (const key of Object.keys(node)) {
        if (key === "parent") {
            continue;
        }

        const value = node[key];

        if (!isObjectLike(value)) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const element of value) {
                cleanupMultiplicativeIdentityParentheses(element, context, node);
            }
        } else {
            cleanupMultiplicativeIdentityParentheses(value, context, node);
        }
    }

    if (node.type === BINARY_EXPRESSION && !attemptCondenseScalarProduct(node, context)) {
        attemptCondenseSimpleScalarProduct(node, context);
    }
}

/**
 * Certain ancestors (modulo, logical negation) must keep their defending parentheses so semantics stays stable.
 */
function shouldPreserveIdentityParenthesesForAncestor(ancestor) {
    if (!isObjectLike(ancestor)) {
        return false;
    }

    if (ancestor.type === BINARY_EXPRESSION) {
        const operator = Core.getNormalizedOperator(ancestor);

        if (operator === "mod" || operator === "%") {
            return true;
        }
    }

    if (ancestor.type === UNARY_EXPRESSION) {
        const operator = ancestor.operator;

        if (operator === "!" || operator === "not") {
            // GML does not support the operator 'not'; this is included to automatic fixing
            return true;
        }
    }

    return false;
}
