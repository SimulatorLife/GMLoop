/**
 * Policy evaluator for the optimize-math-expressions lint rule.
 *
 * This module separates the policy decisions (thresholds, heuristics, skip
 * conditions) from the mechanism code that applies rewrites to the AST.
 * By extracting policy here, the heuristics are testable in isolation and
 * do not couple formatting rules to the mechanics that mutate the output buffer.
 *
 * The evaluator provides two main interfaces:
 * 1. `MathOptimizationSkipEvaluator` — determines whether a given AST node
 *    position should be considered for math optimization based on its parent
 *    and the key used to reach it.
 * 2. `MathOptimizationCandidatePolicy` — determines whether source text is a
 *    viable candidate for the optimization pipeline.
 */

import { Core } from "@gmloop/core";

const {
    unwrapParenthesizedExpression: unwrapParenthesized,
    getLiteralNumberValue,
    areExpressionNodesEquivalentIgnoringParentheses,
    shouldSkipTraversal
} = Core;

/**
 * Policy configuration for text-length thresholds that govern optimization
 * eligibility. Expressions exceeding these thresholds are skipped to avoid
 * expensive normalization paths and unbounded allocation spikes.
 */
export type MathOptimizationTextLengthPolicy = Readonly<{
    /**
     * Maximum source-text length (in characters) for full math optimization.
     * Expressions longer than this are skipped entirely.
     */
    maxOptimizationCandidateLength: number;
    /**
     * Maximum source-text length for manual normalization pass.
     * Expressions exceeding this skip the normalization step.
     */
    maxManualNormalizationLength: number;
}>;

/**
 * Default text-length policy for math optimization.
 * These thresholds are calibrated to balance optimization coverage against
 * per-expression processing cost in typical GML codebases.
 */
export const DEFAULT_TEXT_LENGTH_POLICY: MathOptimizationTextLengthPolicy = Object.freeze({
    maxOptimizationCandidateLength: 2000,
    maxManualNormalizationLength: 600
});

/**
 * Signal patterns used by the policy to detect math optimization candidates.
 * These are compiled once at module-evaluation time and reused across all calls.
 */
export type MathOptimizationSignalPatterns = Readonly<{
    /**
     * Matches any character or built-in function name that indicates the
     * source text contains math-like syntax (e.g., `+`, `*`, `sin`).
     */
    mathOptimizationSignal: RegExp;
    /**
     * Matches characters/operators that strongly indicate math content
     * (e.g., `*`, `/`, `%`) and are high-confidence optimization signals.
     */
    mathStrongSignal: RegExp;
    /**
     * Matches division-based operators (`/`, `%`, `div`, `mod`) that trigger
     * the division-to-multiplication rewrite pipeline.
     */
    divisionBasedSignal: RegExp;
    /**
     * Matches numeric literals (e.g., `42`, `3.14`, `1e-10`) that indicate
     * constant-foldable expressions.
     */
    numericLiteralSignal: RegExp;
    /**
     * Matches built-in GML math function calls that affect optimization strategy.
     */
    manualMathCallSignal: RegExp;
}>;

/**
 * Default signal patterns for math optimization detection.
 */
