/**
 * Trigonometric and angle-conversion simplification routines.
 * Handles degree↔radian patterns, `degtorad`/`radtodeg` wrappers, and
 * the GameMaker `dsin`/`dcos`/`dtan` degree-native function family.
 */
import { Core } from "@gmloop/core";

import { createCallExpressionNode, mutateToCallExpression } from "./math-ast-builders.js";
import {
    collectProductOperands,
    computeNumericTolerance,
    isLiteralNumber,
    isPiIdentifier
} from "./math-numeric-utils.js";

const { BINARY_EXPRESSION, CALL_EXPRESSION, isObjectLike: _isObjectLike } = Core;

// ---------------------------------------------------------------------------
// Conversion lookup tables
// ---------------------------------------------------------------------------

/** Maps radian-domain trig functions to their degree-native equivalents. */
const RADIAN_TRIG_TO_DEGREE = new Map([
    ["sin", "dsin"],
    ["cos", "dcos"],
    ["tan", "dtan"]
]);

/** Maps degree-native functions to their radian-domain counterparts. */
const DEGREE_TO_RADIAN_CONVERSIONS = new Map([
    ["dsin", { name: "sin", expectedArgs: 1 }],
    ["dcos", { name: "cos", expectedArgs: 1 }],
    ["dtan", { name: "tan", expectedArgs: 1 }],
    ["darcsin", { name: "arcsin", expectedArgs: 1 }],
    ["darccos", { name: "arccos", expectedArgs: 1 }],
    ["darctan", { name: "arctan", expectedArgs: 1 }],
    ["darctan2", { name: "arctan2", expectedArgs: 2 }]
]);

/** Maps radian-domain arc functions to their degree-native equivalents. */
const RADIAN_TO_DEGREE_CONVERSIONS = new Map([
    ["arcsin", { name: "darcsin", expectedArgs: 1 }],
    ["arccos", { name: "darccos", expectedArgs: 1 }],
    ["arctan", { name: "darctan", expectedArgs: 1 }],
    ["arctan2", { name: "darctan2", expectedArgs: 2 }]
]);

// ---------------------------------------------------------------------------
// Public simplifier handlers
// ---------------------------------------------------------------------------

/**
 * Convert a `angle * (pi / 180)` or `angle / 180 * pi` pattern into a
 * `degtorad(angle)` call.  Returns `true` when a transformation was applied.
 */
export function attemptConvertDegreesToRadians(node: unknown, context: unknown): boolean {
    if (
        (!Core.isBinaryOperator(node, "*") && !Core.isBinaryOperator(node, "/")) ||
        hasCommentsInDegreesToRadiansPattern(node, context, true)
    ) {
        return false;
    }

    const angle = matchDegreesToRadians(node);
    if (!angle) {
        return false;
    }

    mutateToCallExpression(node, "degtorad", [Core.cloneAstNode(angle)], node);
    return true;
}

/**
 * Simplify redundant `degtorad`/`radtodeg` wrappers around degree-native or
 * radian-domain trig calls, and convert `sin(angle * pi/180)` patterns into
 * `dsin(angle)`.  Returns `true` when a transformation was applied.
 */
export function attemptSimplifyTrigonometricCall(node: unknown): boolean {
    if (Core.hasComment(node)) {
        return false;
    }

    const rawCalleeName = Core.getUnwrappedIdentifierName((node as any).object);
    if (typeof rawCalleeName !== "string") {
        return false;
    }

    const calleeName = rawCalleeName.toLowerCase();

    if (applyInnerDegreeWrapperConversion(node, calleeName)) {
        return true;
    }

    if (calleeName === "degtorad") {
        return applyOuterTrigConversion(node, DEGREE_TO_RADIAN_CONVERSIONS);
    }

    if (calleeName === "radtodeg") {
        return applyOuterTrigConversion(node, RADIAN_TO_DEGREE_CONVERSIONS);
    }

    if (calleeName !== "sin" && calleeName !== "cos" && calleeName !== "tan") {
        return false;
    }

    const args = Core.getCallExpressionArguments(node);
    if (args.length !== 1) {
        return false;
    }

    const argument = args[0];
    const angle = matchDegreesToRadians(argument);

    if (!angle) {
        return false;
    }

    (node as any).arguments = [createCallExpressionNode("degtorad", [Core.cloneAstNode(angle)], argument)];

    return true;
}

// ---------------------------------------------------------------------------
// Exported matching helpers (consumed by other transform files)
// ---------------------------------------------------------------------------

