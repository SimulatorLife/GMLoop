/**
 * Shared policy predicates and pattern catalogs for the
 * `prefer-epsilon-comparisons` rule.
 *
 * This module owns the **policy decisions** — what counts as a math
 * sensitive declaration, what counts as a strict-positivity vs equality
 * zero comparison, whether an expression is structurally non-negative —
 * that gate the rewrite. The rule's mechanism (line walking, brace-depth
 * scope tracking, source text rewrites, ESLint reporting) is kept in
 * {@link ./prefer-epsilon-comparisons-rule.ts} and depends on this module
 * rather than re-implementing the heuristics inline.
 *
 * Policy evaluators are pure: they take data in and return data out, never
 * mutate state and never touch the ESLint runtime. This keeps the eligibility
 * contract testable in isolation and prevents the mechanism from drifting
 * away from the documented "what should be rewritten" rules.
 */

/**
 * GML built-in functions whose result is a floating-point value subject to
 * rounding error. Any variable whose initializer calls one of these functions
 * (directly or through a sub-expression) is considered "math-sensitive": a
 * direct `== 0` or `> 0` check on such a value can produce incorrect branch
 * decisions when the true result is a tiny non-zero number produced by
 * floating-point arithmetic.
 *
 * The catalog is aligned with the `MATH_CALL_NAMES` set used by
 * `optimize-math-expressions` so both rules agree on what counts as a math
 * call.
 */
export const MATH_SENSITIVE_FUNCTION_NAMES: ReadonlySet<string> = Object.freeze(
    new Set([
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
    ])
);

/**
 * Subset of {@link MATH_SENSITIVE_FUNCTION_NAMES} whose result is guaranteed
 * to be non-negative. Strict positivity checks on these expressions can keep
 * the original `> 0` semantics; equality rewrites can compare directly
 * without `abs(...)`.
 */
export const NON_NEGATIVE_MATH_FUNCTION_NAMES: ReadonlySet<string> = Object.freeze(
    new Set(["point_distance", "point_distance_3d", "sqr", "sqrt"])
);

const FUNCTION_CALL_NAME_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/gu;

const MATH_DECLARATION_PATTERN = /^\s*var\s+([A-Za-z_]\w*)\s*=\s*(.+?);\s*$/u;

