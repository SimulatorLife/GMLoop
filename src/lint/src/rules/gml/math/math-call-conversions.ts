/**
 * Math simplification routines that recognise expression patterns and rewrite
 * them into GameMaker built-in function calls.
 *
 * Extracted from `math-traversal-normalization.ts` to reduce its line count
 * and to group all "convert an AST pattern into a recognised function call"
 * handlers in one focused module.
 *
 * The handlers in this file all follow the same shape: they inspect a binary
 * or call expression, decide whether it matches a known mathematical pattern
 * (e.g. `a*a` → `sqr(a)`, `ln(x) / ln(2)` → `log2(x)`, two-point vector
 * difference → `point_distance(…)`), and if so replace the node with the
 * matching GameMaker built-in call. They are registered with the simplifier
 * pipeline via the `BINARY_SIMPLIFIERS` and `CALL_SIMPLIFIERS` arrays in
 * `math-traversal-normalization.ts`.
 */
import { Core } from "@gmloop/core";

import {
    createBinaryExpressionNode,
    createCallExpressionNode,
    createNumericLiteral,
    mutateToCallExpression,
    replaceNode
} from "./math-ast-builders.js";
import type { ConvertManualMathTransformOptions } from "./math-ast-mutation.js";
import * as AST from "./math-ast-mutation.js";
import {
    collectProductOperands,
    isEulerLiteral,
    isHalfExponentLiteral,
    isLiteralNumber,
    isLnCall
} from "./math-numeric-utils.js";
import { areNodesApproximatelyEquivalent, areNodesEquivalent, collectAdditionTerms } from "./math-scalar-condensing.js";

const { BINARY_EXPRESSION, IDENTIFIER, MEMBER_DOT_EXPRESSION, MEMBER_INDEX_EXPRESSION } = Core;

/**
 * Convert a multiplication where one operand appears more than once into a
 * `sqr(operand)` call, e.g. `a*a` → `sqr(a)`. When the product has extra
 * factors the surviving factors are kept and `sqr(operand)` is multiplied
 * against them, e.g. `a*a*b` → `b*sqr(a)`.
 */
export function attemptConvertSquare(node: any, context: ConvertManualMathTransformOptions | null): boolean {
    if (!Core.isBinaryOperator(node, "*") || Core.hasComment(node)) {
        return false;
    }

    const rawLeft = node.left;
    const rawRight = node.right;

    if (!rawLeft || !rawRight) {
        return false;
    }

    if (Core.hasComment(rawLeft) || Core.hasComment(rawRight)) {
        return false;
    }

    const left = Core.unwrapParenthesizedExpression(rawLeft);
    const right = Core.unwrapParenthesizedExpression(rawRight);

    if (!left || !right) {
        return false;
    }

    if (Core.hasComment(left) || Core.hasComment(right)) {
        return false;
    }

    if (Core.hasInlineCommentBetween(rawLeft, rawRight, context)) {
        return false;
    }

    if (areNodesEquivalent(left, right) || areNodesApproximatelyEquivalent(left, right)) {
        if (!AST.isSafeOperand(left)) {
            return false;
        }

        mutateToCallExpression(node, "sqr", [Core.cloneAstNode(left)], node);
        AST.unwrapEnclosingParentheses(node, context);
        return true;
    }

    const factors: any[] = [];
    if (collectProductOperands(node, factors)) {
        for (let i = 0; i < factors.length; i++) {
            for (let j = i + 1; j < factors.length; j++) {
                const a = Core.unwrapParenthesizedExpression(factors[i]);
                const b = Core.unwrapParenthesizedExpression(factors[j]);
                if (a && b && areNodesEquivalent(a, b) && AST.isSafeOperand(a)) {
                    const remainingFactors = factors.filter((_, idx) => idx !== i && idx !== j);
                    const sqrNode = createCallExpressionNode("sqr", [Core.cloneAstNode(a)], node);

                    if (remainingFactors.length === 0) {
                        mutateToCallExpression(node, "sqr", [Core.cloneAstNode(a)], node);
                        return true;
                    }

                    let product = Core.cloneAstNode(remainingFactors[0]);
                    for (let k = 1; k < remainingFactors.length; k++) {
                        product = createBinaryExpressionNode(
                            "*",
                            product,
                            Core.cloneAstNode(remainingFactors[k]),
                            node
                        );
                    }
                    const result = createBinaryExpressionNode("*", product, sqrNode, node);

                    replaceNode(node, result);
                    return true;
                }
            }
        }
    }

    return false;
}

