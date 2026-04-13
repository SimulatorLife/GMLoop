import type { BinaryExpressionNode, GmlNode, TernaryExpressionNode, UnaryExpressionNode } from "./ast.js";

const ZERO_COMPARISON_EPSILON = Number.EPSILON * 4;

function isApproximatelyZero(value: number): boolean {
    return Math.abs(value) <= ZERO_COMPARISON_EPSILON;
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

/**
 * Check whether a parser-produced string literal value includes surrounding
 * double quotes.
 *
 * The GML parser stores string literal values WITH their surrounding quotes
 * (e.g., the GML literal `"hello"` is stored as the 7-character JS string
 * `"hello"` whose first and last characters are `"`). Hand-crafted AST nodes
 * or non-string literal values do NOT include quotes.
 */
function isParserQuotedString(value: string): boolean {
    return value.length >= 2 && value[0] === '"' && value.at(-1) === '"';
}

/**
 * Strip surrounding double quotes from a parser-produced string literal value.
 *
 * If the value is not a parser-quoted string, it is returned unchanged so that
 * hand-crafted AST nodes (e.g., from tests) continue to work.
 */
function stripParserQuotes(value: string): string {
    if (isParserQuotedString(value)) {
        return value.slice(1, -1);
    }
    return value;
}

function evaluatePrimitiveEqualityOperator(
    operator: string,
    left: string | number | boolean,
    right: string | number | boolean
): boolean | null {
    switch (operator) {
        case "==":
        case "===": {
            return left === right;
        }
        case "!=":
        case "!==": {
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
        switch (op) {
            case "+": {
                return leftNumber + rightNumber;
            }
            case "-": {
                return leftNumber - rightNumber;
            }
            case "*": {
                return leftNumber * rightNumber;
            }
            case "/": {
                // Avoid division by zero
                return isApproximatelyZero(rightNumber) ? null : leftNumber / rightNumber;
            }
            case "div": {
                // GML's div performs integer division truncating toward zero (like C int/int).
                // Math.trunc is correct here; Math.floor would give wrong results for
                // negative operands (e.g. -7 div 2 should be -3, not -4).
                return isApproximatelyZero(rightNumber) ? null : Math.trunc(leftNumber / rightNumber);
            }
            case "%":
            case "mod": {
                // Avoid modulo by zero
                return isApproximatelyZero(rightNumber) ? null : leftNumber % rightNumber;
            }
            case "**": {
                return leftNumber ** rightNumber;
            }
            case "<": {
                return leftNumber < rightNumber;
            }
            case "<=": {
                return leftNumber <= rightNumber;
            }
            case ">": {
                return leftNumber > rightNumber;
            }
            case ">=": {
                return leftNumber >= rightNumber;
            }
            case "&": {
                return leftNumber & rightNumber;
            }
            case "|": {
                return leftNumber | rightNumber;
            }
            case "^":
            case "xor": {
                return leftNumber ^ rightNumber;
            }
            case "<<": {
                return leftNumber << rightNumber;
            }
            case ">>": {
                return leftNumber >> rightNumber;
            }
            default: {
                return evaluatePrimitiveEqualityOperator(op, leftNumber, rightNumber);
            }
        }
    }

    // String operations.
    // The GML parser stores string literal values with their surrounding
    // double quotes (e.g., the GML literal "hello" has `value === '"hello"'`).
    // We must strip those parser quotes before folding so that the emitter's
    // `JSON.stringify` re-wraps the result correctly.
    if (typeof left === "string" && typeof right === "string") {
        if (op === "+") {
            return stripParserQuotes(left) + stripParserQuotes(right);
        }

        const strippedLeft = stripParserQuotes(left);
        const strippedRight = stripParserQuotes(right);
        const equalityResult = evaluatePrimitiveEqualityOperator(op, strippedLeft, strippedRight);
        if (equalityResult !== null) {
            return equalityResult;
        }
    }

    // Logical operations (boolean only)
    const leftBoolean = toBooleanLiteral(left);
    const rightBoolean = toBooleanLiteral(right);
    if (leftBoolean !== null && rightBoolean !== null) {
        switch (op) {
            case "&&":
            case "and": {
                return leftBoolean && rightBoolean;
            }
            case "||":
            case "or": {
                return leftBoolean || rightBoolean;
            }
            default: {
                return evaluatePrimitiveEqualityOperator(op, leftBoolean, rightBoolean);
            }
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

    return foldedCondition ? ast.consequent : ast.alternate;
}
