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

void describe("isControlFlowExitStatement", () => {
    void it("returns true for ReturnStatement", () => {
        assert.equal(isControlFlowExitStatement(nodeOfType("ReturnStatement", {})), true);
    });

    void it("returns true for BreakStatement", () => {
        assert.equal(isControlFlowExitStatement(nodeOfType("BreakStatement", {})), true);
    });

    void it("returns true for ContinueStatement", () => {
        assert.equal(isControlFlowExitStatement(nodeOfType("ContinueStatement", {})), true);
    });

    void it("returns true for ExitStatement", () => {
        assert.equal(isControlFlowExitStatement(nodeOfType("ExitStatement", {})), true);
    });

    void it("returns true for ThrowStatement", () => {
        assert.equal(isControlFlowExitStatement(nodeOfType("ThrowStatement", {})), true);
    });

    void it("returns false for non-exit statements", () => {
        assert.equal(isControlFlowExitStatement(nodeOfType("BlockStatement", {})), false);
        assert.equal(isControlFlowExitStatement(nodeOfType("IfStatement", {})), false);
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
