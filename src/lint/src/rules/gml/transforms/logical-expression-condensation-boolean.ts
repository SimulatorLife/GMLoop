/**
 * Boolean expression ADT used by the logical-expression condensation pipeline.
 *
 * The condensation pass converts GML AST nodes that act as boolean
 * expressions into a small internal algebra ({@link BOOLEAN_NODE_TYPES}),
 * performs truth-table driven simplification on that algebra, and finally
 * renders the result back out as a GML AST. This module owns the ADT: the
 * discriminator enum, the constructor helpers, the canonical key used to
 * deduplicate terms, the predicate that classifies a GML AST node as a
 * boolean expression, and the `toBooleanExpression` walker that lowers AST
 * nodes into the ADT.
 *
 * Extracted from `logical-expression-condensation.ts` to keep the long-file
 * boundary under the 1000-line target. Behavior is preserved exactly; only
 * the source layout has changed.
 */
import { Core } from "@gmloop/core";

import { getAstNodeKey, isObjectLike } from "./logical-expression-condensation-key.js";

const { compactArray, getOrCreateMapEntry, isNode, toNormalizedLowerCaseString } = Core;

const BOOLEAN_NODE_TYPES = Object.freeze({
    CONST: "CONST",
    VAR: "VAR",
    NOT: "NOT",
    AND: "AND",
    OR: "OR"
});

/**
 * Classifies a GML AST node as a boolean-producing expression. When
 * `allowValueLiterals` is set, arithmetic and member-access expressions are
 * also accepted so the caller can use them as ternary operands.
 */
function isBooleanBranchExpression(node, allowValueLiterals = false) {
    if (!isObjectLike(node)) {
        return false;
    }

    switch (node.type) {
        case "Literal": {
            const { value } = node;
            if (typeof value === "boolean") {
                return true;
            }
            if (typeof value === "string") {
                const normalized = toNormalizedLowerCaseString(value);
                return normalized === "true" || normalized === "false";
            }
            return allowValueLiterals;
        }
        case "Identifier":
        case "MemberDotExpression":
        case "MemberIndexExpression":
        case "CallExpression": {
            return true;
        }
        case "ParenthesizedExpression": {
            return isBooleanBranchExpression(node.expression, allowValueLiterals);
        }
        case "UnaryExpression":
        case "IncDecExpression": {
            const operator = Core.getNormalizedOperator(node);
            if (operator === "!" || operator === "not") {
                // GML does not support the operator 'not'; this is included to automatic fixing
                return isBooleanBranchExpression(node.argument, allowValueLiterals);
            }
            if (allowValueLiterals && (operator === "+" || operator === "-")) {
                return isBooleanBranchExpression(node.argument, true);
            }
            return false;
        }
        case "BinaryExpression": {
            const operator = Core.getNormalizedOperator(node);

            if (Core.isLogicalBinaryOperator(operator)) {
                return (
                    isBooleanBranchExpression(node.left, allowValueLiterals) &&
                    isBooleanBranchExpression(node.right, allowValueLiterals)
                );
            }

            if (Core.isComparisonBinaryOperator(operator)) {
                return isBooleanBranchExpression(node.left, true) && isBooleanBranchExpression(node.right, true);
            }

            if (allowValueLiterals && (Core.isArithmeticBinaryOperator(operator) || operator === "**")) {
                return isBooleanBranchExpression(node.left, true) && isBooleanBranchExpression(node.right, true);
            }

            return false;
        }
        default: {
            return false;
        }
    }
}

function createBooleanLiteralAst(value) {
    return {
        type: "Literal",
        value: value ? "true" : "false",
        start: undefined,
        end: undefined
    };
}

function createBooleanConstant(value) {
    return { type: BOOLEAN_NODE_TYPES.CONST, value: !!value };
}

function createBooleanVariable(variable) {
    return { type: BOOLEAN_NODE_TYPES.VAR, variable };
}

function createBooleanNot(argument) {
    return { type: BOOLEAN_NODE_TYPES.NOT, argument };
}

function createBooleanAnd(terms) {
    return { type: BOOLEAN_NODE_TYPES.AND, terms: compactArray(terms) };
}

function createBooleanOr(terms) {
    return { type: BOOLEAN_NODE_TYPES.OR, terms: compactArray(terms) };
}

