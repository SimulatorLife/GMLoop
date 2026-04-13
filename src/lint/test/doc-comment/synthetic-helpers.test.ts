import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getArgumentIndexFromReferenceNode, resolveParameterName } from "../../src/doc-comment/index.js";

void describe("getArgumentIndexFromReferenceNode", () => {
    void it("returns the index for argumentN identifiers", () => {
        assert.strictEqual(
            getArgumentIndexFromReferenceNode({
                type: "Identifier",
                name: "argument3"
            }),
            3
        );
    });

    void it("returns the index for bracket argument references", () => {
        assert.strictEqual(
            getArgumentIndexFromReferenceNode({
                type: "MemberIndexExpression",
                object: { type: "Identifier", name: "argument" },
                property: [{ type: "Literal", value: "2" }]
            }),
            2
        );
    });

    void it("returns the index for dot-style argument references", () => {
        assert.strictEqual(
            getArgumentIndexFromReferenceNode({
                type: "MemberExpression",
                object: { type: "Identifier", name: "argument" },
                property: { type: "Literal", value: 4 }
            }),
            4
        );
    });

    void it("returns null for non-argument references", () => {
        assert.strictEqual(
            getArgumentIndexFromReferenceNode({
                type: "Identifier",
                name: "value"
            }),
            null
        );
    });
});

void describe("resolveParameterName", () => {
    void it("returns the name from an Identifier parameter", () => {
        assert.strictEqual(resolveParameterName({ type: "Identifier", name: "foo" }), "foo");
    });

    void it("returns the name from a DefaultParameter with Identifier left", () => {
        assert.strictEqual(
            resolveParameterName({
                type: "DefaultParameter",
                left: { type: "Identifier", name: "bar" },
                right: { type: "Literal", value: "0" }
            }),
            "bar"
        );
    });

    void it("returns the name from an AssignmentPattern with Identifier left", () => {
        assert.strictEqual(
            resolveParameterName({
                type: "AssignmentPattern",
                left: { type: "Identifier", name: "baz" },
                right: { type: "Literal", value: "undefined" }
            }),
            "baz"
        );
    });

    void it("returns the name via left.id.name when left.name is absent", () => {
        assert.strictEqual(
            resolveParameterName({
                type: "DefaultParameter",
                left: { id: { name: "qux" } },
                right: null
            }),
            "qux"
        );
    });

    void it("falls back to param.name for unknown node types", () => {
        assert.strictEqual(resolveParameterName({ type: "RestElement", name: "args" }), "args");
    });

    void it("returns undefined for null input", () => {
        assert.strictEqual(resolveParameterName(null), undefined);
    });

    void it("returns undefined for undefined input", () => {
        assert.strictEqual(resolveParameterName(undefined), undefined);
    });

    void it("returns undefined for non-object input", () => {
        assert.strictEqual(resolveParameterName("not-an-object"), undefined);
    });

    void it("returns undefined when Identifier has no name", () => {
        assert.strictEqual(resolveParameterName({ type: "Identifier" }), undefined);
    });

    void it("returns undefined when DefaultParameter has no left", () => {
        assert.strictEqual(resolveParameterName({ type: "DefaultParameter", left: null, right: null }), undefined);
    });

    void it("returns undefined when DefaultParameter left has no name or id", () => {
        assert.strictEqual(
            resolveParameterName({ type: "DefaultParameter", left: { type: "Pattern" }, right: null }),
            undefined
        );
    });

    void it("returns undefined for a numeric name on Identifier", () => {
        assert.strictEqual(resolveParameterName({ type: "Identifier", name: 42 }), undefined);
    });

    void it("returns undefined for array input", () => {
        assert.strictEqual(resolveParameterName([]), undefined);
    });
});
