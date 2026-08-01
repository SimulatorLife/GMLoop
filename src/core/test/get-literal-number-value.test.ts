import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getLiteralNumberValue } from "../src/ast/node-helpers/index.js";

void describe("getLiteralNumberValue", () => {
    void it("extracts a numeric primitive value", () => {
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: 42 }), 42);
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: 0 }), 0);
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: -1.5 }), -1.5);
    });

    void it("parses a string-encoded number", () => {
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: "3.14" }), 3.14);
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: "0" }), 0);
    });

    void it("returns null for non-finite numeric values", () => {
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: Infinity }), null);
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: -Infinity }), null);
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: Number.NaN }), null);
    });

    void it("returns null for non-finite string-encoded values", () => {
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: "Infinity" }), null);
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: "NaN" }), null);
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: "not-a-number" }), null);
    });

    void it("returns null for string literal values", () => {
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: "hello" }), null);
        assert.strictEqual(getLiteralNumberValue({ type: "Literal", value: "true" }), null);
    });

    void it("returns null for non-literal node types", () => {
        assert.strictEqual(getLiteralNumberValue({ type: "Identifier", name: "x" }), null);
        assert.strictEqual(getLiteralNumberValue({ type: "BinaryExpression" }), null);
    });

    void it("returns null for null and undefined", () => {
        assert.strictEqual(getLiteralNumberValue(null), null);
        assert.strictEqual(getLiteralNumberValue(undefined), null);
    });
});
