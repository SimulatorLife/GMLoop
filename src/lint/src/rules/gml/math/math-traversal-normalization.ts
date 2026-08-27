/**
 * Collection of helper routines that reshape math-heavy AST fragments into a normalized form.
 * This includes simplifications, constant conversions, and traversal-safe replacements so the printer emits consistent expressions.
 *
 * Implementation is split across several focused modules:
 *   - math-numeric-utils.ts       – pure numeric/literal evaluation helpers
 *   - math-ast-builders.ts        – AST node creation and mutation helpers
 *   - math-trig-conversions.ts    – trigonometric and angle-conversion simplifiers
 *   - math-call-conversions.ts    – expression-pattern-to-built-in-call simplifiers
 *                                  (sqr, power, sqrt, exp, mean, log2, dot_product, point_*)
 *   - math-ast-mutation.ts        – AST tree-walking, node-lookup, and structural mutation helpers
 *                                  (original-expression cloning, alias removal, blank-line preservation,
 *                                  zero-division simplification)
 */

import { Core } from "@gmloop/core";

import {
    createCallExpressionNode,
    createMultiplicationNode,
    createNumericLiteral,
    replaceNode,
    replaceNodeWith as replaceNodeByMutation
} from "./math-ast-builders.js";
import type { ConvertManualMathTransformOptions } from "./math-ast-mutation.js";
import * as AST from "./math-ast-mutation.js";
import {
    attemptConvertDotProducts,
    attemptConvertLog2,
    attemptConvertMean,
    attemptConvertPointDirection,
    attemptConvertPointDistanceCall,
    attemptConvertPowerToExp,
    attemptConvertPowerToSqrt,
    attemptConvertRepeatedPower,
    attemptConvertSquare
} from "./math-call-conversions.js";
import {
    attemptConvertLengthDir,
    isIdentityReplacementSafeExpression,
    matchScaledOperand
} from "./math-lengthdir-transforms.js";
import { DEFAULT_MATH_NUMERIC_POLICY } from "./math-numeric-policy.js";
import {
    computeNumericTolerance,
    evaluateOneMinusNumeric,
    isNegativeOneFactor,
    isNumericZeroLiteral,
    normalizeNumericCoefficient,
    parseNumericFactor
} from "./math-numeric-utils.js";
import {
    areNodesEquivalent,
    attemptCollectDistributedScalars,
    attemptCondenseNumericChainWithMultipleBases,
    attemptCondenseScalarProduct,
    buildReciprocalRatioRemovalPlan,
    buildReciprocalRatioReplacement,
    buildRemainingRatioTerms,
    collectMultiplicativeChain,
    collectReciprocalRatioTerms,
    combineLengthdirScalarAssignments
} from "./math-scalar-condensing.js";
import {
    attemptConvertDegreesToRadians as simplifyDegreesToRadians,
    attemptSimplifyTrigonometricCall
} from "./math-trig-conversions.js";

const {
    ASSIGNMENT_EXPRESSION,
    BINARY_EXPRESSION,
    CALL_EXPRESSION,
    EXPRESSION_STATEMENT,
    LITERAL,
    PARENTHESIZED_EXPRESSION,
    isObjectLike
} = Core;

const MIN_SAFE_DIVISOR = DEFAULT_MATH_NUMERIC_POLICY.minSafeDivisor;
const MAX_SAFE_RECIPROCAL = DEFAULT_MATH_NUMERIC_POLICY.maxSafeReciprocal;

export function applyManualMathNormalization(ast: any, context: ConvertManualMathTransformOptions | null = null) {
    if (!isObjectLike(ast)) {
        return ast;
    }

    const traversalContext = AST.normalizeTraversalContext(ast, context);

    traverse(ast, new Set(), traversalContext);
    combineLengthdirScalarAssignments(ast);

    return ast;
}

type SimplificationHandler = (node: any, context: ConvertManualMathTransformOptions | null) => boolean;

