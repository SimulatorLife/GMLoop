/**
 * Pre-emission name collectors for GML transpilation.
 *
 * Before the emitter walks the AST, it must know which names are already
 * bound so that identifiers referencing those names are emitted correctly
 * regardless of declaration order.
 *
 * Two collectors are provided:
 *
 * - `collectLocalVariables` – walks a GML event AST and returns the set of
 *   all names declared with `var` or `static`. Used by `EventContextOracle` to distinguish
 *   locals from instance fields.
 *
 * - `collectGlobalVarNames` – walks any GML program AST and returns the set
 *   of all names declared with `globalvar`. Used by `GmlToJsEmitter` to
 *   pre-seed its global-var tracking set so that forward references to
 *   `globalvar`-declared names are emitted as `global.<name>` even when the
 *   declaration appears after the first use.
 */

import type { GmlNode, ProgramNode, VariableDeclaratorNode } from "./ast.js";
import {
    isAstRecord,
    isFunctionScopeBoundary,
    isGlobalVarStatementNode,
    isIdentifierNode,
    isVariableDeclarationNode,
    isVariableDeclaratorNode
} from "./type-guards.js";

type AstRecord = Record<string, unknown>;

function walkAstNodes(root: unknown, visitNode: (node: AstRecord) => boolean | void): void {
    // `walkAstNodes` is the inner traversal shared by every collector in this
    // file and runs once per function/event/program during transpile. The
    // child-iteration step previously built a fresh `Object.values` array on
    // every visited node; iterating keys directly with `for…in` + `Object.hasOwn`
    // avoids that allocation while visiting the same own enumerable properties
    // in the same order. The behavior of the visit callback and the descent
    // rules (including `shouldDescend === false` to stop at function-scope
    // boundaries) is unchanged.
    const traversalStack: unknown[] = [root];

    while (traversalStack.length > 0) {
        const currentNode = traversalStack.pop();

        if (Array.isArray(currentNode)) {
            for (let index = currentNode.length - 1; index >= 0; index -= 1) {
                traversalStack.push(currentNode[index]);
            }
            continue;
        }

        if (!isAstRecord(currentNode)) {
            continue;
        }

        const shouldDescend = visitNode(currentNode);
        if (shouldDescend === false) {
            continue;
        }

        for (const key in currentNode) {
            if (Object.hasOwn(currentNode, key)) {
                traversalStack.push((currentNode as AstRecord)[key]);
            }
        }
    }
}

function collectVarDeclaratorNames(node: AstRecord, localNames: Set<string>): void {
    if (
        !isVariableDeclarationNode(node) ||
        (node.kind !== "var" && node.kind !== "static") ||
        !Array.isArray(node.declarations)
    ) {
        return;
    }

    for (const declaration of node.declarations) {
        if (!isVariableDeclaratorNode(declaration) || !isAstRecord(declaration.id)) {
            continue;
        }

        const idNode = declaration.id;
        if (isIdentifierNode(idNode) && idNode.name.length > 0) {
            localNames.add(idNode.name);
        }
    }
}

function collectVarDeclarationsFromTree(root: unknown, localNames: Set<string>): void {
    walkAstNodes(root, (currentNode) => {
        if (isFunctionScopeBoundary(currentNode)) {
            return false;
        }

        collectVarDeclaratorNames(currentNode, localNames);
        return true;
    });
}

function collectStaticDeclarationsFromTree(root: unknown, declarations: VariableDeclaratorNode[]): void {
    walkAstNodes(root, (currentNode) => {
        if (isFunctionScopeBoundary(currentNode)) {
            return false;
        }

        if (
            isVariableDeclarationNode(currentNode) &&
            currentNode.kind === "static" &&
            Array.isArray(currentNode.declarations)
        ) {
            for (const declaration of currentNode.declarations) {
                if (isVariableDeclaratorNode(declaration)) {
                    declarations.push(declaration);
                }
            }
        }

        return true;
    });
}

