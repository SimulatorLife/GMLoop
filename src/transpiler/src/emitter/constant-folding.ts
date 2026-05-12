import type { BinaryExpressionNode, GmlNode, TernaryExpressionNode, UnaryExpressionNode } from "./ast.js";
import { normalizeStructKeyText } from "./js-string-utils.js";

const ZERO_COMPARISON_EPSILON = Number.EPSILON * 4;

function isApproximatelyZero(value: number): boolean {
    return Math.abs(value) <= ZERO_COMPARISON_EPSILON;
}

/**
 * Relative and absolute epsilon for floating-point equality comparisons.
 *
 * Using a combined tolerance avoids false negatives for both:
 * - Very small values near zero (where absolute epsilon dominates)
 * - Large values where relative error is the binding constraint
 *
 * The factor of 8 was chosen to safely exceed the accumulated rounding error
 * for a 10-term sum of numbers around 0.1 (each term has ~1.5 ulp of error;
 * 10 terms → ~15 ulp total → ~3.2 × EPSILON). Choosing 8× EPSILON provides
 * sufficient headroom for typical GML numeric literals while remaining well
 * below values that differ by more than one digit, so the comparison remains
 * meaningful rather than collapsing all distinct floats to "equal".
 */
const APPROXIMATE_EQUALITY_EPSILON = Number.EPSILON * 8;

function isApproximatelyEqual(a: number, b: number): boolean {
    if (a === b) return true;
    const diff = Math.abs(a - b);
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    return diff <= APPROXIMATE_EQUALITY_EPSILON * scale;
}

function toNumericLiteral(value: string | number | boolean): number | null {
    if (typeof value === "number") {
        return value;
    }

    if (typeof value !== "string") {
        return null;
    }

    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
}

function toBooleanLiteral(value: string | number | boolean): boolean | null {
    if (typeof value === "boolean") {
        return value;
    }

    if (value === "true") {
        return true;
    }

    if (value === "false") {
        return false;
    }

    return null;
}

function isNullishValue(value: unknown): value is null | undefined {
    return value === null || value === undefined;
}

// Map-based dispatch for numeric operators: eliminates verbose switch statements
// while preserving identical runtime behavior. Each operator maps to a pure function
// that handles the operation, including zero-divisor guards for div/%/mod.
const NUMERIC_OPERATORS = new Map<string, (a: number, b: number) => number | boolean | null>([
    ["+", (a, b) => a + b],
    ["-", (a, b) => a - b],
    ["*", (a, b) => a * b],
    ["/", (a, b) => (isApproximatelyZero(b) ? null : a / b)],
    [
        "div",
        (a, b) =>
            // GML's div truncates toward zero (like C int/int). Math.trunc is correct here;
            // Math.floor gives wrong results for negative operands (e.g. -7 div 2 → -3, not -4).
            isApproximatelyZero(b) ? null : Math.trunc(a / b)
    ],
    ["%", (a, b) => (isApproximatelyZero(b) ? null : a % b)],
    ["mod", (a, b) => (isApproximatelyZero(b) ? null : a % b)],
    ["**", (a, b) => a ** b],
    ["<", (a, b) => a < b],
    ["<=", (a, b) => a <= b],
    [">", (a, b) => a > b],
    [">=", (a, b) => a >= b],
    ["&", (a, b) => a & b],
    ["|", (a, b) => a | b],
    ["^", (a, b) => a ^ b],
    ["xor", (a, b) => a ^ b],
    ["<<", (a, b) => a << b],
    [">>", (a, b) => a >> b]
]);

// Boolean operators that need short-circuit evaluation.
// Unlike numeric operators, &&/and and ||/or must be evaluated inline
// to preserve JavaScript's short-circuit semantics (e.g., false && x returns false without evaluating x).
const BOOLEAN_OPERATORS = new Set(["&&", "and", "||", "or"]);

function evaluateEqualityOperator(
    operator: string,
    left: string | number | boolean,
    right: string | number | boolean
): boolean | null {
    switch (operator) {
        case "==":
        case "===": {
            // Apply epsilon-tolerant comparison for numeric operands to handle
            // floating-point rounding artifacts from intermediate computation.
            if (typeof left === "number" && typeof right === "number") {
                return isApproximatelyEqual(left, right);
            }
            return left === right;
        }
        case "!=":
        case "!==": {
            if (typeof left === "number" && typeof right === "number") {
                return !isApproximatelyEqual(left, right);
            }
            return left !== right;
        }
        default: {
            return null;
        }
    }
}

/**
 * Attempt to fold a constant binary expression at compile time.
 *
 * This optimization reduces output size and improves runtime performance
 * by evaluating simple arithmetic and logical operations on literal values
 * during transpilation instead of at runtime.
 *
 * Examples:
 *   2 + 3 → 5
 *   10 / 2 → 5
 *   true && false → false
 *   "hello" + " world" → "hello world"
 *
 * This is especially beneficial for hot-reload scenarios where the same
 * constant expressions might be evaluated repeatedly during development.
 *
 * @param ast - Binary expression node to potentially fold
 * @returns The folded constant value if both operands are literals and the
 *          operation can be safely evaluated, otherwise null
 */
