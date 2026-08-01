import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSingleVariableDeclarator } from "../src/ast/node-helpers/index.js";

void describe("getSingleVariableDeclarator", () => {
    void it("returns null for non-variable declarations", () => {
        assert.equal(getSingleVariableDeclarator(null), null);
        assert.equal(getSingleVariableDeclarator({ type: "FunctionDeclaration" }), null);
    });

    void it("returns null when the declaration list is not a single variable declarator", () => {
        assert.equal(
            getSingleVariableDeclarator({
                type: "VariableDeclaration",
                declarations: []
            }),
            null
        );

        assert.equal(
            getSingleVariableDeclarator({
                type: "VariableDeclaration",
                declarations: [{ type: "VariableDeclarator" }, { type: "VariableDeclarator" }]
            }),
            null
        );

        assert.equal(
            getSingleVariableDeclarator({
                type: "VariableDeclaration",
                declarations: [{ type: "AssignmentExpression" }]
            }),
            null
        );
    });

    void it("returns the declarator for single variable declarations", () => {
        const declarator = { type: "VariableDeclarator", id: { name: "foo" } };

        const result = getSingleVariableDeclarator({
            type: "VariableDeclaration",
            declarations: [declarator]
        });

        assert.equal(result, declarator);
    });
});
