import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attemptCondenseScalarProduct } from "../../src/rules/gml/math/math-scalar-condensing.js";
import { applyScalarCondensing } from "../../src/rules/gml/math/math-traversal-normalization.js";

void describe("applyScalarCondensing", () => {
    void it("combines numeric scalar factors", () => {
        const ast: any = {
            type: "BinaryExpression",
            operator: "*",
            left: {
                type: "BinaryExpression",
                operator: "*",
                left: { type: "Identifier", name: "foo" },
                right: { type: "Literal", value: "2" }
            },
            right: { type: "Literal", value: "3" }
        };

        applyScalarCondensing(ast, null);

        assert.strictEqual(ast.type, "BinaryExpression");
        assert.strictEqual(ast.left.type, "Identifier");
        assert.strictEqual(ast.left.name, "foo");
        assert.strictEqual(ast.right.type, "Literal");
        assert.strictEqual(ast.right.value, "6");
    });
});

void describe("attemptCondenseScalarProduct", () => {
    const makeNode = (operator: string, left: any, right: any): any => ({
        type: "BinaryExpression",
        operator,
        left,
        right
    });

    const identifier = (name: string) => ({ type: "Identifier", name });
    const literal = (value: string) => ({ type: "Literal", value });

    void it("collapses multiplication by a positive identity into the non-numeric operand", () => {
        const node = makeNode("*", identifier("foo"), literal("1"));

        const result = attemptCondenseScalarProduct(node, null);

        assert.strictEqual(result, true);
        assert.strictEqual(node.type, "Identifier");
        assert.strictEqual(node.name, "foo");
    });

    void it("collapses multiplication by a negative identity into a unary negation", () => {
        const node = makeNode("*", identifier("foo"), literal("-1"));

        const result = attemptCondenseScalarProduct(node, null);

        assert.strictEqual(result, true);
        assert.strictEqual(node.type, "UnaryExpression");
        assert.strictEqual(node.operator, "-");
        assert.strictEqual(node.argument.type, "Identifier");
        assert.strictEqual(node.argument.name, "foo");
    });

    void it("rewrites a scalar product by folding multiple numerators into a single literal", () => {
        const node = makeNode("*", makeNode("*", identifier("foo"), literal("2")), literal("3"));

        const result = attemptCondenseScalarProduct(node, null);

        assert.strictEqual(result, true);
        assert.strictEqual(node.operator, "*");
        assert.strictEqual(node.left.type, "Identifier");
        assert.strictEqual(node.left.name, "foo");
        assert.strictEqual(node.right.type, "Literal");
        assert.strictEqual(node.right.value, "6");
    });

    void it("leaves a non-multiplicative node unchanged", () => {
        const node = makeNode("+", identifier("foo"), literal("1"));

        const result = attemptCondenseScalarProduct(node, null);

        assert.strictEqual(result, false);
        assert.strictEqual(node.operator, "+");
        assert.strictEqual(node.left.type, "Identifier");
        assert.strictEqual(node.right.type, "Literal");
    });

    void it("does not rewrite when no non-numeric term is present", () => {
        const node = makeNode("*", literal("2"), literal("3"));

        const originalOperator = node.operator;
        const originalLeft = node.left;
        const originalRight = node.right;

        const result = attemptCondenseScalarProduct(node, null);

        assert.strictEqual(result, false);
        assert.strictEqual(node.operator, originalOperator);
        assert.strictEqual(node.left, originalLeft);
        assert.strictEqual(node.right, originalRight);
    });

    void it("does not rewrite a single numeric factor (no condensing needed)", () => {
        const node = makeNode("*", identifier("foo"), literal("2"));

        const result = attemptCondenseScalarProduct(node, null);

        assert.strictEqual(result, false);
        assert.strictEqual(node.operator, "*");
        assert.strictEqual(node.left.type, "Identifier");
        assert.strictEqual(node.right.type, "Literal");
    });
});
