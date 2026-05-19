/**
 * Collection of helper routines that reshape math-heavy AST fragments into a normalized form.
 * This includes simplifications, constant conversions, and traversal-safe replacements so the printer emits consistent expressions.
 *
 * Implementation is split across several focused modules:
 *   - math-numeric-utils.ts    – pure numeric/literal evaluation helpers
 *   - math-ast-builders.ts     – AST node creation and mutation helpers
 *   - math-trig-conversions.ts – trigonometric and angle-conversion simplifiers
 *   - math-ast-mutation.ts     – AST tree-walking, node-lookup, and structural mutation helpers
 *                               (original-expression cloning, alias removal, blank-line preservation,
 *                               zero-division simplification)
 */

import { Core } from "@gmloop/core";

import {
    cloneMultiplicativeTerms,
    createBinaryExpressionNode,
    createCallExpressionNode,
    createMultiplicationNode,
    createNegatedExpression,
    createNumericLiteral,
    createParenthesizedExpressionNode,
    createUnaryNegationNode,
    mutateToCallExpression,
    mutateToNumericLiteral,
    replaceNode,
    replaceNodeWith as replaceNodeByMutation
} from "./math-ast-builders.js";
import type { ConvertManualMathTransformOptions } from "./math-ast-mutation.js";
import * as AST from "./math-ast-mutation.js";
import {
    attemptConvertLengthDir,
    isIdentityReplacementSafeExpression,
    isSafeReciprocalCancellationOperand,
    matchLengthdirReassignment,
    matchScaledOperand
} from "./math-lengthdir-transforms.js";
import {
    areLiteralNumbersApproximatelyEqual,
    collectProductOperands,
    computeIntegerGcd,
    computeNumericTolerance,
    evaluateOneMinusNumeric,
    isEulerLiteral,
    isHalfExponentLiteral,
    isLiteralNumber,
    isLnCall,
    isNegativeOneFactor,
    isNumericZeroLiteral,
    normalizeNumericCoefficient,
    parseNumericFactor,
    scaleNumericLiteralCoefficient,
    toApproxInteger
} from "./math-numeric-utils.js";
import {
    attemptConvertDegreesToRadians as simplifyDegreesToRadians,
    attemptSimplifyTrigonometricCall
} from "./math-trig-conversions.js";

// Re-export the entire public API of math-ast-mutation.ts so callers importing
// from this module get all mutation helpers transparently.
export * from "./math-ast-mutation.js";

const {
    ASSIGNMENT_EXPRESSION,
    BINARY_EXPRESSION,
    CALL_EXPRESSION,
    EXPRESSION_STATEMENT,
    IDENTIFIER,
    LITERAL,
    MEMBER_DOT_EXPRESSION,
    MEMBER_INDEX_EXPRESSION,
    PARENTHESIZED_EXPRESSION,
    UNARY_EXPRESSION,
    VARIABLE_DECLARATION,
    isObjectLike
} = Core;

const MIN_SAFE_DIVISOR = 1e-10;
const MAX_SAFE_RECIPROCAL = 1e10;

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

