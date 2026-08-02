import { Core, type GameMakerAstNode } from "@gmloop/core";

type AstNodeRecord = GameMakerAstNode & Record<string, unknown>;

/** Static member declaration discovered on a constructor. */
export type ConstructorStaticMemberDeclarationRecord = {
    constructorName: string;
    declarationNode: AstNodeRecord;
    /**
     * Whether the member's initializer is a function/constructor value (a static
     * method) rather than plain data (a static field). Distinguishes the two so
     * downstream consumers such as the semantic graph do not classify every
     * `static` member as a callable.
     */
    isCallableValue: boolean;
    memberIdentifier: AstNodeRecord;
    memberName: string;
};

/** Resolved reference to a constructor static member. */
export type ConstructorStaticMemberReferenceRecord = {
    constructorName: string;
    memberIdentifier: AstNodeRecord;
    memberName: string;
};

type ConstructorInstanceVariableOccurrenceRecord = {
    constructorName: string;
    variableIdentifier: AstNodeRecord;
    variableName: string;
};

/** Constructor-owned static-member and instance-variable facts collected from one AST. */
export type ConstructorMemberAnalysis = {
    declarations: Array<ConstructorStaticMemberDeclarationRecord>;
    instanceVariableDeclarations: Array<ConstructorInstanceVariableOccurrenceRecord>;
    instanceVariableReferences: Array<ConstructorInstanceVariableOccurrenceRecord>;
    references: Array<ConstructorStaticMemberReferenceRecord>;
};

function isAstNodeRecord(value: unknown): value is AstNodeRecord {
    return Core.isObjectLike(value) && typeof (value as { type?: unknown }).type === "string";
}

function readIdentifierName(node: unknown): string | null {
    if (!isAstNodeRecord(node) || node.type !== "Identifier" || typeof node.name !== "string") {
        return null;
    }

    return node.name;
}

function readBindingIdentifierName(node: unknown): string | null {
    const directName = readIdentifierName(node);
    if (directName !== null) {
        return directName;
    }

    if (!isAstNodeRecord(node) || node.type !== "DefaultParameter") {
        return null;
    }

    return readIdentifierName(node.left);
}

function readConstructorName(node: AstNodeRecord): string | null {
    if (typeof node.id === "string") {
        return node.id;
    }

    return readIdentifierName(node.id);
}

function traverseConstructorOwnedBodyNode(root: unknown, visit: (node: AstNodeRecord) => void): void {
    const rootNode = isAstNodeRecord(root) ? root : null;
    if (rootNode === null) {
        return;
    }
    Core.traverseAst(rootNode, {
        enter(node) {
            if (!isAstNodeRecord(node)) {
                return false;
            }
            const typedNode = node;
            visit(typedNode);
            if (
                node !== rootNode &&
                (node.type === "FunctionDeclaration" ||
                    node.type === "ConstructorDeclaration" ||
                    node.type === "StructDeclaration")
            ) {
                return false;
            }
        }
    });
}

/**
 * Whether a static member's initializer holds a callable value (a static method
 * or nested constructor) as opposed to plain data such as a number, string, or
 * struct literal. GML function values parse as `FunctionDeclaration` nodes even
 * when used as an expression, matching the check `collectStaticFunctionNodes`
 * uses below to find static method bodies.
 */
function isCallableStaticMemberValue(node: unknown): boolean {
    return isAstNodeRecord(node) && (node.type === "FunctionDeclaration" || node.type === "ConstructorDeclaration");
}

function collectStaticMemberDeclarations(constructorNode: AstNodeRecord, constructorName: string) {
    const declarations: Array<ConstructorStaticMemberDeclarationRecord> = [];

    traverseConstructorOwnedBodyNode(constructorNode.body, (node) => {
        if (node.type !== "VariableDeclaration" || node.kind !== "static" || !Array.isArray(node.declarations)) {
            return;
        }

        for (const declaration of node.declarations) {
            if (!isAstNodeRecord(declaration)) {
                continue;
            }

            const memberName = readIdentifierName(declaration.id);
            if (memberName === null || !isAstNodeRecord(declaration.id)) {
                continue;
            }

            declarations.push({
                constructorName,
                declarationNode: node,
                isCallableValue: isCallableStaticMemberValue(declaration.init),
                memberName,
                memberIdentifier: declaration.id
            });
        }
    });

    return declarations;
}

