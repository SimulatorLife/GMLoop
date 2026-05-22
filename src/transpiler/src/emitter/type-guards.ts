/**
 * Type guard library for the transpiler's GML AST nodes.
 *
 * These guards check the `.type` discriminant field present on all GML nodes.
 * They accept `unknown` and return TypeScript predicates that narrow the type
 * safely, enabling callers to substitute any object that satisfies the `BaseNode`
 * interface in place of a canonical AST node — which improves substitution
 * safety when swapping collaborators (e.g. test doubles, mock parsers) that
 * produce structurally-equivalent but non-native instances.
 *
 * All guards delegate to {@link hasNodeType}, which bundles the null-check and
 * string-type check into a single operation so callers avoid repeating those
 * guards.  The implementation mirrors the pattern used in `@gmloop/core`'s
 * `type-guards.ts`, establishing a consistent contract across workspaces.
 *
 * Usage pattern:
 * ```ts
 * // Before (tight coupling to native instanceof-like check):
 * if (node.type === "BlockStatement") { ... }
 *
 * // After (contract-driven dispatch via capability probe):
 * if (isBlockStatementNode(node)) { ... }
 * ```
 */

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

/**
 * Minimal shape check for any object-valued AST child.
 *
 * Used by internal tree-walkers that need to traverse children without
 * depending on a specific node type.  Callers that already hold a
 * `GmlNode` should use the typed guards (`isBlockStatementNode`, etc.)
 * instead of this helper.
 *
 * This guard is intentionally kept **local** to this file because it
 * returns a broad structural predicate (`non-null object`) rather than
 * a typed narrowing predicate.  Exposing it would encourage loose typing
 * at call sites that could otherwise use the typed guards.
 *
 * @param candidate - Value to test.
 * @returns `true` when `candidate` is a non-null object.
 */
export function isAstRecord(candidate: unknown): candidate is Record<string, unknown> {
    return candidate !== null && typeof candidate === "object";
}

/**
 * Core predicate shared by all node-type guards.
 *
 * Checks that `candidate` is a non-null object with a string-valued `type`
 * field matching `expectedType`.  This is the contract that any collaborator
 * must satisfy to be treated as a valid GML node substitute.
 *
 * @param candidate - Value to test.
 * @param expectedType - Node type string to match.
 * @returns `true` when the contract is satisfied.
 */
function hasNodeType<T extends string>(
    candidate: unknown,
    expectedType: T
): candidate is { type: T } & Record<string, unknown> {
    return (
        candidate !== null && typeof candidate === "object" && (candidate as { type?: unknown }).type === expectedType
    );
}

/* ─── Program & Block ────────────────────────────────────────────────────── */

export function isProgramNode(candidate: unknown): candidate is ProgramNode {
    return hasNodeType(candidate, "Program");
}

export function isBlockStatementNode(candidate: unknown): candidate is BlockStatementNode {
    return hasNodeType(candidate, "BlockStatement");
}

/* ─── Literals & Identifiers ─────────────────────────────────────────────── */

export function isIdentifierNode(candidate: unknown): candidate is IdentifierNode {
    return hasNodeType(candidate, "Identifier");
}

export function isLiteralNode(candidate: unknown): candidate is LiteralNode {
    return hasNodeType(candidate, "Literal");
}

/* ─── Expressions ─────────────────────────────────────────────────────────── */

export function isBinaryExpressionNode(candidate: unknown): candidate is BinaryExpressionNode {
    return hasNodeType(candidate, "BinaryExpression");
}

export function isUnaryExpressionNode(candidate: unknown): candidate is UnaryExpressionNode {
    return hasNodeType(candidate, "UnaryExpression");
}

export function isAssignmentExpressionNode(candidate: unknown): candidate is AssignmentExpressionNode {
    return hasNodeType(candidate, "AssignmentExpression");
}

export function isTernaryExpressionNode(candidate: unknown): candidate is TernaryExpressionNode {
    return hasNodeType(candidate, "TernaryExpression");
}

export function isCallExpressionNode(candidate: unknown): candidate is CallExpressionNode {
    return hasNodeType(candidate, "CallExpression");
}

export function isMemberDotExpressionNode(candidate: unknown): candidate is MemberDotExpressionNode {
    return hasNodeType(candidate, "MemberDotExpression");
}

export function isMemberIndexExpressionNode(candidate: unknown): candidate is MemberIndexExpressionNode {
    return hasNodeType(candidate, "MemberIndexExpression");
}

export function isNewExpressionNode(candidate: unknown): candidate is NewExpressionNode {
    return hasNodeType(candidate, "NewExpression");
}

export function isArrayExpressionNode(candidate: unknown): candidate is ArrayExpressionNode {
    return hasNodeType(candidate, "ArrayExpression");
}

export function isStructExpressionNode(candidate: unknown): candidate is StructExpressionNode {
    return hasNodeType(candidate, "StructExpression");
}

export function isParenthesizedExpressionNode(candidate: unknown): candidate is ParenthesizedExpressionNode {
    return hasNodeType(candidate, "ParenthesizedExpression");
}

export function isTemplateStringExpressionNode(candidate: unknown): candidate is TemplateStringExpressionNode {
    return hasNodeType(candidate, "TemplateStringExpression");
}

export function isTemplateStringTextNode(candidate: unknown): candidate is TemplateStringTextNode {
    return hasNodeType(candidate, "TemplateStringText");
}

export function isDefaultParameterNode(candidate: unknown): candidate is DefaultParameterNode {
    return hasNodeType(candidate, "DefaultParameter");
}

export function isMissingOptionalArgumentNode(candidate: unknown): candidate is MissingOptionalArgumentNode {
    return hasNodeType(candidate, "MissingOptionalArgument");
}

