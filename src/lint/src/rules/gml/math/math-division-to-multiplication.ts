import { Core, type GameMakerAstNode, type MutableGameMakerAstNode } from "@gmloop/core";

import { replaceNodeWith } from "./math-ast-builders.js";
import { DEFAULT_MATH_NUMERIC_POLICY, type MathNumericPolicy } from "./math-numeric-policy.js";
import { computeNumericTolerance } from "./math-numeric-utils.js";
import { matchDegreesToRadians } from "./math-trig-conversions.js";

const { BINARY_EXPRESSION, LITERAL, PARENTHESIZED_EXPRESSION } = Core;

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

function getMultiplicationFactor(node: GameMakerAstNode | null | undefined, policy: MathNumericPolicy): number | null {
    if (Core.shouldSkipTraversal(node)) {
        return null;
    }

    const literalValue = Core.getLiteralNumberValue(node);
    if (literalValue !== null && Number.isFinite(literalValue)) {
        // Use tolerance-aware comparison to detect values extremely close to zero
        // that might arise from floating-point rounding errors
        const tolerance = computeNumericTolerance(literalValue);
        if (Math.abs(literalValue) <= Math.max(tolerance, policy.minSafeDivisor)) {
            return null;
        }

        const reciprocal = 1 / literalValue;
        if (!Number.isFinite(reciprocal) || Math.abs(reciprocal) > policy.maxSafeReciprocal) {
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

        if (Math.abs(reciprocalScalar) > policy.maxSafeReciprocal) {
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
    // Walk down the paren chain looking for the innermost expression. We
    // can only strip the redundant wrappers when:
    //   - every wrapper is comment-free, and
    //   - the innermost expression is a `*` BINARY_EXPRESSION (removing
    //     parentheses around `+` or other lower-precedence operators
    //     would change the meaning of the rewritten expression).
    const leftOperand = node.left as ParenthesizedExpressionNode | null;
    let innermost: GameMakerAstNode | null = null;
    let current: ParenthesizedExpressionNode | null = leftOperand;
    while (current && current.type === PARENTHESIZED_EXPRESSION) {
        if (Core.hasComment(current)) {
            return;
        }
        const nested = current.expression;
        if (nested?.type === PARENTHESIZED_EXPRESSION) {
            current = nested;
            continue;
        }
        if (!nested) {
            return;
        }
        innermost = nested;
        break;
    }

    if (
        !innermost ||
        innermost.type !== BINARY_EXPRESSION ||
        innermost.operator !== "*" ||
        Core.hasComment(innermost)
    ) {
        return;
    }

    // Validation passed: walk the chain a second time, replacing each
    // paren wrapper with its inner expression in place.
    current = leftOperand;
    while (current && current.type === PARENTHESIZED_EXPRESSION) {
        const expression = current.expression;
        if (!expression || !replaceNodeWith(current, expression)) {
            break;
        }
        current = expression;
    }
}

/**
 * Converts division by a constant literal into multiplication by its reciprocal.
 * Example: `x / 2` -> `x * 0.5`
 */
function attemptConvertDivisionToMultiplication(node: MutableGameMakerAstNode, policy: MathNumericPolicy): boolean {
    if (node.type !== BINARY_EXPRESSION || node.operator !== "/") {
        return false;
    }

    if (matchDegreesToRadians(node)) {
        return false;
    }

    const right = node.right;
    const multiplier = getMultiplicationFactor(right, policy);
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
 *
 * @param node - AST root (or subtree) to rewrite in place.
 * @param policy - Optional numeric-safety policy override. When omitted, the
 *   default thresholds from {@link DEFAULT_MATH_NUMERIC_POLICY} are used.
 *   Supplying a tighter policy is useful in tests that exercise boundary
 *   conditions; the lint rule and most consumers should rely on the default.
 */
export function applyDivisionToMultiplication(
    node: MutableGameMakerAstNode,
    policy: MathNumericPolicy = DEFAULT_MATH_NUMERIC_POLICY
) {
    if (Core.shouldSkipTraversal(node)) {
        return;
    }

    // Apply transform to this node first, then descend into its children.
    // Visiting the parent before its children matters when a division
    // expression contains nested divisions (e.g., `(x / 2) / 3` should
    // become `x * 0.5 * 0.333...` rather than `x / 2 * 0.333...`).
    attemptConvertDivisionToMultiplication(node, policy);
    Core.visitNonTraversalChildValues(node, (child) =>
        applyDivisionToMultiplication(child as MutableGameMakerAstNode, policy)
    );
}
