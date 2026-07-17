/**
 * Symbol extraction for semantic-aware hot-reload coordination.
 *
 * Extracts function and script definitions from GML AST nodes to enable
 * accurate dependency tracking. This replaces the basic file name heuristics
 * with true AST-based symbol extraction.
 *
 * Example usage:
 * ```ts
 * import { Parser } from "@gmloop/parser";
 * import { extractSymbolsFromAst } from "./symbol-extraction.js";
 *
 * const parser = new Parser.GMLParser(sourceText, {});
 * const ast = parser.parse();
 * const symbols = extractSymbolsFromAst(ast, filePath);
 * // Returns: ["gml_Script_player_move", "gml_Script_player_jump"]
 * ```
 */

import { Core } from "@gmloop/core";

import { getRuntimePathSegments, resolveObjectRuntimeIdFromSegments } from "./runtime-identifiers.js";

const { FUNCTION_DECLARATION, VARIABLE_DECLARATOR, ASSIGNMENT_EXPRESSION } = {
    FUNCTION_DECLARATION: Core.FUNCTION_DECLARATION,
    VARIABLE_DECLARATOR: Core.VARIABLE_DECLARATOR,
    ASSIGNMENT_EXPRESSION: Core.ASSIGNMENT_EXPRESSION
};

interface AstNode {
    type?: string | null;
    id?: string | AstNode | null;
    name?: string | AstNode | null;
    params?: Array<AstNode | string> | null;
    param?: AstNode | string | null;
    argument?: AstNode | null;
    init?: AstNode | null;
    left?: AstNode | null;
    right?: AstNode | null;
    // body may be a statement array (Program, BlockStatement, SwitchCase) or a nested
    // BlockStatement node (FunctionDeclaration.body) — handle both shapes during traversal.
    body?: Array<unknown> | AstNode | null;
    declarations?: Array<AstNode> | null;
    // SwitchStatement: `discriminant` is the expression being tested; `cases` is the list of
    // SwitchCase nodes. Neither maps to `body` or a standard prop, so they are tracked separately.
    discriminant?: AstNode | null;
    cases?: Array<AstNode> | null;
    // ForStatement: `update` is the post-iteration step expression (e.g. `i = next(i)`).
    update?: AstNode | null;
    // TryStatement: `block` is the try body, `handler` is the CatchClause, `finalizer` is the
    // Finalizer. None of these map to `body`, so they must be walked explicitly.
    block?: AstNode | null;
    handler?: AstNode | null;
    finalizer?: AstNode | null;
}

/**
 * Checks if a node is an identifier node with a name.
 */
function isIdentifierNode(node: unknown): node is { name: string } {
    return (
        typeof node === "object" &&
        node !== null &&
        "type" in node &&
        node.type === "Identifier" &&
        "name" in node &&
        typeof node.name === "string"
    );
}

/**
 * Extracts the identifier name from a node.
 * Handles both string names and identifier nodes.
 */
function extractIdentifierName(node: string | AstNode | null | undefined): string | null {
    if (typeof node === "string") {
        return node;
    }
    if (isIdentifierNode(node)) {
        return node.name;
    }
    return null;
}

type FunctionAstNode = AstNode & {
    type: "FunctionDeclaration" | "FunctionExpression" | "ArrowFunctionExpression";
};

function isFunctionNode(node: unknown): node is FunctionAstNode {
    if (!node || typeof node !== "object") {
        return false;
    }

    const type = (node as AstNode).type;
    return type === "FunctionDeclaration" || type === "FunctionExpression" || type === "ArrowFunctionExpression";
}

function extractBindingNames(node: string | AstNode | null | undefined): Array<string> {
    if (typeof node === "string") {
        return [node];
    }
    if (!node || typeof node !== "object") {
        return [];
    }

    if (node.type === "Identifier") {
        const identifierName = extractIdentifierName(node);
        return identifierName === null ? [] : [identifierName];
    }

    if (node.type === "DefaultParameter") {
        return extractBindingNames(node.left);
    }

    if (node.type === "RestElement") {
        return extractBindingNames(node.argument);
    }

    return [];
}