const BINARY_SIMPLIFIERS: SimplificationHandler[] = [
    attemptSimplifyOneMinusFactor,
    attemptRemoveMultiplicativeIdentity,
    attemptReplaceMultiplicationWithZero,
    attemptRemoveAdditiveIdentity,
    simplifyDegreesToRadians,
    attemptSimplifyDivisionByReciprocal,
    attemptCancelReciprocalRatios,
    attemptSimplifyNegativeDivisionProduct,
    attemptCondenseScalarProduct,
    attemptCondenseNumericChainWithMultipleBases,
    attemptCollectDistributedScalars,
    attemptSimplifyLengthdirHalfDifference,
    attemptConvertRepeatedPower,
    attemptConvertSquare,
    attemptConvertMean,
    attemptConvertLog2,
    attemptConvertLengthDir,
    attemptConvertDotProducts
];

const ASSIGNMENT_SIMPLIFIERS: SimplificationHandler[] = [attemptRemoveMultiplicativeIdentityAssignment];

const CALL_SIMPLIFIERS: SimplificationHandler[] = [
    attemptConvertPointDistanceCall,
    attemptConvertPowerToSqrt,
    attemptConvertPowerToExp,
    attemptConvertPointDirection,
    attemptSimplifyTrigonometricCall
];

function applySimplifiers(
    node: any,
    context: ConvertManualMathTransformOptions | null,
    simplifiers: SimplificationHandler[]
) {
    return simplifiers.some((simplifier) => simplifier(node, context));
}

/**
 * DFS that repeatedly applies all available math simplification rules until the node stabilizes.
 */
function traverse(node, seen, context, parent = null) {
    if (!isObjectLike(node)) {
        return;
    }

    if (parent && !node.parent && !Array.isArray(node)) {
        Object.defineProperty(node, "parent", {
            value: parent,
            enumerable: false,
            configurable: true
        });
    }

    if (node._gmlManualMathOriginal === true) {
        return;
    }

    if (seen.has(node)) {
        return;
    }

    seen.add(node);

    if (Array.isArray(node)) {
        for (const element of node) {
            traverse(element, seen, context, parent);
        }
        return;
    }

    let changed = true;
    let iterations = 0;
    while (changed && iterations < 1000) {
        changed = false;
        iterations++;

        if (node.type === BINARY_EXPRESSION && applySimplifiers(node, context, BINARY_SIMPLIFIERS)) {
            changed = true;
            continue;
        }

        if (node.type === ASSIGNMENT_EXPRESSION && applySimplifiers(node, context, ASSIGNMENT_SIMPLIFIERS)) {
            changed = true;
            continue;
        }

        if (node.type === CALL_EXPRESSION && applySimplifiers(node, context, CALL_SIMPLIFIERS)) {
            changed = true;
            continue;
        }

        for (const key of Object.keys(node)) {
            if (key === "parent") {
                continue;
            }
            const value = node[key];
            if (!isObjectLike(value)) {
                continue;
            }

            traverse(value, seen, context, node);
        }
    }
}

function attemptSimplifyOneMinusFactor(node, context) {
    if (!Core.isBinaryOperator(node, "*")) {
        return false;
    }

    let modified = false;

    if (simplifyOneMinusOperand(node, "left", context)) {
        modified = true;
    }

    if (simplifyOneMinusOperand(node, "right", context)) {
        modified = true;
    }

    return modified;
}

function simplifyOneMinusOperand(node, key, context) {
    const rawOperand = node[key];
    if (!rawOperand || Core.hasComment(rawOperand)) {
        return false;
    }

    const expression = Core.unwrapParenthesizedExpression(rawOperand);
    if (!expression || Core.hasComment(expression)) {
        return false;
    }

    if (Core.hasInlineCommentBetween(node.left, node.right, context)) {
        return false;
    }

    if (
        context &&
        expression.type === BINARY_EXPRESSION &&
        Core.hasInlineCommentBetween(expression.left, expression.right, context)
    ) {
        return false;
    }

    const numericValue = evaluateOneMinusNumeric(expression);
    if (numericValue === null || !Number.isFinite(numericValue)) {
        return false;
    }

    const normalizedValue = normalizeNumericCoefficient(numericValue);
    if (normalizedValue === null) {
        return false;
    }

    if (expression.type === LITERAL && String(expression.value) === normalizedValue) {
        return false;
    }

    const literal = createNumericLiteral(normalizedValue, rawOperand);
    if (!literal) {
        return false;
    }

    node[key] = literal;
    return true;
}

