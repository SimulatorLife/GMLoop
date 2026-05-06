import assert from "node:assert/strict";
import { test } from "node:test";

import {
    tryFoldConstantExpression,
    tryFoldConstantTernaryExpression,
    tryFoldConstantUnaryExpression
} from "../src/emitter/constant-folding.js";

// Shared helpers for reduced test boilerplate.

function binary(operator: string, left: string | number | boolean, right: string | number | boolean) {
    return {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: left },
        right: { type: "Literal" as const, value: right },
        operator
    };
}

function unary(operator: string, value: string | number | boolean | null | undefined) {
    return {
        type: "UnaryExpression" as const,
        operator,
        argument: { type: "Literal" as const, value },
        prefix: true
    };
}

// ---------------------------------------------------------------------------
// Arithmetic operators (native JS syntax + GML keyword aliases unified)
// ---------------------------------------------------------------------------

void test("constant folding: addition", () => {
    const ast = binary("+", 2, 3);
    assert.strictEqual(tryFoldConstantExpression(ast), 5);
});

void test("constant folding: numeric string addition", () => {
    const ast = binary("+", "2", "3");
    assert.strictEqual(tryFoldConstantExpression(ast), 5);
});

void test("constant folding: subtraction", () => {
    const ast = binary("-", 10, 3);
    assert.strictEqual(tryFoldConstantExpression(ast), 7);
});

void test("constant folding: multiplication", () => {
    const ast = binary("*", 4, 5);
    assert.strictEqual(tryFoldConstantExpression(ast), 20);
});

void test("constant folding: division", () => {
    const ast = binary("/", 20, 4);
    assert.strictEqual(tryFoldConstantExpression(ast), 5);
});

// GML's div is integer division truncating toward zero (like C's int/int).
// These two tests cover negative-operand edge cases for the truncation boundary.

void test("constant folding: GML div with negative numerator", () => {
    // -7 div 2 must be -3 (truncation), NOT -4 (floor).
    const ast = binary("div", -7, 2);
    assert.strictEqual(tryFoldConstantExpression(ast), -3);
});

void test("constant folding: GML div with negative divisor", () => {
    // -7 div -2 must be 3 (truncation toward zero).
    const ast = binary("div", -7, -2);
    assert.strictEqual(tryFoldConstantExpression(ast), 3);
});

// Separate test for the basic div case (positive ÷ positive, exact result).

void test("constant folding: GML div basic", () => {
    const ast = binary("div", 20, 3);
    assert.strictEqual(tryFoldConstantExpression(ast), 6);
});

// % (JS) and mod (GML) produce identical results for positive operands.
// The basic positive-operand case is covered once; the GML-specific edge-case
// tests below (negative operands, near-zero divisor) ensure the implementation
// handles GML semantics throughout.

void test("constant folding: modulo (JS) and GML mod share implementation", () => {
    assert.strictEqual(tryFoldConstantExpression(binary("%", 10, 3)), 1);
    assert.strictEqual(tryFoldConstantExpression(binary("mod", 10, 3)), 1);
});

void test("constant folding: GML mod with negative operands", () => {
    // Verify that mod (not %) is tested with negative values, since the
    // implementation uses the same numeric branch for both operators.
    assert.strictEqual(tryFoldConstantExpression(binary("mod", -10, 3)), -1);
    assert.strictEqual(tryFoldConstantExpression(binary("mod", 10, -3)), 1);
});

void test("constant folding: power", () => {
    const ast = binary("**", 2, 3);
    assert.strictEqual(tryFoldConstantExpression(ast), 8);
});

// ---------------------------------------------------------------------------
// String operations
// ---------------------------------------------------------------------------

// Unquoted strings (hand-crafted AST without parser quoting).

void test("constant folding: string concatenation", () => {
    const ast = binary("+", "hello", " world");
    assert.strictEqual(tryFoldConstantExpression(ast), "hello world");
});

void test("constant folding: string equality", () => {
    const ast = binary("==", "player", "player");
    assert.strictEqual(tryFoldConstantExpression(ast), true);
});

void test("constant folding: string inequality", () => {
    const ast = binary("!==", "hello", "world");
    assert.strictEqual(tryFoldConstantExpression(ast), true);
});

// Parser-quoted strings (value includes surrounding double-quote characters,
// as produced by the GML parser).

void test("constant folding: parser-quoted string concatenation", () => {
    // verify that parser quotes are stripped before concatenating.
    const ast = binary("+", '"hello"', '" world"');
    assert.strictEqual(tryFoldConstantExpression(ast), "hello world");
});

void test("constant folding: parser-quoted string equality", () => {
    const ast = binary("==", '"player"', '"player"');
    assert.strictEqual(tryFoldConstantExpression(ast), true);
});

