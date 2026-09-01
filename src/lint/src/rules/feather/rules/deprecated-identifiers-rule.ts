import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { gmlRuleBaseHelpersServices, gmlRuleDeprecatedIdentifierServices } from "../../gml/gml-rule-services.js";
import { createFeatherRuleMeta } from "../feather-rule-helpers.js";
import type { FeatherManifestEntry } from "../manifest.js";

const { getDeprecatedIdentifierCatalogEntry } = gmlRuleDeprecatedIdentifierServices;
const { walkAstNodesWithParent } = gmlRuleBaseHelpersServices;

type AstNodeWithType = Readonly<{ type: string }>;
type DeprecatedCatalogEntry = NonNullable<ReturnType<typeof getDeprecatedIdentifierCatalogEntry>>;
type DeprecatedIdentifierRuleKind = "constant" | "function" | "variable";
type DeclaredIdentifierScope = Readonly<{
    start: number;
    end: number;
    names: ReadonlySet<string>;
}>;

function isRuleOwnedCatalogEntry(
    entry: ReturnType<typeof getDeprecatedIdentifierCatalogEntry>,
    ruleKind: DeprecatedIdentifierRuleKind
): entry is DeprecatedCatalogEntry {
    if (entry === null) {
        return false;
    }

    if (ruleKind === "function") {
        return entry.legacyUsage === "call" || entry.legacyUsage === "call-or-identifier";
    }

    if (ruleKind === "constant") {
        return entry.type === "literal" && entry.legacyUsage === "identifier";
    }

    return (
        entry.type === "variable" && (entry.legacyUsage === "identifier" || entry.legacyUsage === "indexed-identifier")
    );
}

function canFixCatalogEntry(entry: DeprecatedCatalogEntry): boolean {
    return entry.replacementKind === "direct-rename" && entry.replacement !== null;
}

function readDeclaredPatternNames(node: unknown): ReadonlyArray<string> {
    const identifierName = Core.getIdentifierName(node);
    if (identifierName) {
        return [identifierName.toLowerCase()];
    }

    if (!node || typeof node !== "object" || Reflect.get(node, "type") !== "AssignmentPattern") {
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

        if (!node || typeof node !== "object" || typeof Reflect.get(node, "type") !== "string") {
            return;
        }
        const typedNode = node as AstNodeWithType;

        if (typedNode.type === "VariableDeclarator") {
            for (const declaredName of readDeclaredPatternNames((typedNode as Readonly<{ id?: unknown }>).id)) {
                activeScope.names.add(declaredName);
            }

            visitScope((typedNode as Readonly<{ init?: unknown }>).init, activeScope, typedNode);
            return;
        }

        if (typedNode.type === "EnumDeclaration") {
            const enumName = Core.getIdentifierName((typedNode as Readonly<{ name?: unknown }>).name);
            if (enumName) {
                activeScope.names.add(enumName.toLowerCase());
            }
        }

        if (Core.isFunctionLikeDeclaration(typedNode)) {
            const functionName = (typedNode as Readonly<{ id?: unknown }>).id;
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

            visitScope((typedNode as Readonly<{ body?: unknown }>).body, nestedScope, typedNode);
            return;
        }

        Core.forEachNodeChild(typedNode, (child) => visitScope(child, activeScope, typedNode));
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
        messageId: "diagnostic",
        data: {
            identifier: identifierName,
            replacementSuffix: buildReplacementSuffix(entry)
        },
        fix: canFixCatalogEntry(entry) ? (fixer) => fixer.replaceTextRange([start, end], entry.replacement) : undefined
    });
}

function collectDeprecatedUserFunctionReplacements(sourceText: string): ReadonlyMap<string, string> {
    const replacements = new Map<string, string>();
    for (const match of sourceText.matchAll(
        /\/\/\/\s*@deprecated\s+Use\s+([A-Za-z_][A-Za-z0-9_]*)\s+instead\.[^\n]*\n\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
    )) {
        replacements.set(match[2], match[1]);
    }
    return replacements;
}

function createAvailableScoreReplacementName(sourceText: string): string {
    const identifierNames = new Set(
        [...sourceText.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)].map((match) => match[0].toLowerCase())
    );
    let candidate = "__feather_score";
    let suffix = 2;
    while (identifierNames.has(candidate.toLowerCase())) {
        candidate = `__feather_score_${suffix}`;
        suffix += 1;
    }
    return candidate;
}

