import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportFullTextRewrite } from "../rule-base-helpers.js";

// GML built-in functions whose result is a floating-point value subject to
// rounding error. Any variable whose initializer calls one of these functions
// (directly or transitively through a sub-expression) is considered
// "math-sensitive": a direct `== 0` or `> 0` check on such a value can produce
// incorrect branch decisions when the true result is a tiny non-zero number
// produced by floating-point arithmetic.
//
// This set is deliberately aligned with the comprehensive
// `MATH_CALL_NAMES` catalog used by `optimize-math-expressions` so that both
// rules agree on what counts as a math call, and the same coverage is offered
// to every floating-point math builtin in the language.
const MATH_SENSITIVE_FUNCTION_NAMES: ReadonlySet<string> = new Set([
    "arccos",
    "arcsin",
    "arctan",
    "arctan2",
    "cos",
    "darccos",
    "darcsin",
    "darctan",
    "darctan2",
    "dcos",
    "degtorad",
    "dot_product",
    "dot_product_3d",
    "dot_product_3d_normalize",
    "dot_product_normalize",
    "dsin",
    "dtan",
    "exp",
    "lengthdir_x",
    "lengthdir_y",
    "ln",
    "log2",
    "log10",
    "mean",
    "point_direction",
    "point_distance",
    "point_distance_3d",
    "power",
    "radtodeg",
    "sin",
    "sqr",
    "sqrt",
    "tan"
]);

const FUNCTION_CALL_NAME_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/gu;

function expressionLooksMathSensitive(expression: string): boolean {
    // Scan the initializer for any identifier immediately followed by `(` so
    // we only treat actual function-call forms as math-sensitive. The previous
    // substring-based check missed several categories of math builtins
    // (trig, exp/log, degree conversions, etc.) and produced false positives
    // for any identifier that happened to begin with the searched prefix.
    const normalized = expression.toLowerCase();
    for (const match of normalized.matchAll(FUNCTION_CALL_NAME_PATTERN)) {
        const nextIndex = match.index + match[0].length;
        if (
            nextIndex < normalized.length &&
            normalized[nextIndex] === "(" &&
            MATH_SENSITIVE_FUNCTION_NAMES.has(match[0])
        ) {
            return true;
        }
    }

    return false;
}

type ZeroComparisonOperator = "==" | ">";

type IfZeroComparisonMatch = Readonly<{
    indentation: string;
    variableName: string;
    operator: ZeroComparisonOperator;
    suffix: string;
}>;

function readIfZeroComparisonMatch(line: string): IfZeroComparisonMatch | null {
    const match = /^(\s*)if\s*\(\s*([A-Za-z_]\w*)\s*(==|>)\s*0\s*\)(.*)$/u.exec(line);
    if (!match) {
        return null;
    }

    return Object.freeze({
        indentation: match[1] ?? "",
        variableName: match[2] ?? "",
        operator: (match[3] as ZeroComparisonOperator | undefined) ?? "==",
        suffix: match[4] ?? ""
    });
}

export function createPreferEpsilonComparisonsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const lineEnding = Core.dominantLineEnding(sourceText);
                    const lines = sourceText.split(/\r?\n/u);
                    const mathSensitiveVariables = new Set<string>();

                    for (const line of lines) {
                        const declarationMatch = /^\s*var\s+([A-Za-z_]\w*)\s*=\s*(.+?);\s*$/u.exec(line);
                        if (!declarationMatch) {
                            continue;
                        }

                        const variableName = declarationMatch[1] ?? "";
                        const expression = declarationMatch[2] ?? "";
                        if (expressionLooksMathSensitive(expression)) {
                            mathSensitiveVariables.add(variableName);
                        }
                    }

                    const hasEpsilonDeclaration = lines.some((line) =>
                        /^\s*var\s+eps\s*=\s*math_get_epsilon\(\)\s*;\s*$/u.test(line)
                    );

                    const rewrittenLines: Array<string> = [];
                    let insertedEpsilonDeclaration = hasEpsilonDeclaration;
                    for (const line of lines) {
                        const ifZeroComparisonMatch = readIfZeroComparisonMatch(line);
                        if (!ifZeroComparisonMatch) {
                            rewrittenLines.push(line);
                            continue;
                        }

                        const { indentation, variableName, operator, suffix } = ifZeroComparisonMatch;
                        if (!mathSensitiveVariables.has(variableName)) {
                            rewrittenLines.push(line);
                            continue;
                        }

                        if (operator === ">") {
                            rewrittenLines.push(`${indentation}if (${variableName} > math_get_epsilon())${suffix}`);
                            continue;
                        }

                        if (!insertedEpsilonDeclaration) {
                            rewrittenLines.push(`${indentation}var eps = math_get_epsilon();`);
                            insertedEpsilonDeclaration = true;
                        }

                        rewrittenLines.push(`${indentation}if (${variableName} <= eps)${suffix}`);
                    }

                    const rewrittenText = rewrittenLines.join(lineEnding);
                    reportFullTextRewrite(context, definition.messageId, sourceText, rewrittenText);
                }
            });
        }
    });
}
