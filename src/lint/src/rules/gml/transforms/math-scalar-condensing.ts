/**
 * Scalar condensing helpers for AST nodes that represent multiplication and addition chains.
 */
import { Core } from "@gmloop/core";

import {
    cloneMultiplicativeTerms,
    createBinaryExpressionNode,
    createCallExpressionNode,
    createNegatedExpression,
    createNumericLiteral,
    createParenthesizedExpressionNode,
    createUnaryNegationNode,
    mutateToNumericLiteral,
    replaceNodeWith as replaceNodeByMutation
} from "./math-ast-builders.js";
import type { ConvertManualMathTransformOptions } from "./math-ast-mutation.js";
import * as AST from "./math-ast-mutation.js";
import {
    isSafeReciprocalCancellationOperand,
    matchScaledOperand,
    unwrapEnclosingParentheses
} from "./math-lengthdir-transforms.js";
import {
    computeIntegerGcd,
    computeNumericTolerance,
    normalizeNumericCoefficient,
    parseNumericFactor,
    scaleNumericLiteralCoefficient
} from "./math-numeric-utils.js";

export * from "./math-ast-mutation.js";
export { findParentEntry, unwrapEnclosingParentheses } from "./math-lengthdir-transforms.js";

const {
    BINARY_EXPRESSION,
    CALL_EXPRESSION,
    IDENTIFIER,
    LITERAL,
    MEMBER_DOT_EXPRESSION,
    MEMBER_INDEX_EXPRESSION,
    PARENTHESIZED_EXPRESSION,
    UNARY_EXPRESSION,
    isObjectLike
} = Core;

type MultiplicativeChain = {
    numerators: Array<{ raw: any; expression: any }>;
    denominators: Array<{ raw: any; expression: any }>;
};

type ReciprocalRatioTerm = {
    index: number;
    numerator: any;
    denominator: any;
};

type ReciprocalRatioRemovalPlan = {
    indicesToRemove: Set<number>;
    replacementsByIndex: Map<number, any[]>;
};