function walkNodeForScopeBindings(node: unknown, bindings: Set<string>): void {
    if (!node || typeof node !== "object") {
        return;
    }

    const astNode = node as AstNode;

    // Nested functions have an independent local scope. Their function name is
    // still a binding in the containing scope, but their parameters and local
    // declarations must not hide script calls in the containing function.
    if (isFunctionNode(astNode)) {
        if (astNode.type === FUNCTION_DECLARATION) {
            const functionName = extractIdentifierName(astNode.id);
            if (functionName !== null) {
                bindings.add(functionName);
            }
        }
        return;
    }

    if (astNode.type === VARIABLE_DECLARATOR) {
        for (const bindingName of extractBindingNames(astNode.id)) {
            bindings.add(bindingName);
        }
    }

    if (astNode.type === ASSIGNMENT_EXPRESSION && isFunctionNode(astNode.right)) {
        for (const bindingName of extractBindingNames(astNode.left)) {
            bindings.add(bindingName);
        }
    }

    if (astNode.type === "CatchClause") {
        for (const bindingName of extractBindingNames(astNode.param)) {
            bindings.add(bindingName);
        }
    }

    if (Array.isArray(astNode.body)) {
        for (const child of astNode.body) {
            walkNodeForScopeBindings(child, bindings);
        }
    } else if (astNode.body !== null && astNode.body !== undefined) {
        walkNodeForScopeBindings(astNode.body, bindings);
    }

    if (Array.isArray(astNode.declarations)) {
        for (const child of astNode.declarations) {
            walkNodeForScopeBindings(child, bindings);
        }
    }

    for (const prop of [
        "init",
        "left",
        "right",
        "argument",
        "test",
        "consequent",
        "alternate",
        "expression",
        "discriminant",
        "update",
        "block",
        "handler",
        "finalizer"
    ] as const) {
        const value = astNode[prop];
        if (value) {
            walkNodeForScopeBindings(value, bindings);
        }
    }

    if (Array.isArray(astNode.cases)) {
        for (const switchCase of astNode.cases) {
            walkNodeForScopeBindings(switchCase, bindings);
        }
    }
}

function collectFunctionScopeBindings(functionNode: AstNode): Set<string> {
    const bindings = new Set<string>();

    if (Array.isArray(functionNode.params)) {
        for (const parameter of functionNode.params) {
            for (const bindingName of extractBindingNames(parameter)) {
                bindings.add(bindingName);
            }
        }
    }

    if (functionNode.body) {
        walkNodeForScopeBindings(functionNode.body, bindings);
    }

    return bindings;
}

/**
 * Checks if a node represents a function value (FunctionDeclaration, FunctionExpression, or ArrowFunctionExpression).
 */
function isFunctionValue(node: AstNode | null | undefined): boolean {
    if (!node || typeof node !== "object") {
        return false;
    }
    const type = node.type;
    return type === "FunctionDeclaration" || type === "FunctionExpression" || type === "ArrowFunctionExpression";
}

/**
 * Extracts function definitions from variable declarators.
 * Handles: var myFunc = function() { }
 */
function extractFromVariableDeclarator(node: AstNode, filePath: string): Array<string> {
    const symbols: Array<string> = [];
    const idName = extractIdentifierName(node.id);
    if (idName && node.init && isFunctionValue(node.init)) {
        const runtimeId = resolveRuntimeIdFromPath(filePath, idName);
        if (runtimeId) {
            symbols.push(runtimeId);
        }
    }
    return symbols;
}

/**
 * Extracts function definitions from assignment expressions.
 * Handles: myFunc = function() { }
 */
function extractFromAssignment(node: AstNode, filePath: string): Array<string> {
    const symbols: Array<string> = [];
    const leftName = extractIdentifierName(node.left);
    if (leftName && node.right && isFunctionValue(node.right)) {
        const runtimeId = resolveRuntimeIdFromPath(filePath, leftName);
        if (runtimeId) {
            symbols.push(runtimeId);
        }
    }
    return symbols;
}

/**
 * Resolves a runtime identifier from a file path and symbol name.
 * Uses path heuristics to determine if it's a script or object event.
 */
function resolveRuntimeIdFromPath(filePath: string, symbolName: string): string | null {
    const segments = getRuntimePathSegments(filePath);
    const objectRuntimeId = resolveObjectRuntimeIdFromSegments(segments);
    if (objectRuntimeId) {
        return objectRuntimeId;
    }

    return `gml_Script_${symbolName}`;
}

/**
 * Recursively walks an AST node and extracts all symbol definitions.
 *
 * `filePath` is captured in a closure so the recursive descent does not need to
 * thread it as a parameter through every intermediate call site — it is only
 * consumed at the leaf extraction helpers.
 */