/**
 * Walk a GML event AST and collect all variable names declared with `var` or `static`.
 *
 * Traversal stops at nested `FunctionDeclaration` and `ConstructorDeclaration`
 * boundaries so that inner-function locals are not included in the returned set.
 *
 * @param ast - The event or function-body AST node to walk
 * @returns An immutable set of all `var`-declared variable names in the event body
 *
 * @example
 * ```gml
 * // Event body:
 * var speed = 5;
 * static cached_message = "hit";
 * var dx = cos(direction) * speed;
 * health -= 1;           // NOT a local (instance field)
 * if (alive) {
 *     var msg = "hit";   // IS a local (var is function-scoped in GML)
 * }
 * ```
 * ```typescript
 * const locals = collectLocalVariables(ast);
 * // locals = Set { "speed", "cached_message", "dx", "msg" }
 * ```
 */
export function collectLocalVariables(ast: GmlNode): ReadonlySet<string> {
    const localNames = new Set<string>();
    collectVarDeclarationsFromTree(ast, localNames);
    return localNames;
}

/**
 * Collect static declarations owned by one function body.
 *
 * Static declarations are initialized before the rest of their containing
 * function executes. The emitter uses this ordered list to hoist those
 * initializers into the function prologue while keeping nested functions'
 * static scopes separate.
 *
 * @param ast - The function body or program fragment to inspect
 * @returns Static declarators in source order, excluding nested functions
 */
export function collectStaticVariableDeclarations(ast: GmlNode): ReadonlyArray<VariableDeclaratorNode> {
    const declarations: VariableDeclaratorNode[] = [];
    collectStaticDeclarationsFromTree(ast, declarations);
    return declarations;
}

/**
 * Collect the names of all `globalvar`-declared variables from a GML program AST.
 *
 * In GML, `globalvar` binds a name to the global struct regardless of where the
 * declaration appears in the source. This means an identifier may be referenced
 * before its `globalvar` declaration in the source text—a legal forward reference.
 *
 * `GmlToJsEmitter` uses this set to pre-seed its internal global-var tracker
 * before emission begins, so that forward-referenced global names are always
 * emitted as `global.<name>` rather than as bare identifiers.
 *
 * The walk crosses `FunctionDeclaration` and `ConstructorDeclaration` boundaries
 * because `globalvar` is always global-scoped regardless of the lexical nesting.
 *
 * @param ast - The root `Program` node to walk
 * @returns An immutable set of all `globalvar`-declared names in the program
 *
 * @example
 * ```gml
 * // Forward reference — foo referenced before its globalvar declaration:
 * foo = 1;
 * globalvar foo;
 * ```
 * ```typescript
 * const globals = collectGlobalVarNames(ast);
 * // globals = Set { "foo" }
 * // GmlToJsEmitter pre-seeds this.globalVars with { "foo" } before emission,
 * // so `foo = 1` is correctly emitted as `global.foo = 1`.
 * ```
 */
export function collectGlobalVarNames(ast: ProgramNode): ReadonlySet<string> {
    const globalNames = new Set<string>();
    collectGlobalVarNamesFromTree(ast, globalNames);
    return globalNames;
}

function collectGlobalVarNamesFromDeclaration(declaration: unknown, globalNames: Set<string>): void {
    if (!isVariableDeclaratorNode(declaration) || !isAstRecord(declaration.id)) {
        return;
    }
    const idNode = declaration.id;
    if (isIdentifierNode(idNode) && idNode.name.length > 0) {
        globalNames.add(idNode.name);
    }
}

function collectGlobalVarNamesFromNode(node: AstRecord, globalNames: Set<string>): void {
    if (isGlobalVarStatementNode(node) && Array.isArray(node.declarations)) {
        for (const declaration of node.declarations) {
            collectGlobalVarNamesFromDeclaration(declaration, globalNames);
        }
    }
}

function collectGlobalVarNamesFromTree(root: unknown, globalNames: Set<string>): void {
    walkAstNodes(root, (currentNode) => {
        collectGlobalVarNamesFromNode(currentNode, globalNames);
    });
}