export const DEFAULT_MATH_SIGNAL_PATTERNS: MathOptimizationSignalPatterns = Object.freeze({
    mathOptimizationSignal:
        /[*/%+-]|\b(?:div|mod|power|sqrt|sqr|sin|cos|tan|dsin|dcos|dtan|degtorad|radtodeg|arctan2|darctan2|ln|exp|log2|point_distance(?:_3d)?|point_direction|lengthdir_[xy]|dot_product(?:_3d)?|mean)\b/u,
    mathStrongSignal:
        /[*/%]|\b(?:div|mod|power|sqrt|sqr|sin|cos|tan|dsin|dcos|dtan|degtorad|radtodeg|arctan2|darctan2|ln|exp|log2|point_distance(?:_3d)?|point_direction|lengthdir_[xy]|dot_product(?:_3d)?|mean)\b/u,
    divisionBasedSignal: /[/%]|\b(?:div|mod)\b/u,
    numericLiteralSignal: /(?<![\w.])(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?![\w.])/iu,
    manualMathCallSignal:
        /\b(?:arccos|arcsin|arctan|arctan2|cos|darccos|darcsin|darctan|darctan2|dcos|dsin|dtan|exp|lengthdir_[xy]|ln|log2|mean|point_direction|point_distance(?:_3d)?|power|radtodeg|sin|sqr|sqrt|tan)\s*\(/u
});

/**
 * Evaluates whether an AST node's position in the tree should be skipped
 * from math optimization based on its parent and the key used to reach it.
 *
 * This is a pure predicate: it returns a boolean without performing any
 * transformation or side effects.
 *
 * @param parentNode - The parent AST node (may be null/undefined)
 * @param parentKey - The property key used to reach the child from parent
 * @returns true if the node should be skipped from optimization
 */
export function evaluateSkipDecision(parentNode: unknown, parentKey: string | null): boolean {
    if (!parentNode || typeof parentNode !== "object") {
        return false;
    }

    const parentType = (parentNode as { type?: unknown }).type;
    if (typeof parentType !== "string") {
        return false;
    }

    // Skip when parent is itself a math or parenthesized expression to avoid
    // nested optimizations that could break operator precedence or produce
    // unintended side effects.
    if (
        parentType === "BinaryExpression" ||
        parentType === "UnaryExpression" ||
        parentType === "LogicalExpression" ||
        parentType === "ParenthesizedExpression"
    ) {
        return true;
    }

    // Skip when the node is already the initializer or right-hand side of a
    // declaration/assignment, as these are typically already processed by
    // other normalization passes.
    if (
        (parentType === "VariableDeclarator" && parentKey === "init") ||
        (parentType === "AssignmentExpression" && parentKey === "right") ||
        (parentType === "IfStatement" && parentKey === "test") ||
        (parentType === "ReturnStatement" && parentKey === "argument")
    ) {
        return true;
    }

    return false;
}

/**
 * Context information provided to the candidate policy evaluator.
 */
export type MathOptimizationCandidateContext = Readonly<{
    /** The source text of the candidate expression */
    sourceText: string;
    /** The AST node type (e.g., "BinaryExpression", "CallExpression") */
    nodeType: string;
}>;

/**
 * Result of evaluating a math optimization candidate.
 */
export type MathOptimizationCandidateEvaluation = Readonly<{
    /** Whether the candidate contains math-like syntax worth optimizing */
    hasMathSyntax: boolean;
    /** Whether the candidate contains strong math signals (high confidence) */
    hasStrongMathSignal: boolean;
    /** Whether the candidate contains division-based operators */
    hasDivisionOperator: boolean;
    /** Whether the candidate contains numeric literals */
    hasNumericLiteral: boolean;
    /** Whether the candidate is too long for optimization */
    exceedsLengthThreshold: boolean;
    /** Whether manual normalization should be attempted */
    shouldAttemptManualNormalization: boolean;
}>;

/**
 * Configuration for the math optimization candidate policy evaluator.
 */
export type MathOptimizationCandidatePolicyConfig = Readonly<{
    /** Text length policy thresholds */
    textLengthPolicy: MathOptimizationTextLengthPolicy;
    /** Signal patterns for detecting math syntax */
    signalPatterns: MathOptimizationSignalPatterns;
}>;

/**
 * Default configuration for the candidate policy evaluator.
 */
export const DEFAULT_CANDIDATE_POLICY_CONFIG: MathOptimizationCandidatePolicyConfig = Object.freeze({
    textLengthPolicy: DEFAULT_TEXT_LENGTH_POLICY,
    signalPatterns: DEFAULT_MATH_SIGNAL_PATTERNS
});

/**
 * Evaluates whether source text is a viable candidate for math optimization.
 *
 * This function applies a series of heuristic checks (pattern matching,
 * length thresholds, content inspection) to determine whether the source text
 * should proceed through the optimization pipeline. The evaluation is pure
 * and produces a structured result that the mechanism code can act upon.
 *
 * @param context - Context containing source text and node type
 * @param config - Policy configuration (defaults to standard rules)
 * @returns Evaluation result with flags indicating candidate viability
 */
export function evaluateMathOptimizationCandidate(
    context: MathOptimizationCandidateContext,
    config: MathOptimizationCandidatePolicyConfig = DEFAULT_CANDIDATE_POLICY_CONFIG
): MathOptimizationCandidateEvaluation {
    const { sourceText } = context;
    const { textLengthPolicy, signalPatterns } = config;
    const { maxOptimizationCandidateLength, maxManualNormalizationLength } = textLengthPolicy;
    const {
        mathOptimizationSignal,
        mathStrongSignal,
        divisionBasedSignal,
        numericLiteralSignal,
        manualMathCallSignal
    } = signalPatterns;

    // Basic sanity check: empty or non-string text is not a candidate
    if (typeof sourceText !== "string" || sourceText.length === 0) {
        return Object.freeze({
            hasMathSyntax: false,
            hasStrongMathSignal: false,
            hasDivisionOperator: false,
            hasNumericLiteral: false,
            exceedsLengthThreshold: true,
            shouldAttemptManualNormalization: false
        });
    }

    // Check length threshold first to fail fast on large expressions
    const exceedsLength = sourceText.length > maxOptimizationCandidateLength;

    // Check for string literals - if present, the text is likely string concatenation,
    // not math. We can't reliably determine if + or - is math or string concat in
    // GML without AST context, so be conservative and exclude string literals.
    const hasStringLiteral = /["']/u.test(sourceText);

    // Detect presence of math-like syntax
    const hasMathSyntax = !hasStringLiteral && mathOptimizationSignal.test(sourceText);
    const hasStrongSignal = mathStrongSignal.test(sourceText);
    const hasDivision = divisionBasedSignal.test(sourceText);
    const hasNumeric = numericLiteralSignal.test(sourceText);
    const hasManualMathCall = manualMathCallSignal.test(sourceText);

    // Determine whether manual normalization should be attempted.
    // This is a separate pipeline step with its own length budget.
    const shouldAttemptManual =
        sourceText.length <= maxManualNormalizationLength &&
        (hasDivision ||
            sourceText.includes("*") ||
            hasManualMathCall ||
            ((sourceText.includes("+") || sourceText.includes("-")) && hasNumeric));

    return Object.freeze({
        hasMathSyntax,
        hasStrongMathSignal: hasStrongSignal,
        hasDivisionOperator: hasDivision,
        hasNumericLiteral: hasNumeric,
        exceedsLengthThreshold: exceedsLength,
        shouldAttemptManualNormalization: shouldAttemptManual
    });
}

/**
 * Helper to narrow unknown to the shape expected by Core helpers that
 * accept `AstNodeRecord | null | undefined`.
 */
function isAstNodeRecord(candidate: unknown): candidate is Record<string, unknown> {
    return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

/**
 * Evaluates whether a node should be skipped from traversal-based optimization.
 * This uses the core traversal skip logic in addition to expression-position checks.
 *
 * @param node - The AST node to evaluate
 * @returns true if the node should be skipped
 */
export function shouldSkipNodeFromTraversal(node: unknown): boolean {
    if (!isAstNodeRecord(node)) {
        return false;
    }
    return shouldSkipTraversal(node);
}

/**
 * Configuration for the numeric literal canonical form evaluation.
 */
export type NumericLiteralCanonicalFormPolicy = Readonly<{
    /** Maximum absolute value before number is considered too large for canonical form */
    maxCanonicalFormValue: number;
    /** Epsilon for floating-point comparison (e.g., comparing 2.0 vs 1.9999999) */
    epsilon: number;
}>;

export const DEFAULT_NUMERIC_LITERAL_POLICY: NumericLiteralCanonicalFormPolicy = Object.freeze({
    maxCanonicalFormValue: 1e15,
    epsilon: 1e-9
});

/**
 * Evaluates whether a numeric literal text is in canonical form.
 *
 * @param sourceText - The source text to check
 * @param node - The AST node representing the literal
 * @param config - Policy configuration (defaults to standard rules)
 * @returns true if the literal is already in canonical form
 */
export function evaluateCanonicalFormDecision(
    sourceText: string,
    node: unknown,
    config: NumericLiteralCanonicalFormPolicy = DEFAULT_NUMERIC_LITERAL_POLICY
): boolean {
    const expression = unwrapParenthesized(node as Parameters<typeof unwrapParenthesized>[0]);
    if (!expression || expression.type !== "Literal") {
        return false;
    }

    const numericValue = getLiteralNumberValue(expression);
    if (numericValue === null) {
        return false;
    }

    // Check if value exceeds the maximum for canonical form representation
    if (Math.abs(numericValue) > config.maxCanonicalFormValue) {
        return false;
    }

    const literalText = sourceText;
    const canonicalText = formatCanonicalNumericLiteralWithConfig(numericValue, config);
    return literalText !== null && canonicalText !== null && literalText === canonicalText;
}

/**
 * Formats a numeric value to its canonical representation.
 * Uses default policy for configuration.
 */
export function formatCanonicalNumericLiteral(value: number): string | null {
    return formatCanonicalNumericLiteralWithConfig(value, DEFAULT_NUMERIC_LITERAL_POLICY);
}

/**
 * Formats a numeric value to its canonical representation using provided config.
 */
function formatCanonicalNumericLiteralWithConfig(
    value: number,
    config: NumericLiteralCanonicalFormPolicy
): string | null {
    if (!Number.isFinite(value)) {
        return null;
    }

    if (value === 0) {
        return "0";
    }

    if (value === Math.round(value) && Math.abs(value) <= 999_999_999_999_999) {
        return String(Math.trunc(value));
    }

    // Handle values very close to integers using epsilon comparison
    const roundedValue = Math.round(value);
    if (Math.abs(value - roundedValue) < config.epsilon) {
        return String(roundedValue);
    }

    // Use toPrecision for compact representation of floating-point values
    const absValue = Math.abs(value);
    if (absValue < 1e-4 || absValue >= 1e15) {
        return value
            .toExponential(6)
            .replace(/\.?0+e/, "e")
            .replace("e", "e");
    }

    // For regular floating point, use fixed notation with appropriate precision
    const precision = absValue < 1 ? 10 : absValue < 100 ? 8 : 6;
    const fixed = value.toPrecision(precision);

    // Remove trailing zeros after decimal point
    return fixed.replace(/\.?0+$/, "");
}

/**
 * Extracts and evaluates numeric operands from a binary expression node.
 * Used by the optimization pipeline to identify constant operands.
 *
 * @param node - The AST node to evaluate
 * @returns Numeric value if node represents a constant number, null otherwise
 */
export function tryEvaluateNumericOperand(node: unknown): number | null {
    const expression = unwrapParenthesized(node as Parameters<typeof unwrapParenthesized>[0]);
    if (!expression) {
        return null;
    }

    if (expression.type === "Literal") {
        return getLiteralNumberValue(expression);
    }

    return null;
}

/**
 * Checks whether two AST nodes represent equivalent expressions
 * (ignoring parentheses that don't affect semantics).
 *
 * @param left - First node to compare
 * @param right - Second node to compare
 * @returns true if the expressions are equivalent
 */
export function areExpressionsSemanticallyEquivalent(left: unknown, right: unknown): boolean {
    return areExpressionNodesEquivalentIgnoringParentheses(left, right);
}

/**
 * Convenience re-export of constants for use by the rule mechanism.
 * These thresholds are policy decisions extracted from the rule.
 */
export const MATH_OPTIMIZATION_POLICY_CONSTANTS = Object.freeze({
    /** Maximum source-text length for full optimization pipeline */
    MAX_OPTIMIZATION_CANDIDATE_LENGTH: DEFAULT_TEXT_LENGTH_POLICY.maxOptimizationCandidateLength,
    /** Maximum source-text length for manual normalization pass */
    MAX_MANUAL_NORMALIZATION_LENGTH: DEFAULT_TEXT_LENGTH_POLICY.maxManualNormalizationLength
});
