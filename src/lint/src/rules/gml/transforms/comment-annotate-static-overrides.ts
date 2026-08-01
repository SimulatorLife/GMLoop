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
    parentName: string | null;
    staticFunctions: Map<string, MutableGameMakerAstNode>;
};

/**
 * The declarator shape guaranteed by {@link getStaticFunctionDeclarator}.
 *
 * `MutableGameMakerAstNode` carries `Record<string, unknown>`, so without an
 * explicit narrowing the type system still treats `declarator.id` as
 * `unknown`. Encoding the identifier-narrowing in the return type lets
 * callers read `declarator.id.name` directly without re-running
 * `Core.isIdentifierNode`.
 */
type StaticFunctionDeclarator = MutableGameMakerAstNode & {
    id: { name: string };
};

/**
 * Validate that a statement declares a single static variable and return its
 * declarator, narrowing `id` to an identifier so callers can read
 * `declarator.id.name` without re-validating the shape.
 */
function getStaticFunctionDeclarator(statement: unknown): StaticFunctionDeclarator | null {
    if (!Core.isNode(statement) || statement.type !== "VariableDeclaration") {
        return null;
    }

    const variableDeclaration = statement as MutableGameMakerAstNode & { kind?: unknown };
    if (variableDeclaration.kind !== "static") {
        return null;
    }

    const declarations = (variableDeclaration as { declarations?: unknown }).declarations;
    if (!Core.isNonEmptyArray(declarations)) {
        return null;
    }

    const declarator = declarations[0];
    if (!declarator) {
        return null;
    }

    const declaratorId = (declarator as { id?: unknown }).id;
    if (!Core.isIdentifierNode(declaratorId)) {
        return null;
    }

    return declarator as StaticFunctionDeclarator;
}

/**
 * Pull the identifier name from a static declarator.
 */
function extractStaticFunctionName(statement: unknown): string | null {
    const declarator = getStaticFunctionDeclarator(statement);
    return declarator ? Core.getNonEmptyString(declarator.id.name) : null;
}

/**
 * Identify static variable declarations that host function expressions/declarations.
 */
function isStaticFunctionDeclaration(statement: unknown): boolean {
    const declarator = getStaticFunctionDeclarator(statement);
    const initType = (declarator?.init as { type?: unknown } | null | undefined)?.type;
    return initType === "FunctionDeclaration" || initType === "FunctionExpression";
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
 * Resolve a constructor name from an `id` slot that the parser may populate as
 * either an `IdentifierNode` or a raw string literal.
 */
function resolveConstructorNameFromId(id: unknown): string | null {
    if (Core.isIdentifierNode(id)) {
        return Core.getNonEmptyString(id.name);
    }

    if (typeof id === "string") {
        return Core.getNonEmptyString(id);
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

    return resolveConstructorNameFromId((node.parent as MutableGameMakerAstNode & { id?: unknown }).id);
}

/**
 * Collect the static function declarations from a constructor body into a name-keyed map.
 */
function collectStaticFunctions(node: MutableGameMakerAstNode): Map<string, MutableGameMakerAstNode> {
    const staticFunctions = new Map<string, MutableGameMakerAstNode>();

    // `getBodyStatements` expects a `Program` or `BlockStatement`, so unwrap
    // the constructor's nested `BlockStatement` first.
    for (const statement of Core.getBodyStatements(node.body)) {
        if (!isStaticFunctionDeclaration(statement)) {
            continue;
        }

        const staticName = extractStaticFunctionName(statement);
        if (!staticName || staticFunctions.has(staticName)) {
            continue;
        }

        staticFunctions.set(staticName, statement as MutableGameMakerAstNode);
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

    for (const node of Core.getBodyStatements(ast)) {
        if (!Core.isNode(node) || node.type !== "ConstructorDeclaration") {
            continue;
        }

        const name = resolveConstructorNameFromId((node as MutableGameMakerAstNode).id);
        if (!name) {
            continue;
        }

        constructors.set(name, {
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
