import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getUnwrappedIdentifierName, isUnwrappedIdentifierWithName } from "../src/ast/node-helpers/index.js";

void describe("getUnwrappedIdentifierName", () => {
    void it("returns the name for a bare identifier", () => {
        assert.equal(getUnwrappedIdentifierName({ type: "Identifier", name: "value" }), "value");
    });

    void it("unwraps parenthesized identifier expressions", () => {
        const nestedIdentifier = {
            type: "ParenthesizedExpression",
            expression: {
                type: "ParenthesizedExpression",
                expression: { type: "Identifier", name: "wrapped_value" }
            }
        };

        assert.equal(getUnwrappedIdentifierName(nestedIdentifier), "wrapped_value");
    });

    void it("returns null for non-identifier expressions", () => {
        const expression = {
            type: "ParenthesizedExpression",
            expression: { type: "Literal", value: 1, raw: "1" }
        };

        assert.equal(getUnwrappedIdentifierName(expression), null);
    });
});

void describe("isUnwrappedIdentifierWithName", () => {
    void it("matches the expected identifier name after unwrapping", () => {
        const nestedIdentifier = {
            type: "ParenthesizedExpression",
            expression: { type: "Identifier", name: "pi" }
        };

        assert.equal(isUnwrappedIdentifierWithName(nestedIdentifier, "pi"), true);
    });

    void it("returns false when the names differ", () => {
        assert.equal(isUnwrappedIdentifierWithName({ type: "Identifier", name: "tau" }, "pi"), false);
    });
});
