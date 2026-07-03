import { Core } from "@gmloop/core";

type AstNodeRecord = Record<string, unknown>;

export type ConstructorStaticMemberDeclarationRecord = {
    constructorName: string;
    memberIdentifier: AstNodeRecord;
    memberName: string;
};

export type ConstructorStaticMemberReferenceRecord = {
    constructorName: string;
    memberIdentifier: AstNodeRecord;
    memberName: string;
};

export type ConstructorStaticMemberAnalysis = {
    declarations: Array<ConstructorStaticMemberDeclarationRecord>;
    references: Array<ConstructorStaticMemberReferenceRecord>;
};

const TRAVERSAL_LINK_KEYS = new Set(["parent", "enclosingNode", "precedingNode", "followingNode"]);

function isAstNodeRecord(value: unknown): value is AstNodeRecord {
    return Core.isObjectLike(value);
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

function readNodeChildren(node: AstNodeRecord): Array<AstNodeRecord> {
    const children: Array<AstNodeRecord> = [];

    for (const [key, value] of Object.entries(node)) {
        if (TRAVERSAL_LINK_KEYS.has(key)) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const child of value) {
                if (isAstNodeRecord(child)) {
                    children.push(child);
                }
            }
            continue;
        }

        if (isAstNodeRecord(value)) {
            children.push(value);
        }
    }

    return children;
}

function traverseAstNode(root: unknown, visit: (node: AstNodeRecord) => void): void {
    if (!isAstNodeRecord(root)) {
        return;
    }

    const stack = [root];
    const seen = new WeakSet<object>();

    while (stack.length > 0) {
        const node = stack.pop();
        if (node === undefined || seen.has(node)) {
            continue;
        }

        seen.add(node);
        visit(node);

        const children = readNodeChildren(node);
        for (let index = children.length - 1; index >= 0; index -= 1) {
            stack.push(children[index]);
        }
    }
}

function traverseConstructorOwnedBodyNode(root: unknown, visit: (node: AstNodeRecord) => void): void {
    if (!isAstNodeRecord(root)) {
        return;
    }

    const stack = [root];
    const seen = new WeakSet<object>();

    while (stack.length > 0) {
        const node = stack.pop();
        if (node === undefined || seen.has(node)) {
            continue;
        }

        seen.add(node);
        visit(node);

        if (
            node !== root &&
            (node.type === "FunctionDeclaration" ||
                node.type === "ConstructorDeclaration" ||
                node.type === "StructDeclaration")
        ) {
            continue;
        }

        const children = readNodeChildren(node);
        for (let index = children.length - 1; index >= 0; index -= 1) {
            stack.push(children[index]);
        }
    }
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

export function collectConstructorStaticMemberAnalysis(ast: unknown): ConstructorStaticMemberAnalysis {
    const declarations: Array<ConstructorStaticMemberDeclarationRecord> = [];
    const references: Array<ConstructorStaticMemberReferenceRecord> = [];

    traverseAstNode(ast, (node) => {
        if (node.type !== "ConstructorDeclaration") {
            return;
        }

        const constructorName = readConstructorName(node);
        if (constructorName === null) {
            return;
        }

        declarations.push(...collectStaticMemberDeclarations(node, constructorName));
        references.push(...collectStaticFunctionReferences(node, collectReceiverTypes(node)));
    });

    return { declarations, references };
}
