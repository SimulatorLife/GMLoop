/**
 * AST emission for the logical-expression condensation pipeline.
 *
 * Once the simplifier has produced the final boolean expression, this module
 * is responsible for rendering it back out as a GML AST. The rendering step
 * has two subtleties: AND groups must be parenthesised when their parent
 * operator is OR (so the precedence matches the original), and the resulting
 * source order should match the original so source-map and other line/column
 * information is preserved.
 *
 * Extracted from `logical-expression-condensation.ts` to keep the long-file
 * boundary under the 1000-line target. Behavior is preserved exactly; only
 * the source layout has changed.
 */
import { Core } from "@gmloop/core";

import { BOOLEAN_NODE_TYPES, createBooleanLiteralAst } from "./logical-expression-condensation-boolean.js";
import { isObjectLike } from "./logical-expression-condensation-key.js";

const { cloneAstNode, cloneLocation } = Core;

function wrapBinaryOperand(node, parentOperator, position) {
    if (!node || node.type !== "BinaryExpression") {
        return node;
    }

    const childOperator = node.operator;
    const shouldWrap = parentOperator === "&&" && childOperator === "||";

    if (!shouldWrap) {
        return node;
    }

    return {
        type: "ParenthesizedExpression",
        expression: node,
        start: cloneLocation(node.start),
        end: cloneLocation(node.end),
        synthetic: true,
        position
    };
}

function wrapUnaryArgument(node) {
    if (!node) {
        return node;
    }

    if (node.type !== "BinaryExpression" && node.type !== "LogicalExpression") {
        return node;
    }

    return {
        type: "ParenthesizedExpression",
        expression: node,
        start: cloneLocation(node.start),
        end: cloneLocation(node.end),
        synthetic: true
    };
}

function getNodeLocationIndex(node) {
    if (!isObjectLike(node)) {
        return Number.POSITIVE_INFINITY;
    }

    const start = node.start;
    if (typeof start === "number") {
        return start;
    }

    if (start && typeof start.index === "number") {
        return start.index;
    }

    return Number.POSITIVE_INFINITY;
}

function getBooleanExpressionSourceStart(expression, context) {
    if (!isObjectLike(expression)) {
        return Number.POSITIVE_INFINITY;
    }

    switch (expression.type) {
        case BOOLEAN_NODE_TYPES.VAR: {
            if (!context || !Array.isArray(context.variables)) {
                return Number.POSITIVE_INFINITY;
            }

            const variableRecord = context.variables[expression.variable?.index];
            return getNodeLocationIndex(variableRecord?.node);
        }
        case BOOLEAN_NODE_TYPES.NOT: {
            return getBooleanExpressionSourceStart(expression.argument, context);
        }
        case BOOLEAN_NODE_TYPES.AND:
        case BOOLEAN_NODE_TYPES.OR: {
            let earliest = Number.POSITIVE_INFINITY;
            for (const term of expression.terms ?? []) {
                const termStart = getBooleanExpressionSourceStart(term, context);
                if (termStart < earliest) {
                    earliest = termStart;
                }
            }
            return earliest;
        }
        case BOOLEAN_NODE_TYPES.CONST: {
            return getNodeLocationIndex(expression.node);
        }
        default: {
            return Number.POSITIVE_INFINITY;
        }
    }
}

function getBooleanOrTermPriority(expression) {
    if (!isObjectLike(expression)) {
        return 1;
    }

    return expression.type === BOOLEAN_NODE_TYPES.NOT ? 0 : 1;
}

function getOriginalBooleanTermIndex(orderMap, term) {
    if (!orderMap || !isObjectLike(term)) {
        return Number.MAX_SAFE_INTEGER;
    }

    const index = orderMap.get(term);
    return typeof index === "number" ? index : Number.MAX_SAFE_INTEGER;
}

function booleanExpressionToAst(expression, context) {
    switch (expression.type) {
        case BOOLEAN_NODE_TYPES.CONST: {
            return createBooleanLiteralAst(expression.value);
        }
        case BOOLEAN_NODE_TYPES.VAR: {
            return cloneAstNode(context.variables[expression.variable.index]?.node);
        }
        case BOOLEAN_NODE_TYPES.NOT: {
            const argumentAst = booleanExpressionToAst(expression.argument, context);
            if (!argumentAst) {
                return null;
            }
            return {
                type: "UnaryExpression",
                operator: "!",
                prefix: true,
                argument: wrapUnaryArgument(argumentAst),
                start: cloneLocation(argumentAst.start),
                end: cloneLocation(argumentAst.end)
            };
        }
        case BOOLEAN_NODE_TYPES.AND: {
            return buildBinaryAst("&&", expression.terms, context);
        }
        case BOOLEAN_NODE_TYPES.OR: {
            return buildBinaryAst("||", expression.terms, context);
        }
        default: {
            return null;
        }
    }
}

function buildBinaryAst(operator, terms, context) {
    if (terms.length === 0) {
        return null;
    }
    if (terms.length === 1) {
        return booleanExpressionToAst(terms[0], context);
    }

    let originalOrOrder = null;
    if (operator === "||") {
        originalOrOrder = new WeakMap();
        for (const [index, term] of terms.entries()) {
            if (term && typeof term === "object") {
                originalOrOrder.set(term, index);
            }
        }
    }

    const orderedTerms =
        operator === "||"
            ? [...terms].toSorted((left, right) => {
                  const leftPriority = getBooleanOrTermPriority(left);
                  const rightPriority = getBooleanOrTermPriority(right);
                  if (leftPriority !== rightPriority) {
                      return leftPriority - rightPriority;
                  }

                  const leftStart = getBooleanExpressionSourceStart(left, context);
                  const rightStart = getBooleanExpressionSourceStart(right, context);
                  if (leftStart !== rightStart) {
                      return leftStart - rightStart;
                  }

                  const leftIndex = getOriginalBooleanTermIndex(originalOrOrder, left);
                  const rightIndex = getOriginalBooleanTermIndex(originalOrOrder, right);
                  return leftIndex - rightIndex;
              })
            : terms;

    let current = booleanExpressionToAst(orderedTerms[0], context);
    for (let index = 1; index < orderedTerms.length; index++) {
        const right = booleanExpressionToAst(orderedTerms[index], context);
        if (!current || !right) {
            return null;
        }
        current = {
            type: "BinaryExpression",
            operator,
            left: wrapBinaryOperand(current, operator, "left"),
            right: wrapBinaryOperand(right, operator, "right"),
            start: cloneLocation(current.start),
            end: cloneLocation(right.end)
        };
    }

    return current;
}

export {
    booleanExpressionToAst,
    buildBinaryAst,
    getBooleanExpressionSourceStart,
    getBooleanOrTermPriority,
    getNodeLocationIndex,
    getOriginalBooleanTermIndex,
    wrapBinaryOperand,
    wrapUnaryArgument
};
