/**
 * lengthdir-specific math simplification transforms.
 *
 * Extracted from `math-traversal-normalization.ts` to reduce its line count
 * and to group all lengthdir-related helpers together.
 *
 * Public exports mirror the original names so callers can import from either
 * module without changing behavior.
 */
import { Core } from "@gmloop/core";

import {
    createBinaryExpressionNode,
    createCallExpressionNode,
    createMultiplicationNode,
    createNumericLiteral,
    mutateToCallExpression,
    replaceNode,
    replaceNodeWith as replaceNodeByMutation
} from "./math-ast-builders.js";
import type { ConvertManualMathTransformOptions } from "./math-ast-mutation.js";
import { computeNumericTolerance, normalizeNumericCoefficient, parseNumericFactor } from "./math-numeric-utils.js";
import {
    attemptCollectDistributedScalars,
    attemptCondenseNumericChainWithMultipleBases,
    attemptCondenseScalarProduct
} from "./math-traversal-normalization.js";
import { identifyTrigCall } from "./math-trig-conversions.js";

const {
    ASSIGNMENT_EXPRESSION,
    BINARY_EXPRESSION,
    CALL_EXPRESSION,
    IDENTIFIER,
    LITERAL,
    MEMBER_DOT_EXPRESSION,
    MEMBER_INDEX_EXPRESSION,
    PARENTHESIZED_EXPRESSION,
    UNARY_EXPRESSION,
    VARIABLE_DECLARATION,
    isObjectLike
} = Core;

export function unwrapEnclosingParentheses(node: any, context: ConvertManualMathTransformOptions | null) {
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

        if (!isSafeOperand(parent) && expression.type !== CALL_EXPRESSION) {
            break;
        }

        replaceNodeByMutation(parent, current);
        current = parent;
    }
}

export function findParentEntry(root: any, target: any) {
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

export function isSafeOperand(node: any): boolean {
    if (!isObjectLike(node)) {
        return false;
    }

    if (Core.hasComment(node)) {
        return false;
    }

    switch (node.type) {
        case IDENTIFIER:
        case LITERAL:
        case MEMBER_DOT_EXPRESSION:
        case MEMBER_INDEX_EXPRESSION: {
            return true;
        }
        case PARENTHESIZED_EXPRESSION: {
            return isSafeOperand(node.expression);
        }
        default: {
            return false;
        }
    }
}

/**
 * True when `node` represents an operand that can be safely used in reciprocal-cancellation
 * transforms. Unary `-` is allowed since negating does not affect zero-checks.
 * Delegates to `isSafeOperand` for all other cases.
 */
export function isSafeReciprocalCancellationOperand(node: any): boolean {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression) {
        return false;
    }

    if (expression.type === UNARY_EXPRESSION && expression.operator === "-") {
        return isSafeReciprocalCancellationOperand(expression.argument);
    }

    return isSafeOperand(expression);
}

/**
 * True when every element of `nodes` is a safe operand for math transforms.
 * Returns `false` for non-array inputs.
 */
export function areAllSafeOperands(nodes: unknown): boolean {
    if (!Array.isArray(nodes)) {
        return false;
    }

    return nodes.every((node) => isSafeOperand(node));
}