void test("constant folding: parser-quoted string inequality", () => {
    const ast = binary("!=", '"hello"', '"world"');
    assert.strictEqual(tryFoldConstantExpression(ast), true);
});

void test("constant folding: mixed parser-quoted and unquoted concatenation", () => {
    const ast = binary("+", '"hello"', " suffix");
    assert.strictEqual(tryFoldConstantExpression(ast), "hello suffix");
});

// ---------------------------------------------------------------------------
// Boolean operations
// ---------------------------------------------------------------------------

// Logical operators — JS syntax (&&, ||, !) and GML keywords (and, or, not)
// share the same boolean evaluation path; one test per pair is sufficient.

void test("constant folding: boolean AND (&&) and GML and share implementation", () => {
    assert.strictEqual(tryFoldConstantExpression(binary("&&", true, false)), false);
    assert.strictEqual(tryFoldConstantExpression(binary("and", true, false)), false);
});

void test("constant folding: boolean OR (||) and GML or share implementation", () => {
    assert.strictEqual(tryFoldConstantExpression(binary("||", false, true)), true);
    assert.strictEqual(tryFoldConstantExpression(binary("or", false, true)), true);
});

void test("constant folding: parses boolean string literals", () => {
    const ast = binary("and", "true", "false");
    assert.strictEqual(tryFoldConstantExpression(ast), false);
});

// ---------------------------------------------------------------------------
// Comparison operators
// ---------------------------------------------------------------------------

void test("constant folding: comparison less than", () => {
    const ast = binary("<", 5, 10);
    assert.strictEqual(tryFoldConstantExpression(ast), true);
});

void test("constant folding: comparison greater than", () => {
    const ast = binary(">", 5, 10);
    assert.strictEqual(tryFoldConstantExpression(ast), false);
});

void test("constant folding: comparison equal", () => {
    const ast = binary("==", 5, 5);
    assert.strictEqual(tryFoldConstantExpression(ast), true);
});

void test("constant folding: strict comparison equal", () => {
    // true === "true" succeeds because the implementation normalises the
    // string "true" to boolean true before the strict equality check.
    const ast = binary("===", true, "true");
    assert.strictEqual(tryFoldConstantExpression(ast), true);
});

void test("constant folding: strict comparison not equal", () => {
    const ast = binary("!==", 5, 3);
    assert.strictEqual(tryFoldConstantExpression(ast), true);
});

void test("constant folding: comparison not equal", () => {
    const ast = binary("!=", 5, 3);
    assert.strictEqual(tryFoldConstantExpression(ast), true);
});

// ---------------------------------------------------------------------------
// Bitwise operators
// ---------------------------------------------------------------------------

// ^ (JS) and xor (GML) share the same implementation path.

void test("constant folding: bitwise AND", () => {
    const ast = binary("&", 12, 10);
    assert.strictEqual(tryFoldConstantExpression(ast), 8);
});

void test("constant folding: bitwise OR", () => {
    const ast = binary("|", 12, 10);
    assert.strictEqual(tryFoldConstantExpression(ast), 14);
});

void test("constant folding: bitwise XOR (^) and GML xor share implementation", () => {
    assert.strictEqual(tryFoldConstantExpression(binary("^", 12, 10)), 6);
    assert.strictEqual(tryFoldConstantExpression(binary("xor", 12, 10)), 6);
});

void test("constant folding: left shift", () => {
    const ast = binary("<<", 3, 2);
    assert.strictEqual(tryFoldConstantExpression(ast), 12);
});

void test("constant folding: right shift", () => {
    const ast = binary(">>", 12, 2);
    assert.strictEqual(tryFoldConstantExpression(ast), 3);
});

// ---------------------------------------------------------------------------
// Division / modulo zero safety
// ---------------------------------------------------------------------------

void test("constant folding: does not fold division by zero", () => {
    const ast = binary("/", 10, 0);
    assert.strictEqual(tryFoldConstantExpression(ast), null);
});

void test("constant folding: does not fold modulo by zero", () => {
    const ast = binary("%", 10, 0);
    assert.strictEqual(tryFoldConstantExpression(ast), null);
});

void test("constant folding: GML mod also rejects zero divisor", () => {
    const ast = binary("mod", 10, 0);
    assert.strictEqual(tryFoldConstantExpression(ast), null);
});

void test("constant folding: treats near-zero divisor as zero", () => {
    const ast = binary("/", 10, Number.EPSILON * 2);
    assert.strictEqual(tryFoldConstantExpression(ast), null);
});

void test("constant folding: still folds with safely non-zero tiny divisor", () => {
    const ast = binary("/", 10, 1e-12);
    assert.strictEqual(tryFoldConstantExpression(ast), 1e13);
});

// ---------------------------------------------------------------------------
// Cases that should not fold
// ---------------------------------------------------------------------------

