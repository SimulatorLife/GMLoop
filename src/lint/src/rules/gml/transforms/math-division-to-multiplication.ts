import { Core, type GameMakerAstNode, type MutableGameMakerAstNode } from "@gmloop/core";

import { computeNumericTolerance } from "./math-numeric-utils.js";
import { matchDegreesToRadians, replaceNodeWith } from "./math-traversal-normalization.js";

const { BINARY_EXPRESSION, LITERAL, PARENTHESIZED_EXPRESSION } = Core;

const MIN_SAFE_DIVISOR = 1e-10;
const MAX_SAFE_RECIPROCAL = 1e10;

type ParenthesizedExpressionNode = GameMakerAstNode & {
    expression?: GameMakerAstNode | null;
};

type BinaryExpressionNode = GameMakerAstNode & {
    left?: GameMakerAstNode | null;
    operator?: string | null;
    right?: GameMakerAstNode | null;
};

function extractReciprocalScalar(node: GameMakerAstNode | null | undefined): number | null {
    const expression = Core.unwrapParenthesizedExpression(node) ?? null;
    if (!expression || expression.type !== BINARY_EXPRESSION || expression.operator !== "/") {
        return null;
    }

    const binary = expression as BinaryExpressionNode;
    const numerator = Core.unwrapParenthesizedExpression(binary.left) ?? null;
    const denominator = Core.unwrapParenthesizedExpression(binary.right) ?? null;

    if (!numerator || !denominator) {
        return null;
    }

    const numeratorValue = Core.getLiteralNumberValue(numerator);
    const denominatorValue = Core.getLiteralNumberValue(denominator);

    if (
        numeratorValue === null ||
        denominatorValue === null ||
        !Number.isFinite(numeratorValue) ||
        !Number.isFinite(denominatorValue)
    ) {
        return null;
    }

    if (Math.abs(numeratorValue - 1) > Number.EPSILON) {
        return null;
    }

    return denominatorValue;
}

function getMultiplicationFactor(node: GameMakerAstNode | null | undefined): number | null {
    if (Core.shouldSkipTraversal(node)) {
        return null;
    }

    const literalValue = Core.getLiteralNumberValue(node);
    if (literalValue !== null && Number.isFinite(literalValue)) {
        // Use tolerance-aware comparison to detect values extremely close to zero
        // that might arise from floating-point rounding errors
        const tolerance = computeNumericTolerance(literalValue);
        if (Math.abs(literalValue) <= Math.max(tolerance, MIN_SAFE_DIVISOR)) {
            return null;
        }

        const reciprocal = 1 / literalValue;
        if (!Number.isFinite(reciprocal) || Math.abs(reciprocal) > MAX_SAFE_RECIPROCAL) {
            return null;
        }

        return reciprocal;
    }

    const reciprocalScalar = extractReciprocalScalar(node);
    if (reciprocalScalar !== null && Number.isFinite(reciprocalScalar)) {
        // Use tolerance-aware comparison to avoid division by near-zero values
        const tolerance = computeNumericTolerance(reciprocalScalar);
        if (Math.abs(reciprocalScalar) <= tolerance) {
            return null;
        }

        if (Math.abs(reciprocalScalar) > MAX_SAFE_RECIPROCAL) {
            return null;
        }

        return reciprocalScalar;
    }

    return null;
}

function formatMultiplierLiteral(multiplier: number): string | null {
    if (!Number.isFinite(multiplier)) {
        return null;
    }

    if (Object.is(multiplier, -0)) {
        return "0";
    }

    const literal = String(multiplier);
    if (literal.includes("e") || literal.includes("E")) {
        return null;
    }

    return literal;
}

function flattenMultiplicativeOperand(node: MutableGameMakerAstNode) {
    const leftOperand = node.left as ParenthesizedExpressionNode | null;
    if (!leftOperand || leftOperand.type !== PARENTHESIZED_EXPRESSION) {
        return;
    }

    const wrappers: ParenthesizedExpressionNode[] = [];
    let cursor = leftOperand;

    while (cursor && cursor.type === PARENTHESIZED_EXPRESSION) {
        wrappers.push(cursor);

        const nested = cursor.expression;
        if (!nested || nested.type !== PARENTHESIZED_EXPRESSION) {
            break;
        }

        cursor = nested;
    }

    if (wrappers.length === 0 || !cursor) {
        return;
    }

    const innermost = cursor.expression;
    if (!innermost || innermost.type !== BINARY_EXPRESSION || innermost.operator !== "*") {
        return;
    }

    if (wrappers.some((wrapper) => Core.hasComment(wrapper)) || Core.hasComment(innermost)) {
        return;
    }

    let current = node.left as ParenthesizedExpressionNode | null;
    while (current && current.type === PARENTHESIZED_EXPRESSION) {
        const expression = current.expression;
        if (!expression || !replaceNodeWith(current, expression)) {
            break;
        }

        current = expression as ParenthesizedExpressionNode | null;
    }
}

/**
 * Converts division by a constant literal into multiplication by its reciprocal.
 * Example: `x / 2` -> `x * 0.5`
 */
function attemptConvertDivisionToMultiplication(node: MutableGameMakerAstNode): boolean {
    if (node.type !== BINARY_EXPRESSION || node.operator !== "/") {
        return false;
    }

    if (matchDegreesToRadians(node)) {
        return false;
    }

    const right = node.right;
    const multiplier = getMultiplicationFactor(right);
    if (multiplier === null) {
        return false;
    }
    const formattedMultiplier = formatMultiplierLiteral(multiplier);
    if (formattedMultiplier === null) {
        return false;
    }

    // Mutate the node
    node.operator = "*";
    const replacementLiteral = {
        type: LITERAL,
        value: formattedMultiplier,
        raw: formattedMultiplier
    } as MutableGameMakerAstNode;
    Core.assignClonedLocation(replacementLiteral, right);
    node.right = replacementLiteral;

    flattenMultiplicativeOperand(node);

    return true;
}

/**
 * Walk the AST and turn division-by-constant patterns into multiplications by the reciprocal.
 */
export function applyDivisionToMultiplication(node: MutableGameMakerAstNode) {
    if (Core.shouldSkipTraversal(node)) {
        return;
    }

    // Apply transform
    attemptConvertDivisionToMultiplication(node);

    // Recursively descend through the AST to find and transform all division
    // operations. The depth-first traversal ensures child nodes are optimized
    // before their parents, which is critical when a division expression contains
    // nested divisions (e.g., `(x / 2) / 3` should become `x * 0.5 * 0.333...`).
    for (const key of Object.keys(node)) {
        // Skip parent references to avoid cycles
        if (key === "parent") continue;

        const child = (node as any)[key];
        if (Array.isArray(child)) {
            for (const item of child) {
                applyDivisionToMultiplication(item);
            }
        } else if (child && typeof child === "object") {
            applyDivisionToMultiplication(child);
        }
    }
}