/* ─── Statements ──────────────────────────────────────────────────────────── */

export function isExpressionStatementNode(candidate: unknown): candidate is ExpressionStatementNode {
    return hasNodeType(candidate, "ExpressionStatement");
}

export function isIdentifierStatementNode(candidate: unknown): candidate is IdentifierStatementNode {
    return hasNodeType(candidate, "IdentifierStatement");
}

export function isIfStatementNode(candidate: unknown): candidate is IfStatementNode {
    return hasNodeType(candidate, "IfStatement");
}

export function isForStatementNode(candidate: unknown): candidate is ForStatementNode {
    return hasNodeType(candidate, "ForStatement");
}

export function isWhileStatementNode(candidate: unknown): candidate is WhileStatementNode {
    return hasNodeType(candidate, "WhileStatement");
}

export function isDoUntilStatementNode(candidate: unknown): candidate is DoUntilStatementNode {
    return hasNodeType(candidate, "DoUntilStatement");
}

export function isRepeatStatementNode(candidate: unknown): candidate is RepeatStatementNode {
    return hasNodeType(candidate, "RepeatStatement");
}

export function isWithStatementNode(candidate: unknown): candidate is WithStatementNode {
    return hasNodeType(candidate, "WithStatement");
}

export function isSwitchStatementNode(candidate: unknown): candidate is SwitchStatementNode {
    return hasNodeType(candidate, "SwitchStatement");
}

export function isReturnStatementNode(candidate: unknown): candidate is ReturnStatementNode {
    return hasNodeType(candidate, "ReturnStatement");
}

export function isThrowStatementNode(candidate: unknown): candidate is ThrowStatementNode {
    return hasNodeType(candidate, "ThrowStatement");
}

export function isTryStatementNode(candidate: unknown): candidate is TryStatementNode {
    return hasNodeType(candidate, "TryStatement");
}

export function isBreakStatementNode(candidate: unknown): candidate is BreakStatementNode {
    return hasNodeType(candidate, "BreakStatement");
}

export function isContinueStatementNode(candidate: unknown): candidate is ContinueStatementNode {
    return hasNodeType(candidate, "ContinueStatement");
}

export function isExitStatementNode(candidate: unknown): candidate is ExitStatementNode {
    return hasNodeType(candidate, "ExitStatement");
}

export function isDeleteStatementNode(candidate: unknown): candidate is DeleteStatementNode {
    return hasNodeType(candidate, "DeleteStatement");
}

/* ─── Declarations ────────────────────────────────────────────────────────── */

export function isVariableDeclarationNode(candidate: unknown): candidate is VariableDeclarationNode {
    return hasNodeType(candidate, "VariableDeclaration");
}

export function isVariableDeclaratorNode(candidate: unknown): candidate is VariableDeclaratorNode {
    return hasNodeType(candidate, "VariableDeclarator");
}

export function isGlobalVarStatementNode(candidate: unknown): candidate is GlobalVarStatementNode {
    return hasNodeType(candidate, "GlobalVarStatement");
}

export function isFunctionDeclarationNode(candidate: unknown): candidate is FunctionDeclarationNode {
    return hasNodeType(candidate, "FunctionDeclaration");
}

export function isConstructorDeclarationNode(candidate: unknown): candidate is ConstructorDeclarationNode {
    return hasNodeType(candidate, "ConstructorDeclaration");
}

export function isConstructorParentClauseNode(candidate: unknown): candidate is ConstructorParentClauseNode {
    return hasNodeType(candidate, "ConstructorParentClause");
}

export function isEnumDeclarationNode(candidate: unknown): candidate is EnumDeclarationNode {
    return hasNodeType(candidate, "EnumDeclaration");
}

export function isMacroDeclarationNode(candidate: unknown): candidate is MacroDeclarationNode {
    return hasNodeType(candidate, "MacroDeclaration");
}

/* ─── Exception handling ──────────────────────────────────────────────────── */

export function isCatchClauseNode(candidate: unknown): candidate is CatchClauseNode {
    return hasNodeType(candidate, "CatchClause");
}

export function isFinallyClauseNode(candidate: unknown): candidate is FinallyClauseNode {
    return hasNodeType(candidate, "FinallyClause");
}

/* ─── Compound helpers ────────────────────────────────────────────────────── */

/**
 * Determine whether `candidate` is a function-scope boundary node.
 *
 * In GML, function bodies form an implicit scope boundary: variables declared
 * inside a `FunctionDeclaration` or `ConstructorDeclaration` do not leak into
 * the outer scope.  This helper lets callers test for either node type in a
 * single call, centralising the boundary definition.
 *
 * @param candidate - Candidate node to inspect.
 * @returns `true` when `candidate` is a function or constructor declaration.
 */
export function isFunctionScopeBoundary(candidate: unknown): boolean {
    return isFunctionDeclarationNode(candidate) || isConstructorDeclarationNode(candidate);
}

/**
 * Determine whether `node` represents any flavour of loop statement.
 *
 * Covers `ForStatement`, `WhileStatement`, `DoUntilStatement`, and
 * `RepeatStatement`.  This is a convenience wrapper around the individual
 * guards; callers that need to distinguish individual loop types should use
 * those guards directly.
 *
 * Note: `WithStatement` is intentionally excluded because, although it
 * iterates over object instances in GML, its scope-change semantics differ
 * from pure loops.  Callers that need `WithStatement` should add their own
 * `isWithStatementNode` check on top of this guard.
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
 * `ExitStatement`, and `ThrowStatement` — the five statement types that
 * prevent subsequent statements in the same block from executing.
 *
 * @param node - Candidate node to inspect.
 * @returns `true` when the node is a control-flow exit.
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
