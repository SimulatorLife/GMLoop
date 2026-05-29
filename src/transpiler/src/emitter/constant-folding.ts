import { Core } from "@gmloop/core";

import type { BinaryExpressionNode, GmlNode, TernaryExpressionNode, UnaryExpressionNode } from "./ast.js";
import { normalizeStructKeyText } from "./js-string-utils.js";

const { isApproximatelyZero } = Core;

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

// Equality operators handled by evaluateEqualityOperator.
// Any other operator returns null from that function, signalling "cannot fold".
const EQUALITY_OPERATORS = new Set(["==", "!=", "===", "!=="]);

function evaluateEqualityOperator(
    operator: string,
    left: string | number | boolean,
    right: string | number | boolean
): boolean | null {
    if (!EQUALITY_OPERATORS.has(operator)) {
        return null;
    }

    const isNegated = operator === "!=" || operator === "!==";

    // Numeric operands: all equality operators use epsilon-tolerant comparison
    // to handle floating-point rounding artifacts from intermediate computation.
    // (The strict/loose distinction applies only to boolean-number coercion below.)
    if (typeof left === "number" && typeof right === "number") {
        const equal = isApproximatelyEqual(left, right);
        return isNegated ? !equal : equal;
    }

    // Boolean-string: "true" == true, "false" == false (loose); types differ (strict).
    // Return null (cannot fold) when the string is not "true" or "false".
    if (typeof left === "string" && typeof right === "boolean") {
        const normalized = normalizeStringToBoolean(left);
        if (normalized !== null) {
            const equal = normalized === right;
            return isNegated ? !equal : equal;
        }
        return null;
    }
    if (typeof left === "boolean" && typeof right === "string") {
        const normalized = normalizeStringToBoolean(right);
        if (normalized !== null) {
            const equal = left === normalized;
            return isNegated ? !equal : equal;
        }
        return null;
    }

    // Boolean-number: in GML loose equality true == 1 and false == 0.
    // Strict equality (===/!==) preserves type identity — always false/true respectively
    // for mixed types since booleans and numbers are never equal. Loose equality
    // (==/!=) coerces booleans to 1/0 before comparison.
    if (typeof left === "boolean" && typeof right === "number") {
        if (operator === "===" || operator === "!==") {
            // Types differ, so === is false and !== is true.
            return operator === "===" ? false : true;
        }
        const equal = (left ? 1 : 0) === right;
        return isNegated ? !equal : equal;
    }
    if (typeof left === "number" && typeof right === "boolean") {
        if (operator === "===" || operator === "!==") {
            return operator === "===" ? false : true;
        }
        const equal = left === (right ? 1 : 0);
        return isNegated ? !equal : equal;
    }

    // Same-type comparisons (booleans, non-boolean strings, or unknown operators).
    // Booleans compare directly; strings were already handled above.
    const equal = left === right;
    return isNegated ? !equal : equal;
}

/**
 * Convert the string literal "true" or "false" to its boolean equivalent.
 * Returns null for any other value so callers can bail out of the fold safely.
 */
function normalizeStringToBoolean(value: unknown): boolean | null {
    if (value === "true") return true;
    if (value === "false") return false;
    return null;
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
    // Guard: abort if either operand node is missing.  In recovery mode the
    // parser may emit a node whose `type` field is present but whose structural
    // children are undefined; accessing `.value` on either would throw a
    // TypeError.  Returning null signals that folding cannot proceed safely.
    if (!ast.left || !ast.right) {
        return null;
    }

    // Only fold if both operands are literals
    if (ast.left.type !== "Literal" || ast.right.type !== "Literal") {
        return null;
    }

    const left = ast.left.value;
    const right = ast.right.value;

    // Abort folding when either operand is null or undefined (the parser uses these
    // as sentinels for missing or malformed AST fields). Returning null here signals
    // "cannot fold at compile time" so the caller emits the expression at runtime
    // instead of crashing on a property access like `.value` or `.operator` of null.
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
    //
    // Hoist normalization to local variables so we avoid repeated calls when
    // both the + operator and equality/comparison checks need the normalized
    // values — saves up to 3 redundant normalizeStructKeyText calls per operand.
    if (typeof left === "string" && typeof right === "string") {
        const normalizedLeft = normalizeStructKeyText(left);
        const normalizedRight = normalizeStructKeyText(right);

        if (op === "+") {
            return normalizedLeft + normalizedRight;
        }

        const equalityResult = evaluateEqualityOperator(op, normalizedLeft, normalizedRight);
        if (equalityResult !== null) {
            return equalityResult;
        }

        // Mixed-type boolean-string comparisons normalized above, but fall through
        // here if the operator wasn't handled — no further action needed.
    }

    // Mixed-type comparisons where one operand is boolean and the other is numeric.
    // Loose equality (`==`) coerces booleans to 1/0 before comparison; strict equality
    // (`===`) preserves type identity so returns false when types differ.
    if (
        (typeof left === "boolean" && typeof right === "number") ||
        (typeof left === "number" && typeof right === "boolean")
    ) {
        const equalityResult = evaluateEqualityOperator(op, left, right);
        if (equalityResult !== null) {
            return equalityResult;
        }
    }

    // Mixed-type boolean-string comparisons: boolean literal compared against
    // the string literal "true" or "false". Normalize the string to boolean.
    if (
        (typeof left === "boolean" && typeof right === "string") ||
        (typeof left === "string" && typeof right === "boolean")
    ) {
        const equalityResult = evaluateEqualityOperator(op, left, right);
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
    // Guard: abort if the operand node is missing.  In recovery mode the parser
    // may emit a node whose `type` field is present but whose `argument` child
    // is undefined; accessing `.value` on it would throw a TypeError.
    if (!ast.argument) {
        return null;
    }

    // Only fold if the operand is a literal
    if (ast.argument.type !== "Literal") {
        return null;
    }

    const operand = ast.argument.value;

    // Return null when the operand is null or undefined so the caller falls back
    // to runtime evaluation rather than crashing on a null property access.
    if (isNullishValue(operand)) {
        return null;
    }

    const op = ast.operator;

    // Detect boolean operands in both native JS and parser-string form.
    // The GML parser represents boolean literals as strings ("true" / "false")
    // rather than native booleans, so the check covers both representations.
    // This guard is critical: applying unary arithmetic to a boolean value
    // (e.g. `-true`) would silently coerce it to a number (1) in JavaScript,
    // which is not equivalent to any valid GML constant expression — GML raises
    // a type error for arithmetic on booleans at runtime. Skipping the fold here
    // keeps the transpiled output syntactically valid and lets the runtime
    // produce the same error GML would, rather than silently producing a wrong
    // numeric result.
    const isBooleanLiteral = typeof operand === "boolean" || operand === "true" || operand === "false";

    // Numeric unary operations — the parser stores numeric literals as strings,
    // so we parse them before applying the operator.
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
    // Guard: abort if the test node is missing.  In recovery mode the parser may
    // emit a node whose `type` field is present but whose structural children are
    // undefined; accessing `.value` would throw a TypeError.
    if (!ast.test) {
        return null;
    }

    if (ast.test.type !== "Literal") {
        return null;
    }

    const foldedCondition = toBooleanLiteral(ast.test.value);
    if (foldedCondition === null) {
        return null;
    }

    // Guard: return null if either branch is absent.  A ternary with only one branch
    // (e.g. `condition ? value`) is valid GML but semantically different from a
    // two-branch form, and collapsing it would alter program behaviour at runtime.
    if (!ast.consequent || !ast.alternate) {
        return null;
    }

    return foldedCondition ? ast.consequent : ast.alternate;
}
