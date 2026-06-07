import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    areAstValuesEquivalentIgnoringParentheses,
    areExpressionNodesEquivalentIgnoringParentheses,
    IGNORED_AST_METADATA_KEYS
} from "../src/ast/ast-node-equivalence.js";

void describe("IGNORED_AST_METADATA_KEYS", () => {
    void it("contains expected position and metadata keys", () => {
        assert.ok(IGNORED_AST_METADATA_KEYS.has("start"));
        assert.ok(IGNORED_AST_METADATA_KEYS.has("end"));
        assert.ok(IGNORED_AST_METADATA_KEYS.has("range"));
        assert.ok(IGNORED_AST_METADATA_KEYS.has("loc"));
        assert.ok(IGNORED_AST_METADATA_KEYS.has("parent"));
        assert.ok(IGNORED_AST_METADATA_KEYS.has("comments"));
        assert.ok(IGNORED_AST_METADATA_KEYS.has("tokens"));
    });

    void it("does not contain structural keys", () => {
        assert.ok(!IGNORED_AST_METADATA_KEYS.has("type"));
        assert.ok(!IGNORED_AST_METADATA_KEYS.has("name"));
        assert.ok(!IGNORED_AST_METADATA_KEYS.has("value"));
        assert.ok(!IGNORED_AST_METADATA_KEYS.has("body"));
    });
});

