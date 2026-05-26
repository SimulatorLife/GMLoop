/**
 * Tests for the transpiler's unique type guard helpers.
 *
 * The canonical type guards for individual GML AST node types live in
 * `@gmloop/core` (Core.isBlockStatementNode, etc.).  Those are tested
 * extensively in @gmloop/core and do not need to be re-tested here.
 *
 * This test file covers the three helpers that are **unique** to the
 * transpiler:
 *   - isAstRecord      — broad structural predicate for the tree walker
 *   - isTemplateStringTextNode — needed by the emitter but absent from Core
 *   - isFunctionScopeBoundary — compound guard for function/constructor scope
 *   - isLoopStatement   — compound guard for the four iteration constructs
 *
 * The test strategy mirrors the approach used in @gmloop/core's
 * type-guards.test.ts: plain object literals are used to represent nodes,
 * ensuring that guards depend only on the structural contract (`.type`
 * string) and not on any class-based identity.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "@gmloop/core";

// Import all guards from the public surface
import {
    isAstRecord,
    isFunctionScopeBoundary,
    isLoopStatement,
    isTemplateStringTextNode
} from "../src/emitter/type-guards.js";

// @gmloop/core also exports isLoopLikeNode and isControlFlowExitStatement.
// Both workspaces implement the same contract (checking .type discriminant),
// so we test them here alongside the transpiler's own guards for
// isLoopStatement (an alias covering the same four loop types) and
// isControlFlowExitStatement.
//
// Note: isControlFlowExitStatement and isLoopLikeNode are accessed via
// Core.isControlFlowExitStatement and Core.isLoopLikeNode because
// @gmloop/core's public API flattens all exports into the Core namespace.

/**
 * Helper to create a minimal node object with only a type string.
 * This represents the structural contract that any GML node substitute
 * must satisfy, independent of class inheritance.
 */
function nodeOfType(type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { type, ...extra };
}

void describe("isAstRecord", () => {
    void it("returns true for plain objects", () => {
        assert.equal(isAstRecord({ type: "Identifier", name: "foo" }), true);
    });

    void it("returns true for empty objects", () => {
        assert.equal(isAstRecord({}), true);
    });

    void it("returns false for null", () => {
        assert.equal(isAstRecord(null), false);
    });

    void it("returns false for undefined", () => {
        assert.equal(isAstRecord(undefined), false);
    });

    void it("returns false for primitives", () => {
        assert.equal(isAstRecord(42), false);
        assert.equal(isAstRecord("foo"), false);
        assert.equal(isAstRecord(true), false);
    });
});

void describe("isTemplateStringTextNode", () => {
    void it("returns true for TemplateStringText nodes", () => {
        assert.equal(isTemplateStringTextNode(nodeOfType("TemplateStringText", { value: "hello" })), true);
    });

    void it("returns false for other node types", () => {
        assert.equal(isTemplateStringTextNode(nodeOfType("TemplateStringExpression", {})), false);
        assert.equal(isTemplateStringTextNode(nodeOfType("Literal", {})), false);
    });

    void it("returns false for null and primitives", () => {
        assert.equal(isTemplateStringTextNode(null), false);
        assert.equal(isTemplateStringTextNode("TemplateStringText"), false);
        assert.equal(isTemplateStringTextNode(undefined), false);
    });
});

void describe("isFunctionScopeBoundary", () => {
    void it("returns true for FunctionDeclaration nodes", () => {
        assert.equal(isFunctionScopeBoundary(nodeOfType("FunctionDeclaration", {})), true);
    });

    void it("returns true for ConstructorDeclaration nodes", () => {
        assert.equal(isFunctionScopeBoundary(nodeOfType("ConstructorDeclaration", {})), true);
    });

    void it("returns false for block-level nodes", () => {
        assert.equal(isFunctionScopeBoundary(nodeOfType("BlockStatement", {})), false);
        assert.equal(isFunctionScopeBoundary(nodeOfType("ForStatement", {})), false);
    });

    void it("returns false for null and primitives", () => {
        assert.equal(isFunctionScopeBoundary(null), false);
        assert.equal(isFunctionScopeBoundary("FunctionDeclaration"), false);
    });
});

/**
 * Unified tests for isLoopLikeNode (Core) + isLoopStatement (transpiler).
 *
 * Both guards implement identical behaviour: they return true for ForStatement,
 * WhileStatement, DoUntilStatement, and RepeatStatement — the four GML loop
 * constructs that carry a condition and support break/continue.  WithStatement
 * is excluded because its scope-change semantics differ from pure iteration.
 *
 * This single describe block exercises both guards, confirming they agree on
 * all loop-type and non-loop-type inputs.  The @gmloop/core tests in
 * `loop-like-node.test.ts` are removed as their coverage is fully subsumed.
 */