function readSelfFieldName(node: unknown): string | null {
    if (!isAstNodeRecord(node) || node.type !== "MemberDotExpression") {
        return null;
    }

    if (readIdentifierName(node.object) !== "self") {
        return null;
    }

    return readIdentifierName(node.property);
}

function readNewExpressionConstructorName(node: unknown): string | null {
    if (!isAstNodeRecord(node) || node.type !== "NewExpression") {
        return null;
    }

    return readIdentifierName(node.expression);
}

function collectReceiverTypes(constructorNode: AstNodeRecord): Map<string, string> {
    const receiverTypes = new Map<string, string>();

    traverseConstructorOwnedBodyNode(constructorNode.body, (node) => {
        if (node.type !== "AssignmentExpression" || node.operator !== "=") {
            return;
        }

        const fieldName = readSelfFieldName(node.left);
        const constructorName = readNewExpressionConstructorName(node.right);
        if (fieldName === null || constructorName === null) {
            return;
        }

        receiverTypes.set(fieldName, constructorName);
    });

    return receiverTypes;
}

function collectShadowedNames(functionNode: AstNodeRecord): Set<string> {
    const shadowedNames = new Set<string>();

    for (const parameter of Core.asArray(functionNode.params)) {
        const parameterName = readBindingIdentifierName(parameter);
        if (parameterName !== null) {
            shadowedNames.add(parameterName);
        }
    }

    traverseConstructorOwnedBodyNode(functionNode.body, (node) => {
        if (node.type !== "VariableDeclarator") {
            return;
        }

        const declarationName = readIdentifierName(node.id);
        if (declarationName !== null) {
            shadowedNames.add(declarationName);
        }
    });

    return shadowedNames;
}

function collectStaticFunctionNodes(constructorNode: AstNodeRecord): Array<AstNodeRecord> {
    const staticFunctionNodes: Array<AstNodeRecord> = [];

    traverseConstructorOwnedBodyNode(constructorNode.body, (node) => {
        if (node.type !== "VariableDeclaration" || node.kind !== "static" || !Array.isArray(node.declarations)) {
            return;
        }

        for (const declaration of node.declarations) {
            if (!isAstNodeRecord(declaration) || !isAstNodeRecord(declaration.init)) {
                continue;
            }

            if (declaration.init.type === "FunctionDeclaration") {
                staticFunctionNodes.push(declaration.init);
            }
        }
    });

    return staticFunctionNodes;
}

function readAssignedInstanceVariableIdentifier(node: AstNodeRecord): AstNodeRecord | null {
    if (node.type !== "AssignmentExpression" || !isAstNodeRecord(node.left)) {
        return null;
    }

    if (readIdentifierName(node.left) !== null) {
        const classifications = Core.asArray(node.left.classifications);
        const hasLexicalDeclaration = Core.isObjectLike(node.left.declaration);
        const isGlobal = classifications.includes("global") || node.left.isGlobalIdentifier === true;
        return hasLexicalDeclaration || isGlobal ? null : node.left;
    }

    if (readSelfFieldName(node.left) === null || !isAstNodeRecord(node.left.property)) {
        return null;
    }

    return node.left.property;
}

function collectInstanceVariableDeclarations(
    constructorNode: AstNodeRecord,
    constructorName: string
): Array<ConstructorInstanceVariableOccurrenceRecord> {
    const declarations: Array<ConstructorInstanceVariableOccurrenceRecord> = [];

    traverseConstructorOwnedBodyNode(constructorNode.body, (node) => {
        const variableIdentifier = readAssignedInstanceVariableIdentifier(node);
        const variableName = readIdentifierName(variableIdentifier);
        if (variableIdentifier === null || variableName === null) {
            return;
        }

        declarations.push({ constructorName, variableIdentifier, variableName });
    });

    return declarations;
}

function collectInstanceVariableReferencesFromRoot(
    root: unknown,
    constructorName: string,
    instanceVariableNames: ReadonlySet<string>,
    declarationIdentifiers: WeakSet<object>
): Array<ConstructorInstanceVariableOccurrenceRecord> {
    const references: Array<ConstructorInstanceVariableOccurrenceRecord> = [];
    const recordedIdentifiers = new WeakSet<object>();

    traverseConstructorOwnedBodyNode(root, (node) => {
        let variableIdentifier: AstNodeRecord | null = null;
        if (node.type === "MemberDotExpression" && readSelfFieldName(node) !== null && isAstNodeRecord(node.property)) {
            variableIdentifier = node.property;
        } else if (node.type === "Identifier") {
            const classifications = Core.asArray(node.classifications);
            const hasLexicalDeclaration = Core.isObjectLike(node.declaration);
            if (!classifications.includes("property") && !hasLexicalDeclaration) {
                variableIdentifier = node;
            }
        }

        const variableName = readIdentifierName(variableIdentifier);
        if (
            variableIdentifier === null ||
            variableName === null ||
            !instanceVariableNames.has(variableName) ||
            declarationIdentifiers.has(variableIdentifier) ||
            recordedIdentifiers.has(variableIdentifier)
        ) {
            return;
        }

        recordedIdentifiers.add(variableIdentifier);
        references.push({ constructorName, variableIdentifier, variableName });
    });

    return references;
}