function attemptRemoveMultiplicativeIdentity(node, context) {
    if (!Core.isBinaryOperator(node, "*")) {
        return false;
    }

    if (Core.hasInlineCommentBetween(node.left, node.right, context)) {
        return false;
    }

    return (
        removeMultiplicativeIdentityOperand(node, "left", "right", context) ||
        removeMultiplicativeIdentityOperand(node, "right", "left", context)
    );
}

function attemptReplaceMultiplicationWithZero(node, context) {
    if (!Core.isBinaryOperator(node, "*")) {
        return false;
    }

    if (Core.hasInlineCommentBetween(node.left, node.right, context)) {
        return false;
    }

    if (replaceMultiplicationWithZeroOperand(node, "left", "right", context)) {
        return true;
    }

    if (replaceMultiplicationWithZeroOperand(node, "right", "left", context)) {
        return true;
    }

    return false;
}

function removeMultiplicativeIdentityOperand(node, key, otherKey, context) {
    const operand = node[key];
    const other = node[otherKey];

    if (!operand || !other) {
        return false;
    }

    if (Core.hasComment(operand) || Core.hasComment(other)) {
        return false;
    }

    const expression = Core.unwrapParenthesizedExpression(operand);
    if (!expression) {
        return false;
    }

    const value = Core.getLiteralNumberValue(expression);
    if (value === null) {
        return false;
    }

    if (Math.abs(value - 1) > computeNumericTolerance(1)) {
        return false;
    }

    const sanitizedOperand = AST.isSafeOperand(other) ? Core.unwrapParenthesizedExpression(other) : other;

    const replacement = Core.cloneAstNode(sanitizedOperand);
    if (!replaceNodeByMutation(node, replacement)) {
        return false;
    }

    node.__fromMultiplicativeIdentity = true;
    unwrapIdentityReplacementResult(node);
    AST.unwrapEnclosingParentheses(node, context);

    return true;
}

function unwrapIdentityReplacementResult(node) {
    while (
        node &&
        node.type === PARENTHESIZED_EXPRESSION &&
        node.expression &&
        isIdentityReplacementSafeExpression(node.expression)
    ) {
        const nextNode = node.expression;
        if (!replaceNodeByMutation(node, nextNode)) {
            break;
        }

        node = nextNode;
        node.__fromMultiplicativeIdentity = true;
    }
}

function replaceMultiplicationWithZeroOperand(node, key, otherKey, context) {
    const operand = node[key];
    const other = node[otherKey];

    if (!operand || !other) {
        return false;
    }

    if (Core.hasComment(operand) || Core.hasComment(other)) {
        return false;
    }

    const expression = Core.unwrapParenthesizedExpression(operand);
    if (!expression) {
        return false;
    }

    const value = Core.getLiteralNumberValue(expression);
    if (value === null) {
        return false;
    }

    if (Math.abs(value) > computeNumericTolerance(0)) {
        return false;
    }

    const parentLine = node?.end?.line;
    const zeroLiteral = createNumericLiteral(0, expression);

    if (!zeroLiteral) {
        return false;
    }

    replaceNode(node, zeroLiteral);
    Core.suppressTrailingLineComment(node, parentLine, context?.astRoot);
    AST.removeSimplifiedAliasDeclaration(context, node);

    return true;
}

function isMultiplicationAnnihilatedByZero(node, context) {
    if (!Core.isBinaryOperator(node, "*")) {
        return false;
    }

    const { left, right } = node;

    if (!left || !right) {
        return false;
    }

    if (Core.hasComment(node) || Core.hasComment(left)) {
        return false;
    }

    if (Core.hasComment(right)) {
        return false;
    }

    if (Core.hasInlineCommentBetween(left, right, context)) {
        return false;
    }

    return (
        isNumericZeroLiteral(Core.unwrapParenthesizedExpression(left)) ||
        isNumericZeroLiteral(Core.unwrapParenthesizedExpression(right))
    );
}

function attemptRemoveAdditiveIdentity(node, context) {
    if (!Core.isBinaryOperator(node, "+")) {
        return false;
    }

    if (Core.hasInlineCommentBetween(node.left, node.right, context)) {
        return false;
    }

    if (removeAdditiveIdentityOperand(node, "left", "right", context)) {
        return true;
    }

    if (removeAdditiveIdentityOperand(node, "right", "left", context)) {
        return true;
    }

    return false;
}