void describe("isLoopLikeNode (Core) and isLoopStatement (transpiler)", () => {
    const loopTypes = ["ForStatement", "WhileStatement", "DoUntilStatement", "RepeatStatement"];
    const nonLoopTypes = [
        { type: "WithStatement", note: "scope-change, not a loop" },
        { type: "IfStatement" },
        { type: "BlockStatement" },
        { type: "BinaryExpression" },
        { type: "CallExpression" }
    ];

    for (const type of loopTypes) {
        void it(`returns true for ${type}`, () => {
            const node = nodeOfType(type, {});
            assert.equal(Core.isLoopLikeNode(node), true, `${type} should pass Core.isLoopLikeNode`);
            assert.equal(isLoopStatement(node), true, `${type} should pass isLoopStatement`);
        });
    }

    for (const { type, note } of nonLoopTypes) {
        const tag = note ? ` (${note})` : "";
        void it(`returns false for ${type}${tag}`, () => {
            const node = nodeOfType(type, {});
            assert.equal(Core.isLoopLikeNode(node), false, `${type} should fail Core.isLoopLikeNode`);
            assert.equal(isLoopStatement(node), false, `${type} should fail isLoopStatement`);
        });
    }

    void it("returns false for null and undefined", () => {
        assert.equal(Core.isLoopLikeNode(null), false);
        assert.equal(Core.isLoopLikeNode(undefined), false);
        assert.equal(isLoopStatement(null), false);
        assert.equal(isLoopStatement(undefined), false);
    });

    void it("returns false for primitives", () => {
        assert.equal(Core.isLoopLikeNode(42), false);
        assert.equal(Core.isLoopLikeNode("ForStatement"), false);
        assert.equal(Core.isLoopLikeNode(true), false);
    });

    void it("returns false for objects without a type", () => {
        assert.equal(Core.isLoopLikeNode({}), false);
        assert.equal(Core.isLoopLikeNode({ body: {} }), false);
    });

    void it("returns false for objects with a non-string type", () => {
        assert.equal(Core.isLoopLikeNode({ type: null }), false);
        assert.equal(Core.isLoopLikeNode({ type: 42 }), false);
    });
});

/**
 * Unified tests for isControlFlowExitStatement (Core) + isControlFlowExitStatement (transpiler).
 *
 * Both guards return true for ReturnStatement, BreakStatement, ContinueStatement,
 * ExitStatement, and ThrowStatement — the five GML statement types that prevent
 * subsequent statements in the same block from executing.  The coverage duplicates
 * @gmloop/core's `node-classification.test.ts` "identifies control flow exit
 * statements" / "rejects non-exit statement types" / "safely handles null and
 * non-object inputs" test group; those three test cases are removed here.
 */
void describe("isControlFlowExitStatement (Core) and isControlFlowExitStatement (transpiler)", () => {
    const exitTypes = ["ReturnStatement", "BreakStatement", "ContinueStatement", "ExitStatement", "ThrowStatement"];
    const nonExitTypes = ["IfStatement", "ExpressionStatement", "BlockStatement", "FunctionDeclaration"];

    for (const type of exitTypes) {
        void it(`returns true for ${type}`, () => {
            const node = nodeOfType(type, {});
            assert.equal(
                Core.isControlFlowExitStatement(node),
                true,
                `${type} should pass Core.isControlFlowExitStatement`
            );
            assert.equal(
                isControlFlowExitStatement(node),
                true,
                `${type} should pass transpiler isControlFlowExitStatement`
            );
        });
    }

    for (const type of nonExitTypes) {
        void it(`returns false for ${type}`, () => {
            const node = nodeOfType(type, {});
            assert.equal(
                Core.isControlFlowExitStatement(node),
                false,
                `${type} should fail Core.isControlFlowExitStatement`
            );
            assert.equal(
                isControlFlowExitStatement(node),
                false,
                `${type} should fail transpiler isControlFlowExitStatement`
            );
        });
    }

    void it("returns false for null, undefined, and primitives", () => {
        assert.equal(Core.isControlFlowExitStatement(null), false);
        assert.equal(Core.isControlFlowExitStatement(undefined), false);
        assert.equal(Core.isControlFlowExitStatement("ReturnStatement"), false);
        assert.equal(Core.isControlFlowExitStatement(42), false);
        assert.equal(Core.isControlFlowExitStatement({}), false);
    });
});

void describe("substitution safety — plain objects work without class inheritance", () => {
    /**
     * This test demonstrates that the local guards work with structurally-equivalent
     * plain objects rather than requiring class instances. This is the key
     * contract that enables safe substitution of collaborators.
     */

    void it("plain object passes isTemplateStringTextNode", () => {
        const plainText = { type: "TemplateStringText", value: "static content" };
        assert.equal(isTemplateStringTextNode(plainText), true);
    });

    void it("plain object passes isFunctionScopeBoundary (FunctionDeclaration)", () => {
        const plainFunction = { type: "FunctionDeclaration", id: null, params: [], body: {} };
        assert.equal(isFunctionScopeBoundary(plainFunction), true);
    });

    void it("plain object passes isLoopStatement", () => {
        const plainLoop = { type: "ForStatement", init: null, test: null, update: null, body: {} };
        assert.equal(isLoopStatement(plainLoop), true);
    });

    void it("plain non-object fails isAstRecord", () => {
        assert.equal(isAstRecord(null), false);
        assert.equal(isAstRecord(undefined), false);
        assert.equal(isAstRecord(42), false);
        assert.equal(isAstRecord("foo"), false);
    });
});
