/**
 * Pure numeric and literal evaluation utilities for AST analysis and constant folding.
 *
 * This module provides reusable numeric comparison and evaluation helpers used
 * throughout the codebase for floating-point-tolerant comparisons and literal
 * expression evaluation.
 *
 * These utilities are framework-agnostic: they operate only on numbers and AST
 * literal nodes, making them suitable for both the transpiler's constant-folding
 * pass and the lint workspace's math-optimization transforms.
 *
 * Architecture note: `computeNumericTolerance` is the canonical epsilon-computing
 * helper for this module. It scales the tolerance to the magnitude of the expected
 * value and is the basis for `isApproximatelyZero`, `areNumbersApproximatelyEqual`,
 * and all derived predicates.
 */
import { Core } from "@gmloop/core";

const { BINARY_EXPRESSION, LITERAL, UNARY_EXPRESSION, isObjectLike } = Core;

/**
 * Epsilon multiplier for zero comparisons. Uses 4× EPSILON as a conservative
 * threshold that safely exceeds accumulated floating-point rounding error for
 * typical arithmetic chains without over-constraining the tolerance.
 */
const ZERO_COMPARISON_EPSILON = Number.EPSILON * 4;

/**
 * Return an epsilon-scaled tolerance for the given expected magnitude.
 * An optional explicit tolerance can be supplied to bypass auto-scaling.
 */
export function computeNumericTolerance(expected: number, providedTolerance?: number): number {
    if (typeof providedTolerance === "number") {
        return providedTolerance;
    }

    const magnitude = Math.max(1, Math.abs(expected));
    return Number.EPSILON * magnitude * 4;
}

/**
 * True when `value` is within floating-point epsilon of zero.
 */
export function isApproximatelyZero(value: number): boolean {
    return Math.abs(value) <= ZERO_COMPARISON_EPSILON;
}

/**
 * Relative and absolute epsilon for floating-point equality comparisons.
 *
 * Using a combined tolerance avoids false negatives for both:
 * - Very small values near zero (where absolute epsilon dominates)
 * - Large values where relative error is the binding constraint
 *
 * The factor of 8 was chosen to safely exceed the accumulated rounding error
 * for a 10-term sum of numbers around 0.1 (each term has ~1.5 ulp of error;
 * 10 terms → ~15 ulp total → ~3.2 × EPSILON). Choosing 8× EPSILON provides
 * sufficient headroom for typical GML numeric literals while remaining well
 * below values that differ by more than one digit, so the comparison remains
 * meaningful rather than collapsing all distinct floats to "equal".
 */
const APPROXIMATE_EQUALITY_EPSILON = Number.EPSILON * 8;

/**
 * True when `a` and `b` are approximately equal using a relative epsilon
 * comparison scaled to the larger magnitude operand.
 */
export function isApproximatelyEqual(a: number, b: number): boolean {
    if (a === b) return true;
    const diff = Math.abs(a - b);
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    return diff <= APPROXIMATE_EQUALITY_EPSILON * scale;
}

/**
 * Round `value` to `precision` significant digits and return the string
 * representation, or `null` when the result is not finite.
 * Negative zero is normalized to `"0"`.
 */
export function normalizeNumericCoefficient(value: number, precision = 12): string | null {
    if (!Number.isFinite(value)) {
        return null;
    }

    const effectivePrecision = Number.isInteger(precision) ? precision : 12;

    const rounded = Number(value.toPrecision(effectivePrecision));
    if (!Number.isFinite(rounded)) {
        return null;
    }

    if (Object.is(rounded, -0)) {
        return "0";
    }

    return rounded.toString();
}

/**
 * Return the nearest integer to `value` when it falls within floating-point
 * tolerance, or `null` if the value is not close to any integer.
 */
export function toApproxInteger(value: unknown): number | null {
    if (!Number.isFinite(value)) {
        return null;
    }

    const numValue = value as number;
    const rounded = Math.round(numValue);
    const tolerance = computeNumericTolerance(Math.max(1, Math.abs(numValue)));

    if (Math.abs(numValue - rounded) <= tolerance) {
        return rounded;
    }

    return null;
}

/** Greatest-common-divisor via the Euclidean algorithm. Returns 0 for non-finite inputs. */
export function computeIntegerGcd(a: number, b: number): number {
    let left = Math.abs(a);
    let right = Math.abs(b);

    if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return 0;
    }

    while (right !== 0) {
        const temp = right;
        right = left % right;
        left = temp;
    }

    return left;
}

/**
 * True when `node` is a numeric literal whose value is within `tolerance`
 * (or the auto-scaled epsilon) of `expected`.
 */
export function isLiteralNumber(node: unknown, expected: number, tolerance?: number): boolean {
    const value = Core.getLiteralNumberValue(node);
    if (value == null) {
        return false;
    }

    const effectiveTolerance = computeNumericTolerance(expected, tolerance);
    return Math.abs(value - expected) <= effectiveTolerance;
}