export function matchScaledOperand(rawExpression: any, context: ConvertManualMathTransformOptions | null) {
    if (!rawExpression || Core.hasComment(rawExpression)) {
        return null;
    }

    const expression = Core.unwrapParenthesizedExpression(rawExpression);
    if (!expression) {
        return null;
    }

    if (Core.hasComment(expression)) {
        return null;
    }

    if (expression.type === UNARY_EXPRESSION) {
        if (expression.operator === "-" || expression.operator === "+") {
            const inner = matchScaledOperand(expression.argument, context);

            if (!inner) {
                return null;
            }

            const coefficient = expression.operator === "-" ? -inner.coefficient : inner.coefficient;

            return {
                coefficient,
                base: inner.base,
                rawBase: inner.rawBase
            };
        }

        return null;
    }

    if (expression.type !== BINARY_EXPRESSION) {
        return null;
    }

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

    if (expression.operator === "*") {
        const rightBase = Core.unwrapParenthesizedExpression(rawRight);
        if (leftValue !== null && rightValue === null && rightBase) {
            return {
                coefficient: leftValue,
                base: rightBase,
                rawBase: rawRight
            };
        }

        const leftBase = Core.unwrapParenthesizedExpression(rawLeft);
        if (rightValue !== null && leftValue === null && leftBase) {
            return {
                coefficient: rightValue,
                base: leftBase,
                rawBase: rawLeft
            };
        }

        return null;
    }

    if (expression.operator === "/") {
        if (rightValue === null) {
            return null;
        }

        if (Math.abs(rightValue) <= computeNumericTolerance(0)) {
            return null;
        }

        const numerator = Core.unwrapParenthesizedExpression(rawLeft);
        if (!numerator) {
            return null;
        }

        return {
            coefficient: 1 / rightValue,
            base: numerator,
            rawBase: rawLeft
        };
    }

    return null;
}

// ---------------------------------------------------------------------------
// lengthdir-specific helpers
// ---------------------------------------------------------------------------

export function matchLengthdirReassignment(expression: any, identifierName: string): any {
    const root = Core.unwrapParenthesizedExpression(expression);
    if (!root || root.type !== BINARY_EXPRESSION || root.operator !== "-") {
        return null;
    }

    const callExpression = Core.unwrapParenthesizedExpression(root.right);
    if (!callExpression || callExpression.type !== CALL_EXPRESSION) {
        return null;
    }

    if (Core.hasComment(callExpression)) {
        return null;
    }

    const functionName = Core.getUnwrappedIdentifierName(callExpression.object);
    if (functionName !== "lengthdir_x") {
        return null;
    }

    const args = Core.asArray<any>(callExpression.arguments);

    if (args.length !== 2) {
        return null;
    }

    const magnitudeInfo = matchIdentifierTimesFactor(args[0], identifierName);
    if (!magnitudeInfo) {
        return null;
    }

    const left = Core.unwrapParenthesizedExpression(root.left);
    const difference = Core.unwrapParenthesizedExpression(left);
    if (!difference || difference.type !== BINARY_EXPRESSION || difference.operator !== "-") {
        return null;
    }

    if (!Core.isUnwrappedIdentifierWithName(difference.left, identifierName)) {
        return null;
    }

    const subtractInfo = matchIdentifierTimesFactor(difference.right, identifierName);

    if (!subtractInfo) {
        return null;
    }

    const tolerance = computeNumericTolerance(0);
    if (Math.abs(magnitudeInfo.factor - subtractInfo.factor) > tolerance) {
        return null;
    }

    return {
        factor: magnitudeInfo.factor,
        factorNode: subtractInfo.literalNode ?? magnitudeInfo.literalNode,
        angle: args[1],
        functionName,
        callExpression
    };
}

function matchIdentifierTimesFactor(expression: any, identifierName: string) {
    const unwrapped = Core.unwrapParenthesizedExpression(expression);
    if (!unwrapped || Core.hasComment(unwrapped)) {
        return null;
    }

    if (unwrapped.type !== BINARY_EXPRESSION) {
        return null;
    }

    const operator = Core.getNormalizedOperator(unwrapped);

    let factorNode;
    let factorValue;

    if (operator === "*") {
        if (Core.isUnwrappedIdentifierWithName(unwrapped.left, identifierName)) {
            factorNode = unwrapped.right;
        } else if (Core.isUnwrappedIdentifierWithName(unwrapped.right, identifierName)) {
            factorNode = unwrapped.left;
        } else {
            return null;
        }

        factorValue = parseNumericFactor(factorNode);
    } else if (operator === "/") {
        if (!Core.isUnwrappedIdentifierWithName(unwrapped.left, identifierName)) {
            return null;
        }

        const divisorValue = parseNumericFactor(unwrapped.right);
        if (divisorValue === null) {
            return null;
        }

        if (Math.abs(divisorValue) <= computeNumericTolerance(0)) {
            return null;
        }

        factorNode = unwrapped.right;
        factorValue = 1 / divisorValue;
    } else {
        return null;
    }

    if (factorValue === null) {
        return null;
    }

    const literalNode = Core.unwrapParenthesizedExpression(factorNode) ?? factorNode;

    return {
        factor: factorValue,
        literalNode
    };
}

