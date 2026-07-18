/**
 * Policy layer for logical-expression condensation.
 *
 * This module extracts all **policy decisions** — thresholds, heuristics, and
 * conditional rules — from the condensation mechanism code.  By keeping the
 * two layers separate:
 *
 * 1. Policy logic is testable in isolation without AST mutations.
 * 2. Thresholds can be adjusted without touching transformation code.
 * 3. Callers can inspect or override policy outcomes before committing changes.
 *
 * The policy provides a single pure evaluator: `evaluateTruthTablePolicy`.
 * It answers "should the condensation attempt to build a truth table?" based on
 * the number of boolean variables discovered in the condition expression.
 */

/**
 * Policy configuration for truth-table generation.
 *
 * Truth-table generation is exponential in the number of boolean variables
 * (2^n rows), so a hard cap is needed to bound CPU and memory consumption.
 */
export type TruthTablePolicy = Readonly<{
    /**
     * Maximum number of distinct boolean variables in a condition before the
     * truth-table path is abandoned.
     *
     * At 10 variables the table has 1 024 rows — manageable on modern hardware.
     * Each additional variable doubles the row count, so 15 variables would need
     * 32 768 rows.  Beyond the cap, the cost outweighs the simplification benefit
     * and the condition is left unchanged.
     */
    maxVariablesForTruthTable: number;
}>;

/**
 * Policy configuration for iteration limits in expression simplification.
 *
 * Boolean expression simplification is iterative: each pass may unlock
 * further simplifications.  Hard caps prevent pathological expressions from
 * consuming unbounded CPU while still allowing enough passes to converge on
 * genuinely complex expressions.
 */
export type SimplificationPolicy = Readonly<{
    /**
     * Maximum iterations for the main `simplifyBooleanExpression` pass.
     *
     * The simplification loop applies distributive, absorptive, and De Morgan
     * transformations until a fixed point is reached or this limit is hit.
     * At 50 iterations, even deeply nested boolean expressions with many
     * variables can converge.  The value is conservative because expressions
     * rarely need more than ~20 passes in practice, and exceeding this limit
     * almost always indicates either a non-converging pattern or a simplification
     * that would yield marginal gains.
     */
    maxSimplificationIterations: number;
    /**
     * Maximum iterations for the post-processing pipeline.
     *
     * Post-processing handles specialized patterns (XOR reduction, mixed
     * term reduction) that may need a few additional passes after the main
     * simplification.  The limit is low because post-processing operates on
     * already-simplified expressions and converges quickly — 5 iterations is
     * sufficient for the most complex post-processing scenarios.
     */
    maxPostProcessingIterations: number;
}>;

/**
 * Combined policy for the focused logical normalization transforms.
 *
 * This bundles the truth-table cap and the simplification iteration limits so
 * a rule can resolve a single `LogicalNormalizationPolicy` value and thread it
 * through every condensation entry point without callers having to assemble
 * the individual `TruthTablePolicy` and `SimplificationPolicy` parts.
 *
 * `maxTraversalIterations` bounds the fixed-point loop in the orchestrator
 * (`applyLogicalNormalizationWithChangeMetadata`); the other fields bound the
 * inner stages described by the narrower policy types.
 *
 * @see TruthTablePolicy
 * @see SimplificationPolicy
 */
export type LogicalNormalizationPolicy = Readonly<
    TruthTablePolicy &
        SimplificationPolicy & {
            /**
             * Maximum passes for the orchestrator's fixed-point loop.
             *
             * Each pass walks the AST and tries every per-node simplification.
             * The loop terminates as soon as a pass produces no changes, but a
             * hard cap guards against pathological inputs where a rewrite
             * never reaches a fixed point. 10 passes is sufficient in practice:
             * the per-pass iteration limits above already cap the inner work
             * each pass can perform, and changes propagate monotonically.
             */
            maxTraversalIterations: number;
        }
>;

/**
 * Resolved policy combining all condensation configuration values.
 */
export type ResolvedLogicalNormalizationPolicy = Readonly<{
    truthTable: TruthTablePolicy;
    simplification: SimplificationPolicy;
    traversal: Readonly<{ maxTraversalIterations: number }>;
}>;

/**
 * Split a {@link LogicalNormalizationPolicy} into its constituent narrower
 * policy bags so internal helpers can consume just the slice they need
 * (for example `applyLogicalNormalizationWithChangeMetadata` only needs the
 * traversal cap, while `applyLogicalExpressionCondensation` only cares about
 * the truth-table cap and indirectly about simplification iteration limits).
 */
