/**
 * Marks static constructor helper functions that override implementations
 * inherited from parent constructors.
 *
 * This transform lives in the lint comment-transform layer because its
 * sole consumer is `synthetic-comments.ts`, which checks `_overridesStaticFunction`
 * to decide whether to emit an `@override` doc-comment tag and to copy inherited
 * doc lines from the ancestor static helper.
 *
 * Previously this file lived in `@gmloop/refactor`
 * (`refactor/src/annotate-static-overrides.ts`).  It was relocated here because
 * the refactor workspace owns rename/restructuring transactions, not comment-level
 * AST annotation passes; this transform is a lint-pipeline preprocessing step and
 * must be co-located with the code that reads its output.
 */
import { Core, type MutableGameMakerAstNode } from "@gmloop/core";

const { isObjectLike } = Core;

type AnnotateStaticFunctionOverridesTransformOptions = Record<string, never>;

type ConstructorInfo = {
    node: MutableGameMakerAstNode;
    parentName: string | null;
    staticFunctions: Map<string, MutableGameMakerAstNode>;
};

/**
 * Helper to validate that a statement declares a single static variable with a function initializer.
 */
function getStaticFunctionDeclarator(statement: MutableGameMakerAstNode | null | undefined) {
    if (!statement || statement.type !== "VariableDeclaration") {
        return null;
    }

    if (statement.kind !== "static") {
        return null;
    }

    if (!Core.isNonEmptyArray(statement.declarations)) {
        return null;
    }

    const [declarator] = statement.declarations;

    if (!declarator) {
        return null;
    }

    const declaratorId = (declarator as { id?: unknown }).id;
    if (!Core.isIdentifierNode(declaratorId)) {
        return null;
    }

    return declarator;
}

/**
 * Pull the identifier name from a static declarator.
 */
function extractStaticFunctionName(statement: MutableGameMakerAstNode | null | undefined) {
    const declarator = getStaticFunctionDeclarator(statement);

    if (!declarator) {
        return null;
    }

    if (!Core.isIdentifierNode(declarator.id)) {
        return null;
    }

    return Core.getNonEmptyString(declarator.id.name);
}

/**
 * Identify static variable declarations that host function expressions/declarations.
 */
function isStaticFunctionDeclaration(statement: MutableGameMakerAstNode | null | undefined) {
    const declarator = getStaticFunctionDeclarator(statement);
    return declarator?.init?.type === "FunctionDeclaration" || declarator?.init?.type === "FunctionExpression";
}

/**
 * Search the constructor hierarchy to see if an ancestor already defines the named static helper.
 */
function findAncestorStaticFunction(
    constructors: Map<string, ConstructorInfo>,
    startName: string | null | undefined,
    targetName: string
): MutableGameMakerAstNode | null {
    const visited = new Set<string>();
    let currentName = Core.getNonEmptyString(startName);

    while (currentName) {
        if (visited.has(currentName)) {
            break;
        }

        visited.add(currentName);
        const info = constructors.get(currentName);
        if (!info) {
            break;
        }

        const ancestorStatic = info.staticFunctions.get(targetName);
        if (ancestorStatic) {
            return ancestorStatic;
        }

        currentName = Core.getNonEmptyString(info.parentName);
    }

    return null;
}

/**
 * Resolve the string name of a constructor node.
 */
function resolveConstructorName(node: MutableGameMakerAstNode): string | null {
    if (Core.isIdentifierNode(node.id)) {
        return Core.getNonEmptyString(node.id.name);
    }

    if (typeof node.id === "string") {
        return Core.getNonEmptyString(node.id);
    }

    return null;
}

/**
 * Resolve the parent constructor name from a ConstructorParentClause node.
 */
function resolveParentConstructorName(node: MutableGameMakerAstNode): string | null {
    if (!Core.isNode(node.parent) || node.parent.type !== "ConstructorParentClause") {
        return null;
    }

    const parentId = (node.parent as MutableGameMakerAstNode & { id?: unknown }).id;

    if (Core.isIdentifierNode(parentId)) {
        return Core.getNonEmptyString(parentId.name);
    }

    if (typeof parentId === "string") {
        return Core.getNonEmptyString(parentId);
    }

    return null;
}

/**
 * Collect the static function declarations from a constructor body into a name-keyed map.
 */
function collectStaticFunctions(node: MutableGameMakerAstNode): Map<string, MutableGameMakerAstNode> {
    const staticFunctions = new Map<string, MutableGameMakerAstNode>();

    const statements = Core.getBodyStatements((node as Record<string, unknown>).body) as MutableGameMakerAstNode[];

    for (const statement of statements) {
        if (!isStaticFunctionDeclaration(statement)) {
            continue;
        }

        const staticName = extractStaticFunctionName(statement);
        if (!staticName || staticFunctions.has(staticName)) {
            continue;
        }

        staticFunctions.set(staticName, statement);
    }

    return staticFunctions;
}

/**
 * Build a map of constructors with their names, parents, and declared static helper functions.
 */
function collectConstructorInfos(ast: MutableGameMakerAstNode): Map<string, ConstructorInfo> {
    if (!isObjectLike(ast)) {
        return new Map();
    }

    const constructors = new Map<string, ConstructorInfo>();
    const body = Core.getBodyStatements(ast);

    for (const node of body) {
        if (!Core.isNode(node) || node.type !== "ConstructorDeclaration") {
            continue;
        }

        const name = resolveConstructorName(node as MutableGameMakerAstNode);
        if (!name) {
            continue;
        }

        constructors.set(name, {
            node: node as MutableGameMakerAstNode,
            parentName: resolveParentConstructorName(node as MutableGameMakerAstNode),
            staticFunctions: collectStaticFunctions(node as MutableGameMakerAstNode)
        });
    }

    return constructors;
}

/**
 * Walk constructors, find duplicated static helpers, and set override metadata for conflicting members.
 */
function annotateStaticFunctionOverrides(ast: MutableGameMakerAstNode) {
    const constructors = collectConstructorInfos(ast);

    if (constructors.size === 0) {
        return;
    }

    for (const info of constructors.values()) {
        if (!info.parentName) {
            continue;
        }

        for (const [staticName, statement] of info.staticFunctions) {
            const ancestorStatic = findAncestorStaticFunction(constructors, info.parentName, staticName);
            if (ancestorStatic) {
                statement._overridesStaticFunction = true;
                statement._overridesStaticFunctionNode = ancestorStatic;
            }
        }
    }
}

function execute(
    ast: MutableGameMakerAstNode,
    _options: AnnotateStaticFunctionOverridesTransformOptions
): MutableGameMakerAstNode {
    void _options;
    annotateStaticFunctionOverrides(ast);
    return ast;
}

export const annotateStaticFunctionOverridesTransform =
    Core.createParserTransform<AnnotateStaticFunctionOverridesTransformOptions>(
        "annotate-static-overrides",
        {},
        execute
    );