function collectInstanceVariableReferences(
    constructorNode: AstNodeRecord,
    constructorName: string,
    declarations: ReadonlyArray<ConstructorInstanceVariableOccurrenceRecord>
): Array<ConstructorInstanceVariableOccurrenceRecord> {
    const instanceVariableNames = new Set(declarations.map((declaration) => declaration.variableName));
    const declarationIdentifiers = new WeakSet(declarations.map((declaration) => declaration.variableIdentifier));
    const references = collectInstanceVariableReferencesFromRoot(
        constructorNode.body,
        constructorName,
        instanceVariableNames,
        declarationIdentifiers
    );

    for (const functionNode of collectStaticFunctionNodes(constructorNode)) {
        references.push(
            ...collectInstanceVariableReferencesFromRoot(
                functionNode.body,
                constructorName,
                instanceVariableNames,
                declarationIdentifiers
            )
        );
    }

    return references;
}

function readReceiverConstructorName(
    receiverNode: unknown,
    receiverTypes: ReadonlyMap<string, string>,
    shadowedNames: ReadonlySet<string>
): string | null {
    const explicitFieldName = readSelfFieldName(receiverNode);
    if (explicitFieldName !== null) {
        return receiverTypes.get(explicitFieldName) ?? null;
    }

    const bareFieldName = readIdentifierName(receiverNode);
    if (bareFieldName === null || shadowedNames.has(bareFieldName)) {
        return null;
    }

    return receiverTypes.get(bareFieldName) ?? null;
}

function collectStaticFunctionReferences(
    constructorNode: AstNodeRecord,
    receiverTypes: ReadonlyMap<string, string>
): Array<ConstructorStaticMemberReferenceRecord> {
    const references: Array<ConstructorStaticMemberReferenceRecord> = [];

    for (const functionNode of collectStaticFunctionNodes(constructorNode)) {
        const shadowedNames = collectShadowedNames(functionNode);
        traverseConstructorOwnedBodyNode(functionNode.body, (node) => {
            if (node.type !== "MemberDotExpression" || !isAstNodeRecord(node.property)) {
                return;
            }

            const memberName = readIdentifierName(node.property);
            const constructorName = readReceiverConstructorName(node.object, receiverTypes, shadowedNames);
            if (memberName === null || constructorName === null) {
                return;
            }

            references.push({
                constructorName,
                memberName,
                memberIdentifier: node.property
            });
        });
    }

    return references;
}

/** Collect constructor member declarations and references without assigning project symbol identities. */
export function collectConstructorMemberAnalysis(ast: unknown): ConstructorMemberAnalysis {
    const declarations: Array<ConstructorStaticMemberDeclarationRecord> = [];
    const instanceVariableDeclarations: Array<ConstructorInstanceVariableOccurrenceRecord> = [];
    const instanceVariableReferences: Array<ConstructorInstanceVariableOccurrenceRecord> = [];
    const references: Array<ConstructorStaticMemberReferenceRecord> = [];

    Core.traverseAst(ast, {
        enter(node) {
            if (!isAstNodeRecord(node) || node.type !== "ConstructorDeclaration") {
                return;
            }

            const constructorName = readConstructorName(node);
            if (constructorName === null) {
                return;
            }

            const constructorInstanceVariableDeclarations = collectInstanceVariableDeclarations(node, constructorName);
            declarations.push(...collectStaticMemberDeclarations(node, constructorName));
            instanceVariableDeclarations.push(...constructorInstanceVariableDeclarations);
            instanceVariableReferences.push(
                ...collectInstanceVariableReferences(node, constructorName, constructorInstanceVariableDeclarations)
            );
            references.push(...collectStaticFunctionReferences(node, collectReceiverTypes(node)));
        }
    });

    return { declarations, instanceVariableDeclarations, instanceVariableReferences, references };
}