function removeAdditiveIdentityOperand(node, key, otherKey, context) {
    const operand = node[key];
    const other = node[otherKey];

    if (!operand || !other) {
        return false;
    }

    if (Core.hasComment(other)) {
        return false;
    }

    const expression = Core.unwrapParenthesizedExpression(operand);
    if (!expression) {
        return false;
    }

    let value = Core.getLiteralNumberValue(expression);

    if (value === null && isMultiplicationAnnihilatedByZero(expression, context)) {
        value = 0;
    }

    if (value === null) {
        return false;
    }

    if (Math.abs(value) > computeNumericTolerance(0)) {
        return false;
    }

    const parentLine = node?.end?.line;
    const trailingCommentValue = AST.captureTrailingLineCommentValue(parentLine, context);

    if (!replaceNodeByMutation(node, other)) {
        return false;
    }

    if (trailingCommentValue) {
        AST.attachTrailingCommentToStatement(node, trailingCommentValue);
    }

    Core.suppressTrailingLineComment(node, parentLine, context?.astRoot);
    AST.removeSimplifiedAliasDeclaration(context, node);

    return true;
}

function attemptRemoveMultiplicativeIdentityAssignment(node, context) {
    if (!node || node.type !== ASSIGNMENT_EXPRESSION) {
        return false;
    }

    if (node.operator !== "*=" && node.operator !== "/=") {
        return false;
    }

    if (Core.hasComment(node) || Core.hasComment(node.left) || Core.hasComment(node.right)) {
        return false;
    }

    if (Core.hasInlineCommentBetween(node.left, node.right, context)) {
        return false;
    }

    const rightExpression = Core.unwrapParenthesizedExpression(node.right);
    if (!rightExpression) {
        return false;
    }

    const numericValue = Core.getLiteralNumberValue(rightExpression);
    if (numericValue === null || !Number.isFinite(numericValue)) {
        return false;
    }

    if (Math.abs(numericValue - 1) > computeNumericTolerance(1)) {
        return false;
    }

    const parentNode = node.parent;
    if (
        !parentNode ||
        (parentNode.type !== EXPRESSION_STATEMENT &&
            parentNode.type !== "Program" &&
            parentNode.type !== "BlockStatement" &&
            parentNode.type !== "SwitchCase")
    ) {
        return false;
    }

    const removalTarget = parentNode.type === EXPRESSION_STATEMENT ? parentNode : node;

    const root = context && typeof context === "object" ? context.astRoot : null;
    if (!isObjectLike(root)) {
        return false;
    }

    const paddedNode = AST.markPreviousSiblingForBlankLine(root, removalTarget, context);
    const removed = AST.removeNodeFromAst(root, removalTarget);
    if (!removed) {
        if (paddedNode && typeof paddedNode === "object") {
            delete paddedNode._gmlForceFollowingEmptyLine;
        }
        return false;
    }

    return true;
}

