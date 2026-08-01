/**
 * Type guard library for the transpiler's GML AST nodes.
 *
 * These guards check the `.type` discriminant field present on all GML nodes.
 * They accept `unknown` and return TypeScript predicates that narrow the type
 * safely, enabling callers to substitute any object that satisfies the `BaseNode`
 * interface in place of a canonical AST node.
 *
 * Guards delegate to Core.isNode for the null-check and property access,
 * matching the pattern used in @gmloop/core's type-guards.ts.
 */

import { Core } from "@gmloop/core";

import type {
    ArrayExpressionNode,
    AssignmentExpressionNode,
    BinaryExpressionNode,
    BlockStatementNode,
    BreakStatementNode,
    CallExpressionNode,
    CatchClauseNode,
    ConstructorDeclarationNode,
    ConstructorParentClauseNode,
    ContinueStatementNode,
    DefaultParameterNode,
    DeleteStatementNode,
    DoUntilStatementNode,
    EnumDeclarationNode,
    ExitStatementNode,
    ExpressionStatementNode,
    FinallyClauseNode,
    ForStatementNode,
    FunctionDeclarationNode,
    GlobalVarStatementNode,
    IdentifierNode,
    IdentifierStatementNode,
    IfStatementNode,
    LiteralNode,
    MacroDeclarationNode,
    MemberDotExpressionNode,
    MemberIndexExpressionNode,
    MissingOptionalArgumentNode,
    NewExpressionNode,
    ParenthesizedExpressionNode,
    ProgramNode,
    RepeatStatementNode,
    ReturnStatementNode,
    StructExpressionNode,
    SwitchStatementNode,
    TemplateStringExpressionNode,
    TemplateStringTextNode,
    TernaryExpressionNode,
    ThrowStatementNode,
    TryStatementNode,
    UnaryExpressionNode,
    VariableDeclarationNode,
    VariableDeclaratorNode,
    WhileStatementNode,
    WithStatementNode
} from "./ast.js";

/* ─── Internal helpers ─────────────────────────────────────────────────────── */

function matchesType<T extends string>(
    candidate: unknown,
    expectedType: T
): candidate is { type: T } & Record<string, unknown> {
    return Core.isNode(candidate) && (candidate as { type?: unknown }).type === expectedType;
}

/* ─── Program & Block ─────────────────────────────────────────────────────── */

export function isProgramNode(candidate: unknown): candidate is ProgramNode {
    return matchesType(candidate, "Program");
}

export function isBlockStatementNode(candidate: unknown): candidate is BlockStatementNode {
    return matchesType(candidate, "BlockStatement");
}

/* ─── Literals & Identifiers ─────────────────────────────────────────────── */

export function isIdentifierNode(candidate: unknown): candidate is IdentifierNode {
    return matchesType(candidate, "Identifier");
}

export function isLiteralNode(candidate: unknown): candidate is LiteralNode {
    return matchesType(candidate, "Literal");
}

/* ─── Expressions ─────────────────────────────────────────────────────────── */

export function isBinaryExpressionNode(candidate: unknown): candidate is BinaryExpressionNode {
    return matchesType(candidate, "BinaryExpression");
}

export function isUnaryExpressionNode(candidate: unknown): candidate is UnaryExpressionNode {
    return matchesType(candidate, "UnaryExpression");
}

export function isAssignmentExpressionNode(candidate: unknown): candidate is AssignmentExpressionNode {
    return matchesType(candidate, "AssignmentExpression");
}

export function isTernaryExpressionNode(candidate: unknown): candidate is TernaryExpressionNode {
    return matchesType(candidate, "TernaryExpression");
}

export function isCallExpressionNode(candidate: unknown): candidate is CallExpressionNode {
    return matchesType(candidate, "CallExpression");
}

export function isMemberDotExpressionNode(candidate: unknown): candidate is MemberDotExpressionNode {
    return matchesType(candidate, "MemberDotExpression");
}

export function isMemberIndexExpressionNode(candidate: unknown): candidate is MemberIndexExpressionNode {
    return matchesType(candidate, "MemberIndexExpression");
}

export function isNewExpressionNode(candidate: unknown): candidate is NewExpressionNode {
    return matchesType(candidate, "NewExpression");
}

export function isArrayExpressionNode(candidate: unknown): candidate is ArrayExpressionNode {
    return matchesType(candidate, "ArrayExpression");
}

export function isStructExpressionNode(candidate: unknown): candidate is StructExpressionNode {
    return matchesType(candidate, "StructExpression");
}

export function isParenthesizedExpressionNode(candidate: unknown): candidate is ParenthesizedExpressionNode {
    return matchesType(candidate, "ParenthesizedExpression");
}

export function isTemplateStringExpressionNode(candidate: unknown): candidate is TemplateStringExpressionNode {
    return matchesType(candidate, "TemplateStringExpression");
}

export function isTemplateStringTextNode(candidate: unknown): candidate is TemplateStringTextNode {
    return matchesType(candidate, "TemplateStringText");
}

export function isDefaultParameterNode(candidate: unknown): candidate is DefaultParameterNode {
    return matchesType(candidate, "DefaultParameter");
}

export function isMissingOptionalArgumentNode(candidate: unknown): candidate is MissingOptionalArgumentNode {
    return matchesType(candidate, "MissingOptionalArgument");
}

/* ─── Statements ─────────────────────────────────────────────────────────── */

export function isExpressionStatementNode(candidate: unknown): candidate is ExpressionStatementNode {
    return matchesType(candidate, "ExpressionStatement");
}