/**
 * True when `left` and `right` are within mutual floating-point tolerance.
 */
export function areLiteralNumbersApproximatelyEqual(left: number, right: number): boolean {
    const tolerance = Math.max(computeNumericTolerance(left), computeNumericTolerance(right));
    return Math.abs(left - right) <= tolerance;
}

/**
 * True when `node` represents the exponent `0.5`, either as the literal `0.5`
 * or the expression `1 / 2`.
 */
export function isHalfExponentLiteral(node: unknown): boolean {
    if (!node) {
        return false;
    }

    if (isLiteralNumber(node, 0.5)) {
        return true;
    }

    if (Core.isBinaryOperator(node, "/")) {
        return (
            isLiteralNumber((node as { left?: unknown }).left, 1) &&
            isLiteralNumber((node as { right?: unknown }).right, 2)
        );
    }

    return false;
}

/** True when `node` is a numeric literal approximately equal to Euler's number. */
export function isEulerLiteral(node: unknown): boolean {
    const value = Core.getLiteralNumberValue(node);
    if (value === undefined) {
        return false;
    }

    return Math.abs(value - Math.E) <= 1e-9;
}

/**
 * Convert a string, number, or boolean literal value to a number.
 * Returns `null` if conversion fails.
 */
export function toNumericLiteral(value: string | number | boolean): number | null {
    if (typeof value === "number") {
        return value;
    }

    if (typeof value !== "string") {
        return null;
    }

    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Convert a string, number, or boolean literal value to a boolean.
 * Handles the parser quirk where boolean literals may be stored as strings.
 * Returns `null` if the value cannot be interpreted as a boolean.
 */
export function toBooleanLiteral(value: string | number | boolean): boolean | null {
    if (typeof value === "boolean") {
        return value;
    }

    if (value === "true") {
        return true;
    }

    if (value === "false") {
        return false;
    }

    return null;
}

/** True when `value` is `null` or `undefined`. */
export function isNullishValue(value: unknown): value is null | undefined {
    return value === null || value === undefined;
}

/**
 * True when `node` (after unwrapping parentheses) is the identifier `pi` or `PI`.
 */
export function isPiIdentifier(node: unknown): boolean {
    const expression = Core.unwrapParenthesizedExpression(node);
    return Boolean(
        expression &&
        (expression as { type?: string }).type === "Identifier" &&
        typeof (expression as { name?: string }).name === "string" &&
        (expression as { name: string }).name.toLowerCase() === "pi"
    );
}

/** True when `node` is a numeric literal within floating-point tolerance of zero. */
export function isNumericZeroLiteral(node: unknown): boolean {
    const literalValue = Core.getLiteralNumberValue(node);
    if (literalValue === null) {
        return false;
    }

    return Math.abs(literalValue) <= computeNumericTolerance(0);
}

/** True when `node` is a call to `ln(…)` with exactly one argument. */
export function isLnCall(node: unknown): boolean {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (
        !expression ||
        (expression as { type?: string }).type !== "CallExpression" ||
        Core.getUnwrappedIdentifierName((expression as { object?: unknown }).object) !== "ln"
    ) {
        return false;
    }

    const args = Core.asArray((expression as { arguments?: unknown }).arguments);
    return args.length === 1;
}

/**
 * Constant-fold `node` as a numeric expression.
 * Supports literals, unary `+`/`-`, and binary `+`, `-`, `*`, `/`.
 * Returns `null` for any non-numeric sub-expression.
 */
export function evaluateNumericExpression(node: unknown): number | null {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression) {
        return null;
    }

    if ((expression as { type?: string }).type === LITERAL) {
        return Core.getLiteralNumberValue(expression);
    }

    if ((expression as { type?: string }).type === UNARY_EXPRESSION) {
        const value = evaluateNumericExpression((expression as { argument?: unknown }).argument);
        if (value === null) {
            return null;
        }

        const op = (expression as { operator?: string }).operator;
        if (op === "-") {
            return -value;
        }

        if (op === "+") {
            return value;
        }

        return null;
    }

    if ((expression as { type?: string }).type === BINARY_EXPRESSION) {
        const operator = Core.getNormalizedOperator(expression);

        if (operator === "+" || operator === "-") {
            const left = evaluateNumericExpression((expression as { left?: unknown }).left);
            const right = evaluateNumericExpression((expression as { right?: unknown }).right);

            if (left === null || right === null) {
                return null;
            }

            return operator === "+" ? left + right : left - right;
        }

        if (operator === "*" || operator === "/") {
            const left = evaluateNumericExpression((expression as { left?: unknown }).left);
            const right = evaluateNumericExpression((expression as { right?: unknown }).right);

            if (left === null || right === null) {
                return null;
            }

            if (operator === "*") {
                return left * right;
            }

            if (Math.abs(right) <= computeNumericTolerance(0)) {
                return null;
            }

            return left / right;
        }
    }

    return null;
}