function attemptSimplifyDivisionByReciprocal(node, context) {
    if (!Core.isBinaryOperator(node, "/")) {
        return false;
    }

    if (Core.hasComment(node) || Core.hasComment(node.left) || Core.hasComment(node.right)) {
        return false;
    }

    if (Core.hasInlineCommentBetween(node.left, node.right, context)) {
        return false;
    }

    const denominator = Core.unwrapParenthesizedExpression(node.right);
    if (!denominator || denominator.type !== BINARY_EXPRESSION || denominator.operator !== "/") {
        return false;
    }

    if (Core.hasComment(denominator) || Core.hasComment(denominator.left) || Core.hasComment(denominator.right)) {
        return false;
    }

    if (Core.hasInlineCommentBetween(denominator.left, denominator.right, context)) {
        return false;
    }

    const numerator = Core.unwrapParenthesizedExpression(denominator.left);
    const rawReciprocalFactor = denominator.right;
    const reciprocalFactor = Core.unwrapParenthesizedExpression(rawReciprocalFactor);

    if (!numerator || !rawReciprocalFactor || !reciprocalFactor) {
        return false;
    }

    const numericValue = Core.getLiteralNumberValue(numerator);
    if (numericValue === null) {
        return false;
    }

    if (Math.abs(numericValue - 1) > computeNumericTolerance(1)) {
        return false;
    }

    const reciprocalNumericValue = Core.getLiteralNumberValue(reciprocalFactor);
    if (reciprocalNumericValue !== null) {
        if (!Number.isFinite(reciprocalNumericValue)) {
            return false;
        }

        const maxSafeReciprocal =
            context && context.mathNumericPolicy ? context.mathNumericPolicy.maxSafeReciprocal : MAX_SAFE_RECIPROCAL;
        const minSafeDivisor =
            context && context.mathNumericPolicy ? context.mathNumericPolicy.minSafeDivisor : MIN_SAFE_DIVISOR;

        if (Math.abs(reciprocalNumericValue) > maxSafeReciprocal) {
            return false;
        }

        if (Math.abs(1 / reciprocalNumericValue) < minSafeDivisor) {
            return false;
        }
    }

    const leftClone = Core.cloneAstNode(node.left);
    const rightClone =
        Core.cloneAstNode(rawReciprocalFactor) ?? Core.cloneAstNode(reciprocalFactor) ?? reciprocalFactor;

    if (!leftClone || !rightClone) {
        return false;
    }

    node.operator = "*";
    node.left = leftClone;
    node.right = rightClone;

    return true;
}

function attemptCancelReciprocalRatios(node, context) {
    if (!node) {
        return false;
    }

    if (!Core.isBinaryOperator(node, "*") && !Core.isBinaryOperator(node, "/")) {
        return false;
    }

    const chain = {
        numerators: [],
        denominators: []
    };

    if (!collectMultiplicativeChain(node, chain, false, context)) {
        return false;
    }

    if (chain.numerators.length < 2) {
        return false;
    }

    const ratioTerms = collectReciprocalRatioTerms({
        chain,
        context
    });
    if (!ratioTerms || ratioTerms.length === 0) {
        return false;
    }

    const removalPlan = buildReciprocalRatioRemovalPlan({
        chain,
        ratioTerms
    });
    if (!removalPlan) {
        return false;
    }

    const remainingTerms = buildRemainingRatioTerms({
        chain,
        removalPlan
    });
    if (!remainingTerms) {
        return false;
    }

    const replacement = buildReciprocalRatioReplacement({
        remainingTerms,
        node
    });
    if (!replacement) {
        return false;
    }

    return replaceNodeByMutation(node, replacement);
}

function attemptSimplifyNegativeDivisionProduct(node, context) {
    if (!Core.isBinaryOperator(node, "*")) {
        return false;
    }

    if (Core.hasComment(node)) {
        return false;
    }

    if (Core.hasInlineCommentBetween(node.left, node.right, context)) {
        return false;
    }

    const candidates = [
        { fractionKey: "left", signKey: "right" },
        { fractionKey: "right", signKey: "left" }
    ];

    for (const { fractionKey, signKey } of candidates) {
        const fractionNode = node[fractionKey];
        const signNode = node[signKey];

        if (!isNegativeOneFactor(signNode)) {
            continue;
        }

        if (Core.hasComment(signNode)) {
            continue;
        }

        const fractionExpression = Core.unwrapParenthesizedExpression(fractionNode);
        if (
            !fractionExpression ||
            fractionExpression.type !== BINARY_EXPRESSION ||
            fractionExpression.operator !== "/"
        ) {
            continue;
        }

        if (Core.hasComment(fractionExpression)) {
            continue;
        }

        const numerator = Core.unwrapParenthesizedExpression(fractionExpression.left);
        const denominator = Core.unwrapParenthesizedExpression(fractionExpression.right);

        if (!numerator || !denominator) {
            continue;
        }

        if (Core.hasComment(fractionExpression.left) || Core.hasComment(fractionExpression.right)) {
            continue;
        }

        if (Core.hasInlineCommentBetween(fractionExpression.left, fractionExpression.right, context)) {
            continue;
        }

        const denominatorValue = parseNumericFactor(denominator);
        if (denominatorValue === null) {
            continue;
        }

        if (Math.abs(denominatorValue) <= computeNumericTolerance(0)) {
            continue;
        }

        const coefficient = -1 / denominatorValue;
        const normalizedCoefficient = normalizeNumericCoefficient(coefficient);
        if (normalizedCoefficient === null) {
            continue;
        }

        const baseClone = Core.cloneAstNode(numerator);
        const literal = createNumericLiteral(normalizedCoefficient, denominator);

        if (!baseClone || !literal) {
            continue;
        }

        node.operator = "*";
        node.left = baseClone;
        node.right = literal;
        return true;
    }

    return false;
}

