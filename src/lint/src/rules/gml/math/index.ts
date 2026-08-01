/**
 * Public surface for the `gml/math/` helper collection.
 *
 * Math expression normalisation in the lint workspace is split across several
 * implementation files (AST builders, AST mutation, traversal normalisation,
 * division→multiplication, parentheses cleanup, scalar condensing, trig
 * conversions, lengthdir transforms, numeric policy, numeric utilities).
 *
 * Without a barrel, consumers reach deep relative paths such as
 * `../../math/math-traversal-normalization.js` from rule files, or
 * `../../../../src/rules/gml/math/math-ast-mutation.js` from deeply-nested
 * test files. Every one of those paths encodes the internal file layout
 * of this folder; if a helper is moved or split, every consumer churns.
 *
 * This barrel is the stable public API for the math folder. It re-exports
 * the curated helpers as named bindings so consumers depend on a single,
 * versioned entry point. Implementation files keep their current names
 * internally; the barrel just gives the outside world one address.
 *
 * A few implementation files (`math-traversal-normalization.ts` and
 * `math-scalar-condensing.ts`) re-export everything from `math-ast-mutation.ts`,
 * and `math-scalar-condensing.ts` also defines its own variants of
 * `areNodesEquivalent` and `applyScalarCondensing`. To keep this barrel
 * unambiguous we resolve each helper at its canonical source rather than
 * relying on `export *` chains, so the public surface stays decoupled from
 * how the implementation files happen to be stitched together internally.
 */
export {
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
    replaceNodeWith
} from "./math-ast-builders.js";
export {
    applyScalarCondensing,
    areNodesEquivalent,
    attachTrailingCommentToStatement,
    captureTrailingLineCommentValue,
    type ConvertManualMathTransformOptions,
    findAssignmentExpressionForRight,
    findParentEntry,
    findStatementAncestor,
    findTargetArrayEntry,
    findVariableDeclarationByName,
    findVariableDeclaratorForInit,
    hasOriginalComment,
    insertNodeBefore,
    isSafeOperand,
    markPreviousSiblingForBlankLine,
    normalizeTraversalContext,
    recordManualMathOriginalAssignment,
    removeNodeFromAst,
    removeSimplifiedAliasDeclaration,
    type ScalarCondensingTarget,
    simplifyZeroDivisionNumerators,
    type TargetArraySearchDirection,
    traverseZeroDivisionNumerators,
    unwrapEnclosingParentheses
} from "./math-ast-mutation.js";
export { applyDivisionToMultiplication } from "./math-division-to-multiplication.js";
export {
    areAllSafeOperands,
    attemptConvertLengthDir,
    attemptSimplifyLengthdirHalfDifference,
    extractSignedOperand,
    isIdentityReplacementSafeExpression,
    isSafeReciprocalCancellationOperand,
    matchLengthdirReassignment,
    matchLengthdirScaledOperand,
    matchScaledOperand,
    promoteLengthdirHalfDifference
} from "./math-lengthdir-transforms.js";
export {
    applyManualMathCanonicalForms,
    evaluateShouldApplyManualMathCanonicalForms,
    findManualMathCanonicalFormRuleById,
    getDefaultManualMathCanonicalFormsPolicy,
    type ManualMathCanonicalFormRule,
    type ManualMathCanonicalFormsPolicy
} from "./math-manual-canonical-forms-policy.js";
export type { MathNumericPolicy } from "./math-numeric-policy.js";
export { DEFAULT_MATH_NUMERIC_POLICY, resolveMathNumericPolicy } from "./math-numeric-policy.js";
export {
    collectProductOperands,
    computeIntegerGcd,
    computeNumericTolerance,
    evaluateNumericExpression,
    evaluateOneMinusNumeric,
    findFirstNumericLiteral,
    isEulerLiteral,
    isHalfExponentLiteral,
    isLiteralNumber,
    isLnCall,
    isNegativeOneFactor,
    isNumericZeroLiteral,
    isPiIdentifier,
    normalizeNumericCoefficient,
    parseNumericFactor,
    scaleNumericLiteralCoefficient,
    toApproxInteger
} from "./math-numeric-utils.js";
export { cleanupMultiplicativeIdentityParentheses } from "./math-parentheses-cleanup.js";
export {
    attemptCancelReciprocalRatios,
    attemptCollectDistributedScalars,
    attemptCondenseNumericChainWithMultipleBases,
    attemptCondenseScalarProduct,
    attemptCondenseSimpleScalarProduct,
    buildReciprocalRatioRemovalPlan,
    buildReciprocalRatioReplacement,
    buildRemainingRatioTerms,
    collapseUnitMinusHalfFactor,
    collectAdditionTerms,
    collectMultiplicativeChain,
    collectReciprocalRatioTerms,
    combineLengthdirScalarAssignments,
    compareIndexProperties,
    extractScalarAdditionTerm
} from "./math-scalar-condensing.js";
export {
    ADDITIVE_MATH_BINARY_OPERATORS,
    areExpressionsSemanticallyEquivalent,
    canAstShapeContainMathOptimizationCandidate,
    containsMathOptimizationSyntax,
    DEFAULT_CANDIDATE_POLICY_CONFIG,
    DEFAULT_MATH_CALL_NAMES,
    DEFAULT_MATH_SIGNAL_PATTERNS,
    DEFAULT_NUMERIC_LITERAL_POLICY,
    DEFAULT_TEXT_LENGTH_POLICY,
    evaluateCanonicalFormDecision,
    evaluateMathOptimizationCandidate,
    evaluateSkipDecision,
    formatCanonicalNumericLiteral,
    MATH_OPTIMIZATION_POLICY_CONSTANTS,
    type MathOptimizationCandidateContext,
    type MathOptimizationCandidateEvaluation,
    type MathOptimizationCandidatePolicyConfig,
    type MathOptimizationSignalPatterns,
    type MathOptimizationTextLengthPolicy,
    type NumericLiteralCanonicalFormPolicy,
    shouldSkipNodeFromTraversal,
    STRONG_MATH_BINARY_OPERATORS,
    tryEvaluateNumericOperand
} from "./math-skip-evaluator.js";
export { applyManualMathNormalization } from "./math-traversal-normalization.js";
export {
    attemptConvertDegreesToRadians,
    attemptSimplifyTrigonometricCall,
    identifyTrigCall,
    matchDegreesToRadians
} from "./math-trig-conversions.js";