/** True when `node` evaluates as a numeric factor approximately equal to -1. */
export function isNegativeOneFactor(node: unknown): boolean {
    const value = parseNumericFactor(node);
    if (value === null) {
        return false;
    }

    return Math.abs(value + 1) <= computeNumericTolerance(1);
}

/**
 * If `node` is a binary subtraction `1 - <expr>`, evaluate and return the
 * numeric result of `1 - <expr>`.  Returns `null` for non-matching shapes.
 */
export function evaluateOneMinusNumeric(node: unknown): number | null {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression || (expression as { type?: string }).type !== BINARY_EXPRESSION) {
        return null;
    }

    const operator = Core.getNormalizedOperator(expression);

    if (operator !== "-") {
        return null;
    }

    const leftValue = evaluateNumericExpression((expression as { left?: unknown }).left);
    if (leftValue === null) {
        return null;
    }

    const tolerance = computeNumericTolerance(1);
    if (Math.abs(leftValue - 1) > tolerance) {
        return null;
    }

    const rightValue = evaluateNumericExpression((expression as { right?: unknown }).right);
    if (rightValue === null) {
        return null;
    }

    return leftValue - rightValue;
}

/**
 * Evaluate `node` as a product/quotient of numeric literals.
 * Returns the computed value or `null` if any sub-expression is not purely numeric.
 */
export function parseNumericFactor(node: unknown): number | null {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression) {
        return null;
    }

    if ((expression as { type?: string }).type === BINARY_EXPRESSION) {
        const operator = Core.getNormalizedOperator(expression);

        if (operator === "*" || operator === "/") {
            const leftValue = parseNumericFactor((expression as { left?: unknown }).left);
            const rightValue = parseNumericFactor((expression as { right?: unknown }).right);

            if (leftValue === null || rightValue === null) {
                return null;
            }

            if (operator === "*") {
                return leftValue * rightValue;
            }

            if (Math.abs(rightValue) <= computeNumericTolerance(0)) {
                return null;
            }

            return leftValue / rightValue;
        }
    }

    if ((expression as { type?: string }).type === UNARY_EXPRESSION) {
        const value = parseNumericFactor((expression as { argument?: unknown }).argument);
        if (value === null) {
            return null;
        }

        const op = (expression as { operator?: string }).operator;
        if (op === "-") {
            return -value;
        }

        if (op === "+") {
            return value;
        }

        return null;
    }

    const literalValue = Core.getLiteralNumberValue(expression);
    return literalValue ?? null;
}

/**
 * Depth-first search for the first AST node whose `type` is `Literal` and
 * whose value is a finite number.
 */
export function findFirstNumericLiteral(node: unknown): unknown {
    if (!isObjectLike(node)) {
        return null;
    }

    if ((node as { type?: string }).type === LITERAL) {
        return Core.getLiteralNumberValue(node) === null ? null : node;
    }

    for (const key of Object.keys(node as object)) {
        if (key === "parent") {
            continue;
        }

        const value = (node as Record<string, unknown>)[key];
        if (!isObjectLike(value)) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const element of value) {
                const result = findFirstNumericLiteral(element);
                if (result) {
                    return result;
                }
            }
        } else {
            const result = findFirstNumericLiteral(value);
            if (result) {
                return result;
            }
        }
    }

    return null;
}

/**
 * Mutate the numeric literal embedded in `node` (the first one found via DFS)
 * by scaling it by `factor`.  Returns `true` on success.
 */
export function scaleNumericLiteralCoefficient(node: unknown, factor: number): boolean {
    if (!Number.isFinite(factor)) {
        return false;
    }

    const literal = findFirstNumericLiteral(node);
    if (!literal) {
        return false;
    }

    const literalValue = Core.getLiteralNumberValue(literal);
    if (literalValue === null) {
        return false;
    }

    const scaledValue = literalValue * factor;
    const normalizedValue = normalizeNumericCoefficient(scaledValue);
    if (normalizedValue === null) {
        return false;
    }

    (literal as { value?: unknown }).value = normalizedValue;
    return true;
}

/**
 * Recursively collect all leaf operands of a chain of `*` binary expressions
 * into `output`.  Returns `true` on success, `false` when a commented node
 * prevents safe collection.
 */
export function collectProductOperands(node: unknown, output: unknown[]): boolean {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression) {
        return false;
    }

    if (!Core.isBinaryOperator(expression, "*")) {
        output.push(expression);
        return true;
    }

    if (Core.hasComment(expression)) {
        return false;
    }

    return (
        collectProductOperands((expression as { left?: unknown }).left, output) &&
        collectProductOperands((expression as { right?: unknown }).right, output)
    );
}
