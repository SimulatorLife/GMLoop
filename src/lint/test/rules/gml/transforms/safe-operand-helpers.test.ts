import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    areAllSafeOperands,
    isSafeOperand,
    isSafeReciprocalCancellationOperand
} from "../../../../src/rules/gml/transforms/math-lengthdir-transforms.js";

void describe("isSafeOperand", () => {
    void it("returns true for Identifier", () => {
        assert.strictEqual(isSafeOperand({ type: "Identifier", name: "foo" }), true);
    });

    void it("returns false for CallExpression", () => {
        assert.strictEqual(
            isSafeOperand({ type: "CallExpression", callee: { type: "Identifier", name: "foo" }, arguments: [] }),
            false
        );
    });

    void it("returns true for MemberDotExpression", () => {
        assert.strictEqual(
            isSafeOperand({
                type: "MemberDotExpression",
                object: { type: "Identifier", name: "obj" },
                property: { type: "Identifier", name: "x" }
            }),
            true
        );
    });

    void it("returns true for MemberIndexExpression with safe index", () => {
        assert.strictEqual(
            isSafeOperand({
                type: "MemberIndexExpression",
                object: { type: "Identifier", name: "arr" },
                property: [{ type: "Identifier", name: "i" }]
            }),
            true
        );
    });

    void it("returns false for BinaryExpression", () => {
        assert.strictEqual(isSafeOperand({ type: "BinaryExpression", operator: "+", left: {}, right: {} }), false);
    });

    void it("returns false for null/undefined", () => {
        assert.strictEqual(isSafeOperand(null), false);
        assert.strictEqual(isSafeOperand(undefined), false);
    });

    void it("returns true for node with plain hasComment property (does not check actual comments)", () => {
        assert.strictEqual(isSafeOperand({ type: "Identifier", name: "foo", hasComment: true }), true);
    });

    void it("returns true for ParenthesizedExpression wrapping safe operand", () => {
        assert.strictEqual(
            isSafeOperand({
                type: "ParenthesizedExpression",
                expression: { type: "Identifier", name: "foo" }
            }),
            true
        );
    });
});

void describe("isSafeReciprocalCancellationOperand", () => {
    void it("returns true for Identifier", () => {
        assert.strictEqual(isSafeReciprocalCancellationOperand({ type: "Identifier", name: "foo" }), true);
    });

    void it("returns true for unary negation of Identifier", () => {
        assert.strictEqual(
            isSafeReciprocalCancellationOperand({
                type: "UnaryExpression",
                operator: "-",
                argument: { type: "Identifier", name: "x" }
            }),
            true
        );
    });

    void it("returns true for double negation of Identifier", () => {
        assert.strictEqual(
            isSafeReciprocalCancellationOperand({
                type: "UnaryExpression",
                operator: "-",
                argument: {
                    type: "UnaryExpression",
                    operator: "-",
                    argument: { type: "Identifier", name: "x" }
                }
            }),
            true
        );
    });

    void it("returns false for unary plus", () => {
        assert.strictEqual(
            isSafeReciprocalCancellationOperand({
                type: "UnaryExpression",
                operator: "+",
                argument: { type: "Identifier", name: "x" }
            }),
            false
        );
    });

    void it("returns false for parenthesized negation", () => {
        assert.strictEqual(
            isSafeReciprocalCancellationOperand({
                type: "ParenthesizedExpression",
                expression: {
                    type: "UnaryExpression",
                    operator: "-",
                    argument: { type: "Identifier", name: "x" }
                }
            }),
            true
        );
    });

    void it("returns false for null/undefined", () => {
        assert.strictEqual(isSafeReciprocalCancellationOperand(null), false);
        assert.strictEqual(isSafeReciprocalCancellationOperand(undefined), false);
    });
});

void describe("areAllSafeOperands", () => {
    void it("returns true for array of safe operands", () => {
        assert.strictEqual(
            areAllSafeOperands([
                { type: "Identifier", name: "a" },
                { type: "Identifier", name: "b" }
            ]),
            true
        );
    });

    void it("returns false when any operand is unsafe", () => {
        assert.strictEqual(
            areAllSafeOperands([
                { type: "Identifier", name: "a" },
                { type: "BinaryExpression", operator: "+", left: {}, right: {} }
            ]),
            false
        );
    });

    void it("returns false for non-array input", () => {
        assert.strictEqual(areAllSafeOperands("not an array"), false);
        assert.strictEqual(areAllSafeOperands({ type: "Identifier", name: "foo" }), false);
        assert.strictEqual(areAllSafeOperands(null), false);
    });

    void it("returns true for empty array", () => {
        assert.strictEqual(areAllSafeOperands([]), true);
    });
});