void test("constant folding: does not fold variable expressions", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Identifier" as const, name: "a" },
        right: { type: "Identifier" as const, name: "b" },
        operator: "+"
    };
    assert.strictEqual(tryFoldConstantExpression(ast), null);
});

void test("constant folding: does not fold mixed types", () => {
    // Intentionally test mismatched operand types; use a separate literal
    // construction to satisfy the strict types on the binary() helper.
    const ast: ReturnType<typeof binary> = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 5 },
        right: { type: "Literal" as const, value: "hello" as string | number | boolean },
        operator: "+"
    };
    assert.strictEqual(tryFoldConstantExpression(ast), null);
});

void test("constant folding: handles negative numbers correctly", () => {
    const ast = binary("+", -5, 3);
    assert.strictEqual(tryFoldConstantExpression(ast), -2);
});

void test("constant folding: handles floating point correctly", () => {
    const ast = binary("+", 0.5, 0.3);
    const result = tryFoldConstantExpression(ast);
    assert.ok(typeof result === "number" && result > 0.79 && result < 0.81);
});

// ---------------------------------------------------------------------------
// Unary constant folding
// ---------------------------------------------------------------------------

void test("unary constant folding: negation of positive number", () => {
    const ast = unary("-", 5);
    assert.strictEqual(tryFoldConstantUnaryExpression(ast), -5);
});

void test("unary constant folding: negation of negative number", () => {
    const ast = unary("-", -10);
    assert.strictEqual(tryFoldConstantUnaryExpression(ast), 10);
});

void test("unary constant folding: unary plus", () => {
    const ast = unary("+", 42);
    assert.strictEqual(tryFoldConstantUnaryExpression(ast), 42);
});

void test("unary constant folding: bitwise NOT", () => {
    const ast = unary("~", 15);
    assert.strictEqual(tryFoldConstantUnaryExpression(ast), -16);
});

// Logical NOT — ! (JS) and not (GML) share the implementation.

void test("unary constant folding: logical NOT (!) and GML not share implementation", () => {
    assert.strictEqual(tryFoldConstantUnaryExpression(unary("!", true)), false);
    assert.strictEqual(tryFoldConstantUnaryExpression(unary("!", false)), true);
    assert.strictEqual(tryFoldConstantUnaryExpression(unary("not", true)), false);
    assert.strictEqual(tryFoldConstantUnaryExpression(unary("not", false)), true);
});

void test("unary constant folding: returns null for non-literal operand", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "-",
        argument: { type: "Identifier" as const, name: "x" },
        prefix: true
    };
    assert.strictEqual(tryFoldConstantUnaryExpression(ast), null);
});

void test("unary constant folding: returns null for null operand value", () => {
    const ast = unary("-", null);
    assert.strictEqual(tryFoldConstantUnaryExpression(ast), null);
});

void test("unary constant folding: returns null for undefined operand value", () => {
    const ast = unary("-", undefined);
    assert.strictEqual(tryFoldConstantUnaryExpression(ast), null);
});

void test("unary constant folding: returns null for unsupported operator", () => {
    const ast = unary("++", 5);
    assert.strictEqual(tryFoldConstantUnaryExpression(ast), null);
});

void test("unary constant folding: returns null for type mismatch (boolean with numeric operator)", () => {
    const ast = unary("-", true);
    assert.strictEqual(tryFoldConstantUnaryExpression(ast), null);
});

void test("unary constant folding: returns null for type mismatch (number with logical operator)", () => {
    const ast = unary("!", 42);
    assert.strictEqual(tryFoldConstantUnaryExpression(ast), null);
});

// ---------------------------------------------------------------------------
// Ternary constant folding
// ---------------------------------------------------------------------------

void test("ternary constant folding: selects consequent for true literal condition", () => {
    const ast = {
        type: "TernaryExpression" as const,
        test: { type: "Literal" as const, value: true },
        consequent: { type: "Literal" as const, value: 1 },
        alternate: { type: "Literal" as const, value: 2 }
    };
    assert.deepStrictEqual(tryFoldConstantTernaryExpression(ast), ast.consequent);
});

void test("ternary constant folding: selects alternate for false string literal condition", () => {
    const ast = {
        type: "TernaryExpression" as const,
        test: { type: "Literal" as const, value: "false" },
        consequent: { type: "Literal" as const, value: 1 },
        alternate: { type: "Literal" as const, value: 2 }
    };
    assert.deepStrictEqual(tryFoldConstantTernaryExpression(ast), ast.alternate);
});

void test("ternary constant folding: does not fold non-boolean literal conditions", () => {
    const ast = {
        type: "TernaryExpression" as const,
        test: { type: "Literal" as const, value: 1 },
        consequent: { type: "Literal" as const, value: 1 },
        alternate: { type: "Literal" as const, value: 2 }
    };
    assert.strictEqual(tryFoldConstantTernaryExpression(ast), null);
});
