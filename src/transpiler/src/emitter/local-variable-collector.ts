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
 *   all names declared with `var`. Used by `EventContextOracle` to distinguish
 *   locals from instance fields.
 *
 * - `collectGlobalVarNames` – walks any GML program AST and returns the set
 *   of all names declared with `globalvar`. Used by `GmlToJsEmitter` to
 *   pre-seed its global-var tracking set so that forward references to
 *   `globalvar`-declared names are emitted as `global.<name>` even when the
 *   declaration appears after the first use.
 */

import type { ProgramNode } from "./ast.js";

type AstRecord = Record<string, unknown>;

function isAstRecord(value: unknown): value is AstRecord {
    return value !== null && typeof value === "object";
}

function isFunctionScopeBoundary(node: AstRecord): boolean {
    return node.type === "FunctionDeclaration" || node.type === "ConstructorDeclaration";
}

function collectVarDeclaratorNames(node: AstRecord, localNames: Set<string>): void {
    if (node.type !== "VariableDeclaration" || node.kind !== "var" || !Array.isArray(node.declarations)) {
        return;
    }

    for (const declaration of node.declarations) {
        if (!isAstRecord(declaration) || declaration.type !== "VariableDeclarator" || !isAstRecord(declaration.id)) {
            continue;
        }

        const { name } = declaration.id;
        if (typeof name === "string" && name.length > 0) {
            localNames.add(name);
        }
    }
}

function collectVarDeclarationsFromTree(root: unknown, localNames: Set<string>): void {
    const traversalStack: unknown[] = [root];

    while (traversalStack.length > 0) {
        const currentNode = traversalStack.pop();
        if (currentNode === undefined) {
            continue;
        }

        if (Array.isArray(currentNode)) {
            for (let index = currentNode.length - 1; index >= 0; index -= 1) {
                traversalStack.push(currentNode[index]);
            }
            continue;
        }

        if (!isAstRecord(currentNode) || isFunctionScopeBoundary(currentNode)) {
            continue;
        }

        collectVarDeclaratorNames(currentNode, localNames);

        for (const value of Object.values(currentNode)) {
            traversalStack.push(value);
        }
    }
}

/**
 * Walk a GML event AST and collect all variable names declared with `var`.
 *
 * Traversal stops at nested `FunctionDeclaration` and `ConstructorDeclaration`
 * boundaries so that inner-function locals are not included in the returned set.
 *
 * @param ast - The root `Program` node to walk
 * @returns An immutable set of all `var`-declared variable names in the event body
 *
 * @example
 * ```gml
 * // Event body:
 * var speed = 5;
 * var dx = cos(direction) * speed;
 * health -= 1;           // NOT a local (instance field)
 * if (alive) {
 *     var msg = "hit";   // IS a local (var is function-scoped in GML)
 * }
 * ```
 * ```typescript
 * const locals = collectLocalVariables(ast);
 * // locals = Set { "speed", "dx", "msg" }
 * ```
 */
export function collectLocalVariables(ast: ProgramNode): ReadonlySet<string> {
    const localNames = new Set<string>();
    collectVarDeclarationsFromTree(ast, localNames);
    return localNames;
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
    if (!isAstRecord(declaration) || !isAstRecord(declaration.id)) {
        return;
    }
    const { name } = declaration.id;
    if (typeof name === "string" && name.length > 0) {
        globalNames.add(name);
    }
}

function collectGlobalVarNamesFromNode(node: AstRecord, globalNames: Set<string>, stack: unknown[]): void {
    if (node.type === "GlobalVarStatement" && Array.isArray(node.declarations)) {
        for (const declaration of node.declarations) {
            collectGlobalVarNamesFromDeclaration(declaration, globalNames);
        }
    }
    // Push child values onto the traversal stack.
    for (const value of Object.values(node)) {
        stack.push(value);
    }
}

function collectGlobalVarNamesFromTree(root: unknown, globalNames: Set<string>): void {
    const traversalStack: unknown[] = [root];

    while (traversalStack.length > 0) {
        const currentNode = traversalStack.pop();

        if (Array.isArray(currentNode)) {
            for (let index = currentNode.length - 1; index >= 0; index -= 1) {
                traversalStack.push(currentNode[index]);
            }
        } else if (isAstRecord(currentNode)) {
            collectGlobalVarNamesFromNode(currentNode, globalNames, traversalStack);
        }
    }
}
