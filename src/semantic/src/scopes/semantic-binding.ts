import { Core, type GameMakerAstNode, type MutableGameMakerAstNode } from "@gmloop/core";

import { SCOPE_OVERRIDE_KEYWORD } from "./scope-override-keywords.js";
import { ScopeTracker } from "./scope-tracker.js";
import type { ScopeRole } from "./types.js";

type BindableAstNode = MutableGameMakerAstNode & { type: string };
type BindableIdentifierNode = BindableAstNode & { name: string; type: "Identifier" };

const VARIABLE_DECLARATION_ROLE: ScopeRole = Object.freeze({ kind: "variable", type: "declaration" });
const PARAMETER_DECLARATION_ROLE: ScopeRole = Object.freeze({ kind: "parameter", type: "declaration" });
const STRUCT_DECLARATION_ROLE: ScopeRole = Object.freeze({ kind: "struct", type: "declaration" });
const ENUM_DECLARATION_ROLE: ScopeRole = Object.freeze({ kind: "enum", type: "declaration" });
const ENUM_MEMBER_DECLARATION_ROLE: ScopeRole = Object.freeze({ kind: "enum-member", type: "declaration" });
const PROPERTY_REFERENCE_ROLE: ScopeRole = Object.freeze({ kind: "property", type: "reference" });
const TYPE_REFERENCE_ROLE: ScopeRole = Object.freeze({ kind: "type", type: "reference" });
const GLOBAL_VARIABLE_DECLARATION_ROLE: ScopeRole = Object.freeze({
    kind: "variable",
    scopeOverride: SCOPE_OVERRIDE_KEYWORD,
    tags: ["global"],
    type: "declaration"
});
const GLOBAL_VARIABLE_REFERENCE_ROLE: ScopeRole = Object.freeze({
    kind: "variable",
    scopeOverride: SCOPE_OVERRIDE_KEYWORD,
    tags: ["global"],
    type: "reference"
});
const GLOBAL_MACRO_DECLARATION_ROLE: ScopeRole = Object.freeze({
    kind: "macro",
    scopeOverride: SCOPE_OVERRIDE_KEYWORD,
    tags: ["global"],
    type: "declaration"
});

function readBindableNode(value: unknown): BindableAstNode | null {
    if (!Core.isObjectLike(value) || typeof (value as { type?: unknown }).type !== "string") {
        return null;
    }
    return value as BindableAstNode;
}

function readBindableNodes(value: unknown): BindableAstNode[] {
    if (!Array.isArray(value)) {
        const node = readBindableNode(value);
        return node === null ? [] : [node];
    }

    return value.flatMap((entry) => {
        const node = readBindableNode(entry);
        return node === null ? [] : [node];
    });
}

function readIdentifier(value: unknown): BindableIdentifierNode | null {
    if (!Core.isIdentifierNode(value)) {
        return null;
    }
    return value as BindableIdentifierNode;
}

function clearIdentifierBinding(identifier: BindableIdentifierNode): void {
    delete identifier.classifications;
    delete identifier.declaration;
    delete identifier.isGlobalIdentifier;
    delete identifier.scopeId;
}

function bindIdentifier(
    coordinator: ScopeTracker,
    candidate: unknown,
    role: ScopeRole | null = null,
    options: Readonly<{ applyRegisteredGlobal: boolean; markGlobal: boolean }> = {
        applyRegisteredGlobal: true,
        markGlobal: false
    }
): void {
    const identifier = readIdentifier(candidate);
    if (identifier === null) {
        return;
    }

    clearIdentifierBinding(identifier);
    if (options.applyRegisteredGlobal) {
        coordinator.applyGlobalIdentifiersToNode(identifier);
    }
    coordinator.withRole(role, () => coordinator.applyCurrentRoleToIdentifier(identifier.name, identifier));
    if (options.markGlobal) {
        coordinator.markGlobalIdentifier(identifier);
    }
}