/**
 * Convert a chain of identical factors into a `power(base, count)` call,
 * e.g. `a*a*a` → `power(a, 3)`.
 */
export function attemptConvertRepeatedPower(node: any, context: ConvertManualMathTransformOptions | null): boolean {
    if (!Core.isBinaryOperator(node, "*") || Core.hasComment(node)) {
        return false;
    }

    const factors: any[] = [];
    if (!collectProductOperands(node, factors)) {
        return false;
    }

    if (factors.length <= 2) {
        return false;
    }

    const base = Core.unwrapParenthesizedExpression(factors[0]);
    if (!base || !AST.isSafeOperand(base)) {
        return false;
    }

    for (let index = 1; index < factors.length; index += 1) {
        const operand = Core.unwrapParenthesizedExpression(factors[index]);
        if (!areNodesEquivalent(base, operand)) {
            return false;
        }
    }

    const exponentLiteral = createNumericLiteral(factors.length, node);
    mutateToCallExpression(node, "power", [Core.cloneAstNode(base), exponentLiteral], node);
    AST.unwrapEnclosingParentheses(node, context);
    return true;
}

/**
 * Convert `(a + b) / 2` or `(a + b) * 0.5` patterns into `mean(a, b)`.
 */
export function attemptConvertMean(node: any, context: ConvertManualMathTransformOptions | null): boolean {
    if (Core.hasComment(node)) {
        return false;
    }

    const expression = Core.unwrapParenthesizedExpression(node);

    if (!expression || expression.type !== BINARY_EXPRESSION) {
        return false;
    }

    let addition;
    let divisor;

    if (expression.operator === "/") {
        addition = Core.unwrapParenthesizedExpression(expression.left);
        divisor = Core.unwrapParenthesizedExpression(expression.right);

        if (!isLiteralNumber(divisor, 2)) {
            return false;
        }
    } else if (expression.operator === "*") {
        const left = Core.unwrapParenthesizedExpression(expression.left);
        const right = Core.unwrapParenthesizedExpression(expression.right);

        if (isLiteralNumber(left, 0.5)) {
            addition = right;
        } else if (isLiteralNumber(right, 0.5)) {
            addition = left;
        } else {
            return false;
        }
    } else {
        return false;
    }

    if (!addition || addition.type !== BINARY_EXPRESSION) {
        return false;
    }

    if (Core.hasComment(addition)) {
        return false;
    }

    if (addition.operator !== "+") {
        return false;
    }

    const leftTerm = Core.unwrapParenthesizedExpression(addition.left);
    const rightTerm = Core.unwrapParenthesizedExpression(addition.right);

    if (!leftTerm || !rightTerm) {
        return false;
    }

    mutateToCallExpression(node, "mean", [Core.cloneAstNode(leftTerm), Core.cloneAstNode(rightTerm)], node);
    AST.unwrapEnclosingParentheses(node, context);
    return true;
}

/**
 * Convert `ln(x) / ln(2)` patterns into `log2(x)`.
 */
export function attemptConvertLog2(node: any, context: ConvertManualMathTransformOptions | null): boolean {
    if (!Core.isBinaryOperator(node, "/") || Core.hasComment(node)) {
        return false;
    }

    const numerator = Core.unwrapParenthesizedExpression(node.left);
    const denominator = Core.unwrapParenthesizedExpression(node.right);

    if (!isLnCall(numerator) || !isLnCall(denominator)) {
        return false;
    }

    const [numeratorArg] = numerator.arguments;
    const [denominatorArg] = denominator.arguments;

    if (!numeratorArg || !denominatorArg) {
        return false;
    }

    if (!isLiteralNumber(denominatorArg, 2)) {
        return false;
    }

    mutateToCallExpression(node, "log2", [Core.cloneAstNode(numeratorArg)], node);
    AST.unwrapEnclosingParentheses(node, context);
    return true;
}

