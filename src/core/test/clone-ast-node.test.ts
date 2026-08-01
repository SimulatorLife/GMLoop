import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cloneAstNode } from "../src/ast/node-helpers/index.js";

void describe("cloneAstNode", () => {
    void it("returns null for nullish values", () => {
        assert.equal(cloneAstNode(null), null);
        assert.equal(cloneAstNode(), null);
    });

    void it("returns primitives unchanged", () => {
        const text = "identifier";
        const count = 42;

        assert.equal(cloneAstNode(text), text);
        assert.equal(cloneAstNode(count), count);
    });

    void it("clones objects without sharing references", () => {
        const original = {
            type: "Literal",
            value: "foo",
            nested: { value: "bar" }
        };

        const cloned = cloneAstNode(original);

        assert.notEqual(cloned, original);
        assert.deepEqual(cloned, original);

        cloned.nested.value = "baz";
        assert.equal(original.nested.value, "bar");
    });

    void it("skips traversal links and restores local parent links within the cloned subtree", () => {
        const program = {
            type: "Program",
            body: [] as Array<Record<string, unknown>>
        };
        const statement = {
            type: "ExpressionStatement",
            expression: {
                type: "Identifier",
                name: "value"
            } as Record<string, unknown>,
            parent: program
        };
        program.body.push(statement);
        statement.expression.parent = statement;

        const clonedStatement = cloneAstNode(statement) as typeof statement;

        assert.notStrictEqual(clonedStatement, statement);
        assert.equal(clonedStatement.parent, undefined);
        assert.equal(clonedStatement.expression.parent, clonedStatement);
        assert.notStrictEqual(clonedStatement.expression, statement.expression);
    });
});
