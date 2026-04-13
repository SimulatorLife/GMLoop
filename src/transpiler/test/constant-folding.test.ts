import assert from "node:assert/strict";
import { test } from "node:test";

import {
    tryFoldConstantExpression,
    tryFoldConstantTernaryExpression,
    tryFoldConstantUnaryExpression
} from "../src/emitter/constant-folding.js";

// Unit tests for the constant folding function itself
// These tests create AST nodes directly to test the folding logic

void test("constant folding: arithmetic addition", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 2 },
        right: { type: "Literal" as const, value: 3 },
        operator: "+"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 5, "Should fold 2 + 3 to 5");
});

void test("constant folding: parses numeric string literals for arithmetic", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: "2" },
        right: { type: "Literal" as const, value: "3" },
        operator: "+"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 5, 'Should fold numeric strings "2" + "3" to 5');
});

void test("constant folding: arithmetic subtraction", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 10 },
        right: { type: "Literal" as const, value: 3 },
        operator: "-"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 7, "Should fold 10 - 3 to 7");
});

void test("constant folding: arithmetic multiplication", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 4 },
        right: { type: "Literal" as const, value: 5 },
        operator: "*"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 20, "Should fold 4 * 5 to 20");
});

void test("constant folding: arithmetic division", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 20 },
        right: { type: "Literal" as const, value: 4 },
        operator: "/"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 5, "Should fold 20 / 4 to 5");
});

void test("constant folding: GML div operator", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 20 },
        right: { type: "Literal" as const, value: 3 },
        operator: "div"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 6, "Should fold 20 div 3 to 6 (integer division)");
});

void test("constant folding: GML div operator truncates toward zero for negative numerator", () => {
    // GML's div truncates toward zero, not toward negative infinity.
    // -7 div 2 must be -3 (truncation), NOT -4 (floor).
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: -7 },
        right: { type: "Literal" as const, value: 2 },
        operator: "div"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, -3, "Should fold -7 div 2 to -3 (truncation toward zero, not floor)");
});

void test("constant folding: GML div operator truncates toward zero for negative divisor", () => {
    // -7 div -2 must be 3 (truncation toward zero).
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: -7 },
        right: { type: "Literal" as const, value: -2 },
        operator: "div"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 3, "Should fold -7 div -2 to 3 (truncation toward zero)");
});
void test("constant folding: modulo operation", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 10 },
        right: { type: "Literal" as const, value: 3 },
        operator: "%"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 1, "Should fold 10 % 3 to 1");
});

void test("constant folding: GML mod operator", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 10 },
        right: { type: "Literal" as const, value: 3 },
        operator: "mod"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 1, "Should fold 10 mod 3 to 1");
});

void test("constant folding: power operation", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 2 },
        right: { type: "Literal" as const, value: 3 },
        operator: "**"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 8, "Should fold 2 ** 3 to 8");
});

void test("constant folding: string concatenation", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: "hello" },
        right: { type: "Literal" as const, value: " world" },
        operator: "+"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, "hello world", 'Should fold "hello" + " world" to "hello world"');
});

void test("constant folding: string equality", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: "player" },
        right: { type: "Literal" as const, value: "player" },
        operator: "=="
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, true, "Should fold string equality checks");
});

void test("constant folding: string inequality", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: "player" },
        right: { type: "Literal" as const, value: "enemy" },
        operator: "!=="
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, true, "Should fold string inequality checks");
});

void test("constant folding: parser-quoted string concatenation", () => {
    // The GML parser stores string literal values WITH surrounding double quotes.
    // This test verifies that constant folding correctly strips parser quotes
    // before concatenating, producing "hello world" instead of '"hello"" world"'.
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: '"hello"' },
        right: { type: "Literal" as const, value: '" world"' },
        operator: "+"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, "hello world", "Should strip parser quotes before concatenating strings");
});

void test("constant folding: parser-quoted string equality", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: '"player"' },
        right: { type: "Literal" as const, value: '"player"' },
        operator: "=="
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, true, "Should strip parser quotes before comparing strings");
});

void test("constant folding: parser-quoted string inequality", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: '"hello"' },
        right: { type: "Literal" as const, value: '"world"' },
        operator: "!="
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, true, "Should strip parser quotes for string inequality");
});

void test("constant folding: mixed parser-quoted and unquoted string concatenation", () => {
    // When one operand has parser quotes and the other doesn't (e.g., from a
    // hand-crafted AST), both should be handled gracefully.
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: '"hello"' },
        right: { type: "Literal" as const, value: " suffix" },
        operator: "+"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, "hello suffix", "Should strip quotes from parser-quoted side and keep unquoted side");
});

