import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportFullTextRewrite, rewriteSourceText } from "../rule-base-helpers.js";

// GML built-in functions whose result is a floating-point value subject to
// rounding error. Any variable whose initializer calls one of these functions
// (directly or transitively through a sub-expression) is considered
// "math-sensitive": a direct `== 0` or `> 0` check on such a value can produce
// incorrect branch decisions when the true result is a tiny non-zero number
// produced by floating-point arithmetic. Equality rewrites must use an absolute
// value because signed math results can be negative. Strict positivity rewrites
// are limited to values whose sign is not known to be non-negative.
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

const NON_NEGATIVE_MATH_FUNCTION_NAMES: ReadonlySet<string> = new Set([
    "point_distance",
    "point_distance_3d",
    "sqr",
    "sqrt"
]);

const FUNCTION_CALL_NAME_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/gu;

function readMathSensitiveFunctionNames(expression: string): Array<string> {
    // Scan the initializer for any identifier immediately followed by `(` so
    // we only treat actual function-call forms as math-sensitive. The previous
    // substring-based check missed several categories of math builtins
    // (trig, exp/log, degree conversions, etc.) and produced false positives
    // for any identifier that happened to begin with the searched prefix.
    const normalized = expression.toLowerCase();
    const functionNames: Array<string> = [];
    for (const match of normalized.matchAll(FUNCTION_CALL_NAME_PATTERN)) {
        const nextIndex = match.index + match[0].length;
        if (
            nextIndex < normalized.length &&
            normalized[nextIndex] === "(" &&
            MATH_SENSITIVE_FUNCTION_NAMES.has(match[0])
        ) {
            functionNames.push(match[0]);
        }
    }

    return functionNames;
}

function hasRepeatedDotProductOperands(expression: string): boolean {
    const callMatch = /^(?<functionName>dot_product(?:_3d)?)\s*\((?<arguments>.*)\)$/u.exec(expression.trim());
    if (!callMatch?.groups) {
        return false;
    }

    const functionName = callMatch.groups.functionName;
    const argumentsList = callMatch.groups.arguments.split(",").map((argument) => argument.trim());
    const expectedArgumentCount = functionName === "dot_product_3d" ? 6 : 4;
    if (argumentsList.length !== expectedArgumentCount) {
        return false;
    }

    const half = expectedArgumentCount / 2;
    return argumentsList.slice(0, half).every((argument, index) => argument === argumentsList[index + half]);
}

function expressionIsKnownNonNegativeMath(expression: string, functionNames: ReadonlyArray<string>): boolean {
    if (expression.includes("-")) {
        return false;
    }

    if (hasRepeatedDotProductOperands(expression)) {
        return true;
    }

    return (
        functionNames.length > 0 &&
        functionNames.every((functionName) => NON_NEGATIVE_MATH_FUNCTION_NAMES.has(functionName))
    );
}

type ZeroComparisonOperator = "==" | ">";

type IfZeroComparisonMatch = Readonly<{
    indentation: string;
    variableName: string;
    operator: ZeroComparisonOperator;
    suffix: string;
}>;

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

// Matches a line that opens a new function body (either `function name(...) {`
// or a method/lambda assignment such as `name = function(...) {`). GML `var`
// locals declared inside a function are scoped to that function and are not
// visible from sibling or outer functions, so `eps` insertion must be tracked
// per function scope rather than once for the whole file.
const FUNCTION_SCOPE_START_PATTERN = /\bfunction\b[^{]*\{\s*$/u;
const EPSILON_DECLARATION_PATTERN = /^\s*var\s+eps\s*=\s*math_get_epsilon\(\)\s*;\s*$/u;

function countOccurrences(line: string, character: string): number {
    let count = 0;
    for (const char of line) {
        if (char === character) {
            count += 1;
        }
    }

    return count;
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

/**
 * Applies the epsilon-comparison rewrite to a sequence of source lines.
 *
 * Runs two passes over `sourceLines`:
 *  1. Collect every `var X = mathFn(...);` declaration whose initializer calls
 *     a math-sensitive builtin; record the variable name and whether its
 *     result is known to be non-negative.
 *  2. Rewrite every `if (var == 0) {` and `if (var > 0) {` line whose target
 *     was collected in pass 1, inserting an `eps = math_get_epsilon()`
 *     declaration at the start of the enclosing function scope when no such
 *     declaration already exists.
 *
 * Pass 2 tracks brace depth and an explicit scope stack so the inserted
 * `eps` declaration is scoped to the function body that owns the rewritten
 * check rather than the file as a whole.
 */
function rewriteEpsilonComparisonLines(sourceLines: ReadonlyArray<string>): ReadonlyArray<string> {
    const mathSensitiveVariables = new Set<string>();
    const nonNegativeMathSensitiveVariables = new Set<string>();

    for (const line of sourceLines) {
        const declarationMatch = /^\s*var\s+([A-Za-z_]\w*)\s*=\s*(.+?);\s*$/u.exec(line);
        if (!declarationMatch) {
            continue;
        }

        const variableName = declarationMatch[1] ?? "";
        const expression = declarationMatch[2] ?? "";
        const functionNames = readMathSensitiveFunctionNames(expression);
        if (functionNames.length > 0) {
            mathSensitiveVariables.add(variableName);
            if (expressionIsKnownNonNegativeMath(expression, functionNames)) {
                nonNegativeMathSensitiveVariables.add(variableName);
            }
        }
    }

    const rewrittenLines: Array<string> = [];

    // Track whether an `eps` declaration has already been emitted for the
    // current function scope. Each stack entry corresponds to one nested
    // function body; `braceDepth` records the depth at which that entry's
    // scope was opened so we know when it closes and control returns to the
    // enclosing scope's own `insertedEpsilonDeclaration` state.
    const scopeStack: Array<EpsilonScope & { braceDepth: number }> = [
        { braceDepth: 0, insertedEpsilonDeclaration: false }
    ];
    let braceDepth = 0;

    for (const line of sourceLines) {
        if (FUNCTION_SCOPE_START_PATTERN.test(line)) {
            scopeStack.push({ braceDepth, insertedEpsilonDeclaration: false });
        }

        const currentScope = scopeStack.at(-1);

        if (EPSILON_DECLARATION_PATTERN.test(line)) {
            currentScope.insertedEpsilonDeclaration = true;
        }

        const ifZeroComparisonMatch = readIfZeroComparisonMatch(line);
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
