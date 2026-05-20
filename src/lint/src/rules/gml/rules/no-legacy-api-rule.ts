import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { gmlRuleDeprecatedIdentifierServices } from "../gml-rule-services.js";
import { createMeta, isAstNodeWithType, walkAstNodesWithParent } from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

const { getDeprecatedIdentifierCatalogEntry } = gmlRuleDeprecatedIdentifierServices;

type AstNodeWithType = Readonly<{ type: string }>;
type DeprecatedCatalogEntry = NonNullable<ReturnType<typeof getDeprecatedIdentifierCatalogEntry>>;
type DeclaredIdentifierScope = Readonly<{
    start: number;
    end: number;
    names: ReadonlySet<string>;
}>;

function isRuleOwnedCatalogEntry(
    entry: ReturnType<typeof getDeprecatedIdentifierCatalogEntry>
): entry is DeprecatedCatalogEntry {
    return entry !== null && (entry.diagnosticOwner !== "feather" || entry.replacementKind === "direct-rename");
}

function canFixCatalogEntry(entry: DeprecatedCatalogEntry): boolean {
    return entry.replacementKind === "direct-rename" && entry.replacement !== null;
}

function readDeclaredPatternNames(node: unknown): ReadonlyArray<string> {
    const identifierName = Core.getIdentifierName(node);
    if (identifierName) {
        return [identifierName.toLowerCase()];
    }

    if (!isAstNodeWithType(node) || node.type !== "AssignmentPattern") {
        return [];
    }

    return readDeclaredPatternNames((node as Readonly<{ left?: unknown }>).left);
}

function collectScopedDeclaredIdentifiers(
    programNode: unknown,
    sourceTextLength: number
): ReadonlyArray<DeclaredIdentifierScope> {
    const scopes: Array<{ start: number; end: number; names: Set<string> }> = [
        {
            start: 0,
            end: sourceTextLength,
            names: new Set<string>()
        }
    ];

    const visitScope = (
        node: unknown,
        activeScope: { start: number; end: number; names: Set<string> },
        parent: AstNodeWithType | null
    ): void => {
        if (Array.isArray(node)) {
            for (const entry of node) {
                visitScope(entry, activeScope, parent);
            }
            return;
        }

        if (!isAstNodeWithType(node)) {
            return;
        }

        if (node.type === "VariableDeclarator") {
            for (const declaredName of readDeclaredPatternNames((node as Readonly<{ id?: unknown }>).id)) {
                activeScope.names.add(declaredName);
            }

            visitScope((node as Readonly<{ init?: unknown }>).init, activeScope, node);
            return;
        }

        if (node.type === "EnumDeclaration") {
            const enumName = Core.getIdentifierName((node as Readonly<{ name?: unknown }>).name);
            if (enumName) {
                activeScope.names.add(enumName.toLowerCase());
            }
        }

        if (Core.isFunctionLikeDeclaration(node)) {
            const functionName = (node as Readonly<{ id?: unknown }>).id;
            if (
                typeof functionName === "string" &&
                functionName.length > 0 &&
                parent?.type !== "VariableDeclarator" &&
                parent?.type !== "AssignmentExpression" &&
                parent?.type !== "Property"
            ) {
                activeScope.names.add(functionName.toLowerCase());
            }

            const nestedScope = {
                start: Core.getNodeStartIndex(node) ?? activeScope.start,
                end: Core.getNodeEndIndex(node) ?? activeScope.end,
                names: new Set<string>()
            };
            scopes.push(nestedScope);

            for (const parameter of (node as Readonly<{ params?: ReadonlyArray<unknown> }>).params ?? []) {
                for (const declaredName of readDeclaredPatternNames(parameter)) {
                    nestedScope.names.add(declaredName);
                }
            }

            visitScope((node as Readonly<{ body?: unknown }>).body, nestedScope, node);
            return;
        }

        Core.forEachNodeChild(node, (child) => visitScope(child, activeScope, node));
    };

    visitScope(programNode, scopes[0], null);

    return scopes.map((scope) =>
        Object.freeze({
            start: scope.start,
            end: scope.end,
            names: scope.names
        })
    );
}

function findInnermostDeclaredIdentifierScope(
    scopes: ReadonlyArray<DeclaredIdentifierScope>,
    offset: number
): DeclaredIdentifierScope | null {
    let matchedScope: DeclaredIdentifierScope | null = null;
    for (const scope of scopes) {
        if (offset < scope.start || offset >= scope.end) {
            continue;
        }

        if (matchedScope === null || (scope.start >= matchedScope.start && scope.end <= matchedScope.end)) {
            matchedScope = scope;
        }
    }

    return matchedScope;
}