void test("constant folding: boolean AND", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: true },
        right: { type: "Literal" as const, value: false },
        operator: "&&"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, false, "Should fold true && false to false");
});

void test("constant folding: GML and operator", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: true },
        right: { type: "Literal" as const, value: false },
        operator: "and"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, false, "Should fold true and false to false");
});

void test("constant folding: parses boolean string literals", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: "true" },
        right: { type: "Literal" as const, value: "false" },
        operator: "and"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, false, 'Should fold "true" and "false" to false');
});

void test("constant folding: boolean OR", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: true },
        right: { type: "Literal" as const, value: false },
        operator: "||"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, true, "Should fold true || false to true");
});

void test("constant folding: GML or operator", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: true },
        right: { type: "Literal" as const, value: false },
        operator: "or"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, true, "Should fold true or false to true");
});

void test("constant folding: comparison less than", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 5 },
        right: { type: "Literal" as const, value: 10 },
        operator: "<"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, true, "Should fold 5 < 10 to true");
});

void test("constant folding: comparison greater than", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 5 },
        right: { type: "Literal" as const, value: 10 },
        operator: ">"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, false, "Should fold 5 > 10 to false");
});

void test("constant folding: comparison equal", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 5 },
        right: { type: "Literal" as const, value: 5 },
        operator: "=="
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, true, "Should fold 5 == 5 to true");
});

void test("constant folding: strict comparison equal", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: true },
        right: { type: "Literal" as const, value: "true" },
        operator: "==="
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, true, "Should fold true === true to true");
});

void test("constant folding: strict comparison not equal", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 5 },
        right: { type: "Literal" as const, value: 3 },
        operator: "!=="
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, true, "Should fold 5 !== 3 to true");
});
void test("constant folding: comparison not equal", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 5 },
        right: { type: "Literal" as const, value: 3 },
        operator: "!="
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, true, "Should fold 5 != 3 to true");
});

void test("constant folding: bitwise AND", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 12 },
        right: { type: "Literal" as const, value: 10 },
        operator: "&"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 8, "Should fold 12 & 10 to 8");
});

void test("constant folding: bitwise OR", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 12 },
        right: { type: "Literal" as const, value: 10 },
        operator: "|"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 14, "Should fold 12 | 10 to 14");
});

void test("constant folding: bitwise XOR", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 12 },
        right: { type: "Literal" as const, value: 10 },
        operator: "^"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 6, "Should fold 12 ^ 10 to 6");
});

void test("constant folding: GML xor operator", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 12 },
        right: { type: "Literal" as const, value: 10 },
        operator: "xor"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 6, "Should fold 12 xor 10 to 6");
});

void test("constant folding: left shift", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 3 },
        right: { type: "Literal" as const, value: 2 },
        operator: "<<"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 12, "Should fold 3 << 2 to 12");
});

void test("constant folding: right shift", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 12 },
        right: { type: "Literal" as const, value: 2 },
        operator: ">>"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 3, "Should fold 12 >> 2 to 3");
});

void test("constant folding: does not fold division by zero", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 10 },
        right: { type: "Literal" as const, value: 0 },
        operator: "/"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, null, "Should not fold division by zero");
});

void test("constant folding: does not fold modulo by zero", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 10 },
        right: { type: "Literal" as const, value: 0 },
        operator: "%"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, null, "Should not fold modulo by zero");
});

void test("constant folding: treats near-zero divisor as zero", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 10 },
        right: { type: "Literal" as const, value: Number.EPSILON * 2 },
        operator: "/"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, null, "Should not fold division by a near-zero divisor");
});

void test("constant folding: still folds with safely non-zero tiny divisor", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 10 },
        right: { type: "Literal" as const, value: 1e-12 },
        operator: "/"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, 1e13, "Should fold when divisor is tiny but not effectively zero");
});

void test("constant folding: does not fold variable expressions", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Identifier" as const, name: "a" },
        right: { type: "Identifier" as const, name: "b" },
        operator: "+"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, null, "Should not fold expressions with variables");
});

void test("constant folding: does not fold mixed types", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 5 },
        right: { type: "Literal" as const, value: "hello" },
        operator: "+"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, null, "Should not fold mixed number and string");
});