function reportDirectIdentifierReplacement(
    context: Rule.RuleContext,
    node: unknown,
    identifierName: string,
    replacement: string
): void {
    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
    if (typeof start !== "number" || typeof end !== "number") {
        return;
    }

    context.report({
        node: node as Rule.Node,
        messageId: "diagnostic",
        data: {
            identifier: identifierName,
            replacementSuffix: `; use '${replacement}' instead`
        },
        fix: (fixer) => fixer.replaceTextRange([start, end], replacement)
    });
}

function createDeprecatedIdentifierRule(
    entry: FeatherManifestEntry,
    ruleKind: DeprecatedIdentifierRuleKind
): Rule.RuleModule {
    return Object.freeze({
        meta: createFeatherRuleMeta(entry),
        create(context) {
            return Object.freeze({
                Program(programNode) {
                    const sourceText = context.sourceCode.text;
                    const declaredIdentifierScopes = collectScopedDeclaredIdentifiers(programNode, sourceText.length);
                    const userFunctionReplacements =
                        ruleKind === "function" ? collectDeprecatedUserFunctionReplacements(sourceText) : new Map();
                    const scoreReplacement =
                        ruleKind === "variable" ? createAvailableScoreReplacementName(sourceText) : "";

                    walkAstNodesWithParent(programNode, ({ node, parent, parentKey }) => {
                        if (!node || typeof node !== "object" || typeof Reflect.get(node, "type") !== "string") {
                            return;
                        }
                        const typedNode = node as AstNodeWithType;

                        if (typedNode.type === "CallExpression") {
                            const callee = Core.getCallExpressionIdentifier(typedNode);
                            const identifierName = callee?.name;
                            if (typeof identifierName !== "string") {
                                return;
                            }

                            const userFunctionReplacement = userFunctionReplacements.get(identifierName);
                            if (userFunctionReplacement) {
                                reportDirectIdentifierReplacement(
                                    context,
                                    callee,
                                    identifierName,
                                    userFunctionReplacement
                                );
                                return;
                            }

                            if (isIdentifierShadowedByLocalScope(declaredIdentifierScopes, identifierName, callee)) {
                                return;
                            }

                            const catalogEntry = getDeprecatedIdentifierCatalogEntry(identifierName);
                            if (!isRuleOwnedCatalogEntry(catalogEntry, ruleKind) || ruleKind !== "function") {
                                return;
                            }

                            reportIdentifierRange(context, callee, identifierName, catalogEntry);
                            return;
                        }

                        if (typedNode.type === "MemberIndexExpression") {
                            const objectNode = (typedNode as Readonly<{ object?: unknown }>).object;
                            const identifierName = Core.getIdentifierName(objectNode);
                            if (typeof identifierName !== "string") {
                                return;
                            }
                            if (
                                isIdentifierShadowedByLocalScope(declaredIdentifierScopes, identifierName, objectNode)
                            ) {
                                return;
                            }

                            const catalogEntry = getDeprecatedIdentifierCatalogEntry(identifierName);
                            if (
                                !isRuleOwnedCatalogEntry(catalogEntry, ruleKind) ||
                                ruleKind !== "variable" ||
                                catalogEntry.legacyUsage !== "indexed-identifier"
                            ) {
                                return;
                            }

                            reportIdentifierRange(context, objectNode, identifierName, catalogEntry);
                            return;
                        }

                        if (typedNode.type !== "Identifier") {
                            return;
                        }

                        if (isBareIdentifierDeclarationContext(parent, parentKey)) {
                            return;
                        }

                        const identifierName = Core.getIdentifierName(typedNode);
                        if (!identifierName) {
                            return;
                        }
                        if (isIdentifierShadowedByLocalScope(declaredIdentifierScopes, identifierName, typedNode)) {
                            return;
                        }

                        if (ruleKind === "variable" && identifierName.toLowerCase() === "score") {
                            reportDirectIdentifierReplacement(context, typedNode, identifierName, scoreReplacement);
                            return;
                        }

                        const catalogEntry = getDeprecatedIdentifierCatalogEntry(identifierName);
                        if (
                            !isRuleOwnedCatalogEntry(catalogEntry, ruleKind) ||
                            ruleKind === "function" ||
                            catalogEntry.legacyUsage !== "identifier"
                        ) {
                            return;
                        }

                        reportIdentifierRange(context, typedNode, identifierName, catalogEntry);
                    });
                }
            });
        }
    });
}

export function createGm1017Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createDeprecatedIdentifierRule(entry, "function");
}

export function createGm1023Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createDeprecatedIdentifierRule(entry, "constant");
}

export function createGm1024Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createDeprecatedIdentifierRule(entry, "variable");
}