function bindDefaultChildren(coordinator: ScopeTracker, node: BindableAstNode): void {
    Core.forEachAstChild(node, (child) => bindNode(coordinator, child as BindableAstNode));
}

function bindVariableDeclarator(coordinator: ScopeTracker, declarator: BindableAstNode): void {
    const initializer = readBindableNode(declarator.init);
    if (initializer !== null) {
        bindNode(coordinator, initializer);
    }
    bindIdentifier(coordinator, declarator.id, VARIABLE_DECLARATION_ROLE);
}

function bindVariableDeclaration(coordinator: ScopeTracker, declaration: BindableAstNode): void {
    for (const declarator of readBindableNodes(declaration.declarations)) {
        bindVariableDeclarator(coordinator, declarator);
    }
}

function bindGlobalVariableStatement(coordinator: ScopeTracker, statement: BindableAstNode): void {
    for (const declarator of readBindableNodes(statement.declarations)) {
        const initializer = readBindableNode(declarator.init);
        if (initializer !== null) {
            bindNode(coordinator, initializer);
        }
        bindIdentifier(coordinator, declarator.id, GLOBAL_VARIABLE_DECLARATION_ROLE, {
            applyRegisteredGlobal: true,
            markGlobal: true
        });
    }
}

function bindParameter(coordinator: ScopeTracker, parameter: BindableAstNode): void {
    if (parameter.type === "DefaultParameter") {
        bindIdentifier(coordinator, parameter.left, PARAMETER_DECLARATION_ROLE);
        const defaultValue = readBindableNode(parameter.right);
        if (defaultValue !== null) {
            bindNode(coordinator, defaultValue);
        }
        return;
    }

    bindIdentifier(coordinator, parameter, PARAMETER_DECLARATION_ROLE);
}

function bindFunctionLikeDeclaration(coordinator: ScopeTracker, declaration: BindableAstNode): void {
    bindIdentifier(coordinator, declaration.idLocation);
    coordinator.withScope("function", () => {
        for (const parameter of readBindableNodes(declaration.params)) {
            bindParameter(coordinator, parameter);
        }
        const body = readBindableNode(declaration.body);
        if (body !== null) {
            bindNode(coordinator, body);
        }
    });

    const parentClause = readBindableNode(declaration.parent);
    if (parentClause !== null) {
        bindNode(coordinator, parentClause);
    }
}

function bindStructDeclaration(coordinator: ScopeTracker, declaration: BindableAstNode): void {
    bindIdentifier(coordinator, declaration.id, STRUCT_DECLARATION_ROLE);
    coordinator.withScope("struct", () => {
        for (const parameter of readBindableNodes(declaration.params)) {
            bindParameter(coordinator, parameter);
        }
        const body = readBindableNode(declaration.body);
        if (body !== null) {
            bindNode(coordinator, body);
        }
    });

    const parentClause = readBindableNode(declaration.parent);
    if (parentClause !== null) {
        bindNode(coordinator, parentClause);
    }
}

function bindWithStatement(coordinator: ScopeTracker, statement: BindableAstNode): void {
    const receiver = readBindableNode(statement.test);
    if (receiver !== null) {
        bindNode(coordinator, receiver);
    }
    coordinator.withScope("with", () => {
        const body = readBindableNode(statement.body);
        if (body !== null) {
            bindNode(coordinator, body);
        }
    });
}

function bindCatchClause(coordinator: ScopeTracker, clause: BindableAstNode): void {
    coordinator.withScope("catch", () => {
        bindIdentifier(coordinator, clause.param, PARAMETER_DECLARATION_ROLE);
        const body = readBindableNode(clause.body);
        if (body !== null) {
            bindNode(coordinator, body);
        }
    });
}