function buildWalkNode(filePath: string, symbols: Array<string>): (node: unknown) => void {
    function walkNode(node: unknown): void {
        if (!node || typeof node !== "object") {
            return;
        }

        const astNode = node as AstNode;

        // Extract from FunctionDeclaration nodes
        if (astNode.type === FUNCTION_DECLARATION) {
            const functionName = extractIdentifierName(astNode.id);
            if (functionName) {
                const runtimeId = resolveRuntimeIdFromPath(filePath, functionName);
                if (runtimeId) {
                    symbols.push(runtimeId);
                }
            }
        }

        // Extract from VariableDeclarator nodes (var myFunc = function() {})
        if (astNode.type === VARIABLE_DECLARATOR) {
            symbols.push(...extractFromVariableDeclarator(astNode, filePath));
        }

        // Extract from AssignmentExpression nodes (myFunc = function() {})
        if (astNode.type === ASSIGNMENT_EXPRESSION) {
            symbols.push(...extractFromAssignment(astNode, filePath));
        }

        // Recursively walk body — as a statement array (Program, BlockStatement.body)
        // or as a nested BlockStatement node (FunctionDeclaration.body).
        if (Array.isArray(astNode.body)) {
            for (const child of astNode.body) {
                walkNode(child);
            }
        } else if (astNode.body !== null && astNode.body !== undefined) {
            walkNode(astNode.body);
        }

        // Recursively walk declarations array (for VariableDeclaration, etc.)
        if (Array.isArray(astNode.declarations)) {
            for (const child of astNode.declarations) {
                walkNode(child);
            }
        }

        // Walk common single-node AST properties that might contain nested function definitions.
        // Includes: SwitchStatement.discriminant, ForStatement.update, TryStatement.block/handler/finalizer.
        for (const prop of [
            "init",
            "left",
            "right",
            "argument",
            "test",
            "consequent",
            "alternate",
            "expression",
            "discriminant",
            "update",
            "block",
            "handler",
            "finalizer"
        ] as const) {
            const value = astNode[prop];
            if (value) {
                walkNode(value);
            }
        }

        // Walk SwitchStatement.cases — an array of SwitchCase nodes that is not covered
        // by `body` or `declarations`, so it requires its own traversal step.
        if (Array.isArray(astNode.cases)) {
            for (const switchCase of astNode.cases) {
                walkNode(switchCase);
            }
        }
    }

    return walkNode;
}

/**
 * Extracts all symbol definitions from a GML AST.
 *
 * @param ast - The parsed AST from Parser.GMLParser
 * @param filePath - The source file path for context
 * @returns Array of runtime symbol IDs (e.g., "gml_Script_player_move")
 */
export function extractSymbolsFromAst(ast: AstNode, filePath: string): Array<string> {
    const symbols: Array<string> = [];
    const walkNode = buildWalkNode(filePath, symbols);
    walkNode(ast);
    return Core.uniqueArray(symbols) as Array<string>;
}

/**
 * GML CallExpression shape.
 *
 * The GML parser emits `object` (not the ESTree-standard `callee`) for the
 * function position of a call. Both fields are typed here so the walker can
 * handle GML ASTs and any ESTree-compatible AST transparently.
 */
interface CallExpressionNode {
    type: string;
    object?: AstNode;
    callee?: AstNode;
    arguments?: Array<unknown>;
}

/**
 * Handles a CallExpression node: records the direct callee name as a reference,
 * recurses into the callee (for chained/member-expression callees), and recurses
 * into each argument (for nested call expressions like `outer(inner())`).
 */
function processCallExpressionReferences(
    callNode: CallExpressionNode,
    references: Set<string>,
    locallyBoundNames: ReadonlySet<string>
): void {
    const callee = callNode.object ?? callNode.callee;
    if (callee) {
        const calleeName = extractIdentifierName(callee);
        if (calleeName && !locallyBoundNames.has(calleeName)) {
            references.add(`gml_Script_${calleeName}`);
        }
        walkNodeForReferences(callee, references, locallyBoundNames);
    }

    if (Array.isArray(callNode.arguments)) {
        for (const arg of callNode.arguments) {
            walkNodeForReferences(arg, references, locallyBoundNames);
        }
    }
}

function walkFunctionReferences(functionNode: AstNode, references: Set<string>): void {
    const locallyBoundNames = collectFunctionScopeBindings(functionNode);

    if (Array.isArray(functionNode.params)) {
        for (const parameter of functionNode.params) {
            walkNodeForReferences(parameter, references, locallyBoundNames);
        }
    }

    if (functionNode.body) {
        walkNodeForReferences(functionNode.body, references, locallyBoundNames);
    }
}

