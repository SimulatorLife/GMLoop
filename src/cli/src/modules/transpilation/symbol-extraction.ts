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
 */
function walkNode(node: unknown, filePath: string, symbols: Array<string>): void {
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
            walkNode(child, filePath, symbols);
        }
    } else if (astNode.body !== null && astNode.body !== undefined) {
        walkNode(astNode.body, filePath, symbols);
    }

    // Recursively walk declarations array (for VariableDeclaration, etc.)
    if (Array.isArray(astNode.declarations)) {
        for (const child of astNode.declarations) {
            walkNode(child, filePath, symbols);
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
            walkNode(value, filePath, symbols);
        }
    }

    // Walk SwitchStatement.cases — an array of SwitchCase nodes that is not covered
    // by `body` or `declarations`, so it requires its own traversal step.
    if (Array.isArray(astNode.cases)) {
        for (const switchCase of astNode.cases) {
            walkNode(switchCase, filePath, symbols);
        }
    }
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
    walkNode(ast, filePath, symbols);
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
function processCallExpressionReferences(callNode: CallExpressionNode, references: Set<string>): void {
    const callee = callNode.object ?? callNode.callee;
    if (callee) {
        const calleeName = extractIdentifierName(callee);
        if (calleeName) {
            references.add(`gml_Script_${calleeName}`);
        }
        walkNodeForReferences(callee, references);
    }

    if (Array.isArray(callNode.arguments)) {
        for (const arg of callNode.arguments) {
            walkNodeForReferences(arg, references);
        }
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
function walkNodeForReferences(node: unknown, references: Set<string>): void {
    if (!node || typeof node !== "object") {
        return;
    }

    const astNode = node as AstNode;

    // Extract from CallExpression nodes (e.g., player_move(), enemy_attack()).
    // Callee and arguments walks are delegated to processCallExpressionReferences
    // to keep this function within the allowed cognitive complexity budget.
    if (astNode.type === "CallExpression") {
        processCallExpressionReferences(astNode as unknown as CallExpressionNode, references);
    }

    // Recursively walk body — as a statement array (Program, BlockStatement.body)
    // or as a nested BlockStatement node (FunctionDeclaration.body).
    if (Array.isArray(astNode.body)) {
        for (const child of astNode.body) {
            walkNodeForReferences(child, references);
        }
    } else if (astNode.body !== null && astNode.body !== undefined) {
        walkNodeForReferences(astNode.body, references);
    }

    // Recursively walk declarations array
    if (Array.isArray(astNode.declarations)) {
        for (const child of astNode.declarations) {
            walkNodeForReferences(child, references);
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
            walkNodeForReferences(value, references);
        }
    }

    // Walk SwitchStatement.cases — an array of SwitchCase nodes that is not covered
    // by `body` or `declarations`, so it requires its own traversal step.
    if (Array.isArray(astNode.cases)) {
        for (const switchCase of astNode.cases) {
            walkNodeForReferences(switchCase, references);
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
    walkNodeForReferences(ast, references);
    return Array.from(references);
}
