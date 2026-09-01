import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyManualMathNormalization } from "../../src/rules/gml/math/index.js";

void describe("applyManualMathNormalization", () => {
    void it("removes multiplicative identity operands", () => {
        const ast: any = {
            type: "BinaryExpression",
            operator: "*",
            left: { type: "Literal", value: "1" },
            right: { type: "Identifier", name: "foo" }
        };

        applyManualMathNormalization(ast, null);

        assert.strictEqual(ast.type, "Identifier");
        assert.strictEqual(ast.name, "foo");
        assert.strictEqual(ast.__fromMultiplicativeIdentity, true);
    });
});
