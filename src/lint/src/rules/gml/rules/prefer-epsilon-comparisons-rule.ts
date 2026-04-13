import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { createMeta, reportFullTextRewrite } from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

function expressionLooksMathSensitive(expression: string): boolean {
    const normalized = expression.toLowerCase();
    return (
        normalized.includes("sqr(") ||
        normalized.includes("sqrt(") ||
        normalized.includes("point_distance") ||
        normalized.includes("dot_product_") ||
        normalized.includes("lengthdir_") ||
        normalized.includes("math_")
    );
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