/**
 * Recursively walks an AST node and extracts direct function call references.
 *
 * Only CallExpression callees are recorded as references. Standalone Identifier
 * nodes (variable reads, property names, etc.) are intentionally excluded to
 * prevent false-positive dependencies: a local variable named `x` must not
 * create a phantom dependency on a script also named `x`. Nested call
 * expressions within arguments are correctly discovered via recursive descent,
 * so chains like `outer(inner())` track both `outer` and `inner`.
 *
 * NOTE: The GML parser emits `object` (not the ESTree standard `callee`) as the
 * function being called in a CallExpression. This handler accounts for that shape.
 */
function walkNodeForReferences(node: unknown, references: Set<string>, locallyBoundNames: ReadonlySet<string>): void {
    if (!node || typeof node !== "object") {
        return;
    }

    const astNode = node as AstNode;

    if (isFunctionNode(astNode)) {
        walkFunctionReferences(astNode, references);
        return;
    }

    // Extract from CallExpression nodes (e.g., player_move(), enemy_attack()).
    // Callee and arguments walks are delegated to processCallExpressionReferences
    // to keep this function within the allowed cognitive complexity budget.
    if (astNode.type === "CallExpression") {
        processCallExpressionReferences(astNode as unknown as CallExpressionNode, references, locallyBoundNames);
    }

    // Recursively walk body — as a statement array (Program, BlockStatement.body)
    // or as a nested BlockStatement node (FunctionDeclaration.body).
    if (Array.isArray(astNode.body)) {
        for (const child of astNode.body) {
            walkNodeForReferences(child, references, locallyBoundNames);
        }
    } else if (astNode.body !== null && astNode.body !== undefined) {
        walkNodeForReferences(astNode.body, references, locallyBoundNames);
    }

    // Recursively walk declarations array
    if (Array.isArray(astNode.declarations)) {
        for (const child of astNode.declarations) {
            walkNodeForReferences(child, references, locallyBoundNames);
        }
    }

    // Walk common single-node AST properties that may contain nested call expressions.
    // Includes: SwitchStatement.discriminant, ForStatement.update, TryStatement.block/handler/finalizer.
    for (const prop of [
        "init",
        "left",
        "right",
        "argument",
        "test",
        "consequent",
        "alternate",
        "expression",
        "discriminant",
        "update",
        "block",
        "handler",
        "finalizer"
    ] as const) {
        const value = astNode[prop];
        if (value) {
            walkNodeForReferences(value, references, locallyBoundNames);
        }
    }

    // Walk SwitchStatement.cases — an array of SwitchCase nodes that is not covered
    // by `body` or `declarations`, so it requires its own traversal step.
    if (Array.isArray(astNode.cases)) {
        for (const switchCase of astNode.cases) {
            walkNodeForReferences(switchCase, references, locallyBoundNames);
        }
    }
}

/**
 * Extracts direct function call references from a GML AST.
 *
 * Only identifiers appearing as CallExpression callees are returned. This keeps
 * the reference set compact and precise, preventing variable names from creating
 * false-positive entries in the dependency tracker that would trigger unnecessary
 * dependent retranspilation during hot-reload.
 *
 * @param ast - The parsed AST from Parser.GMLParser
 * @returns Array of runtime symbol IDs called in the file (e.g., "gml_Script_player_move")
 */
export function extractReferencesFromAst(ast: AstNode): Array<string> {
    const references = new Set<string>();

    if (ast.type === "Program" && Array.isArray(ast.body)) {
        const topLevelNodes = ast.body.filter((node): node is AstNode => typeof node === "object" && node !== null);
        const topLevelBindings = new Set<string>();

        for (const node of topLevelNodes) {
            if (!isFunctionNode(node)) {
                walkNodeForScopeBindings(node, topLevelBindings);
            }
        }

        for (const node of topLevelNodes) {
            if (isFunctionNode(node)) {
                walkFunctionReferences(node, references);
            } else {
                walkNodeForReferences(node, references, topLevelBindings);
            }
        }
    } else if (isFunctionNode(ast)) {
        walkFunctionReferences(ast, references);
    } else {
        const locallyBoundNames = new Set<string>();
        walkNodeForScopeBindings(ast, locallyBoundNames);
        walkNodeForReferences(ast, references, locallyBoundNames);
    }

    return Array.from(references);
}