const _SCALAR_CONDENSING_SIMPLIFIERS: SimplificationHandler[] = [
    attemptCondenseSimpleScalarProduct,
    attemptCondenseScalarProduct,
    attemptCondenseNumericChainWithMultipleBases,
    attemptCollectDistributedScalars
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
    unwrapEnclosingParentheses(node, context);

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

function combineLengthdirScalarAssignments(ast) {
    if (!isObjectLike(ast)) {
        return;
    }

    const body = Array.isArray(ast.body) ? ast.body : null;
    if (!body) {
        for (const [key, value] of Object.entries(ast)) {
            if (key === "parent" || !isObjectLike(value)) {
                continue;
            }

            combineLengthdirScalarAssignments(value);
        }
        return;
    }

    /**
     * Merge consecutive lengthdir scalar assignments into their declaration so the AST represents simplified math patterns.
     *
     * This loop iterates over `body` while also mutating it via `body.splice()`, so we use a while-loop
     * rather than a for-loop to safely re-evaluate the termination condition after each mutation.
     * If this were a standard for-loop, `body.splice(index + 1, 1)` would remove the element at
     * `index + 1`, shifting subsequent elements down by one; on the next iteration, the loop would
     * increment index and look at `body[index + 1]`, which is now the element originally at
     * `index + 2` — effectively skipping `index + 2`.
     *
     * Using `while (index < body.length - 1)` and re-checking `body.length` after each splice
     * ensures the loop terminates correctly and processes all consecutive pairs.
     */
    let index = 0;
    while (index < body.length - 1) {
        const declaration = body[index];
        const next = body[index + 1];

        if (
            !declaration ||
            declaration.type !== VARIABLE_DECLARATION ||
            !Array.isArray(declaration.declarations) ||
            declaration.declarations.length !== 1 ||
            Core.hasComment(declaration)
        ) {
            index += 1;
            continue;
        }

        const [declarator] = declaration.declarations;
        if (!declarator || Core.hasComment(declarator) || !declarator.init || Core.hasComment(declarator.init)) {
            index += 1;
            continue;
        }

        if (!next) {
            index += 1;
            continue;
        }

        const assignment = next.type === EXPRESSION_STATEMENT ? next.expression : next;
        if (
            !assignment ||
            assignment.type !== ASSIGNMENT_EXPRESSION ||
            assignment.operator !== "=" ||
            Core.hasComment(next) ||
            Core.hasComment(assignment)
        ) {
            index += 1;
            continue;
        }

        const baseName = Core.getUnwrappedIdentifierName(declarator.id);
        if (!baseName || Core.getUnwrappedIdentifierName(assignment.left) !== baseName) {
            index += 1;
            continue;
        }

        const match = matchLengthdirReassignment(assignment.right, baseName);

        if (!match) {
            index += 1;
            continue;
        }

        const initClone = Core.cloneAstNode(declarator.init);
        if (!initClone) {
            index += 1;
            continue;
        }

        let baseTimesFactor = initClone;

        if (!scaleNumericLiteralCoefficient(baseTimesFactor, match.factor)) {
            const normalizedFactor = normalizeNumericCoefficient(match.factor);
            if (normalizedFactor === null) {
                index += 1;
                continue;
            }

            const factorLiteral = createNumericLiteral(normalizedFactor, match.factorNode);
            if (!factorLiteral) {
                index += 1;
                continue;
            }

            baseTimesFactor = createBinaryExpressionNode("*", baseTimesFactor, factorLiteral, assignment.right);
        }

        const callOneLiteral = createNumericLiteral("1", assignment.right);
        const differenceOneLiteral = createNumericLiteral("1", assignment.right);
        if (!callOneLiteral || !differenceOneLiteral) {
            index += 1;
            continue;
        }

        const lengthdirCall = createCallExpressionNode(
            match.functionName,
            [callOneLiteral, Core.cloneAstNode(match.angle)],
            match.callExpression
        );
        if (!lengthdirCall) {
            index += 1;
            continue;
        }

        const difference = createBinaryExpressionNode("-", differenceOneLiteral, lengthdirCall, assignment.right);

        const parenthesizedDifference = createParenthesizedExpressionNode(difference, assignment.right);
        if (!parenthesizedDifference) {
            index += 1;
            continue;
        }

        const finalExpression = createBinaryExpressionNode(
            "*",
            baseTimesFactor,
            parenthesizedDifference,
            assignment.right
        );

        AST.applyScalarCondensing(finalExpression);

        declarator.init = finalExpression;
        body.splice(index + 1, 1);
        // Do NOT increment index — the element that just shifted into body[index + 1]
        // is the next candidate and must be checked against body[index] before advancing.
        continue;
    }

    for (const element of body) {
        if (!isObjectLike(element)) {
            continue;
        }

        combineLengthdirScalarAssignments(element);
    }
}

function attemptCondenseSimpleScalarProduct(node, context) {
    if (!Core.isBinaryOperator(node, "*")) {
        return false;
    }

    const chain = { numerators: [], denominators: [] };
    if (!collectMultiplicativeChain(node, chain, false, null)) {
        return false;
    }

    const nonNumericTerms = [];
    let coefficient = 1;
    let hasNumericContribution = false;

    for (const term of chain.numerators) {
        if (Core.hasComment(term.expression)) {
            return false;
        }

        const numericValue = parseNumericFactor(term.expression);
        if (numericValue === null) {
            nonNumericTerms.push(term);
            continue;
        }

        coefficient *= numericValue;
        hasNumericContribution = true;
    }

    const cancelledReciprocalTerms = cancelSimpleReciprocalNumeratorPairs(nonNumericTerms);

    if (cancelledReciprocalTerms) {
        hasNumericContribution = true;
    }

    if (
        chain.denominators.length === 0 &&
        !cancelledReciprocalTerms &&
        Math.abs(coefficient - 1) > computeNumericTolerance(1)
    ) {
        return false;
    }

    if (nonNumericTerms.length === 0) {
        return false;
    }

    for (const term of chain.denominators) {
        if (Core.hasComment(term.expression)) {
            return false;
        }

        const numericValue = parseNumericFactor(term.expression);
        if (numericValue === null || Math.abs(numericValue) <= computeNumericTolerance(0)) {
            if (numericValue === null) {
                const matchIndex = nonNumericTerms.findIndex((candidate) =>
                    areSimpleExpressionsEquivalent(candidate.expression, term.expression)
                );

                if (matchIndex !== -1) {
                    nonNumericTerms.splice(matchIndex, 1);
                    continue;
                }
            }

            return false;
        }

        coefficient /= numericValue;
        hasNumericContribution = true;
    }

    if (!hasNumericContribution || !Number.isFinite(coefficient)) {
        return false;
    }

    const normalizedCoefficient = normalizeNumericCoefficient(coefficient);
    if (normalizedCoefficient === null) {
        return false;
    }

    const operand = cloneMultiplicativeTerms(nonNumericTerms, node);
    if (!operand) {
        return false;
    }

    const unitTolerance = computeNumericTolerance(1);
    const normalizedNumber =
        typeof normalizedCoefficient === "number" ? normalizedCoefficient : Number(normalizedCoefficient);
    if (!Number.isFinite(normalizedNumber)) return false;
    if (Math.abs(normalizedNumber - 1) <= unitTolerance) {
        const originalExpression = Core.cloneAstNode(node);

        if (!replaceNodeByMutation(node, operand)) {
            return false;
        }

        node.__fromMultiplicativeIdentity = true;
        AST.recordManualMathOriginalAssignment(context, node, originalExpression);

        return true;
    }
    const literal = createNumericLiteral(normalizedCoefficient, node) as any;
    if (!literal) {
        return false;
    }

    node.operator = "*";
    node.left = operand;
    node.right = literal;
    node.__fromMultiplicativeIdentity = true;

    return true;
}

function cancelSimpleReciprocalNumeratorPairs(terms) {
    if (!Array.isArray(terms) || terms.length < 2) {
        return false;
    }

    const consumed = new Set();
    const tolerance = computeNumericTolerance(1);
    let cancelled = false;

    for (let index = 0; index < terms.length; index += 1) {
        if (consumed.has(index)) {
            continue;
        }

        const term = terms[index];
        const expression = Core.unwrapParenthesizedExpression(term.expression);
        if (!expression || expression.type !== BINARY_EXPRESSION) {
            continue;
        }

        const operator = Core.getNormalizedOperator(expression);

        if (operator !== "/") {
            continue;
        }

        if (!isSafeReciprocalCancellationOperand(expression.right)) {
            continue;
        }

        const numeratorValue = parseNumericFactor(expression.left);
        if (numeratorValue === null || Math.abs(numeratorValue - 1) > tolerance) {
            continue;
        }

        const matchIndex = terms.findIndex((candidate, candidateIndex) => {
            if (candidateIndex === index || consumed.has(candidateIndex) || Core.hasComment(candidate.expression)) {
                return false;
            }

            if (!isSafeReciprocalCancellationOperand(candidate.expression)) {
                return false;
            }

            return areSimpleExpressionsEquivalent(candidate.expression, expression.right);
        });

        if (matchIndex === -1) {
            continue;
        }

        consumed.add(index);
        consumed.add(matchIndex);
        cancelled = true;
    }

    if (!cancelled) {
        return false;
    }

    const remaining = [];
    for (const [index, term] of terms.entries()) {
        if (consumed.has(index)) {
            continue;
        }

        remaining.push(term);
    }

    terms.length = 0;
    for (const term of remaining) {
        terms.push(term);
    }

    return true;
}

function areSimpleExpressionsEquivalent(left, right) {
    return areNodesApproximatelyEquivalent(left, right);
}

function unwrapEnclosingParentheses(node, context) {
    if (!isObjectLike(node)) {
        return;
    }

    const root = context?.astRoot;
    if (!isObjectLike(root)) {
        return;
    }

    let current = node;
    while (true) {
        const parentInfo = findParentEntry(root, current);
        if (!parentInfo) {
            break;
        }

        const { parent } = parentInfo;
        if (!isObjectLike(parent)) {
            break;
        }

        if (parent.type !== PARENTHESIZED_EXPRESSION) {
            break;
        }

        const expression = parent.expression;
        if (!expression) {
            break;
        }

        if (Core.hasComment(parent) || Core.hasComment(expression)) {
            break;
        }

        if (!AST.isSafeOperand(parent) && expression.type !== CALL_EXPRESSION) {
            break;
        }

        replaceNodeByMutation(parent, current);
        current = parent;
    }
}

function findParentEntry(root, target) {
    const stack = [{ parent: null, key: null, node: root }];
    const visited = new Set();

    while (stack.length > 0) {
        const { parent, key, node } = stack.pop();
        if (node === target) {
            return { parent, key };
        }

        if (!isObjectLike(node) || visited.has(node)) {
            continue;
        }

        visited.add(node);

        if (Array.isArray(node)) {
            for (let index = node.length - 1; index >= 0; index -= 1) {
                const element = node[index];
                stack.push({ parent: node, key: index, node: element });
            }
            continue;
        }

        for (const [childKey, childValue] of Object.entries(node)) {
            if (childKey === "parent") {
                continue;
            }

            stack.push({ parent: node, key: childKey, node: childValue });
        }
    }

    return null;
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

        if (Math.abs(reciprocalNumericValue) > MAX_SAFE_RECIPROCAL) {
            return false;
        }

        if (Math.abs(1 / reciprocalNumericValue) < MIN_SAFE_DIVISOR) {
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

type MultiplicativeChain = {
    numerators: Array<{ raw: any; expression: any }>;
    denominators: Array<{ raw: any; expression: any }>;
};

type ReciprocalRatioTerm = {
    index: number;
    numerator: any;
    denominator: any;
};

function collectReciprocalRatioTerms({
    chain,
    context
}: {
    chain: MultiplicativeChain;
    context: ConvertManualMathTransformOptions | null;
}) {
    const ratioTerms: ReciprocalRatioTerm[] = [];

    for (const [index, term] of chain.numerators.entries()) {
        if (Core.hasComment(term.raw) || Core.hasComment(term.expression)) {
            return null;
        }

        const expression = Core.unwrapParenthesizedExpression(term.expression);
        if (!expression || expression.type !== BINARY_EXPRESSION || expression.operator !== "/") {
            continue;
        }

        const numerator = Core.unwrapParenthesizedExpression(expression.left);
        const denominator = Core.unwrapParenthesizedExpression(expression.right);

        if (!numerator || !denominator) {
            continue;
        }

        if (!isSafeReciprocalCancellationOperand(numerator) || !isSafeReciprocalCancellationOperand(denominator)) {
            continue;
        }

        if (Core.hasComment(expression.left) || Core.hasComment(expression.right)) {
            return null;
        }

        if (Core.hasInlineCommentBetween(expression.left, expression.right, context)) {
            return null;
        }

        ratioTerms.push({ index, numerator, denominator });
    }

    return ratioTerms;
}

type ReciprocalRatioRemovalPlan = {
    indicesToRemove: Set<number>;
    replacementsByIndex: Map<number, any[]>;
};

function buildReciprocalRatioRemovalPlan({
    chain,
    ratioTerms
}: {
    chain: MultiplicativeChain;
    ratioTerms: ReciprocalRatioTerm[];
}) {
    const indicesToRemove = new Set<number>();
    const replacementsByIndex = new Map<number, any[]>();
    const ratioIndices = new Set(ratioTerms.map(({ index }) => index));

    for (let outer = 0; outer < ratioTerms.length; outer += 1) {
        if (indicesToRemove.has(ratioTerms[outer].index)) {
            continue;
        }

        for (let inner = outer + 1; inner < ratioTerms.length; inner += 1) {
            if (indicesToRemove.has(ratioTerms[inner].index)) {
                continue;
            }

            const first = ratioTerms[outer];
            const second = ratioTerms[inner];

            if (
                areNodesEquivalent(first.numerator, second.denominator) &&
                areNodesEquivalent(first.denominator, second.numerator)
            ) {
                indicesToRemove.add(first.index);
                indicesToRemove.add(second.index);
                break;
            }
        }
    }

    for (const ratioTerm of ratioTerms) {
        if (indicesToRemove.has(ratioTerm.index)) {
            continue;
        }

        for (const [index, term] of chain.numerators.entries()) {
            if (index === ratioTerm.index) {
                continue;
            }

            if (indicesToRemove.has(index)) {
                continue;
            }

            if (ratioIndices.has(index)) {
                continue;
            }

            if (Core.hasComment(term.raw) || Core.hasComment(term.expression)) {
                continue;
            }

            const candidate = Core.unwrapParenthesizedExpression(term.expression);
            if (!candidate) {
                continue;
            }

            if (!isSafeReciprocalCancellationOperand(candidate)) {
                continue;
            }

            if (!areNodesEquivalent(candidate, ratioTerm.denominator)) {
                continue;
            }

            const numericValue = parseNumericFactor(ratioTerm.numerator);
            const isMultiplicativeIdentity =
                numericValue !== null && Math.abs(numericValue - 1) <= computeNumericTolerance(1);

            if (!isMultiplicativeIdentity) {
                replacementsByIndex.set(ratioTerm.index, [ratioTerm.numerator]);
            }
            indicesToRemove.add(ratioTerm.index);
            indicesToRemove.add(index);
            break;
        }
    }

    if (indicesToRemove.size === 0 && replacementsByIndex.size === 0) {
        return null;
    }

    return { indicesToRemove, replacementsByIndex };
}

function buildRemainingRatioTerms({
    chain,
    removalPlan
}: {
    chain: MultiplicativeChain;
    removalPlan: ReciprocalRatioRemovalPlan;
}) {
    const remainingTerms: any[] = [];

    for (const [index, term] of chain.numerators.entries()) {
        if (removalPlan.indicesToRemove.has(index)) {
            const replacements = removalPlan.replacementsByIndex.get(index);
            if (!pushRatioReplacements(remainingTerms, replacements)) {
                return null;
            }

            continue;
        }

        const clone = Core.cloneAstNode(term.raw);
        if (!clone) {
            return null;
        }

        remainingTerms.push(clone);
    }

    return remainingTerms;
}

function pushRatioReplacements(remainingTerms: Array<any>, replacements: Array<any> | undefined): boolean {
    if (!replacements || replacements.length === 0) {
        return true;
    }

    for (const replacement of replacements) {
        const clone = Core.cloneAstNode(replacement);
        if (!clone) {
            return false;
        }

        remainingTerms.push(clone);
    }

    return true;
}

function buildReciprocalRatioReplacement({ remainingTerms, node }: { remainingTerms: any[]; node: any }) {
    if (remainingTerms.length === 0) {
        return createNumericLiteral(1, node);
    }

    if (remainingTerms.length === 1) {
        return remainingTerms[0];
    }

    let combined = remainingTerms[0];

    for (let index = 1; index < remainingTerms.length; index += 1) {
        const product = {
            type: BINARY_EXPRESSION,
            operator: "*",
            left: combined,
            right: remainingTerms[index]
        };

        Core.assignClonedLocation(product, node);
        combined = product;
    }

    return combined;
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

function attemptCondenseScalarProduct(node, context) {
    if (!node) {
        return false;
    }

    if (AST.hasOriginalComment(node, context)) {
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

    const nonNumericTerms = [];
    let coefficient = 1;
    let hasNumericContribution = false;
    let meaningfulNumericFactorCount = 0;
    let numericNumeratorProduct = 1;
    let numericDenominatorProduct = 1;
    let hasNumericNumeratorFactor = false;
    let hasNumericDenominatorFactor = false;
    let numericDenominatorCount = 0;
    const unitTolerance = computeNumericTolerance(1);

    for (const term of chain.numerators) {
        if (Core.hasComment(term.expression) || (term.raw && Core.hasComment(term.raw))) {
            return false;
        }

        const numericValue = parseNumericFactor(term.expression);
        if (numericValue === null) {
            nonNumericTerms.push(term);
            continue;
        }

        hasNumericContribution = true;
        coefficient *= numericValue;
        hasNumericNumeratorFactor = true;
        numericNumeratorProduct *= numericValue;

        if (Math.abs(numericValue - 1) > unitTolerance && Math.abs(numericValue + 1) > unitTolerance) {
            meaningfulNumericFactorCount += 1;
        }
    }

    if (nonNumericTerms.length === 0) {
        return false;
    }

    for (const term of chain.denominators) {
        if (Core.hasComment(term.expression) || (term.raw && Core.hasComment(term.raw))) {
            return false;
        }

        const numericValue = parseNumericFactor(term.expression);
        if (numericValue === null || Math.abs(numericValue) <= computeNumericTolerance(0)) {
            return false;
        }

        hasNumericContribution = true;
        coefficient /= numericValue;
        hasNumericDenominatorFactor = true;
        numericDenominatorProduct *= numericValue;
        numericDenominatorCount += 1;

        if (Math.abs(numericValue - 1) > unitTolerance && Math.abs(numericValue + 1) > unitTolerance) {
            meaningfulNumericFactorCount += 1;
        }
    }

    if (!hasNumericContribution) {
        return false;
    }

    if (!Number.isFinite(coefficient)) {
        return false;
    }

    const zeroTolerance = computeNumericTolerance(0);
    const coefficientIsPositiveIdentity = Math.abs(coefficient - 1) <= unitTolerance;
    const coefficientIsNegativeIdentity = Math.abs(coefficient + 1) <= unitTolerance;

    if ((coefficientIsPositiveIdentity || coefficientIsNegativeIdentity) && nonNumericTerms.length > 0) {
        const condensedOperand = cloneMultiplicativeTerms(nonNumericTerms, node);
        if (!condensedOperand) {
            return false;
        }

        const replacement = coefficientIsNegativeIdentity
            ? createUnaryNegationNode(condensedOperand, node)
            : condensedOperand;

        if (!replacement || !replaceNodeByMutation(node, replacement)) {
            return false;
        }

        unwrapEnclosingParentheses(node, context);

        return true;
    }

    if (Math.abs(coefficient) <= zeroTolerance) {
        return false;
    }

    if (meaningfulNumericFactorCount < 2) {
        return false;
    }

    const ratioMetadata =
        hasNumericDenominatorFactor && numericDenominatorCount >= 2
            ? computeScalarRatioMetadata(
                  coefficient,
                  hasNumericNumeratorFactor ? numericNumeratorProduct : 1,
                  numericDenominatorProduct
              )
            : null;

    const normalizedCoefficient = normalizeNumericCoefficient(coefficient, ratioMetadata?.precision);
    if (normalizedCoefficient === null) {
        return false;
    }

    const clonedOperand = cloneMultiplicativeTerms(nonNumericTerms, node);
    const literal = createNumericLiteral(normalizedCoefficient, node) as any;

    if (!clonedOperand || !literal) {
        return false;
    }

    node.operator = "*";
    node.left = clonedOperand;
    node.right = literal;

    return true;
}

function computeScalarRatioMetadata(coefficient, numeratorProduct, denominatorProduct) {
    if (!Number.isFinite(coefficient)) {
        return null;
    }

    if (
        !Number.isFinite(numeratorProduct) ||
        !Number.isFinite(denominatorProduct) ||
        Math.abs(denominatorProduct) <= computeNumericTolerance(1)
    ) {
        return null;
    }

    let numerator = numeratorProduct;
    let denominator = denominatorProduct;

    if (Math.abs(denominator) <= computeNumericTolerance(0)) {
        return null;
    }

    if (denominator < 0) {
        numerator *= -1;
        denominator *= -1;
    }

    const ratioValue = numerator / denominator;
    const tolerance = computeNumericTolerance(coefficient);

    if (Math.abs(coefficient - ratioValue) > tolerance) {
        return null;
    }

    const numeratorInt = toApproxInteger(numerator);
    const denominatorInt = toApproxInteger(denominator);

    if (numeratorInt === null || denominatorInt === null) {
        return null;
    }

    if (denominatorInt === 0) {
        return null;
    }

    let simplifiedNumerator = numeratorInt;
    let simplifiedDenominator = denominatorInt;

    if (simplifiedDenominator < 0) {
        simplifiedNumerator *= -1;
        simplifiedDenominator *= -1;
    }

    const gcdValue = computeIntegerGcd(Math.abs(simplifiedNumerator), Math.abs(simplifiedDenominator));

    if (!Number.isFinite(gcdValue) || gcdValue <= 0) {
        return null;
    }

    simplifiedNumerator /= gcdValue;
    simplifiedDenominator /= gcdValue;

    if (simplifiedDenominator <= 1) {
        return null;
    }

    const unitTolerance = computeNumericTolerance(1);
    const absNumerator = Math.abs(simplifiedNumerator);
    if (absNumerator < 1 - unitTolerance || absNumerator > 1 + unitTolerance) {
        return null;
    }

    if (Math.abs(simplifiedDenominator) < 100) {
        return null;
    }

    const signPrefix = simplifiedNumerator < 0 ? "-" : "";
    const ratioText = `${signPrefix}1/${simplifiedDenominator}`;

    return {
        text: `(${ratioText})`,
        precision: 11
    };
}

function attemptCondenseNumericChainWithMultipleBases(node, context) {
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

    if (chain.denominators.length === 0) {
        return false;
    }

    let coefficient = 1;
    let hasNumericContribution = false;
    let meaningfulNumericFactorCount = 0;
    const nonNumericTerms = [];
    const unitTolerance = computeNumericTolerance(1);

    for (const term of chain.numerators) {
        if (Core.hasComment(term.expression) || (term.raw && Core.hasComment(term.raw))) {
            return false;
        }

        const numericValue = parseNumericFactor(term.expression);
        if (numericValue === null) {
            nonNumericTerms.push(term);
            continue;
        }

        hasNumericContribution = true;
        coefficient *= numericValue;

        if (Math.abs(numericValue - 1) > unitTolerance && Math.abs(numericValue + 1) > unitTolerance) {
            meaningfulNumericFactorCount += 1;
        }
    }

    if (nonNumericTerms.length < 2) {
        return false;
    }

    for (const term of chain.denominators) {
        if (Core.hasComment(term.expression) || (term.raw && Core.hasComment(term.raw))) {
            return false;
        }

        const numericValue = parseNumericFactor(term.expression);
        if (numericValue === null || Math.abs(numericValue) <= computeNumericTolerance(0)) {
            return false;
        }

        hasNumericContribution = true;
        coefficient /= numericValue;

        if (Math.abs(numericValue - 1) > unitTolerance && Math.abs(numericValue + 1) > unitTolerance) {
            meaningfulNumericFactorCount += 1;
        }
    }

    if (!hasNumericContribution) {
        return false;
    }

    if (!Number.isFinite(coefficient)) {
        return false;
    }

    const tolerance = computeNumericTolerance(1);
    if (
        Math.abs(coefficient) <= computeNumericTolerance(0) ||
        Math.abs(coefficient - 1) <= tolerance ||
        Math.abs(coefficient + 1) <= tolerance
    ) {
        return false;
    }

    if (meaningfulNumericFactorCount < 2) {
        const magnitude = Math.abs(coefficient);
        if (magnitude <= 1 + unitTolerance) {
            return false;
        }
    }

    const normalizedCoefficient = normalizeNumericCoefficient(coefficient);
    if (normalizedCoefficient === null) {
        return false;
    }

    const clonedOperand = cloneMultiplicativeTerms(nonNumericTerms, node);
    const literal = createNumericLiteral(normalizedCoefficient, node);

    if (!clonedOperand || !literal) {
        return false;
    }

    node.operator = "*";
    node.left = clonedOperand;
    node.right = literal;

    return true;
}

function attemptCollectDistributedScalars(node, context) {
    if (!Core.isBinaryOperator(node, "+") || Core.hasComment(node)) {
        return false;
    }

    if (Core.hasInlineCommentBetween(node.left, node.right, context)) {
        return false;
    }

    const terms = [];
    collectAdditionTerms(node, terms);

    if (terms.length < 2) {
        return false;
    }

    let baseDetails = null;
    let coefficient = 0;

    for (const term of terms) {
        const details = extractScalarAdditionTerm(term, context);
        if (!details || !details.base || !details.rawBase || details.hasExplicitCoefficient !== true) {
            return false;
        }

        if (!baseDetails) {
            if (!AST.isSafeOperand(details.base)) {
                return false;
            }

            baseDetails = details;
        } else if (!areNodesEquivalent(baseDetails.base, details.base)) {
            return false;
        }

        coefficient += details.coefficient;
    }

    if (!baseDetails || !Number.isFinite(coefficient)) {
        return false;
    }

    const zeroTolerance = computeNumericTolerance(0);
    const unitTolerance = computeNumericTolerance(1);

    if (Math.abs(coefficient) <= zeroTolerance) {
        mutateToNumericLiteral(node, 0, node);
        return true;
    }

    if (Math.abs(coefficient - 1) <= unitTolerance) {
        const baseClone = Core.cloneAstNode(baseDetails.rawBase);
        if (!baseClone) {
            return false;
        }

        replaceNodeByMutation(node, baseClone);
        return true;
    }

    if (Math.abs(coefficient + 1) <= unitTolerance) {
        const baseClone = Core.cloneAstNode(baseDetails.rawBase);
        if (!baseClone) {
            return false;
        }

        const negated = createNegatedExpression(baseClone, node);
        if (!negated) {
            return false;
        }

        replaceNode(node, negated);
        return true;
    }

    const normalizedCoefficient = normalizeNumericCoefficient(coefficient);
    if (normalizedCoefficient === null) {
        return false;
    }

    const baseClone = Core.cloneAstNode(baseDetails.rawBase);
    const literal = createNumericLiteral(normalizedCoefficient, node);

    if (!baseClone || !literal) {
        return false;
    }

    node.operator = "*";
    node.left = baseClone;
    node.right = literal;

    return true;
}

function attemptConvertSquare(node, context) {
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
        unwrapEnclosingParentheses(node, context);
        return true;
    }

    const factors = [];
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

function attemptConvertRepeatedPower(node, context) {
    if (!Core.isBinaryOperator(node, "*") || Core.hasComment(node)) {
        return false;
    }

    const factors = [];
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
    unwrapEnclosingParentheses(node, context);
    return true;
}

function attemptConvertMean(node, context) {
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
    unwrapEnclosingParentheses(node, context);
    return true;
}

function attemptConvertLog2(node, context) {
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
    unwrapEnclosingParentheses(node, context);
    return true;
}

function attemptConvertDotProducts(node, context) {
    if (!Core.isBinaryOperator(node, "+") || Core.hasComment(node)) {
        return false;
    }

    const terms = [];
    collectAdditionTerms(node, terms);

    if (terms.length !== 2 && terms.length !== 3) {
        return false;
    }

    const leftVector = [];
    const rightVector = [];

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
    unwrapEnclosingParentheses(node, context);
    return true;
}

function isDotProductOperandCandidate(node) {
    if (!node || Core.hasComment(node)) {
        return false;
    }

    return node.type === IDENTIFIER || node.type === MEMBER_DOT_EXPRESSION || node.type === MEMBER_INDEX_EXPRESSION;
}

function attemptConvertPointDistanceCall(node, context) {
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

    const args = [];
    for (const difference of match) {
        args.push(Core.cloneAstNode(difference.subtrahend));
    }
    for (const difference of match) {
        args.push(Core.cloneAstNode(difference.minuend));
    }

    const functionName = match.length === 2 ? "point_distance" : "point_distance_3d";

    mutateToCallExpression(node, functionName, args, node);
    unwrapEnclosingParentheses(node, context);
    return true;
}

function attemptConvertPowerToSqrt(node, context) {
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
    unwrapEnclosingParentheses(node, context);
    return true;
}

function attemptConvertPowerToExp(node, context) {
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
    unwrapEnclosingParentheses(node, context);
    return true;
}

function attemptConvertPointDirection(node, context) {
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
    unwrapEnclosingParentheses(node, context);
    return true;
}

function matchSquaredDifferences(expression) {
    const terms = [];
    collectAdditionTerms(expression, terms);

    if (terms.length < 2 || terms.length > 3) {
        return null;
    }

    const differences = [];

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

function matchDifference(node) {
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

function collectAdditionTerms(node, output) {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression) {
        return;
    }

    if (expression.type === BINARY_EXPRESSION && expression.operator === "+") {
        collectAdditionTerms(expression.left, output);
        collectAdditionTerms(expression.right, output);
        return;
    }

    output.push(expression);
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

function extractScalarAdditionTerm(expression, context) {
    if (!expression || Core.hasComment(expression)) {
        return null;
    }

    if (expression.type === BINARY_EXPRESSION && expression.operator === "*") {
        const rawLeft = expression.left;
        const rawRight = expression.right;

        if (!rawLeft || !rawRight) {
            return null;
        }

        if (
            Core.hasComment(rawLeft) ||
            Core.hasComment(rawRight) ||
            Core.hasInlineCommentBetween(rawLeft, rawRight, context)
        ) {
            return null;
        }

        const left = Core.unwrapParenthesizedExpression(rawLeft);
        const right = Core.unwrapParenthesizedExpression(rawRight);

        if (!left || !right) {
            return null;
        }

        if (Core.hasComment(left) || Core.hasComment(right)) {
            return null;
        }

        const leftValue = parseNumericFactor(left);
        const rightValue = parseNumericFactor(right);

        if (leftValue !== null && rightValue !== null) {
            return null;
        }

        if (leftValue !== null) {
            return {
                coefficient: leftValue,
                base: right,
                rawBase: rawRight,
                hasExplicitCoefficient: true
            };
        }

        if (rightValue !== null) {
            return {
                coefficient: rightValue,
                base: left,
                rawBase: rawLeft,
                hasExplicitCoefficient: true
            };
        }

        return null;
    }

    const literalValue = parseNumericFactor(expression);
    if (literalValue !== null) {
        return {
            coefficient: literalValue,
            base: null,
            rawBase: null,
            hasExplicitCoefficient: false
        };
    }

    return {
        coefficient: 1,
        base: expression,
        rawBase: expression,
        hasExplicitCoefficient: false
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

function collectMultiplicativeChain(node, output, includeInDenominator, context) {
    collapseUnitMinusHalfFactor(node, context);

    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression) {
        return false;
    }

    if (expression.type === BINARY_EXPRESSION) {
        const operator = expression.operator;

        if (operator === "*" || operator === "/") {
            if (Core.hasInlineCommentBetween(expression.left, expression.right, context)) {
                return false;
            }

            if (operator === "/") {
                const rightExpression = Core.unwrapParenthesizedExpression(expression.right);
                if (!rightExpression) {
                    return false;
                }

                if (parseNumericFactor(rightExpression) === null) {
                    const collection = includeInDenominator ? output.denominators : output.numerators;

                    collection.push({ raw: node, expression });
                    return true;
                }
            }

            if (!collectMultiplicativeChain(expression.left, output, includeInDenominator, context)) {
                return false;
            }

            if (operator === "/") {
                return collectMultiplicativeChain(expression.right, output, !includeInDenominator, context);
            }

            return collectMultiplicativeChain(expression.right, output, includeInDenominator, context);
        }
    }

    const collection = includeInDenominator ? output.denominators : output.numerators;

    collection.push({ raw: node, expression });
    return true;
}

function collapseUnitMinusHalfFactor(node, context) {
    if (!isObjectLike(node)) {
        return false;
    }

    if (node.type !== PARENTHESIZED_EXPRESSION || Core.hasComment(node)) {
        return false;
    }

    const difference = Core.unwrapParenthesizedExpression(node.expression);

    if (!difference || difference.type !== BINARY_EXPRESSION) {
        return false;
    }

    if (difference.operator !== "-") {
        return false;
    }

    if (Core.hasComment(difference)) {
        return false;
    }

    const rawLeft = difference.left;
    const rawRight = difference.right;

    if (!rawLeft || !rawRight) {
        return false;
    }

    if (Core.hasComment(rawLeft) || Core.hasComment(rawRight)) {
        return false;
    }

    if (Core.hasInlineCommentBetween(rawLeft, rawRight, context)) {
        return false;
    }

    const leftValue = parseNumericFactor(rawLeft);
    const rightValue = parseNumericFactor(rawRight);

    if (leftValue === null || rightValue === null) {
        return false;
    }

    const unitTolerance = computeNumericTolerance(1);
    const halfTolerance = computeNumericTolerance(0.5);

    if (Math.abs(leftValue - 1) > unitTolerance) {
        return false;
    }

    if (Math.abs(rightValue - 0.5) > halfTolerance) {
        return false;
    }

    mutateToNumericLiteral(node, 0.5, node);
    return true;
}

function areNodesApproximatelyEquivalent(a, b) {
    if (areNodesEquivalent(a, b)) {
        return true;
    }

    const left = Core.unwrapParenthesizedExpression(a);
    const right = Core.unwrapParenthesizedExpression(b);

    if (!left || !right || left.type !== right.type) {
        return false;
    }

    switch (left.type) {
        case IDENTIFIER: {
            return left.name === right.name;
        }
        case LITERAL: {
            const leftNumber = Core.getLiteralNumberValue(left);
            const rightNumber = Core.getLiteralNumberValue(right);

            if (typeof leftNumber === "number" && typeof rightNumber === "number") {
                return areLiteralNumbersApproximatelyEqual(leftNumber, rightNumber);
            }

            return false;
        }
        case BINARY_EXPRESSION: {
            return (
                left.operator === right.operator &&
                areNodesApproximatelyEquivalent(left.left, right.left) &&
                areNodesApproximatelyEquivalent(left.right, right.right)
            );
        }
        case UNARY_EXPRESSION: {
            return left.operator === right.operator && areNodesApproximatelyEquivalent(left.argument, right.argument);
        }
        default: {
            return false;
        }
    }
}

function areNodesEquivalent(a, b) {
    const left = Core.unwrapParenthesizedExpression(a);
    const right = Core.unwrapParenthesizedExpression(b);

    if (left === right) {
        return true;
    }

    if (!left || !right || left.type !== right.type) {
        return false;
    }

    switch (left.type) {
        case IDENTIFIER: {
            return left.name === right.name;
        }
        case LITERAL: {
            return left.value === right.value;
        }
        case MEMBER_DOT_EXPRESSION: {
            return areNodesEquivalent(left.object, right.object) && areNodesEquivalent(left.property, right.property);
        }
        case MEMBER_INDEX_EXPRESSION: {
            return (
                areNodesEquivalent(left.object, right.object) && compareIndexProperties(left.property, right.property)
            );
        }
        case BINARY_EXPRESSION: {
            return (
                left.operator === right.operator &&
                areNodesEquivalent(left.left, right.left) &&
                areNodesEquivalent(left.right, right.right)
            );
        }
        case UNARY_EXPRESSION: {
            return left.operator === right.operator && areNodesEquivalent(left.argument, right.argument);
        }
        case CALL_EXPRESSION: {
            const leftName = Core.getUnwrappedIdentifierName(left.object);
            const rightName = Core.getUnwrappedIdentifierName(right.object);

            if (leftName !== rightName) {
                return false;
            }

            const leftArgs = Core.asArray<any>(left.arguments);
            const rightArgs = Core.asArray<any>(right.arguments);

            if (leftArgs.length !== rightArgs.length) {
                return false;
            }

            for (const [index, leftArg] of leftArgs.entries()) {
                if (!areNodesEquivalent(leftArg, rightArgs[index])) {
                    return false;
                }
            }

            return true;
        }
        default: {
            return false;
        }
    }
}

function compareIndexProperties(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
    }

    for (const [index, element] of a.entries()) {
        if (!areNodesEquivalent(element, b[index])) {
            return false;
        }
    }

    return true;
}

// Remaining module-specific exports (all other symbols from math-ast-mutation.ts
// are already re-exported at the top of this file).
export {
    attemptCancelReciprocalRatios,
    attemptCollectDistributedScalars,
    attemptCondenseNumericChainWithMultipleBases,
    attemptCondenseScalarProduct,
    attemptCondenseSimpleScalarProduct,
    attemptRemoveAdditiveIdentity,
    attemptRemoveMultiplicativeIdentity,
    attemptSimplifyDivisionByReciprocal,
    attemptSimplifyNegativeDivisionProduct,
    attemptSimplifyOneMinusFactor
};

export { replaceNodeWith } from "./math-ast-builders.js";
export { isIdentityReplacementSafeExpression } from "./math-lengthdir-transforms.js";
export { areAllSafeOperands, isSafeOperand, isSafeReciprocalCancellationOperand } from "./math-lengthdir-transforms.js";
export { attemptConvertDegreesToRadians, matchDegreesToRadians } from "./math-trig-conversions.js";