/**
 * Recognise a degrees-to-radians expression such as:
 *   `angle * pi / 180`, `angle / 180 * pi`, `angle * 0.017453…`, etc.
 * Returns the plain-degrees angle sub-node on success, or `null`.
 */
export function matchDegreesToRadians(node: unknown): unknown {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression) {
        return null;
    }

    if (Core.isBinaryOperator(expression, "/")) {
        const left = Core.unwrapParenthesizedExpression((expression as any).left);
        const right = Core.unwrapParenthesizedExpression((expression as any).right);

        if (!isLiteralNumber(right, 180)) {
            return null;
        }

        if (Core.isBinaryOperator(left, "*")) {
            const factorA = Core.unwrapParenthesizedExpression((left as any).left);
            const factorB = Core.unwrapParenthesizedExpression((left as any).right);

            if (isPiIdentifier(factorA)) {
                return factorB;
            }

            if (isPiIdentifier(factorB)) {
                return factorA;
            }
        }
    }

    if (Core.isBinaryOperator(expression, "*")) {
        const left = Core.unwrapParenthesizedExpression((expression as any).left);
        const right = Core.unwrapParenthesizedExpression((expression as any).right);

        if (isLiteralNumber(left, 0.017_453_292_519_943_295)) {
            return right;
        }

        if (isLiteralNumber(right, 0.017_453_292_519_943_295)) {
            return left;
        }

        if (Core.isBinaryOperator(left, "/")) {
            const numerator = Core.unwrapParenthesizedExpression((left as any).left);
            const denominator = Core.unwrapParenthesizedExpression((left as any).right);

            if (isPiIdentifier(right) && isLiteralNumber(denominator, 180)) {
                return numerator;
            }
        }

        if (Core.isBinaryOperator(right, "/")) {
            const numerator = Core.unwrapParenthesizedExpression((right as any).left);
            const denominator = Core.unwrapParenthesizedExpression((right as any).right);

            if (isPiIdentifier(left) && isLiteralNumber(denominator, 180)) {
                return numerator;
            }
        }

        const reciprocalCandidate = matchDegreesToRadiansViaReciprocalPi(expression);
        if (reciprocalCandidate) {
            return reciprocalCandidate;
        }
    }

    return null;
}

/**
 * Identify a `dcos(angle)` / `dsin(angle)` call or a `cos(degtorad(angle))`
 * / `sin(degtorad(angle))` call.  Returns `{ kind, argument }` or `null`.
 */
export function identifyTrigCall(node: unknown): { kind: "cos" | "sin"; argument: unknown } | null {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression || (expression as any).type !== CALL_EXPRESSION) {
        return null;
    }

    const calleeName = Core.getUnwrappedIdentifierName((expression as any).object);
    if (!Array.isArray((expression as any).arguments) || (expression as any).arguments.length !== 1) {
        return null;
    }

    const [argument] = (expression as any).arguments;

    if (calleeName === "dcos") {
        return { kind: "cos", argument: Core.unwrapParenthesizedExpression(argument) };
    }

    if (calleeName === "dsin") {
        return { kind: "sin", argument: Core.unwrapParenthesizedExpression(argument) };
    }

    if (calleeName === "cos") {
        const degArg = matchDegToRadCall(argument);
        if (!degArg) {
            return null;
        }
        return { kind: "cos", argument: degArg };
    }

    if (calleeName === "sin") {
        const degArg = matchDegToRadCall(argument);
        if (!degArg) {
            return null;
        }
        return { kind: "sin", argument: degArg };
    }

    return null;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Detect `sin(degtorad(angle))` → `dsin(angle)` and similar wrappers. */
function applyInnerDegreeWrapperConversion(node: unknown, functionName: string): boolean {
    const mapping = RADIAN_TRIG_TO_DEGREE.get(functionName);
    if (!mapping) {
        return false;
    }

    const args = Core.getCallExpressionArguments(node);
    if (args.length !== 1) {
        return false;
    }

    const firstArg = args[0];
    const wrappedCall = Core.unwrapParenthesizedExpression(firstArg);
    if (
        !wrappedCall ||
        (wrappedCall as any).type !== CALL_EXPRESSION ||
        Core.getUnwrappedIdentifierName((wrappedCall as any).object)?.toLowerCase() !== "degtorad"
    ) {
        return false;
    }

    if (Core.hasComment(firstArg) || Core.hasComment(wrappedCall)) {
        return false;
    }

    const wrappedArgs = Core.getCallExpressionArguments(wrappedCall);
    if (wrappedArgs.length !== 1) {
        return false;
    }

    mutateToCallExpression(node, mapping, [Core.cloneAstNode(wrappedArgs[0])], node);
    return true;
}

