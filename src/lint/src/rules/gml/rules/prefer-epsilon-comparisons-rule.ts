import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportFullTextRewrite, rewriteSourceText } from "../rule-base-helpers.js";
import {
    evaluateIfZeroComparison,
    evaluateIsEpsilonDeclaration,
    evaluateIsFunctionScopeStart,
    evaluateMathSensitiveVariables,
    type IfZeroComparisonMatch
} from "./prefer-epsilon-comparisons-rule-policy.js";

type EpsilonScope = {
    insertedEpsilonDeclaration: boolean;
};

/**
 * Build the rewritten `if (var > math_get_epsilon())` line for strict
 * positivity checks. When the variable is known to be non-negative (e.g.
 * `point_distance`, `sqr`, `sqrt`), keep the original `> 0` semantics
 * because the result cannot be negative and the original check is safe.
 */
function rewriteStrictPositivityLine(
    originalLine: string,
    match: IfZeroComparisonMatch,
    nonNegativeVariables: ReadonlySet<string>
): string {
    if (nonNegativeVariables.has(match.variableName)) {
        return originalLine;
    }

    return `${match.indentation}if (${match.variableName} > math_get_epsilon())${match.suffix}`;
}

/**
 * Build the rewritten `if (var <= eps)` lines for equality checks against
 * zero. Equality rewrites must use `abs(...)` because signed math results
 * can be negative; only known non-negative results can compare directly.
 * When the enclosing scope has not yet emitted an `eps` declaration, the
 * helper also returns that declaration line and marks the scope so
 * subsequent rewrites in the same scope reuse it.
 */
function rewriteZeroEqualityLines(
    match: IfZeroComparisonMatch,
    nonNegativeVariables: ReadonlySet<string>,
    scope: EpsilonScope
): ReadonlyArray<string> {
    const lines: Array<string> = [];

    if (!scope.insertedEpsilonDeclaration) {
        lines.push(`${match.indentation}var eps = math_get_epsilon();`);
        scope.insertedEpsilonDeclaration = true;
    }

    const comparedVariable = nonNegativeVariables.has(match.variableName)
        ? match.variableName
        : `abs(${match.variableName})`;
    lines.push(`${match.indentation}if (${comparedVariable} <= eps)${match.suffix}`);

    return lines;
}

function countOccurrences(line: string, character: string): number {
    let count = 0;
    for (const char of line) {
        if (char === character) {
            count += 1;
        }
    }

    return count;
}

/**
 * Apply the epsilon-comparison rewrite to a sequence of source lines.
 *
 * The mechanism is responsible only for "how" the rewrite is emitted:
 * walking the line array, tracking brace depth and the per-scope `eps`
 * insertion state, and dispatching to the rewrite helpers. The "what"
 * decisions — which declarations qualify as math-sensitive, which zero
 * comparison shape is recognised, and which math calls imply a
 * non-negative result — live in
 * {@link ./prefer-epsilon-comparisons-rule-policy.ts} and are exercised
 * here through the pure `evaluate*` and `readMathSensitiveFunctionNames`
 * entry points.
 *
 * Pass 1: delegate to the policy's `evaluateMathSensitiveVariables` to
 * classify every `var X = expr;` declaration.
 *
 * Pass 2: walk the line array, asking the policy whether each line is a
 * function-scope opener, an existing `eps` declaration, or a zero
 * comparison. The decision table dispatches to the strict-positivity or
 * equality rewrite helper, which uses the scope state to decide whether a
 * fresh `eps` declaration must be emitted before the rewritten `if` line.
 *
 * Brace depth tracking uses an explicit scope stack so the inserted
 * `var eps` declaration is scoped to the function body that owns the
 * rewritten check rather than the file as a whole.
 */
function rewriteEpsilonComparisonLines(sourceLines: ReadonlyArray<string>): ReadonlyArray<string> {
    const { mathSensitiveVariables, nonNegativeMathSensitiveVariables } = evaluateMathSensitiveVariables(sourceLines);

    const rewrittenLines: Array<string> = [];

    // Each stack entry corresponds to one nested function body; `braceDepth`
    // records the depth at which that entry's scope was opened so we know
    // when it closes and control returns to the enclosing scope's own
    // `insertedEpsilonDeclaration` state.
    const scopeStack: Array<EpsilonScope & { braceDepth: number }> = [
        { braceDepth: 0, insertedEpsilonDeclaration: false }
    ];
    let braceDepth = 0;

    for (const line of sourceLines) {
        if (evaluateIsFunctionScopeStart(line)) {
            scopeStack.push({ braceDepth, insertedEpsilonDeclaration: false });
        }

        const currentScope = scopeStack.at(-1);

        if (evaluateIsEpsilonDeclaration(line)) {
            currentScope.insertedEpsilonDeclaration = true;
        }

        const ifZeroComparisonMatch = evaluateIfZeroComparison(line);
        if (!ifZeroComparisonMatch || !mathSensitiveVariables.has(ifZeroComparisonMatch.variableName)) {
            rewrittenLines.push(line);
        } else if (ifZeroComparisonMatch.operator === ">") {
            rewrittenLines.push(
                rewriteStrictPositivityLine(line, ifZeroComparisonMatch, nonNegativeMathSensitiveVariables)
            );
        } else {
            rewrittenLines.push(
                ...rewriteZeroEqualityLines(ifZeroComparisonMatch, nonNegativeMathSensitiveVariables, currentScope)
            );
        }

        braceDepth += countOccurrences(line, "{") - countOccurrences(line, "}");
        while (scopeStack.length > 1 && braceDepth <= scopeStack.at(-1).braceDepth) {
            scopeStack.pop();
        }
    }

    return rewrittenLines;
}

export function createPreferEpsilonComparisonsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const rewrittenText = rewriteSourceText(sourceText, rewriteEpsilonComparisonLines);
                    reportFullTextRewrite(context, definition.messageId, sourceText, rewrittenText);
                }
            });
        }
    });
}