function isIdentifierShadowedByLocalScope(
    scopes: ReadonlyArray<DeclaredIdentifierScope>,
    identifierName: string,
    node: unknown
): boolean {
    const start = Core.getNodeStartIndex(node);
    if (typeof start !== "number") {
        return false;
    }

    const containingScope = findInnermostDeclaredIdentifierScope(scopes, start);
    return containingScope?.names.has(identifierName.toLowerCase()) ?? false;
}

function isBareIdentifierDeclarationContext(parent: AstNodeWithType | null, parentKey: string | null): boolean {
    if (!parent || !parentKey) {
        return false;
    }

    if (parentKey === "params") {
        return true;
    }

    switch (parent.type) {
        case "CallExpression": {
            return parentKey === "object";
        }
        case "MemberDotExpression": {
            return parentKey === "property";
        }
        case "MemberIndexExpression": {
            return parentKey === "object" || parentKey === "property";
        }
        case "VariableDeclarator":
        case "FunctionDeclaration":
        case "ConstructorDeclaration":
        case "ConstructorParentClause":
        case "EnumDeclaration": {
            return parentKey === "id" || parentKey === "name";
        }
        default: {
            return false;
        }
    }
}

function buildReplacementSuffix(entry: DeprecatedCatalogEntry): string {
    return canFixCatalogEntry(entry) ? `; use '${entry.replacement}' instead` : "";
}

function reportIdentifierRange(
    context: Rule.RuleContext,
    definition: GmlRuleDefinition,
    node: unknown,
    identifierName: string,
    entry: DeprecatedCatalogEntry
): void {
    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
    if (typeof start !== "number" || typeof end !== "number") {
        return;
    }

    context.report({
        node: node as Rule.Node,
        messageId: definition.messageId,
        data: {
            identifier: identifierName,
            replacementSuffix: buildReplacementSuffix(entry)
        },
        fix: canFixCatalogEntry(entry) ? (fixer) => fixer.replaceTextRange([start, end], entry.replacement) : undefined
    });
}

export function createNoLegacyApiRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Legacy built-in '{{identifier}}' is deprecated{{replacementSuffix}}."
        }),
        create(context) {
            return Object.freeze({
                Program(programNode) {
                    const declaredIdentifierScopes = collectScopedDeclaredIdentifiers(
                        programNode,
                        context.sourceCode.text.length
                    );

                    walkAstNodesWithParent(programNode, ({ node, parent, parentKey }) => {
                        if (!isAstNodeWithType(node)) {
                            return;
                        }

                        if (node.type === "CallExpression") {
                            const callee = Core.getCallExpressionIdentifier(node);
                            const identifierName = callee?.name;
                            if (typeof identifierName !== "string") {
                                return;
                            }
                            if (isIdentifierShadowedByLocalScope(declaredIdentifierScopes, identifierName, callee)) {
                                return;
                            }

                            const entry = getDeprecatedIdentifierCatalogEntry(identifierName);
                            if (
                                !isRuleOwnedCatalogEntry(entry) ||
                                (entry.legacyUsage !== "call" && entry.legacyUsage !== "call-or-identifier")
                            ) {
                                return;
                            }

                            reportIdentifierRange(context, definition, callee, identifierName, entry);
                            return;
                        }

                        if (node.type === "MemberIndexExpression") {
                            const objectNode = (node as Readonly<{ object?: unknown }>).object;
                            const identifierName = Core.getIdentifierName(objectNode);
                            if (typeof identifierName !== "string") {
                                return;
                            }
                            if (
                                isIdentifierShadowedByLocalScope(declaredIdentifierScopes, identifierName, objectNode)
                            ) {
                                return;
                            }

                            const entry = getDeprecatedIdentifierCatalogEntry(identifierName);
                            if (!isRuleOwnedCatalogEntry(entry) || entry.legacyUsage !== "indexed-identifier") {
                                return;
                            }

                            reportIdentifierRange(context, definition, objectNode, identifierName, entry);
                            return;
                        }

                        if (node.type !== "Identifier") {
                            return;
                        }

                        if (isBareIdentifierDeclarationContext(parent, parentKey)) {
                            return;
                        }

                        const identifierName = Core.getIdentifierName(node);
                        if (!identifierName) {
                            return;
                        }
                        if (isIdentifierShadowedByLocalScope(declaredIdentifierScopes, identifierName, node)) {
                            return;
                        }

                        const entry = getDeprecatedIdentifierCatalogEntry(identifierName);
                        if (!isRuleOwnedCatalogEntry(entry) || entry.legacyUsage !== "identifier") {
                            return;
                        }

                        reportIdentifierRange(context, definition, node, identifierName, entry);
                    });
                }
            });
        }
    });
}