/**
 * Convert a sum of pairwise multiplications of vector operands into
 * `dot_product(…)` or `dot_product_3d(…)`.
 */
export function attemptConvertDotProducts(node: any, context: ConvertManualMathTransformOptions | null): boolean {
    if (!Core.isBinaryOperator(node, "+") || Core.hasComment(node)) {
        return false;
    }

    const terms: any[] = [];
    collectAdditionTerms(node, terms);

    if (terms.length !== 2 && terms.length !== 3) {
        return false;
    }

    const leftVector: any[] = [];
    const rightVector: any[] = [];

    for (const term of terms) {
        const expr = Core.unwrapParenthesizedExpression(term);

        if (!Core.isBinaryOperator(expr, "*") || Core.hasComment(expr)) {
            return false;
        }

        const left = Core.unwrapParenthesizedExpression(expr.left);
        const right = Core.unwrapParenthesizedExpression(expr.right);

        if (!left || !right) {
            return false;
        }

        if (!isDotProductOperandCandidate(left) || !isDotProductOperandCandidate(right)) {
            return false;
        }

        leftVector.push(Core.cloneAstNode(left));
        rightVector.push(Core.cloneAstNode(right));
    }

    const functionName = terms.length === 2 ? "dot_product" : "dot_product_3d";

    mutateToCallExpression(node, functionName, [...leftVector, ...rightVector], node);
    AST.unwrapEnclosingParentheses(node, context);
    return true;
}

/**
 * True when `node` is an operand that can appear inside a `dot_product(…)`
 * call (a plain identifier or a member access on an array/struct).
 */
export function isDotProductOperandCandidate(node: any): boolean {
    if (!node || Core.hasComment(node)) {
        return false;
    }

    return node.type === IDENTIFIER || node.type === MEMBER_DOT_EXPRESSION || node.type === MEMBER_INDEX_EXPRESSION;
}

/**
 * Convert `sqrt((ax-bx)^2 + (ay-by)^2)` or `power((ax-bx)^2 + (ay-by)^2, 0.5)`
 * patterns into `point_distance(…)` or `point_distance_3d(…)`.
 */
export function attemptConvertPointDistanceCall(node: any, context: ConvertManualMathTransformOptions | null): boolean {
    if (Core.hasComment(node)) {
        return false;
    }

    const calleeName = Core.getUnwrappedIdentifierName(node.object);
    const callArguments = Core.getCallExpressionArguments(node);

    let distanceExpression;
    if (calleeName === "sqrt") {
        if (callArguments.length !== 1) {
            return false;
        }

        distanceExpression = callArguments[0];
    } else if (calleeName === "power") {
        if (callArguments.length !== 2) {
            return false;
        }

        const exponent = Core.unwrapParenthesizedExpression(callArguments[1]);
        if (!isHalfExponentLiteral(exponent)) {
            return false;
        }

        distanceExpression = callArguments[0];
    } else {
        return false;
    }

    const match = matchSquaredDifferences(distanceExpression);
    if (!match) {
        return false;
    }

    const args: any[] = [];
    for (const difference of match) {
        args.push(Core.cloneAstNode(difference.subtrahend));
    }
    for (const difference of match) {
        args.push(Core.cloneAstNode(difference.minuend));
    }

    const functionName = match.length === 2 ? "point_distance" : "point_distance_3d";

    mutateToCallExpression(node, functionName, args, node);
    AST.unwrapEnclosingParentheses(node, context);
    return true;
}

/**
 * Convert `power(x, 0.5)` into `sqrt(x)`.
 */
export function attemptConvertPowerToSqrt(node: any, context: ConvertManualMathTransformOptions | null): boolean {
    if (Core.hasComment(node)) {
        return false;
    }

    const calleeName = Core.getUnwrappedIdentifierName(node.object);
    if (calleeName !== "power") {
        return false;
    }

    const args = Core.getCallExpressionArguments(node);
    if (args.length !== 2) {
        return false;
    }

    const exponent = Core.unwrapParenthesizedExpression(args[1]);
    if (!isHalfExponentLiteral(exponent)) {
        return false;
    }

    mutateToCallExpression(node, "sqrt", [Core.cloneAstNode(args[0])], node);
    AST.unwrapEnclosingParentheses(node, context);
    return true;
}

