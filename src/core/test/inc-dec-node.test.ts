/**
 * @file inc-dec-node.test.ts
 *
 * ## Purpose
 *
 * Tests for `Core.isIncDecNode`, a helper that returns `true` for both
 * `IncDecExpression` and `IncDecStatement` nodes — the two AST representations
 * for `++` and `--` operations in GML. These appear independently throughout
 * the lint/transform pipeline and this guard unifies the repeated
 * `type === "IncDecExpression" || type === "IncDecStatement"` pattern.
 *
 * Coverage includes positive hits for both forms, plus negative cases
 * (null, undefined, primitives, non-IncDec types) to confirm robust narrowing.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "../index.js";

void describe("Core.isIncDecNode", () => {
    void it("returns true for IncDecExpression nodes", () => {
        assert.equal(Core.isIncDecNode({ type: "IncDecExpression", argument: {} }), true);
    });

    void it("returns true for IncDecStatement nodes", () => {
        assert.equal(Core.isIncDecNode({ type: "IncDecStatement", argument: {} }), true);
    });

    void it("returns false for non-IncDec node types", () => {
        assert.equal(Core.isIncDecNode({ type: "CallExpression" }), false);
        assert.equal(Core.isIncDecNode({ type: "AssignmentExpression" }), false);
        assert.equal(Core.isIncDecNode({ type: "Identifier" }), false);
        assert.equal(Core.isIncDecNode({ type: "UpdateExpression" }), false);
    });

    void it("returns false for null and undefined", () => {
        assert.equal(Core.isIncDecNode(null), false);
        assert.equal(Core.isIncDecNode(undefined), false);
    });

    void it("returns false for primitives", () => {
        assert.equal(Core.isIncDecNode("IncDecExpression"), false);
        assert.equal(Core.isIncDecNode(42), false);
        assert.equal(Core.isIncDecNode(true), false);
    });

    void it("returns false for objects missing type field", () => {
        assert.equal(Core.isIncDecNode({ argument: {} }), false);
        assert.equal(Core.isIncDecNode({}), false);
    });

    void it("returns false for objects with non-string type", () => {
        assert.equal(Core.isIncDecNode({ type: 123 }), false);
        assert.equal(Core.isIncDecNode({ type: null }), false);
        assert.equal(Core.isIncDecNode({ type: undefined }), false);
    });
});
