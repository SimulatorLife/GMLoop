/**
 * Tests for the transpiler emitter type guards.
 *
 * These tests verify that the type guard functions correctly identify GML AST
 * node types using the `.type` discriminant field, rather than relying on
 * `instanceof` checks against concrete classes. This approach is critical for
 * substitution safety: test doubles, mock parsers, or structurally-equivalent
 * alternatives can be passed to consumers without needing to inherit from
 * specific class hierarchies.
 *
 * The test strategy mirrors the approach used in @gmloop/core's type-guards.test.ts:
 * plain object literals are used to represent nodes, ensuring that guards
 * depend only on the structural contract (`.type` string) and not on any
 * class-based identity.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "@gmloop/core";

// Import all guards from the public surface
import {
    isArrayExpressionNode,
    isAssignmentExpressionNode,
    isAstRecord,
    isBinaryExpressionNode,
    isBlockStatementNode,
    isBreakStatementNode,
    isCallExpressionNode,
    isCatchClauseNode,
    isConstructorDeclarationNode,
    isConstructorParentClauseNode,
    isContinueStatementNode,
    isControlFlowExitStatement,
    isDefaultParameterNode,
    isDeleteStatementNode,
    isDoUntilStatementNode,
    isEnumDeclarationNode,
    isExitStatementNode,
    isExpressionStatementNode,
    isFinallyClauseNode,
    isForStatementNode,
    isFunctionDeclarationNode,
    isFunctionScopeBoundary,
    isGlobalVarStatementNode,
    isIdentifierNode,
    isIdentifierStatementNode,
    isIfStatementNode,
    isLiteralNode,
    isLoopStatement,
    isMacroDeclarationNode,
    isMemberDotExpressionNode,
    isMemberIndexExpressionNode,
    isMissingOptionalArgumentNode,
    isNewExpressionNode,
    isParenthesizedExpressionNode,
    isProgramNode,
    isRepeatStatementNode,
    isReturnStatementNode,
    isStructExpressionNode,
    isSwitchStatementNode,
    isTemplateStringExpressionNode,
    isTemplateStringTextNode,
    isTernaryExpressionNode,
    isThrowStatementNode,
    isTryStatementNode,
    isUnaryExpressionNode,
    isVariableDeclarationNode,
    isVariableDeclaratorNode,
    isWhileStatementNode,
    isWithStatementNode
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

void describe("isProgramNode", () => {
    void it("returns true for Program nodes", () => {
        assert.equal(isProgramNode(nodeOfType("Program", { body: [] })), true);
    });

    void it("returns false for non-Program nodes", () => {
        assert.equal(isProgramNode(nodeOfType("Identifier", { name: "foo" })), false);
        assert.equal(isProgramNode(nodeOfType("BlockStatement", { body: [] })), false);
    });

    void it("returns false for null and primitives", () => {
        assert.equal(isProgramNode(null), false);
        assert.equal(isProgramNode("Program"), false);
        assert.equal(isProgramNode(undefined), false);
    });
});

void describe("isBlockStatementNode", () => {
    void it("returns true for BlockStatement nodes", () => {
        assert.equal(isBlockStatementNode(nodeOfType("BlockStatement", { body: [] })), true);
    });

    void it("returns false for other node types", () => {
        assert.equal(isBlockStatementNode(nodeOfType("Program", { body: [] })), false);
        assert.equal(isBlockStatementNode(nodeOfType("Identifier", { name: "foo" })), false);
    });
});

void describe("isIdentifierNode", () => {
    void it("returns true for Identifier nodes", () => {
        assert.equal(isIdentifierNode(nodeOfType("Identifier", { name: "foo" })), true);
    });

    void it("returns false for non-Identifier nodes", () => {
        assert.equal(isIdentifierNode(nodeOfType("Literal", { value: 42 })), false);
    });
});

void describe("isLiteralNode", () => {
    void it("returns true for Literal nodes", () => {
        assert.equal(isLiteralNode(nodeOfType("Literal", { value: 42 })), true);
        assert.equal(isLiteralNode(nodeOfType("Literal", { value: "hello" })), true);
        assert.equal(isLiteralNode(nodeOfType("Literal", { value: null })), true);
    });

    void it("returns false for non-Literal nodes", () => {
        assert.equal(isLiteralNode(nodeOfType("Identifier", { name: "foo" })), false);
    });
});

void describe("isBinaryExpressionNode", () => {
    void it("returns true for BinaryExpression nodes", () => {
        assert.equal(isBinaryExpressionNode(nodeOfType("BinaryExpression", { operator: "+" })), true);
    });

    void it("returns false for non-BinaryExpression nodes", () => {
        assert.equal(isBinaryExpressionNode(nodeOfType("Identifier", { name: "x" })), false);
    });
});

void describe("isAssignmentExpressionNode", () => {
    void it("returns true for AssignmentExpression nodes", () => {
        assert.equal(isAssignmentExpressionNode(nodeOfType("AssignmentExpression", { operator: "=" })), true);
    });
});

void describe("isUnaryExpressionNode", () => {
    void it("returns true for UnaryExpression nodes", () => {
        assert.equal(isUnaryExpressionNode(nodeOfType("UnaryExpression", { operator: "!" })), true);
    });
});

void describe("isCallExpressionNode", () => {
    void it("returns true for CallExpression nodes", () => {
        assert.equal(isCallExpressionNode(nodeOfType("CallExpression", { arguments: [] })), true);
    });
});

void describe("isMemberDotExpressionNode", () => {
    void it("returns true for MemberDotExpression nodes", () => {
        assert.equal(isMemberDotExpressionNode(nodeOfType("MemberDotExpression", {})), true);
    });
});

void describe("isMemberIndexExpressionNode", () => {
    void it("returns true for MemberIndexExpression nodes", () => {
        assert.equal(isMemberIndexExpressionNode(nodeOfType("MemberIndexExpression", {})), true);
    });
});

void describe("isNewExpressionNode", () => {
    void it("returns true for NewExpression nodes", () => {
        assert.equal(isNewExpressionNode(nodeOfType("NewExpression", {})), true);
    });
});

void describe("isArrayExpressionNode", () => {
    void it("returns true for ArrayExpression nodes", () => {
        assert.equal(isArrayExpressionNode(nodeOfType("ArrayExpression", { elements: [] })), true);
    });
});

void describe("isStructExpressionNode", () => {
    void it("returns true for StructExpression nodes", () => {
        assert.equal(isStructExpressionNode(nodeOfType("StructExpression", { properties: [] })), true);
    });
});

void describe("isParenthesizedExpressionNode", () => {
    void it("returns true for ParenthesizedExpression nodes", () => {
        assert.equal(isParenthesizedExpressionNode(nodeOfType("ParenthesizedExpression", {})), true);
    });
});

void describe("isTemplateStringExpressionNode", () => {
    void it("returns true for TemplateStringExpression nodes", () => {
        assert.equal(isTemplateStringExpressionNode(nodeOfType("TemplateStringExpression", {})), true);
    });
});

void describe("isTemplateStringTextNode", () => {
    void it("returns true for TemplateStringText nodes", () => {
        assert.equal(isTemplateStringTextNode(nodeOfType("TemplateStringText", {})), true);
    });
});

void describe("isDefaultParameterNode", () => {
    void it("returns true for DefaultParameter nodes", () => {
        assert.equal(isDefaultParameterNode(nodeOfType("DefaultParameter", {})), true);
    });
});

void describe("isMissingOptionalArgumentNode", () => {
    void it("returns true for MissingOptionalArgument nodes", () => {
        assert.equal(isMissingOptionalArgumentNode(nodeOfType("MissingOptionalArgument", {})), true);
    });
});

void describe("isTernaryExpressionNode", () => {
    void it("returns true for TernaryExpression nodes", () => {
        assert.equal(isTernaryExpressionNode(nodeOfType("TernaryExpression", {})), true);
    });
});

void describe("isExpressionStatementNode", () => {
    void it("returns true for ExpressionStatement nodes", () => {
        assert.equal(isExpressionStatementNode(nodeOfType("ExpressionStatement", {})), true);
    });
});

void describe("isIdentifierStatementNode", () => {
    void it("returns true for IdentifierStatement nodes", () => {
        assert.equal(isIdentifierStatementNode(nodeOfType("IdentifierStatement", {})), true);
    });
});

void describe("isIfStatementNode", () => {
    void it("returns true for IfStatement nodes", () => {
        assert.equal(isIfStatementNode(nodeOfType("IfStatement", {})), true);
    });

    void it("returns false for nested else-if chains represented as separate nodes", () => {
        // This tests the contract that a plain else-if node is typed as IfStatement
        const elseIf = nodeOfType("IfStatement", { test: { type: "Identifier", name: "b" } });
        assert.equal(isIfStatementNode(elseIf), true);
    });
});

void describe("isForStatementNode", () => {
    void it("returns true for ForStatement nodes", () => {
        assert.equal(isForStatementNode(nodeOfType("ForStatement", {})), true);
    });
});

void describe("isWhileStatementNode", () => {
    void it("returns true for WhileStatement nodes", () => {
        assert.equal(isWhileStatementNode(nodeOfType("WhileStatement", {})), true);
    });
});

void describe("isDoUntilStatementNode", () => {
    void it("returns true for DoUntilStatement nodes", () => {
        assert.equal(isDoUntilStatementNode(nodeOfType("DoUntilStatement", {})), true);
    });
});

void describe("isRepeatStatementNode", () => {
    void it("returns true for RepeatStatement nodes", () => {
        assert.equal(isRepeatStatementNode(nodeOfType("RepeatStatement", {})), true);
    });
});

void describe("isWithStatementNode", () => {
    void it("returns true for WithStatement nodes", () => {
        assert.equal(isWithStatementNode(nodeOfType("WithStatement", {})), true);
    });
});

void describe("isSwitchStatementNode", () => {
    void it("returns true for SwitchStatement nodes", () => {
        assert.equal(isSwitchStatementNode(nodeOfType("SwitchStatement", {})), true);
    });
});

void describe("isReturnStatementNode", () => {
    void it("returns true for ReturnStatement nodes", () => {
        assert.equal(isReturnStatementNode(nodeOfType("ReturnStatement", {})), true);
    });
});

void describe("isThrowStatementNode", () => {
    void it("returns true for ThrowStatement nodes", () => {
        assert.equal(isThrowStatementNode(nodeOfType("ThrowStatement", {})), true);
    });
});

void describe("isTryStatementNode", () => {
    void it("returns true for TryStatement nodes", () => {
        assert.equal(isTryStatementNode(nodeOfType("TryStatement", {})), true);
    });
});

void describe("isBreakStatementNode", () => {
    void it("returns true for BreakStatement nodes", () => {
        assert.equal(isBreakStatementNode(nodeOfType("BreakStatement", {})), true);
    });
});

void describe("isContinueStatementNode", () => {
    void it("returns true for ContinueStatement nodes", () => {
        assert.equal(isContinueStatementNode(nodeOfType("ContinueStatement", {})), true);
    });
});

void describe("isExitStatementNode", () => {
    void it("returns true for ExitStatement nodes", () => {
        assert.equal(isExitStatementNode(nodeOfType("ExitStatement", {})), true);
    });
});

void describe("isDeleteStatementNode", () => {
    void it("returns true for DeleteStatement nodes", () => {
        assert.equal(isDeleteStatementNode(nodeOfType("DeleteStatement", {})), true);
    });
});

void describe("isVariableDeclarationNode", () => {
    void it("returns true for VariableDeclaration nodes", () => {
        assert.equal(isVariableDeclarationNode(nodeOfType("VariableDeclaration", { kind: "var" })), true);
    });
});

void describe("isVariableDeclaratorNode", () => {
    void it("returns true for VariableDeclarator nodes", () => {
        assert.equal(isVariableDeclaratorNode(nodeOfType("VariableDeclarator", {})), true);
    });
});

void describe("isGlobalVarStatementNode", () => {
    void it("returns true for GlobalVarStatement nodes", () => {
        assert.equal(isGlobalVarStatementNode(nodeOfType("GlobalVarStatement", {})), true);
    });
});

void describe("isFunctionDeclarationNode", () => {
    void it("returns true for FunctionDeclaration nodes", () => {
        assert.equal(isFunctionDeclarationNode(nodeOfType("FunctionDeclaration", {})), true);
    });
});

void describe("isConstructorDeclarationNode", () => {
    void it("returns true for ConstructorDeclaration nodes", () => {
        assert.equal(isConstructorDeclarationNode(nodeOfType("ConstructorDeclaration", {})), true);
    });
});

void describe("isConstructorParentClauseNode", () => {
    void it("returns true for ConstructorParentClause nodes", () => {
        assert.equal(isConstructorParentClauseNode(nodeOfType("ConstructorParentClause", {})), true);
    });
});

void describe("isEnumDeclarationNode", () => {
    void it("returns true for EnumDeclaration nodes", () => {
        assert.equal(isEnumDeclarationNode(nodeOfType("EnumDeclaration", {})), true);
    });
});

void describe("isMacroDeclarationNode", () => {
    void it("returns true for MacroDeclaration nodes", () => {
        assert.equal(isMacroDeclarationNode(nodeOfType("MacroDeclaration", {})), true);
    });
});

void describe("isCatchClauseNode", () => {
    void it("returns true for CatchClause nodes", () => {
        assert.equal(isCatchClauseNode(nodeOfType("CatchClause", {})), true);
    });
});

void describe("isFinallyClauseNode", () =>
    void it("returns true for FinallyClause nodes", () => {
        assert.equal(isFinallyClauseNode(nodeOfType("FinallyClause", {})), true);
    }));

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
     * This test demonstrates that the guards work with structurally-equivalent
     * plain objects rather than requiring class instances. This is the key
     * contract that enables safe substitution of collaborators.
     */

    void it("Identifier-like plain object passes isIdentifierNode", () => {
        const plainIdentifier = { type: "Identifier", name: "myVar" };
        assert.equal(isIdentifierNode(plainIdentifier), true);
    });

    void it("Literal-like plain object passes isLiteralNode", () => {
        const plainLiteral = { type: "Literal", value: 42 };
        assert.equal(isLiteralNode(plainLiteral), true);
    });

    void it("BlockStatement-like plain object passes isBlockStatementNode", () => {
        const plainBlock = { type: "BlockStatement", body: [] };
        assert.equal(isBlockStatementNode(plainBlock), true);
    });

    void it("FunctionDeclaration-like plain object passes isFunctionScopeBoundary", () => {
        const plainFunction = { type: "FunctionDeclaration", id: null, params: [], body: {} };
        assert.equal(isFunctionScopeBoundary(plainFunction), true);
    });

    void it("IfStatement plain object with nested else-if is recognized as IfStatement", () => {
        const elseIfNode = {
            type: "IfStatement",
            test: { type: "Identifier", name: "condition" },
            consequent: { type: "BlockStatement", body: [] },
            alternate: null
        };
        assert.equal(isIfStatementNode(elseIfNode), true);
    });
});