export function isIdentifierStatementNode(candidate: unknown): candidate is IdentifierStatementNode {
    return matchesType(candidate, "IdentifierStatement");
}

export function isIfStatementNode(candidate: unknown): candidate is IfStatementNode {
    return matchesType(candidate, "IfStatement");
}

export function isForStatementNode(candidate: unknown): candidate is ForStatementNode {
    return matchesType(candidate, "ForStatement");
}

export function isWhileStatementNode(candidate: unknown): candidate is WhileStatementNode {
    return matchesType(candidate, "WhileStatement");
}

export function isDoUntilStatementNode(candidate: unknown): candidate is DoUntilStatementNode {
    return matchesType(candidate, "DoUntilStatement");
}

export function isRepeatStatementNode(candidate: unknown): candidate is RepeatStatementNode {
    return matchesType(candidate, "RepeatStatement");
}

export function isWithStatementNode(candidate: unknown): candidate is WithStatementNode {
    return matchesType(candidate, "WithStatement");
}

export function isSwitchStatementNode(candidate: unknown): candidate is SwitchStatementNode {
    return matchesType(candidate, "SwitchStatement");
}

export function isReturnStatementNode(candidate: unknown): candidate is ReturnStatementNode {
    return matchesType(candidate, "ReturnStatement");
}

export function isThrowStatementNode(candidate: unknown): candidate is ThrowStatementNode {
    return matchesType(candidate, "ThrowStatement");
}

export function isTryStatementNode(candidate: unknown): candidate is TryStatementNode {
    return matchesType(candidate, "TryStatement");
}

export function isBreakStatementNode(candidate: unknown): candidate is BreakStatementNode {
    return matchesType(candidate, "BreakStatement");
}

export function isContinueStatementNode(candidate: unknown): candidate is ContinueStatementNode {
    return matchesType(candidate, "ContinueStatement");
}

export function isExitStatementNode(candidate: unknown): candidate is ExitStatementNode {
    return matchesType(candidate, "ExitStatement");
}

export function isDeleteStatementNode(candidate: unknown): candidate is DeleteStatementNode {
    return matchesType(candidate, "DeleteStatement");
}

/* ─── Declarations ────────────────────────────────────────────────────────── */

export function isVariableDeclarationNode(candidate: unknown): candidate is VariableDeclarationNode {
    return matchesType(candidate, "VariableDeclaration");
}

export function isVariableDeclaratorNode(candidate: unknown): candidate is VariableDeclaratorNode {
    return matchesType(candidate, "VariableDeclarator");
}

export function isGlobalVarStatementNode(candidate: unknown): candidate is GlobalVarStatementNode {
    return matchesType(candidate, "GlobalVarStatement");
}

export function isFunctionDeclarationNode(candidate: unknown): candidate is FunctionDeclarationNode {
    return matchesType(candidate, "FunctionDeclaration");
}

export function isConstructorDeclarationNode(candidate: unknown): candidate is ConstructorDeclarationNode {
    return matchesType(candidate, "ConstructorDeclaration");
}

export function isConstructorParentClauseNode(candidate: unknown): candidate is ConstructorParentClauseNode {
    return matchesType(candidate, "ConstructorParentClause");
}

export function isEnumDeclarationNode(candidate: unknown): candidate is EnumDeclarationNode {
    return matchesType(candidate, "EnumDeclaration");
}

export function isMacroDeclarationNode(candidate: unknown): candidate is MacroDeclarationNode {
    return matchesType(candidate, "MacroDeclaration");
}

/* ─── Exception handling ──────────────────────────────────────────────────── */

export function isCatchClauseNode(candidate: unknown): candidate is CatchClauseNode {
    return matchesType(candidate, "CatchClause");
}

export function isFinallyClauseNode(candidate: unknown): candidate is FinallyClauseNode {
    return matchesType(candidate, "FinallyClause");
}

/* ─── Compound helpers ─────────────────────────────────────────────────────── */

/**
 * Minimal shape check for any object-valued AST child.
 *
 * Mirrors `Core.isObjectLike` but scoped to the transpiler's internal
 * conventions.
 */
export function isAstRecord(candidate: unknown): candidate is Record<string, unknown> {
    return candidate !== null && typeof candidate === "object";
}

/**
 * Determine whether `candidate` is a function-scope boundary node.
 *
 * In GML, function bodies form an implicit scope boundary: variables declared
 * inside a `FunctionDeclaration` or `ConstructorDeclaration` do not leak into
 * the outer scope.
 */
export function isFunctionScopeBoundary(candidate: unknown): boolean {
    return isFunctionDeclarationNode(candidate) || isConstructorDeclarationNode(candidate);
}

/**
 * Determine whether `node` is any flavour of loop statement.
 *
 * Covers `ForStatement`, `WhileStatement`, `DoUntilStatement`, and `RepeatStatement`.
 * Equivalent to `Core.isLoopLikeNode`.
 */
export function isLoopStatement(node: unknown): boolean {
    return (
        isForStatementNode(node) ||
        isWhileStatementNode(node) ||
        isDoUntilStatementNode(node) ||
        isRepeatStatementNode(node)
    );
}

/**
 * Determine whether `node` is an unconditional control-flow exit statement.
 *
 * Returns `true` for `ReturnStatement`, `BreakStatement`, `ContinueStatement`,
 * `ExitStatement`, and `ThrowStatement`.
 */
export function isControlFlowExitStatement(node: unknown): boolean {
    return (
        isReturnStatementNode(node) ||
        isBreakStatementNode(node) ||
        isContinueStatementNode(node) ||
        isExitStatementNode(node) ||
        isThrowStatementNode(node)
    );
}