export function areNodesEquivalent(a, b) {
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

            const leftArgs = Core.asArray(left.arguments);
            const rightArgs = Core.asArray(right.arguments);

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

export function compareIndexProperties(a, b) {
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

export function areNodesApproximatelyEquivalent(a, b) {
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
                const tolerance = computeNumericTolerance(Math.max(Math.abs(leftNumber), Math.abs(rightNumber)));
                return Math.abs(leftNumber - rightNumber) <= tolerance;
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

export function applyScalarCondensing(node: any, context: ConvertManualMathTransformOptions | null): any {
    if (!isObjectLike(node)) {
        return node;
    }

    let iterations = 0;
    let changed = true;
    while (changed && iterations < 10) {
        changed = false;
        iterations += 1;

        if (AST.isSafeOperand(node) && attemptCondenseScalarProduct(node, context)) {
            changed = true;
        }
    }

    return node;
}

function matchLengthdirReassignment(
    node: any,
    baseName: string
): {
    functionName: string;
    angle: any;
    callExpression: any;
    factor: number;
    factorNode: any;
} | null {
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

    const [lengthArg, angleArg] = args;
    if (!lengthArg || !angleArg) {
        return null;
    }

    const scaledInfo = matchScaledOperand(lengthArg, null);
    if (!scaledInfo || scaledInfo.coefficient === null || !scaledInfo.base) {
        return null;
    }

    if (!areNodesEquivalent(scaledInfo.base, { type: IDENTIFIER, name: baseName })) {
        return null;
    }

    return {
        functionName: calleeName,
        angle: angleArg,
        callExpression: expression,
        factor: scaledInfo.coefficient,
        factorNode: scaledInfo.factorNode
    };
}

export function combineLengthdirScalarAssignments(node: any): void {
    if (!isObjectLike(node)) {
        return;
    }

    const body = Core.getBodyStatements(node);
    if (!body) {
        Core.visitNonTraversalChildValues(node, (child) => {
            combineLengthdirScalarAssignments(child);
        });
        return;
    }

    for (let index = 0; index < body.length - 1; index += 1) {
        const declaration = body[index];
        const next = body[index + 1];

        if (
            !isObjectLike(declaration) ||
            declaration.type !== "VariableDeclaration" ||
            !Array.isArray(declaration.declarations) ||
            declaration.declarations.length !== 1 ||
            Core.hasComment(declaration)
        ) {
            continue;
        }

        const [declarator] = declaration.declarations;
        if (!declarator || Core.hasComment(declarator) || !declarator.init || Core.hasComment(declarator.init)) {
            continue;
        }

        const assignment = next.type === "ExpressionStatement" ? (next as any).expression : next;
        if (
            !assignment ||
            assignment.type !== "AssignmentExpression" ||
            assignment.operator !== "=" ||
            Core.hasComment(next) ||
            Core.hasComment(assignment)
        ) {
            continue;
        }

        const declaratorId = (declarator as any).id;
        const assignmentLeft = assignment.left;
        const baseName = Core.getUnwrappedIdentifierName(declaratorId);
        if (!baseName || Core.getUnwrappedIdentifierName(assignmentLeft) !== baseName) {
            continue;
        }

        const match = matchLengthdirReassignment(assignment.right, baseName);
        if (!match) {
            continue;
        }

        const initClone = Core.cloneAstNode(declarator.init);
        if (!initClone) {
            continue;
        }

        let baseTimesFactor = initClone;

        if (!scaleNumericLiteralCoefficient(baseTimesFactor, match.factor)) {
            const normalizedFactor = normalizeNumericCoefficient(match.factor);
            if (normalizedFactor === null) {
                continue;
            }

            const factorLiteral = createNumericLiteral(normalizedFactor, match.factorNode);
            if (!factorLiteral) {
                continue;
            }

            baseTimesFactor = createBinaryExpressionNode("*", baseTimesFactor, factorLiteral, assignment.right);
        }

        const callOneLiteral = createNumericLiteral("1", assignment.right);
        const differenceOneLiteral = createNumericLiteral("1", assignment.right);
        if (!callOneLiteral || !differenceOneLiteral) {
            continue;
        }

        const lengthdirCall = createCallExpressionNode(
            match.functionName,
            [callOneLiteral, Core.cloneAstNode(match.angle)],
            match.callExpression
        );
        if (!lengthdirCall) {
            continue;
        }

        const difference = createBinaryExpressionNode("-", differenceOneLiteral, lengthdirCall, assignment.right);
        const parenthesizedDifference = createParenthesizedExpressionNode(difference, assignment.right);
        if (!parenthesizedDifference) {
            continue;
        }

        const finalExpression = createBinaryExpressionNode(
            "*",
            baseTimesFactor,
            parenthesizedDifference,
            assignment.right
        );
        applyScalarCondensing(finalExpression, null);

        declarator.init = finalExpression;
        const mutableBody = body as any[];
        mutableBody.splice(index + 1, 1);
        continue;
    }

    for (const element of body) {
        if (isObjectLike(element)) {
            combineLengthdirScalarAssignments(element);
        }
    }
}

export function collectMultiplicativeChain(
    node: any,
    output: MultiplicativeChain,
    includeInDenominator: boolean,
    context: ConvertManualMathTransformOptions | null
): boolean {
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

export function collapseUnitMinusHalfFactor(node: any, context: ConvertManualMathTransformOptions | null): boolean {
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

function cancelSimpleReciprocalNumeratorPairs(terms: any[]): boolean {
    if (!Array.isArray(terms) || terms.length < 2) {
        return false;
    }

    const consumed = new Set<number>();
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

    const remaining: any[] = [];
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

function areSimpleExpressionsEquivalent(left: any, right: any): boolean {
    return areNodesApproximatelyEquivalent(left, right);
}

export function attemptCondenseSimpleScalarProduct(
    node: any,
    context: ConvertManualMathTransformOptions | null
): boolean {
    if (!Core.isBinaryOperator(node, "*")) {
        return false;
    }

    const chain: MultiplicativeChain = { numerators: [], denominators: [] };
    if (!collectMultiplicativeChain(node, chain, false, null)) {
        return false;
    }

    const nonNumericTerms: any[] = [];
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

// ---------------------------------------------------------------------------
// attemptCondenseScalarProduct
// ---------------------------------------------------------------------------

export function attemptCondenseScalarProduct(node, context): boolean {
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

// ---------------------------------------------------------------------------
// computeScalarRatioMetadata
// ---------------------------------------------------------------------------

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

    const toApproxInteger = (n: number): number | null => {
        if (!Number.isFinite(n)) return null;
        const rounded = Math.round(n);
        if (Math.abs(n - rounded) > computeNumericTolerance(n)) return null;
        return rounded;
    };

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

// ---------------------------------------------------------------------------
// attemptCondenseNumericChainWithMultipleBases
// ---------------------------------------------------------------------------

export function attemptCondenseNumericChainWithMultipleBases(node, context): boolean {
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

// ---------------------------------------------------------------------------
// attemptCollectDistributedScalars
// ---------------------------------------------------------------------------

export function attemptCollectDistributedScalars(node, context) {
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

        replaceNodeByMutation(node, negated);
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

// ---------------------------------------------------------------------------
// collectAdditionTerms
// ---------------------------------------------------------------------------

export function collectAdditionTerms(node, output) {
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

// ---------------------------------------------------------------------------
// extractScalarAdditionTerm
// ---------------------------------------------------------------------------

export function extractScalarAdditionTerm(expression, context) {
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

// ---------------------------------------------------------------------------
// collectReciprocalRatioTerms
// ---------------------------------------------------------------------------

export function collectReciprocalRatioTerms({
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

// ---------------------------------------------------------------------------
// buildReciprocalRatioRemovalPlan
// ---------------------------------------------------------------------------

export function buildReciprocalRatioRemovalPlan({
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

// ---------------------------------------------------------------------------
// buildRemainingRatioTerms
// ---------------------------------------------------------------------------

export function buildRemainingRatioTerms({
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

// ---------------------------------------------------------------------------
// pushRatioReplacements
// ---------------------------------------------------------------------------

function pushRatioReplacements(remainingTerms: any[], replacements: any[] | undefined): boolean {
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

// ---------------------------------------------------------------------------
// buildReciprocalRatioReplacement
// ---------------------------------------------------------------------------

export function buildReciprocalRatioReplacement({ remainingTerms, node }: { remainingTerms: any[]; node: any }) {
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

// ---------------------------------------------------------------------------
// attemptCancelReciprocalRatios
// ---------------------------------------------------------------------------

export function attemptCancelReciprocalRatios(node: any, context: ConvertManualMathTransformOptions | null): boolean {
    if (!node) {
        return false;
    }

    if (!Core.isBinaryOperator(node, "*") && !Core.isBinaryOperator(node, "/")) {
        return false;
    }

    const chain: MultiplicativeChain = {
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
