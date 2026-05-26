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

import {
    isAstRecord,
    isFunctionScopeBoundary,
    isLoopStatement,
    isTemplateStringTextNode
} from "../src/emitter/type-guards.js";

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

void describe("isLoopStatement", () => {
    void it("returns true for ForStatement", () => {
        assert.equal(isLoopStatement(nodeOfType("ForStatement", {})), true);
    });

    void it("returns true for WhileStatement", () => {
        assert.equal(isLoopStatement(nodeOfType("WhileStatement", {})), true);
    });

    void it("returns true for DoUntilStatement", () => {
        assert.equal(isLoopStatement(nodeOfType("DoUntilStatement", {})), true);
    });

    void it("returns true for RepeatStatement", () => {
        assert.equal(isLoopStatement(nodeOfType("RepeatStatement", {})), true);
    });

    void it("returns false for WithStatement (scope-change, not a loop)", () => {
        assert.equal(isLoopStatement(nodeOfType("WithStatement", {})), false);
    });

    void it("returns false for non-loop nodes", () => {
        assert.equal(isLoopStatement(nodeOfType("BlockStatement", {})), false);
        assert.equal(isLoopStatement(nodeOfType("ReturnStatement", {})), false);
    });
});

void describe("Core guards — delegates verify no import breakage", () => {
    /**
     * These tests are not asserting new behavior; they serve as a
     * smoke-test that the Core namespace is correctly wired and
     * that all individual node-type guards used by the transpiler
     * are available from Core.  Full coverage of each guard lives
     * in @gmloop/core's type-guards.test.ts.
     */

    void it("Core.isProgramNode correctly identifies Program nodes", () => {
        assert.equal(Core.isProgramNode(nodeOfType("Program", { body: [] })), true);
        assert.equal(Core.isProgramNode(nodeOfType("Identifier", { name: "foo" })), false);
    });

    void it("Core.isBlockStatementNode correctly identifies BlockStatement nodes", () => {
        assert.equal(Core.isBlockStatementNode(nodeOfType("BlockStatement", { body: [] })), true);
        assert.equal(Core.isBlockStatementNode(nodeOfType("Program", { body: [] })), false);
    });

    void it("Core.isIdentifierNode correctly identifies Identifier nodes", () => {
        assert.equal(Core.isIdentifierNode(nodeOfType("Identifier", { name: "foo" })), true);
        assert.equal(Core.isIdentifierNode(nodeOfType("Literal", { value: 42 })), false);
    });

    void it("Core.isLiteralNode correctly identifies Literal nodes", () => {
        assert.equal(Core.isLiteralNode(nodeOfType("Literal", { value: 42 })), true);
        assert.equal(Core.isLiteralNode(nodeOfType("Identifier", { name: "foo" })), false);
    });

    void it("Core.isIfStatementNode correctly identifies IfStatement nodes", () => {
        assert.equal(Core.isIfStatementNode(nodeOfType("IfStatement", {})), true);
        assert.equal(Core.isIfStatementNode(nodeOfType("BlockStatement", {})), false);
    });

    void it("Core.isVariableDeclarationNode correctly identifies VariableDeclaration nodes", () => {
        assert.equal(Core.isVariableDeclarationNode(nodeOfType("VariableDeclaration", { kind: "var" })), true);
        assert.equal(Core.isVariableDeclarationNode(nodeOfType("VariableDeclarator", {})), false);
    });

    void it("Core.isVariableDeclaratorNode correctly identifies VariableDeclarator nodes", () => {
        assert.equal(Core.isVariableDeclaratorNode(nodeOfType("VariableDeclarator", {})), true);
        assert.equal(Core.isVariableDeclaratorNode(nodeOfType("VariableDeclaration", { kind: "var" })), false);
    });

    void it("Core.isGlobalVarStatementNode correctly identifies GlobalVarStatement nodes", () => {
        assert.equal(Core.isGlobalVarStatementNode(nodeOfType("GlobalVarStatement", {})), true);
        assert.equal(Core.isGlobalVarStatementNode(nodeOfType("VariableDeclaration", { kind: "var" })), false);
    });

    void it("Core.isFunctionDeclarationNode correctly identifies FunctionDeclaration nodes", () => {
        assert.equal(Core.isFunctionDeclarationNode(nodeOfType("FunctionDeclaration", {})), true);
        assert.equal(Core.isFunctionDeclarationNode(nodeOfType("Identifier", {})), false);
    });

    void it("Core.isConstructorDeclarationNode correctly identifies ConstructorDeclaration nodes", () => {
        assert.equal(Core.isConstructorDeclarationNode(nodeOfType("ConstructorDeclaration", {})), true);
        assert.equal(Core.isConstructorDeclarationNode(nodeOfType("FunctionDeclaration", {})), false);
    });

    void it("Core.isParenthesizedExpressionNode correctly identifies ParenthesizedExpression nodes", () => {
        assert.equal(Core.isParenthesizedExpressionNode(nodeOfType("ParenthesizedExpression", {})), true);
        assert.equal(Core.isParenthesizedExpressionNode(nodeOfType("Identifier", {})), false);
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