export function resolveLogicalNormalizationPolicy(
    policy: LogicalNormalizationPolicy
): ResolvedLogicalNormalizationPolicy {
    return Object.freeze({
        truthTable: Object.freeze({ maxVariablesForTruthTable: policy.maxVariablesForTruthTable }),
        simplification: Object.freeze({
            maxSimplificationIterations: policy.maxSimplificationIterations,
            maxPostProcessingIterations: policy.maxPostProcessingIterations
        }),
        traversal: Object.freeze({ maxTraversalIterations: policy.maxTraversalIterations })
    });
}

/**
 * Baseline policy constants.
 *
 * These values represent the current calibrated defaults.  They are declared
 * as a frozen object so callers can spread them into custom configs and extend
 * without mutating shared state.
 */
export const TRUTH_TABLE_POLICY_BASELINE: TruthTablePolicy = Object.freeze({
    maxVariablesForTruthTable: 10
});

/**
 * Baseline policy for expression simplification iteration limits.
 */
export const SIMPLIFICATION_POLICY_BASELINE: SimplificationPolicy = Object.freeze({
    maxSimplificationIterations: 50,
    maxPostProcessingIterations: 5
});

/**
 * Baseline policy for the combined logical-flow optimization pipeline.
 *
 * Mirrors `TRUTH_TABLE_POLICY_BASELINE` and `SIMPLIFICATION_POLICY_BASELINE`
 * while also pinning the orchestrator's traversal cap (10 passes). The
 * default keeps the existing behaviour for callers that never opt into a
 * custom policy.
 */
export const LOGICAL_NORMALIZATION_POLICY_BASELINE: LogicalNormalizationPolicy = Object.freeze({
    ...TRUTH_TABLE_POLICY_BASELINE,
    ...SIMPLIFICATION_POLICY_BASELINE,
    maxTraversalIterations: 10
});

/**
 * Input required to evaluate the truth-table generation policy.
 */
export type TruthTablePolicyInput = Readonly<{
    /** Number of distinct boolean variables found in the condition expression */
    variableCount: number;
}>;

/**
 * Decision returned by the truth-table policy evaluator.
 */
export type TruthTablePolicyDecision = Readonly<{
    /** Whether a truth table may be generated for this condition */
    allowTruthTable: boolean;
    /** Human-readable reason for the decision (for debugging and testing) */
    reason: TruthTablePolicyReason;
}>;

/**
 * Discriminated reasons explaining why a truth-table decision was made.
 */
export type TruthTablePolicyReason =
    | { readonly kind: "ok" }
    | { readonly kind: "too_many_variables"; readonly actual: number; readonly max: number }
    | { readonly kind: "no_variables" };

/**
 * Evaluates whether a truth table may be generated for a given condition.
 *
 * This is a pure function: it returns a typed decision object without any
 * side effects.  The mechanism code in `logical-expression-condensation.ts`
 * receives the decision and acts on `allowTruthTable` without needing to know
 * the policy internals.
 *
 * @param input - Policy input containing the variable count
 * @param config - Policy configuration (defaults to baseline)
 * @returns A typed decision object
 *
 * @example
 * ```typescript
 * const decision = evaluateTruthTablePolicy({ variableCount: 5 });
 * // → { allowTruthTable: true, reason: { kind: "ok" } }
 *
 * const decision = evaluateTruthTablePolicy({ variableCount: 12 });
 * // → { allowTruthTable: false, reason: { kind: "too_many_variables", actual: 12, max: 10 } }
 *
 * const decision = evaluateTruthTablePolicy({ variableCount: 0 });
 * // → { allowTruthTable: false, reason: { kind: "no_variables" } }
 * ```
 */
export function evaluateTruthTablePolicy(
    input: TruthTablePolicyInput,
    config: TruthTablePolicy = TRUTH_TABLE_POLICY_BASELINE
): TruthTablePolicyDecision {
    const { variableCount } = input;
    const { maxVariablesForTruthTable } = config;

    // Degenerate case: no variables means there is nothing to condense.
    if (variableCount <= 0) {
        return Object.freeze({
            allowTruthTable: false,
            reason: Object.freeze({ kind: "no_variables" })
        });
    }

    if (variableCount > maxVariablesForTruthTable) {
        return Object.freeze({
            allowTruthTable: false,
            reason: Object.freeze({
                kind: "too_many_variables",
                actual: variableCount,
                max: maxVariablesForTruthTable
            })
        });
    }

    return Object.freeze({
        allowTruthTable: true,
        reason: Object.freeze({ kind: "ok" })
    });
}