void describe("areAstValuesEquivalentIgnoringParentheses", () => {
    void it("considers identical references equal", () => {
        const node = { type: "Identifier", name: "foo" };
        assert.ok(areAstValuesEquivalentIgnoringParentheses(node, node));
    });

    void it("considers structurally identical nodes equal", () => {
        const left = { type: "Identifier", name: "foo" };
        const right = { type: "Identifier", name: "foo" };
        assert.ok(areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("considers nodes with different structural values not equal", () => {
        const left = { type: "Identifier", name: "foo" };
        const right = { type: "Identifier", name: "bar" };
        assert.ok(!areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("ignores position metadata keys", () => {
        const left = { type: "Identifier", name: "x", start: 0, end: 5 };
        const right = { type: "Identifier", name: "x", start: 100, end: 200 };
        assert.ok(areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("ignores loc and range keys", () => {
        const left = { type: "Literal", value: "42", loc: { start: { line: 1 } }, range: [0, 2] };
        const right = { type: "Literal", value: "42", loc: { start: { line: 99 } }, range: [50, 52] };
        assert.ok(areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("ignores comments and tokens keys", () => {
        const left = { type: "Literal", value: "1", comments: ["a"], tokens: ["b"] };
        const right = { type: "Literal", value: "1" };
        assert.ok(areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("ignores parent key", () => {
        const parentA = { type: "Program" };
        const parentB = { type: "Block" };
        const left = { type: "Identifier", name: "x", parent: parentA };
        const right = { type: "Identifier", name: "x", parent: parentB };
        assert.ok(areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("rejects nodes with different types", () => {
        const left = { type: "Identifier", name: "x" };
        const right = { type: "Literal", name: "x" };
        assert.ok(!areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("rejects nodes with extra non-metadata keys", () => {
        const left = { type: "Identifier", name: "x" };
        const right = { type: "Identifier", name: "x", extra: true };
        assert.ok(!areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("handles null values", () => {
        assert.ok(areAstValuesEquivalentIgnoringParentheses(null, null));
        assert.ok(!areAstValuesEquivalentIgnoringParentheses(null, { type: "Identifier" }));
        assert.ok(!areAstValuesEquivalentIgnoringParentheses({ type: "Identifier" }, null));
    });

    void it("compares arrays element-by-element", () => {
        const left = { type: "Program", body: [{ type: "A" }, { type: "B" }] };
        const right = { type: "Program", body: [{ type: "A" }, { type: "B" }] };
        assert.ok(areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("rejects arrays with different lengths", () => {
        const left = { type: "Program", body: [{ type: "A" }] };
        const right = { type: "Program", body: [{ type: "A" }, { type: "B" }] };
        assert.ok(!areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("rejects arrays with different elements", () => {
        const left = { type: "Program", body: [{ type: "A" }] };
        const right = { type: "Program", body: [{ type: "B" }] };
        assert.ok(!areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("rejects array and non-array comparisons", () => {
        assert.ok(!areAstValuesEquivalentIgnoringParentheses([{ type: "A" }], { type: "A" }));
        assert.ok(!areAstValuesEquivalentIgnoringParentheses({ type: "A" }, [{ type: "A" }]));
    });

    void it("handles deeply nested structures", () => {
        const left = {
            type: "BinaryExpression",
            operator: "+",
            left: { type: "Identifier", name: "a" },
            right: { type: "Literal", value: "1" }
        };
        const right = {
            type: "BinaryExpression",
            operator: "+",
            left: { type: "Identifier", name: "a" },
            right: { type: "Literal", value: "1" }
        };
        assert.ok(areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("rejects different primitives", () => {
        assert.ok(!areAstValuesEquivalentIgnoringParentheses("a", "b"));
        assert.ok(!areAstValuesEquivalentIgnoringParentheses(1, 2));
        assert.ok(!areAstValuesEquivalentIgnoringParentheses("a", 1));
    });

    void it("considers identical primitives equal", () => {
        assert.ok(areAstValuesEquivalentIgnoringParentheses("a", "a"));
        assert.ok(areAstValuesEquivalentIgnoringParentheses(42, 42));
    });

    void it("considers numerically equivalent floats equal (epsilon tolerance)", () => {
        // 0.1 + 0.2 in IEEE 754 binary does not equal exactly 0.3.
        // The difference is ~2.22e-16, well within 4× EPSILON (≈ 8.88e-16).
        assert.ok(areAstValuesEquivalentIgnoringParentheses(0.1 + 0.2, 0.3));
        // Symmetry: the value computed two different ways should still match.
        assert.ok(areAstValuesEquivalentIgnoringParentheses(0.1, 0.3 - 0.2));
        assert.ok(areAstValuesEquivalentIgnoringParentheses(0.1 + 0.2, 0.1 + 0.2));
        assert.ok(areAstValuesEquivalentIgnoringParentheses(0.2 + 0.1, 0.3));
    });

    void it("rejects floats that differ by more than epsilon tolerance", () => {
        // 0.1 and 0.4 are well-separated; diff ≈ 0.3 > 4× EPSILON.
        assert.ok(!areAstValuesEquivalentIgnoringParentheses(0.1 + 0.2, 0.4));
        // Very different values should never be considered equal.
        assert.ok(!areAstValuesEquivalentIgnoringParentheses(1e10, 1e10 + 1));
    });

    void it("considers numerically equivalent floats equal at large magnitudes", () => {
        // Large values accumulate larger absolute rounding errors, but the
        // relative comparison using max(|a|,|b|,1) keeps the tolerance scaled.
        const large = 1e12;
        assert.ok(areAstValuesEquivalentIgnoringParentheses(large, large));
        assert.ok(areAstValuesEquivalentIgnoringParentheses(large + 1e-4, large));
    });

    void it("compares numeric literals inside AST nodes with epsilon tolerance", () => {
        const left = {
            type: "BinaryExpression",
            operator: "+",
            left: { type: "Literal", value: 0.1 },
            right: { type: "Literal", value: 0.2 }
        };
        // Numerically identical — even though the AST is structurally identical,
        // this test verifies the numeric value comparison inside objects.
        assert.ok(areAstValuesEquivalentIgnoringParentheses(left, left));
        // Different numeric values in the same structure.
        const right = {
            type: "BinaryExpression",
            operator: "+",
            left: { type: "Literal", value: 0.1 },
            right: { type: "Literal", value: 0.4 }
        };
        assert.ok(!areAstValuesEquivalentIgnoringParentheses(left, right));
    });

    void it("compares string and boolean values by strict equality (no epsilon)", () => {
        assert.ok(areAstValuesEquivalentIgnoringParentheses("hello", "hello"));
        assert.ok(!areAstValuesEquivalentIgnoringParentheses("hello", "world"));
        assert.ok(areAstValuesEquivalentIgnoringParentheses(true, true));
        assert.ok(!areAstValuesEquivalentIgnoringParentheses(true, false));
    });
});

void describe("areExpressionNodesEquivalentIgnoringParentheses", () => {
    void it("treats parenthesized and non-parenthesized forms as equivalent", () => {
        const bare = { type: "Identifier", name: "x" };
        const wrapped = {
            type: "ParenthesizedExpression",
            expression: { type: "Identifier", name: "x" }
        };
        assert.ok(areExpressionNodesEquivalentIgnoringParentheses(bare, wrapped));
        assert.ok(areExpressionNodesEquivalentIgnoringParentheses(wrapped, bare));
    });

    void it("treats doubly parenthesized forms as equivalent", () => {
        const bare = { type: "Identifier", name: "y" };
        const doubleWrapped = {
            type: "ParenthesizedExpression",
            expression: {
                type: "ParenthesizedExpression",
                expression: { type: "Identifier", name: "y" }
            }
        };
        assert.ok(areExpressionNodesEquivalentIgnoringParentheses(bare, doubleWrapped));
    });

    void it("rejects structurally different expressions even with parentheses stripped", () => {
        const left = {
            type: "ParenthesizedExpression",
            expression: { type: "Identifier", name: "a" }
        };
        const right = {
            type: "ParenthesizedExpression",
            expression: { type: "Identifier", name: "b" }
        };
        assert.ok(!areExpressionNodesEquivalentIgnoringParentheses(left, right));
    });

    void it("handles null and undefined gracefully", () => {
        assert.ok(areExpressionNodesEquivalentIgnoringParentheses(null, null));
        assert.ok(areExpressionNodesEquivalentIgnoringParentheses(undefined, undefined));
        assert.ok(!areExpressionNodesEquivalentIgnoringParentheses(null, { type: "Identifier", name: "x" }));
    });

    void it("compares complex nested structures with parentheses at different depths", () => {
        const left = {
            type: "BinaryExpression",
            operator: "+",
            left: {
                type: "ParenthesizedExpression",
                expression: { type: "Identifier", name: "a" }
            },
            right: { type: "Literal", value: "1" }
        };
        const right = {
            type: "BinaryExpression",
            operator: "+",
            left: { type: "Identifier", name: "a" },
            right: { type: "Literal", value: "1" }
        };
        assert.ok(areExpressionNodesEquivalentIgnoringParentheses(left, right));
    });
});
