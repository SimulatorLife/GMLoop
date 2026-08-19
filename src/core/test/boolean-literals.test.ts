import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getBooleanLiteralValue, isBooleanLiteral } from "../src/ast/node-helpers/index.js";

void describe("boolean literal helpers", () => {
    // Node deprecated assert.equal; prefer the strict helpers to avoid legacy coercion.
    void it("normalizes string literal values", () => {
        const literal = { type: "Literal", value: "TRUE" };

        assert.strictEqual(getBooleanLiteralValue(literal), "true");
        assert.strictEqual(isBooleanLiteral(literal), true);
    });

    void it("normalizes boolean primitives when enabled", () => {
        // Each row exercises every documented option shape for one boolean
        // primitive. The previous suite had separate cases for `true` and
        // `false` even though both traverse the same production branches.
        for (const [primitiveValue, normalizedString] of [
            [true, "true"],
            [false, "false"]
        ] as const) {
            const literal = { type: "Literal", value: primitiveValue };

            assert.strictEqual(getBooleanLiteralValue(literal), null);
            assert.strictEqual(isBooleanLiteral(literal), false);
            assert.strictEqual(getBooleanLiteralValue(literal, true), normalizedString);
            assert.strictEqual(isBooleanLiteral(literal, true), true);
            assert.strictEqual(getBooleanLiteralValue(literal, { acceptBooleanPrimitives: true }), normalizedString);
            assert.strictEqual(isBooleanLiteral(literal, { acceptBooleanPrimitives: true }), true);
        }
    });

    void it("rejects non-boolean literals", () => {
        const numberLiteral = { type: "Literal", value: 0 };
        const identifier = { type: "Identifier", name: "value" };

        assert.strictEqual(getBooleanLiteralValue(numberLiteral), null);
        assert.strictEqual(isBooleanLiteral(numberLiteral), false);
        assert.strictEqual(getBooleanLiteralValue(identifier), null);
        assert.strictEqual(isBooleanLiteral(identifier), false);
    });
});