function bindMemberDotExpression(coordinator: ScopeTracker, expression: BindableAstNode): void {
    const receiver = readBindableNode(expression.object);
    if (receiver !== null) {
        bindNode(coordinator, receiver);
    }

    const isGlobalReceiver = readIdentifier(receiver)?.name === SCOPE_OVERRIDE_KEYWORD;
    bindIdentifier(
        coordinator,
        expression.property,
        isGlobalReceiver ? GLOBAL_VARIABLE_REFERENCE_ROLE : PROPERTY_REFERENCE_ROLE,
        {
            applyRegisteredGlobal: false,
            markGlobal: isGlobalReceiver
        }
    );
}

function bindEnumMember(coordinator: ScopeTracker, member: BindableAstNode): void {
    const initializer = readBindableNode(member.initializer);
    if (initializer !== null) {
        bindNode(coordinator, initializer);
    }
    bindIdentifier(coordinator, member.name, ENUM_MEMBER_DECLARATION_ROLE);
}

function bindEnumDeclaration(coordinator: ScopeTracker, declaration: BindableAstNode): void {
    bindIdentifier(coordinator, declaration.name, ENUM_DECLARATION_ROLE);
    for (const member of readBindableNodes(declaration.members)) {
        bindEnumMember(coordinator, member);
    }
}

function bindNode(coordinator: ScopeTracker, node: BindableAstNode): void {
    switch (node.type) {
        case "Program": {
            coordinator.withScope("program", () => bindDefaultChildren(coordinator, node));
            return;
        }
        case "FunctionDeclaration":
        case "ConstructorDeclaration": {
            bindFunctionLikeDeclaration(coordinator, node);
            return;
        }
        case "StructDeclaration": {
            bindStructDeclaration(coordinator, node);
            return;
        }
        case "WithStatement": {
            bindWithStatement(coordinator, node);
            return;
        }
        case "CatchClause": {
            bindCatchClause(coordinator, node);
            return;
        }
        case "VariableDeclaration": {
            bindVariableDeclaration(coordinator, node);
            return;
        }
        case "VariableDeclarator": {
            bindVariableDeclarator(coordinator, node);
            return;
        }
        case "GlobalVarStatement": {
            bindGlobalVariableStatement(coordinator, node);
            return;
        }
        case "DefaultParameter": {
            bindParameter(coordinator, node);
            return;
        }
        case "MemberDotExpression": {
            bindMemberDotExpression(coordinator, node);
            return;
        }
        case "NewExpression": {
            bindIdentifier(coordinator, node.expression, TYPE_REFERENCE_ROLE);
            for (const argument of readBindableNodes(node.arguments)) {
                bindNode(coordinator, argument);
            }
            return;
        }
        case "InheritanceClause": {
            bindIdentifier(coordinator, node.id, TYPE_REFERENCE_ROLE);
            for (const argument of readBindableNodes(node.arguments)) {
                bindNode(coordinator, argument);
            }
            return;
        }
        case "EnumDeclaration": {
            bindEnumDeclaration(coordinator, node);
            return;
        }
        case "EnumMember": {
            bindEnumMember(coordinator, node);
            return;
        }
        case "MacroDeclaration": {
            bindIdentifier(coordinator, node.name, GLOBAL_MACRO_DECLARATION_ROLE);
            return;
        }
        case "Identifier": {
            bindIdentifier(coordinator, node);
            return;
        }
        default: {
            bindDefaultChildren(coordinator, node);
        }
    }
}

/**
 * Annotate a parser-owned GML AST with semantic scope, role, and declaration bindings.
 *
 * The pass mutates identifier nodes in place so downstream semantic indexing can
 * consume the original syntax tree without a second parallel representation.
 * Parser output remains syntax-only until this function is called.
 *
 * @param ast Parser-produced GML AST to annotate.
 */
export function annotateSemanticBindings(ast: GameMakerAstNode): void {
    const root = readBindableNode(ast);
    if (root === null) {
        return;
    }

    bindNode(new ScopeTracker(), root);
}