function matchLengthdirScaledOperand(node, context) {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression || expression.type !== CALL_EXPRESSION) {
        return null;
    }

    const calleeName = Core.getUnwrappedIdentifierName(expression.object);
    if (calleeName !== "lengthdir_x" && calleeName !== "lengthdir_y") {
        return null;
    }

    const args = Core.getCallExpressionArguments(expression);
    if (args.length !== 2) {
        return null;
    }

    const [rawLength, rawAngle] = args;

    if (!rawLength || !rawAngle) {
        return null;
    }

    if (
        Core.hasComment(rawLength) ||
        Core.hasComment(rawAngle) ||
        Core.hasInlineCommentBetween(rawLength, rawAngle, context)
    ) {
        return null;
    }

    const scaledInfo = matchScaledOperand(rawLength, context);
    if (!scaledInfo || !scaledInfo.base) {
        return null;
    }

    return {
        calleeName,
        coefficient: scaledInfo.coefficient,
        base: scaledInfo.base,
        rawLength,
        angle: rawAngle
    };
}

function attemptSimplifyLengthdirHalfDifference(node, context) {
    if (!Core.isBinaryOperator(node, "-") || Core.hasComment(node)) {
        return false;
    }

    const rawLeft = node.left;
    const rawRight = node.right;

    if (!rawLeft || !rawRight) {
        return false;
    }

    if (
        Core.hasComment(rawLeft) ||
        Core.hasComment(rawRight) ||
        Core.hasInlineCommentBetween(rawLeft, rawRight, context)
    ) {
        return false;
    }

    const leftExpression = Core.unwrapParenthesizedExpression(rawLeft);
    const rightExpression = Core.unwrapParenthesizedExpression(rawRight);

    if (!leftExpression || !rightExpression) {
        return false;
    }

    if (Core.hasComment(leftExpression) || Core.hasComment(rightExpression)) {
        return false;
    }

    if (
        !Core.isBinaryOperator(leftExpression, "-") ||
        Core.hasComment(leftExpression) ||
        Core.hasInlineCommentBetween(leftExpression.left, leftExpression.right, context)
    ) {
        return false;
    }

    const minuend = Core.unwrapParenthesizedExpression(leftExpression.left);
    const identifierName = Core.getUnwrappedIdentifierName(minuend);
    const scaledOperandInfo = matchScaledOperand(leftExpression.right, context);

    if (!minuend || !scaledOperandInfo || !scaledOperandInfo.base) {
        return false;
    }

    if (!AST.isSafeOperand(minuend)) {
        return false;
    }

    const lengthDirInfo = matchLengthdirScaledOperand(rightExpression, context);

    if (!lengthDirInfo || !lengthDirInfo.base) {
        return false;
    }

    if (!areNodesEquivalent(minuend, scaledOperandInfo.base) || !areNodesEquivalent(minuend, lengthDirInfo.base)) {
        return false;
    }

    const scaledCoefficient = scaledOperandInfo.coefficient;
    const lengthCoefficient = lengthDirInfo.coefficient;

    if (
        scaledCoefficient === null ||
        lengthCoefficient === null ||
        !Number.isFinite(scaledCoefficient) ||
        !Number.isFinite(lengthCoefficient)
    ) {
        return false;
    }

    const halfTolerance = computeNumericTolerance(0.5);

    if (Math.abs(scaledCoefficient - 0.5) > halfTolerance || Math.abs(lengthCoefficient - 0.5) > halfTolerance) {
        return false;
    }

    const baseClone = Core.cloneAstNode(leftExpression.left);
    if (!baseClone) {
        return false;
    }

    const normalizedCoefficient = normalizeNumericCoefficient(scaledCoefficient);
    if (normalizedCoefficient === null) {
        return false;
    }

    const coefficientLiteral = createNumericLiteral(normalizedCoefficient, leftExpression.right);

    if (!coefficientLiteral) {
        return false;
    }

    const oneLiteral = createNumericLiteral(1, node);
    if (!oneLiteral) {
        return false;
    }

    const angleClone = Core.cloneAstNode(lengthDirInfo.angle);
    if (!angleClone) {
        return false;
    }

    const normalizedLengthArg = createNumericLiteral(1, lengthDirInfo.rawLength);
    if (!normalizedLengthArg) {
        return false;
    }

    const normalizedLengthCall = createCallExpressionNode(
        lengthDirInfo.calleeName,
        [normalizedLengthArg, angleClone],
        rightExpression
    );

    if (!normalizedLengthCall) {
        return false;
    }

    const difference = {
        type: BINARY_EXPRESSION,
        operator: "-",
        left: oneLiteral,
        right: normalizedLengthCall
    };

    Core.assignClonedLocation(difference, node);

    const groupedDifference = {
        type: PARENTHESIZED_EXPRESSION,
        expression: difference
    };

    Core.assignClonedLocation(groupedDifference, node);

    const baseTimesCoefficient = createMultiplicationNode(baseClone, coefficientLiteral, node);

    if (!baseTimesCoefficient) {
        return false;
    }

    const finalProduct = createMultiplicationNode(baseTimesCoefficient, groupedDifference, node);

    if (!finalProduct) {
        return false;
    }

    replaceNode(node, finalProduct);

    promoteLengthdirHalfDifference(context, node, identifierName, normalizedCoefficient, groupedDifference);
    return true;
}