const FUNCTION_SCOPE_START_PATTERN = /\bfunction\b[^{]*\{\s*$/u;

const EPSILON_DECLARATION_PATTERN = /^\s*var\s+eps\s*=\s*math_get_epsilon\(\)\s*;\s*$/u;

const IF_ZERO_COMPARISON_PATTERN = /^(\s*)if\s*\(\s*([A-Za-z_]\w*)\s*(==|>)\s*0\s*\)(.*)$/u;

const REPEATED_DOT_PRODUCT_PATTERN = /^(?<functionName>dot_product(?:_3d)?)\s*\((?<arguments>.*)\)$/u;

/**
 * Operators the rule rewrites. Equality rewrites must use `abs(...)` because
 * signed math results can be negative; strict positivity rewrites only fire
 * when the result is not known to be non-negative.
 */
export type ZeroComparisonOperator = "==" | ">";

/**
 * Description of a single `if (var <op> 0) ...` line captured by
 * {@link evaluateIfZeroComparison}.
 */
export type IfZeroComparisonMatch = Readonly<{
    indentation: string;
    variableName: string;
    operator: ZeroComparisonOperator;
    suffix: string;
}>;

/**
 * Description of a math-sensitive `var X = ...;` line captured by
 * {@link evaluateIsMathSensitiveVariableDeclaration}. The function-name list
 * is included so callers do not have to re-scan the expression to recover
 * the same data.
 */
export type MathSensitiveVariableDeclaration = Readonly<{
    variableName: string;
    expression: string;
    functionNames: ReadonlyArray<string>;
}>;

/**
 * Result of classifying every variable declaration in a list of source
 * lines. Variables in `mathSensitiveVariables` are eligible for the
 * rewrite; variables in `nonNegativeMathSensitiveVariables` are a subset
 * whose result is structurally non-negative (e.g. `sqr`, `sqrt`,
 * `point_distance`) and so can keep the original comparison shape.
 */
export type MathSensitiveVariableClassification = Readonly<{
    mathSensitiveVariables: ReadonlySet<string>;
    nonNegativeMathSensitiveVariables: ReadonlySet<string>;
}>;

/**
 * Scans the initializer of a `var` declaration and returns the names of
 * every math-sensitive function it calls (e.g. `sqrt`, `dot_product_3d`).
 * Pure: only the names found in the expression are returned; ordering is
 * preserved so downstream reasoning can depend on call order.
 */
export function readMathSensitiveFunctionNames(expression: string): Array<string> {
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

/**
 * Returns `true` when `expression` is a `dot_product(x1, ..., xn, x1, ...,
 * xn)` (or `dot_product_3d`) call whose second half repeats its first half
 * verbatim. Repeated-operand dot products are an algebraic identity equal to
 * the sum of squares, so the result is non-negative.
 */
export function hasRepeatedDotProductOperands(expression: string): boolean {
    const callMatch = REPEATED_DOT_PRODUCT_PATTERN.exec(expression.trim());
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

/**
 * Returns `true` when every math function called by `expression` produces a
 * result known to be non-negative (no leading `-`, identity-style dot
 * product, or membership in {@link NON_NEGATIVE_MATH_FUNCTION_NAMES}).
 *
 * An empty `functionNames` list returns `false`: the rule should only treat
 * the expression as non-negative when its math calls alone justify the
 * assumption.
 */
export function expressionIsKnownNonNegativeMath(expression: string, functionNames: ReadonlyArray<string>): boolean {
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

/**
 * Returns the captured `var X = expr;` declaration when `line` initializes a
 * variable with a math-sensitive expression, otherwise `null`.
 *
 * Pure classification: returns the captured name and expression verbatim so
 * callers can use them for further policy decisions without re-scanning.
 */
export function evaluateIsMathSensitiveVariableDeclaration(line: string): MathSensitiveVariableDeclaration | null {
    const declarationMatch = MATH_DECLARATION_PATTERN.exec(line);
    if (!declarationMatch) {
        return null;
    }

    const variableName = declarationMatch[1] ?? "";
    const expression = declarationMatch[2] ?? "";
    const functionNames = readMathSensitiveFunctionNames(expression);
    if (functionNames.length === 0) {
        return null;
    }

    return Object.freeze({ variableName, expression, functionNames });
}

/**
 * Returns `true` when `line` opens a new function body (either
 * `function name(...) {` or a method/lambda assignment such as
 * `name = function(...) {`). GML `var` locals are scoped to the enclosing
 * function, so the rewrite's `eps` insertion must be tracked per function
 * scope rather than once per file.
 */
export function evaluateIsFunctionScopeStart(line: string): boolean {
    return FUNCTION_SCOPE_START_PATTERN.test(line);
}

/**
 * Returns `true` when `line` already declares `var eps = math_get_epsilon();`.
 * The mechanism treats this as evidence that the current scope does not need
 * a fresh declaration.
 */
export function evaluateIsEpsilonDeclaration(line: string): boolean {
    return EPSILON_DECLARATION_PATTERN.test(line);
}

/**
 * Returns the captured `if (X == 0) ...` / `if (X > 0) ...` shape when
 * `line` matches, otherwise `null`. The captured fields are used by the
 * mechanism to emit the rewritten line without re-scanning.
 */
export function evaluateIfZeroComparison(line: string): IfZeroComparisonMatch | null {
    const match = IF_ZERO_COMPARISON_PATTERN.exec(line);
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

/**
 * Walks `sourceLines` once and classifies every `var X = expr;`
 * declaration whose initializer calls a math-sensitive builtin.
 *
 * The walk is intentionally order-preserving so the policy answer is
 * deterministic for a given input (the sets use insertion order).
 *
 * Pure: takes the source line array, returns the classification. No
 * mutation, no I/O.
 */
export function evaluateMathSensitiveVariables(
    sourceLines: ReadonlyArray<string>
): MathSensitiveVariableClassification {
    const mathSensitiveVariables = new Set<string>();
    const nonNegativeMathSensitiveVariables = new Set<string>();

    for (const line of sourceLines) {
        const declaration = evaluateIsMathSensitiveVariableDeclaration(line);
        if (!declaration) {
            continue;
        }

        mathSensitiveVariables.add(declaration.variableName);
        if (expressionIsKnownNonNegativeMath(declaration.expression, declaration.functionNames)) {
            nonNegativeMathSensitiveVariables.add(declaration.variableName);
        }
    }

    return Object.freeze({
        mathSensitiveVariables,
        nonNegativeMathSensitiveVariables
    });
}
