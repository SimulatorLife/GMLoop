import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapBinaryOperator, mapUnaryOperator } from "../src/emitter/operator-mapping.js";

void describe("mapBinaryOperator", () => {
    void it("passes div through unchanged (handled as special case in emitter)", () => {
        // `div` is intentionally absent from BINARY_OPERATOR_MAPPINGS.
        // The emitter lowers `a div b` to `Math.trunc(a / b)` directly.
        assert.strictEqual(mapBinaryOperator("div"), "div");
    });

    void it("maps GML mod operator to JavaScript modulo", () => {
        assert.strictEqual(mapBinaryOperator("mod"), "%");
    });

    void it("maps GML and operator to JavaScript &&", () => {
        assert.strictEqual(mapBinaryOperator("and"), "&&");
    });

    void it("maps GML or operator to JavaScript ||", () => {
        assert.strictEqual(mapBinaryOperator("or"), "||");
    });

    void it("passes xor and ^^ through unchanged (handled as special cases in emitter)", () => {
        assert.strictEqual(mapBinaryOperator("xor"), "xor");
        assert.strictEqual(mapBinaryOperator("^^"), "^^");
    });

    void it("maps == to === for strict equality", () => {
        assert.strictEqual(mapBinaryOperator("=="), "===");
    });

    void it("maps != to !== for strict inequality", () => {
        assert.strictEqual(mapBinaryOperator("!="), "!==");
    });

    void it("preserves bitwise AND operator &", () => {
        assert.strictEqual(mapBinaryOperator("&"), "&");
    });

    void it("preserves bitwise OR operator |", () => {
        assert.strictEqual(mapBinaryOperator("|"), "|");
    });

    void it("preserves left shift operator <<", () => {
        assert.strictEqual(mapBinaryOperator("<<"), "<<");
    });

    void it("preserves right shift operator >>", () => {
        assert.strictEqual(mapBinaryOperator(">>"), ">>");
    });

    void it("passes through standard JavaScript operators unchanged", () => {
        assert.strictEqual(mapBinaryOperator("+"), "+");
        assert.strictEqual(mapBinaryOperator("-"), "-");
        assert.strictEqual(mapBinaryOperator("*"), "*");
        assert.strictEqual(mapBinaryOperator("/"), "/");
        assert.strictEqual(mapBinaryOperator("%"), "%");
        assert.strictEqual(mapBinaryOperator("<"), "<");
        assert.strictEqual(mapBinaryOperator(">"), ">");
        assert.strictEqual(mapBinaryOperator("<="), "<=");
        assert.strictEqual(mapBinaryOperator(">="), ">=");
    });

    void it("passes through unknown operators unchanged", () => {
        assert.strictEqual(mapBinaryOperator("???"), "???");
        assert.strictEqual(mapBinaryOperator("custom_op"), "custom_op");
    });
});

void describe("mapUnaryOperator", () => {
    void it("maps GML not operator to JavaScript !", () => {
        assert.strictEqual(mapUnaryOperator("not"), "!");
    });

    void it("preserves bitwise NOT operator ~", () => {
        assert.strictEqual(mapUnaryOperator("~"), "~");
    });

    void it("preserves unary minus operator -", () => {
        assert.strictEqual(mapUnaryOperator("-"), "-");
    });

    void it("preserves unary plus operator +", () => {
        assert.strictEqual(mapUnaryOperator("+"), "+");
    });

    void it("passes through JavaScript increment operator ++", () => {
        assert.strictEqual(mapUnaryOperator("++"), "++");
    });

    void it("passes through JavaScript decrement operator --", () => {
        assert.strictEqual(mapUnaryOperator("--"), "--");
    });

    void it("passes through unknown operators unchanged", () => {
        assert.strictEqual(mapUnaryOperator("???"), "???");
        assert.strictEqual(mapUnaryOperator("custom_op"), "custom_op");
    });
});
