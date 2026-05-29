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
