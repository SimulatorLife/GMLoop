import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCallExpressionIdentifier, getCallExpressionIdentifierName } from "../src/ast/node-helpers/index.js";

void describe("getCallExpressionIdentifier", () => {
    void it("returns the identifier node when the callee is a named identifier", () => {
        const identifier = { type: "Identifier", name: "example" };
        const callExpression = {
            type: "CallExpression",
            object: identifier,
            arguments: []
        };

        assert.equal(getCallExpressionIdentifier(callExpression), identifier);
    });

    void it("returns null when the callee is not an identifier", () => {
        const callExpression = {
            type: "CallExpression",
            object: { type: "MemberDotExpression" },
            arguments: []
        };

        assert.equal(getCallExpressionIdentifier(callExpression), null);
    });

    void it("returns null when the identifier name is not a string", () => {
        const callExpression = {
            type: "CallExpression",
            object: { type: "Identifier", name: 42 },
            arguments: []
        };

        assert.equal(getCallExpressionIdentifier(callExpression), null);
    });
});

void describe("getCallExpressionIdentifierName", () => {
    void it("returns the callee name when available", () => {
        const callExpression = {
            type: "CallExpression",
            object: { type: "Identifier", name: "do_work" },
            arguments: []
        };

        assert.equal(getCallExpressionIdentifierName(callExpression), "do_work");
    });

    void it("returns null for non-call expressions", () => {
        assert.equal(getCallExpressionIdentifierName({ type: "Identifier" }), null);
    });

    void it("returns null when the callee lacks a string name", () => {
        const callExpression = {
            type: "CallExpression",
            object: { type: "Identifier", name: null },
            arguments: []
        };

        assert.equal(getCallExpressionIdentifierName(callExpression), null);
    });
});