export function matchLengthdirScaledOperand(node: any, context: ConvertManualMathTransformOptions | null) {
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

// ---------------------------------------------------------------------------
// Public normalization entry points
// ---------------------------------------------------------------------------

export function attemptConvertLengthDir(node: any, context: ConvertManualMathTransformOptions | null): boolean {
    if (!Core.isBinaryOperator(node, "*") || Core.hasComment(node)) {
        return false;
    }

    const leftInfo = extractSignedOperand(node.left);
    const rightInfo = extractSignedOperand(node.right);

    const candidates = [
        { length: leftInfo, trig: rightInfo },
        { length: rightInfo, trig: leftInfo }
    ];

    for (const candidate of candidates) {
        const trigInfo = identifyTrigCall(candidate.trig.node);
        if (!trigInfo) {
            continue;
        }

        const lengthNode = Core.unwrapParenthesizedExpression(candidate.length.node);
        if (!lengthNode || !isSafeOperand(lengthNode)) {
            continue;
        }

        const overallNegative = candidate.length.negative !== candidate.trig.negative;

        if (trigInfo.kind === "cos") {
            if (overallNegative) {
                continue;
            }

            mutateToCallExpression(
                node,
                "lengthdir_x",
                [Core.cloneAstNode(lengthNode), Core.cloneAstNode(trigInfo.argument)],
                node
            );
            unwrapEnclosingParentheses(node, context);
            return true;
        }

        if (trigInfo.kind === "sin") {
            if (!overallNegative) {
                continue;
            }

            mutateToCallExpression(
                node,
                "lengthdir_y",
                [Core.cloneAstNode(lengthNode), Core.cloneAstNode(trigInfo.argument)],
                node
            );
            unwrapEnclosingParentheses(node, context);
            return true;
        }
    }

    return false;
}

export function attemptSimplifyLengthdirHalfDifference(
    node: any,
    context: ConvertManualMathTransformOptions | null
): boolean {
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

    if (!isSafeOperand(minuend)) {
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

    const normalizedCoefficient = normalizeNumericCoefficient((scaledCoefficient + lengthCoefficient) / 2);

    if (normalizedCoefficient === null) {
        return false;
    }

    const angleClone = Core.cloneAstNode(lengthDirInfo.angle);
    const normalizedLengthArg = createNumericLiteral(1, lengthDirInfo.rawLength);

    if (!angleClone || !normalizedLengthArg) {
        return false;
    }

    const groupedDifference = createBinaryExpressionNode(
        "-",
        minuend,
        createCallExpressionNode(lengthDirInfo.calleeName, [normalizedLengthArg, angleClone], node),
        node
    );

    if (!groupedDifference) {
        return false;
    }

    promoteLengthdirHalfDifference(context, node, identifierName, normalizedCoefficient, groupedDifference);
    return true;
}

export function promoteLengthdirHalfDifference(
    context: ConvertManualMathTransformOptions | null,
    expressionNode: any,
    identifierName: string,
    normalizedCoefficient: string,
    groupedDifference: any
): void {
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

    const assignment = findAssignmentExpressionForRight(root, expressionNode);
    if (!assignment) {
        return;
    }

    if (Core.getUnwrappedIdentifierName(assignment.left) !== identifierName) {
        return;
    }

    const declaration = findVariableDeclarationByName(root, identifierName);
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

    markPreviousSiblingForBlankLine(root, assignment, context);
    removeNodeFromAst(root, assignment);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function extractSignedOperand(node: any): { node: any; negative: boolean } {
    if (!node) {
        return { node, negative: false };
    }

    const unwrapped = Core.unwrapParenthesizedExpression(node);

    if (unwrapped && unwrapped.type === BINARY_EXPRESSION && Core.getNormalizedOperator(unwrapped) === "*") {
        const left = Core.unwrapParenthesizedExpression(unwrapped.left);
        const right = Core.unwrapParenthesizedExpression(unwrapped.right);

        if (left && right) {
            const leftNumeric = parseNumericFactor(left);
            const rightNumeric = parseNumericFactor(right);

            if (leftNumeric !== null && Math.abs(leftNumeric + 1) <= computeNumericTolerance(1)) {
                return { node: right, negative: true };
            }

            if (rightNumeric !== null && Math.abs(rightNumeric + 1) <= computeNumericTolerance(1)) {
                return { node: left, negative: true };
            }
        }
    }

    if (unwrapped && unwrapped.type === UNARY_EXPRESSION && unwrapped.operator === "-") {
        return { node: unwrapped.argument, negative: true };
    }

    return { node, negative: false };
}

export function isIdentityReplacementSafeExpression(node: any): boolean {
    if (!isObjectLike(node)) {
        return false;
    }

    if (Core.hasComment(node)) {
        return false;
    }

    switch (node.type) {
        case IDENTIFIER:
        case LITERAL:
        case CALL_EXPRESSION:
        case MEMBER_DOT_EXPRESSION:
        case MEMBER_INDEX_EXPRESSION: {
            return true;
        }
        case PARENTHESIZED_EXPRESSION: {
            return isIdentityReplacementSafeExpression(node.expression);
        }
        default: {
            return false;
        }
    }
}

function areNodesEquivalent(a: any, b: any): boolean {
    if (a === b) {
        return true;
    }

    if (!a || !b) {
        return false;
    }

    if (typeof a !== "object" || typeof b !== "object") {
        return false;
    }

    if (a.type !== b.type) {
        return false;
    }

    if (a.type === LITERAL) {
        const aVal = Core.getLiteralNumberValue(a);
        const bVal = Core.getLiteralNumberValue(b);
        if (aVal !== null && bVal !== null) {
            return Math.abs(aVal - bVal) <= computeNumericTolerance(0);
        }
        return String(a.value) === String(b.value);
    }

    if (a.type === IDENTIFIER) {
        return Core.getUnwrappedIdentifierName(a) === Core.getUnwrappedIdentifierName(b);
    }

    if (a.type === MEMBER_DOT_EXPRESSION || a.type === MEMBER_INDEX_EXPRESSION) {
        return areNodesEquivalent(a.object, b.object) && areNodesEquivalent(a.property, b.property);
    }

    if (a.type === CALL_EXPRESSION) {
        const aName = Core.getUnwrappedIdentifierName(a.object);
        const bName = Core.getUnwrappedIdentifierName(b.object);

        if (aName !== bName) {
            return false;
        }

        const aArgs = Core.asArray<any>(a.arguments);
        const bArgs = Core.asArray<any>(b.arguments);

        if (aArgs.length !== bArgs.length) {
            return false;
        }

        for (const [i, aArg] of aArgs.entries()) {
            if (!areNodesEquivalent(aArg, bArgs[i])) {
                return false;
            }
        }

        return true;
    }

    if (a.type === BINARY_EXPRESSION) {
        if (Core.getNormalizedOperator(a) !== Core.getNormalizedOperator(b)) {
            return false;
        }

        return areNodesEquivalent(a.left, b.left) && areNodesEquivalent(a.right, b.right);
    }

    return false;
}

function findAssignmentExpressionForRight(root: any, target: any): any {
    if (!root || !target) {
        return null;
    }

    const stack = [root];
    const visited = new Set();

    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== "object" || visited.has(node)) {
            continue;
        }
        visited.add(node);

        if (node.type === ASSIGNMENT_EXPRESSION && node.right === target) {
            return node;
        }

        if (Array.isArray(node)) {
            for (const element of node) {
                stack.push(element);
            }
            continue;
        }

        for (const value of Object.values(node)) {
            if (value && typeof value === "object") {
                stack.push(value);
            }
        }
    }

    return null;
}

function findVariableDeclarationByName(root: any, identifierName: string): any {
    if (!root || !identifierName) {
        return null;
    }

    const stack = [root];
    const visited = new Set();

    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== "object" || visited.has(node)) {
            continue;
        }
        visited.add(node);

        if (node.type === VARIABLE_DECLARATION && Array.isArray(node.declarations)) {
            for (const declarator of node.declarations) {
                if (Core.isUnwrappedIdentifierWithName(declarator?.id, identifierName)) {
                    return node;
                }
            }
        }

        if (Array.isArray(node)) {
            for (const element of node) {
                stack.push(element);
            }
            continue;
        }

        for (const value of Object.values(node)) {
            if (value && typeof value === "object") {
                stack.push(value);
            }
        }
    }

    return null;
}