export function tryFoldConstantExpression(ast: BinaryExpressionNode): number | string | boolean | null {
    // Only fold if both operands are literals
    if (ast.left.type !== "Literal" || ast.right.type !== "Literal") {
        return null;
    }

    const left = ast.left.value;
    const right = ast.right.value;

    // Handle null/undefined operands conservatively
    if (isNullishValue(left) || isNullishValue(right)) {
        return null;
    }

    const op = ast.operator;

    // Arithmetic and bitwise operations (numbers only).
    // The parser sometimes stores numeric literals as strings, so we normalize
    // both operands once up front and reuse them for all numeric operators.
    const leftNumber = toNumericLiteral(left);
    const rightNumber = toNumericLiteral(right);
    if (leftNumber !== null && rightNumber !== null) {
        const numericFn = NUMERIC_OPERATORS.get(op);
        if (numericFn !== undefined) {
            const result = numericFn(leftNumber, rightNumber);
            // Numeric operators return numbers/booleans; null indicates division by zero
            if (result !== null) {
                return result;
            }
        }
        // Numeric operators (`+ - * /`, etc.) are dispatched via `NUMERIC_OPERATORS`.
        // Comparison operators (`< <= > >=`) in that same map return null when
        // their operands don't satisfy the comparison (e.g., `1 < 0` → null),
        // so we fall through to `evaluateEqualityOperator` for every non-null
        // result — including ordinary equality checks like `1 === 1`.
        const equalityResult = evaluateEqualityOperator(op, leftNumber, rightNumber);
        if (equalityResult !== null) {
            return equalityResult;
        }
    }

    // String operations.
    // The GML parser stores string literal values with their surrounding
    // double quotes preserved in the token text (e.g., the GML literal "hello"
    // is lexed as the token sequence `"` `hello` `"`, and the Literal node's
    // `value` field holds `'"hello"'`). `normalizeStructKeyText` strips the
    // leading and trailing quote so we can perform the actual string operation.
    // The emitter then re-wraps the result in `JSON.stringify`, restoring the
    // correct GML syntax for the transpiled output.
    if (typeof left === "string" && typeof right === "string") {
        if (op === "+") {
            return normalizeStructKeyText(left) + normalizeStructKeyText(right);
        }

        const equalityResult = evaluateEqualityOperator(
            op,
            normalizeStructKeyText(left),
            normalizeStructKeyText(right)
        );
        if (equalityResult !== null) {
            return equalityResult;
        }
    }

    // Logical operations (boolean only)
    const leftBoolean = toBooleanLiteral(left);
    const rightBoolean = toBooleanLiteral(right);
    if (leftBoolean !== null && rightBoolean !== null) {
        if (BOOLEAN_OPERATORS.has(op)) {
            // Short-circuit evaluation for &&/and and ||/or
            if (op === "&&" || op === "and") {
                return leftBoolean && rightBoolean;
            }
            return leftBoolean || rightBoolean;
        }
        // Comparison operators on boolean literals are handled here.
        // If both sides are boolean literals the equality check is meaningful;
        // otherwise evaluateEqualityOperator returns null and the whole fold is
        // aborted so we never produce incorrect results from mixed-type operands.
        const equalityResult = evaluateEqualityOperator(op, leftBoolean, rightBoolean);
        if (equalityResult !== null) {
            return equalityResult;
        }
    }

    // Couldn't fold this expression
    return null;
}

/**
 * Attempt to fold a constant unary expression at compile time.
 *
 * This optimization complements binary expression folding by handling
 * unary operations on literal values during transpilation.
 *
 * Examples:
 *   -5 → -5
 *   +3.14 → 3.14
 *   !true → false
 *   ~15 → -16
 *   not false → true
 *
 * @param ast - Unary expression node to potentially fold
 * @returns The folded constant value if the operand is a literal and the
 *          operation can be safely evaluated, otherwise null
 */
export function tryFoldConstantUnaryExpression(ast: UnaryExpressionNode): number | boolean | null {
    // Only fold if the operand is a literal
    if (ast.argument.type !== "Literal") {
        return null;
    }

    const operand = ast.argument.value;

    // Handle null/undefined operands conservatively
    if (isNullishValue(operand)) {
        return null;
    }

    const op = ast.operator;

    // Helper to check if a value is a boolean literal (handles parser quirk where
    // boolean literals are represented as strings "true"/"false")
    const isBooleanLiteral = typeof operand === "boolean" || operand === "true" || operand === "false";

    // Numeric unary operations
    // Note: The parser represents numeric literals as strings, so we need to parse them.
    // Skip boolean values to avoid incorrect numeric conversion (e.g., true → 1)
    if (!isBooleanLiteral) {
        const numValue = typeof operand === "number" ? operand : Number(operand);
        if (!Number.isNaN(numValue)) {
            switch (op) {
                case "-": {
                    return -numValue;
                }
                case "+": {
                    return numValue;
                }
                case "~": {
                    return ~numValue;
                }
            }
        }
    }

    // Boolean/logical unary operations
    // Note: The parser represents boolean literals as strings ("true"/"false")
    // so we need to handle both actual booleans and string representations
    if (isBooleanLiteral) {
        const boolValue = operand === true || operand === "true";
        switch (op) {
            case "!":
            case "not": {
                return !boolValue;
            }
        }
    }

    // Couldn't fold this expression
    return null;
}

/**
 * Attempt to fold a ternary expression when the condition is a boolean literal.
 *
 * This is intentionally conservative: only explicit boolean literals
 * (`true`, `false`, and parser-normalized `"true"`/`"false"` strings) are
 * folded to avoid changing GML truthiness semantics for numeric/string literals.
 *
 * @param ast - Ternary expression node to potentially fold
 * @returns The selected branch node when folding is safe, otherwise null
 */
export function tryFoldConstantTernaryExpression(ast: TernaryExpressionNode): GmlNode | null {
    if (ast.test.type !== "Literal") {
        return null;
    }

    const foldedCondition = toBooleanLiteral(ast.test.value);
    if (foldedCondition === null) {
        return null;
    }

    // Guard against malformed AST where consequent/alternate are missing.
    // Returning null signals that folding cannot proceed safely.
    if (!ast.consequent || !ast.alternate) {
        return null;
    }

    return foldedCondition ? ast.consequent : ast.alternate;
}