/**
 * Convert `power(e, x)` patterns into `exp(x)`.
 */
export function attemptConvertPowerToExp(node: any, context: ConvertManualMathTransformOptions | null): boolean {
    if (Core.hasComment(node)) {
        return false;
    }

    const calleeName = Core.getUnwrappedIdentifierName(node.object);
    if (calleeName !== "power") {
        return false;
    }

    const args = Core.getCallExpressionArguments(node);
    if (args.length !== 2) {
        return false;
    }

    const base = Core.unwrapParenthesizedExpression(args[0]);
    const exponent = args[1];

    if (!isEulerLiteral(base)) {
        return false;
    }

    mutateToCallExpression(node, "exp", [Core.cloneAstNode(exponent)], node);
    AST.unwrapEnclosingParentheses(node, context);
    return true;
}

/**
 * Convert `arctan2(dy, dx)` where each argument is a subtraction into
 * `point_direction(x1, y1, x2, y2)`.
 */
export function attemptConvertPointDirection(node: any, context: ConvertManualMathTransformOptions | null): boolean {
    if (Core.hasComment(node)) {
        return false;
    }

    const calleeName = Core.getUnwrappedIdentifierName(node.object);
    if (calleeName !== "arctan2") {
        return false;
    }

    const args = Core.getCallExpressionArguments(node);
    if (args.length !== 2) {
        return false;
    }

    const dy = Core.unwrapParenthesizedExpression(args[0]);
    const dx = Core.unwrapParenthesizedExpression(args[1]);

    const dyDiff = matchDifference(dy);
    const dxDiff = matchDifference(dx);

    if (!dyDiff || !dxDiff) {
        return false;
    }

    mutateToCallExpression(
        node,
        "point_direction",
        [
            Core.cloneAstNode(dxDiff.subtrahend),
            Core.cloneAstNode(dyDiff.subtrahend),
            Core.cloneAstNode(dxDiff.minuend),
            Core.cloneAstNode(dyDiff.minuend)
        ],
        node
    );
    AST.unwrapEnclosingParentheses(node, context);
    return true;
}

/**
 * Recognise a sum-of-squared-differences pattern such as `(a-b)*(a-b) + (c-d)*(c-d)`.
 * Returns an array of `{ minuend, subtrahend }` records (length 2 or 3) on
 * success, or `null` if the expression is not a Euclidean-distance-style sum.
 */
export function matchSquaredDifferences(expression: any): Array<{ minuend: any; subtrahend: any }> | null {
    const terms: any[] = [];
    collectAdditionTerms(expression, terms);

    if (terms.length < 2 || terms.length > 3) {
        return null;
    }

    const differences: Array<{ minuend: any; subtrahend: any }> = [];

    for (const term of terms) {
        const product = Core.unwrapParenthesizedExpression(term);
        if (!Core.isBinaryOperator(product, "*") || Core.hasComment(product)) {
            return null;
        }

        const left = Core.unwrapParenthesizedExpression(product.left);
        const right = Core.unwrapParenthesizedExpression(product.right);

        if (!left || !right || (!areNodesEquivalent(left, right) && !areNodesApproximatelyEquivalent(left, right))) {
            return null;
        }

        const difference = matchDifference(left);
        if (!difference) {
            return null;
        }

        differences.push(difference);
    }

    if (differences.length < 2) {
        return null;
    }

    return differences;
}

/**
 * Recognise a binary subtraction expression and return its unwrapped
 * `{ minuend, subtrahend }` operands, or `null` if the input is not a
 * parenthesised binary `-` node.
 */
export function matchDifference(node: any): { minuend: any; subtrahend: any } | null {
    const expression = Core.unwrapParenthesizedExpression(node);

    if (!Core.isBinaryOperator(expression, "-")) {
        return null;
    }

    const minuend = Core.unwrapParenthesizedExpression(expression.left);
    const subtrahend = Core.unwrapParenthesizedExpression(expression.right);

    if (!minuend || !subtrahend) {
        return null;
    }

    return { minuend, subtrahend };
}