type TargetArraySearchDirection = "forward" | "backward";
type TargetArrayEntry = { nodeArray: Array<any>; targetIndex: number };

function findTargetArrayEntry(root: any, target: any, _direction: TargetArraySearchDirection): TargetArrayEntry | null {
    const stack = [{ parent: null, key: null, node: root }];
    const visited = new Set();

    while (stack.length > 0) {
        const { parent, key, node } = stack.pop();
        if (node === target) {
            if (Array.isArray(parent) && typeof key === "number") {
                return { nodeArray: parent, targetIndex: key };
            }
            return null;
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

function removeNodeFromAst(root: any, target: any): boolean {
    if (!root || !target) {
        return false;
    }

    const entry = findTargetArrayEntry(root, target, "forward");
    if (!entry) {
        return false;
    }

    entry.nodeArray.splice(entry.targetIndex, 1);
    return true;
}

function markPreviousSiblingForBlankLine(root: any, target: any, context: ConvertManualMathTransformOptions | null) {
    if (!isObjectLike(root) || !target) {
        return null;
    }

    const sourceText =
        context && typeof context === "object" && typeof context.sourceText === "string" ? context.sourceText : null;
    const targetEntry = findTargetArrayEntry(root, target, "forward");
    if (!targetEntry) {
        return null;
    }

    return preserveBlankLineIfNeeded(targetEntry.nodeArray, targetEntry.targetIndex, target, sourceText);
}

function preserveBlankLineIfNeeded(nodeArray: Array<any>, index: number, target: any, sourceText: string | null) {
    const previous = nodeArray[index - 1];
    const next = nodeArray[index + 1];

    if (previous && typeof previous === "object" && shouldPreserveRemovedBlankLine(target, next, sourceText)) {
        (previous as Record<string, unknown>)._gmlForceFollowingEmptyLine = true;
        return previous;
    }

    return null;
}

function shouldPreserveRemovedBlankLine(removedNode: any, nextNode: any, sourceText: string | null): boolean {
    if (!isObjectLike(nextNode)) {
        return false;
    }

    if (typeof sourceText !== "string" || sourceText.length === 0) {
        return false;
    }

    const removedEnd = Core.getNodeEndIndex(removedNode);
    const nextStart = Core.getNodeStartIndex(nextNode);

    if (removedEnd == undefined || nextStart == undefined || nextStart <= removedEnd || nextStart > sourceText.length) {
        return false;
    }

    const between = sourceText.slice(removedEnd, nextStart);
    return /^\s*\n\s*\n/.test(between);
}