function promoteLengthdirHalfDifference(
    context,
    expressionNode,
    identifierName,
    normalizedCoefficient,
    groupedDifference
) {
    if (!isObjectLike(context) || !expressionNode || typeof normalizedCoefficient !== "string") {
        return;
    }

    if (typeof identifierName !== "string" || identifierName.length === 0) {
        return;
    }

    const root = context.astRoot;
    if (!isObjectLike(root)) {
        return;
    }

    const assignment = AST.findAssignmentExpressionForRight(root, expressionNode);
    if (!assignment) {
        return;
    }

    if (Core.getUnwrappedIdentifierName(assignment.left) !== identifierName) {
        return;
    }

    const declaration = AST.findVariableDeclarationByName(root, identifierName);
    const declarator = Array.isArray(declaration?.declarations) ? declaration.declarations[0] : null;

    if (!declarator || !declarator.init) {
        return;
    }

    const baseClone = Core.cloneAstNode(declarator.init);
    if (!baseClone) {
        return;
    }

    const differenceClone = Core.cloneAstNode(groupedDifference);
    if (!differenceClone) {
        return;
    }

    let leftProduct = null;
    const baseInfo = matchScaledOperand(declarator.init, context);

    if (baseInfo && baseInfo.coefficient !== null && baseInfo.rawBase) {
        const combinedValue = baseInfo.coefficient * Number(normalizedCoefficient);

        if (Number.isFinite(combinedValue)) {
            const combinedLiteralText = normalizeNumericCoefficient(combinedValue);

            if (combinedLiteralText !== null) {
                const baseNodeClone = Core.cloneAstNode(baseInfo.rawBase);
                const literalClone = createNumericLiteral(combinedLiteralText, baseInfo.rawBase);

                if (baseNodeClone && literalClone) {
                    leftProduct = createMultiplicationNode(baseNodeClone, literalClone, declarator.init);
                }
            }
        }
    }

    if (!leftProduct) {
        const coefficientLiteral = createNumericLiteral(normalizedCoefficient, declarator.init);

        if (!coefficientLiteral) {
            return;
        }

        leftProduct = createMultiplicationNode(baseClone, coefficientLiteral, declarator.init);

        if (!leftProduct) {
            return;
        }
    }

    const newInit = createMultiplicationNode(leftProduct, differenceClone, declarator.init);

    if (!newInit) {
        return;
    }

    replaceNode(declarator.init, newInit);

    attemptCondenseScalarProduct(newInit, context);
    attemptCondenseNumericChainWithMultipleBases(newInit, context);
    attemptCollectDistributedScalars(newInit, context);

    AST.markPreviousSiblingForBlankLine(root, assignment, context);
    AST.removeNodeFromAst(root, assignment);
}