void test("constant folding: handles negative numbers correctly", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: -5 },
        right: { type: "Literal" as const, value: 3 },
        operator: "+"
    };
    const result = tryFoldConstantExpression(ast);
    assert.strictEqual(result, -2, "Should fold -5 + 3 to -2");
});

void test("constant folding: handles floating point correctly", () => {
    const ast = {
        type: "BinaryExpression" as const,
        left: { type: "Literal" as const, value: 0.5 },
        right: { type: "Literal" as const, value: 0.3 },
        operator: "+"
    };
    const result = tryFoldConstantExpression(ast);
    // Floating point arithmetic may have precision issues
    assert.ok(
        typeof result === "number" && result > 0.79 && result < 0.81,
        "Should fold 0.5 + 0.3 to approximately 0.8"
    );
});

void test("unary constant folding: negation of positive number", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "-",
        argument: { type: "Literal" as const, value: 5 },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, -5, "Should fold -5 to -5");
});

void test("unary constant folding: negation of negative number", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "-",
        argument: { type: "Literal" as const, value: -10 },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, 10, "Should fold -(-10) to 10");
});

void test("unary constant folding: unary plus", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "+",
        argument: { type: "Literal" as const, value: 42 },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, 42, "Should fold +42 to 42");
});

void test("unary constant folding: bitwise NOT", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "~",
        argument: { type: "Literal" as const, value: 15 },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, -16, "Should fold ~15 to -16");
});

void test("unary constant folding: logical NOT on true", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "!",
        argument: { type: "Literal" as const, value: true },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, false, "Should fold !true to false");
});

void test("unary constant folding: logical NOT on false", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "!",
        argument: { type: "Literal" as const, value: false },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, true, "Should fold !false to true");
});

void test("unary constant folding: GML not keyword on true", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "not",
        argument: { type: "Literal" as const, value: true },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, false, "Should fold not true to false");
});

void test("unary constant folding: GML not keyword on false", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "not",
        argument: { type: "Literal" as const, value: false },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, true, "Should fold not false to true");
});

void test("unary constant folding: returns null for non-literal operand", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "-",
        argument: { type: "Identifier" as const, name: "x" },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, null, "Should not fold non-literal operands");
});

void test("unary constant folding: returns null for null operand value", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "-",
        argument: { type: "Literal" as const, value: null },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, null, "Should not fold null operand");
});

void test("unary constant folding: returns null for undefined operand value", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "-",
        argument: { type: "Literal" as const, value: undefined },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, null, "Should not fold undefined operand");
});

void test("unary constant folding: returns null for unsupported operator", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "++",
        argument: { type: "Literal" as const, value: 5 },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, null, "Should not fold unsupported operators like ++");
});

void test("unary constant folding: returns null for type mismatch (boolean with numeric operator)", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "-",
        argument: { type: "Literal" as const, value: true },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, null, "Should not fold when operator doesn't match operand type");
});

void test("unary constant folding: returns null for type mismatch (number with logical operator)", () => {
    const ast = {
        type: "UnaryExpression" as const,
        operator: "!",
        argument: { type: "Literal" as const, value: 42 },
        prefix: true
    };
    const result = tryFoldConstantUnaryExpression(ast);
    assert.strictEqual(result, null, "Should not fold when operator doesn't match operand type");
});

void test("ternary constant folding: selects consequent for true literal condition", () => {
    const ast = {
        type: "TernaryExpression" as const,
        test: { type: "Literal" as const, value: true },
        consequent: { type: "Literal" as const, value: 1 },
        alternate: { type: "Literal" as const, value: 2 }
    };
    const result = tryFoldConstantTernaryExpression(ast);
    assert.deepStrictEqual(result, ast.consequent);
});

void test("ternary constant folding: selects alternate for false string literal condition", () => {
    const ast = {
        type: "TernaryExpression" as const,
        test: { type: "Literal" as const, value: "false" },
        consequent: { type: "Literal" as const, value: 1 },
        alternate: { type: "Literal" as const, value: 2 }
    };
    const result = tryFoldConstantTernaryExpression(ast);
    assert.deepStrictEqual(result, ast.alternate);
});

void test("ternary constant folding: does not fold non-boolean literal conditions", () => {
    const ast = {
        type: "TernaryExpression" as const,
        test: { type: "Literal" as const, value: 1 },
        consequent: { type: "Literal" as const, value: 1 },
        alternate: { type: "Literal" as const, value: 2 }
    };
    const result = tryFoldConstantTernaryExpression(ast);
    assert.strictEqual(result, null);
});
