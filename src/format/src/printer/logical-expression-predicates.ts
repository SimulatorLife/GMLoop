import { Core } from "@gmloop/core";

/**
 * Determines if a node is a logical comparison clause pattern.
 */
export function isLogicalComparisonClause(node: any): boolean {
    const clauseExpression = Core.unwrapParenthesizedExpression(node);
    if (clauseExpression?.type !== "BinaryExpression") {
        return false;
    }

    if (!Core.isLogicalOrOperator(clauseExpression.operator)) {
        return false;
    }

    return isComparisonAndConjunction(clauseExpression.left) && isComparisonAndConjunction(clauseExpression.right);
}

function isComparisonAndConjunction(node: any): boolean {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (expression?.type !== "BinaryExpression") {
        return false;
    }

    if (!Core.isLogicalAndOperator(expression.operator)) {
        return false;
    }

    if (!isComparisonExpression(expression.left)) {
        return false;
    }

    return isSimpleLogicalOperand(expression.right);
}

function isComparisonExpression(node: any): boolean {
    const expression = Core.unwrapParenthesizedExpression(node);
    return expression?.type === "BinaryExpression" && Core.isComparisonBinaryOperator(expression.operator);
}

function isSimpleLogicalOperand(node: any): boolean {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression) {
        return false;
    }

    if (expression.type === "Identifier") {
        return true;
    }

    if (expression.type === "Literal") {
        return true;
    }

    if (expression.type === "UnaryExpression") {
        return isSimpleLogicalOperand(expression.argument);
    }

    return isComparisonExpression(expression);
}