/** Handle `degtorad(dsin(…))` → `sin(…)` and `radtodeg(arcsin(…))` → `darcsin(…)`. */
function applyOuterTrigConversion(
    node: unknown,
    conversionMap: Map<string, { name: string; expectedArgs: number }>
): boolean {
    const args = Core.getCallExpressionArguments(node);
    if (args.length !== 1) {
        return false;
    }

    const firstArg = Core.unwrapParenthesizedExpression(args[0]);
    if (!firstArg || (firstArg as any).type !== CALL_EXPRESSION || Core.hasComment(firstArg)) {
        return false;
    }

    const innerName = Core.getUnwrappedIdentifierName((firstArg as any).object);
    if (typeof innerName !== "string") {
        return false;
    }

    const mapping = conversionMap.get(innerName.toLowerCase());
    if (!mapping) {
        return false;
    }

    const innerArgs = Core.getCallExpressionArguments(firstArg);
    if (innerArgs.length !== mapping.expectedArgs) {
        return false;
    }

    if (innerArgs.some((argument) => Core.hasComment(argument))) {
        return false;
    }

    mutateToCallExpression(
        node,
        mapping.name,
        innerArgs.map((argument) => Core.cloneAstNode(argument)),
        node
    );
    return true;
}

/** If `argument` is `degtorad(x)`, return the unwrapped `x`, else `null`. */
function matchDegToRadCall(argument: unknown): unknown {
    const expression = Core.unwrapParenthesizedExpression(argument);
    if (
        !expression ||
        (expression as any).type !== CALL_EXPRESSION ||
        Core.getUnwrappedIdentifierName((expression as any).object) !== "degtorad" ||
        !Array.isArray((expression as any).arguments) ||
        (expression as any).arguments.length !== 1
    ) {
        return null;
    }

    return Core.unwrapParenthesizedExpression((expression as any).arguments[0]);
}

/**
 * Recognise a `angle * pi * (1/180)` pattern expressed via product operands.
 * Returns the angle operand or `null`.
 */
function matchDegreesToRadiansViaReciprocalPi(expression: unknown): unknown {
    const operands: unknown[] = [];
    if (!collectProductOperands(expression, operands)) {
        return null;
    }

    const piIndex = operands.findIndex((operand) => isPiIdentifier(operand));
    if (piIndex === -1) {
        return null;
    }

    const reciprocalIndex = operands.findIndex((operand) => isLiteralReciprocalOf180(operand));
    if (reciprocalIndex === -1) {
        return null;
    }

    // Compute splice positions in descending order so that removing earlier indices
    // does not shift the positions of later removals.
    const removals = [piIndex, reciprocalIndex].filter((index) => index !== -1).sort((a, b) => b - a);

    for (const index of removals) {
        operands.splice(index, 1);
    }

    if (operands.length !== 1) {
        return null;
    }

    return Core.unwrapParenthesizedExpression(operands[0]);
}

/** True when `node` is a numeric literal approximately equal to `1/180`. */
function isLiteralReciprocalOf180(node: unknown): boolean {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression) {
        return false;
    }

    const value = Core.getLiteralNumberValue(expression);
    if (value === null) {
        return false;
    }

    return Math.abs(value - 1 / 180) <= computeNumericTolerance(1 / 180);
}

/**
 * Return `true` when any node in the degrees-to-radians pattern `node`
 * carries a comment, which would make it unsafe to collapse.
 * `skipSelfCheck` avoids re-checking the root node when called recursively.
 */
function hasCommentsInDegreesToRadiansPattern(node: unknown, context: unknown, skipSelfCheck = false): boolean {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression || (expression as any).type !== BINARY_EXPRESSION) {
        return false;
    }

    const operator = Core.getNormalizedOperator(expression);

    if (operator !== "*" && operator !== "/") {
        return false;
    }

    const rawLeft = (expression as any).left;
    const rawRight = (expression as any).right;

    if (!rawLeft || !rawRight) {
        return true;
    }

    if ((!skipSelfCheck && Core.hasComment(expression)) || Core.hasComment(rawLeft) || Core.hasComment(rawRight)) {
        return true;
    }

    if (Core.hasInlineCommentBetween(rawLeft, rawRight, context)) {
        return true;
    }

    return (
        hasCommentsInDegreesToRadiansPattern(rawLeft, context) ||
        hasCommentsInDegreesToRadiansPattern(rawRight, context)
    );
}