/**
 * Canonical-form string key for a boolean expression. The key is
 * order-insensitive for AND/OR (terms are sorted) so that two structurally
 * equivalent expressions always compare equal.
 */
function booleanExpressionKey(expression) {
    if (!expression) {
        return "";
    }

    switch (expression.type) {
        case BOOLEAN_NODE_TYPES.CONST: {
            return expression.value ? "1" : "0";
        }
        case BOOLEAN_NODE_TYPES.VAR: {
            return `v:${expression.variable.index}`;
        }
        case BOOLEAN_NODE_TYPES.NOT: {
            return `n:${booleanExpressionKey(expression.argument)}`;
        }
        case BOOLEAN_NODE_TYPES.AND: {
            const keys = expression.terms.map((term) => booleanExpressionKey(term)).toSorted();
            return `a:${keys.join(",")}`;
        }
        case BOOLEAN_NODE_TYPES.OR: {
            const keys = expression.terms.map((term) => booleanExpressionKey(term)).toSorted();
            return `o:${keys.join(",")}`;
        }
        default: {
            return "";
        }
    }
}

/**
 * A `BooleanContext` tracks the variables discovered while lowering AST
 * nodes into boolean expressions. Variables are deduplicated by AST-key so
 * the same identifier resolves to the same internal index in the truth
 * table.
 */
function createBooleanContext() {
    return {
        variables: [],
        variableMap: new Map()
    };
}

function registerVariable(node, context) {
    const key = getAstNodeKey(node);
    return getOrCreateMapEntry(context.variableMap, key, () => {
        const record = { index: context.variables.length, node };
        context.variables.push(record);
        return record;
    });
}

/**
 * Walks a GML AST node and produces the equivalent boolean expression. The
 * traversal recognises parenthesised expressions, boolean literals (including
 * the string forms `"true"` / `"false"`), logical unary / binary operators,
 * and the comparison / arithmetic shorthands. Anything that is not a known
 * boolean-producing expression is treated as a free variable so it can still
 * participate in truth-table evaluation.
 */
function toBooleanExpression(node, context) {
    if (!node) {
        return null;
    }

    if (node.type === "ParenthesizedExpression") {
        return toBooleanExpression(node.expression, context);
    }

    if (node.type === "Literal") {
        if (typeof node.value === "boolean") {
            return createBooleanConstant(node.value);
        }
        if (typeof node.value === "string") {
            const normalized = node.value.toLowerCase();
            if (normalized === "true") {
                return createBooleanConstant(true);
            }
            if (normalized === "false") {
                return createBooleanConstant(false);
            }
        }
    }

    if (
        isNode(node) &&
        (node.type === "Identifier" || node.type.startsWith("Member") || node.type === "CallExpression")
    ) {
        const variable = registerVariable(node, context);
        return createBooleanVariable(variable);
    }

    if (node.type === "UnaryExpression" || node.type === "IncDecExpression") {
        const operator = Core.getNormalizedOperator(node);
        if (operator === "!" || operator === "not") {
            // GML does not support the operator 'not'; this is included to automatic fixing
            const argumentExpr = toBooleanExpression(node.argument, context);
            if (!argumentExpr) {
                return null;
            }
            return createBooleanNot(argumentExpr);
        }
    }

    if (node.type === "BinaryExpression") {
        const operator = Core.getNormalizedOperator(node);
        if (Core.isLogicalAndOperator(operator)) {
            const left = toBooleanExpression(node.left, context);
            const right = toBooleanExpression(node.right, context);
            if (!left || !right) {
                return null;
            }
            return createBooleanAnd([left, right]);
        }
        if (Core.isLogicalOrOperator(operator)) {
            const left = toBooleanExpression(node.left, context);
            const right = toBooleanExpression(node.right, context);
            if (!left || !right) {
                return null;
            }
            return createBooleanOr([left, right]);
        }
    }

    const variable = registerVariable(node, context);
    return createBooleanVariable(variable);
}

export {
    BOOLEAN_NODE_TYPES,
    booleanExpressionKey,
    createBooleanAnd,
    createBooleanConstant,
    createBooleanContext,
    createBooleanLiteralAst,
    createBooleanNot,
    createBooleanOr,
    createBooleanVariable,
    isBooleanBranchExpression,
    registerVariable,
    toBooleanExpression
};
