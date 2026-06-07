import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanupMultiplicativeIdentityParentheses } from "../../src/rules/gml/math/math-parentheses-cleanup.js";
import { normalizeTraversalContext } from "../../src/rules/gml/math/math-traversal-normalization.js";

void describe("cleanupMultiplicativeIdentityParentheses", () => {
    void it("unwraps safe multiplicative identity replacements", () => {
        const ast: any = {
            type: "ParenthesizedExpression",
            expression: {
                type: "Identifier",
                name: "value",
                __fromMultiplicativeIdentity: true
            }
        };

        const context = normalizeTraversalContext(ast, null);

        cleanupMultiplicativeIdentityParentheses(ast, context, null);

        assert.strictEqual(ast.type, "Identifier");
        assert.strictEqual(ast.name, "value");
        assert.strictEqual(ast.__fromMultiplicativeIdentity, true);
    });
});
