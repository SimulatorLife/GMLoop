/**
 * Symbol query operations for the refactor engine.
 * Provides methods to locate symbols, validate existence, and gather occurrences
 * from the semantic analyzer and parser.
 */

import { Core } from "@gmloop/core";

import {
    type AstNode,
    type DependentSymbol,
    type FileSymbol,
    type ParserBridge,
    type PartialSemanticAnalyzer,
    type SymbolLocation,
    type SymbolOccurrence
} from "./types.js";

/**
 * Find the symbol at a specific location in a file.
 * Useful for triggering refactorings from editor positions.
 *
 * Returns a Promise to maintain API consistency with other symbol query functions.
 * The actual result may be synchronous or asynchronous depending on the semantic provider.
 */
export function findSymbolAtLocation(
    filePath: string,
    offset: number,
    semantic: PartialSemanticAnalyzer | null,
    parser: ParserBridge | null
): Promise<SymbolLocation | null> {
    if (!semantic) {
        return Promise.resolve(null);
    }

    // Attempt to use the semantic analyzer's position-based lookup if available.
    // This is the preferred method because it understands scope, binding, and
    // type information, allowing it to distinguish between identically-named
    // symbols in different contexts (e.g., local variables vs. global functions).
    if (Core.hasMethods(semantic, "getSymbolAtPosition")) {
        return Promise.resolve(semantic.getSymbolAtPosition(filePath, offset) ?? null);
    }

    // Fallback to parser-only AST traversal when the semantic analyzer doesn't
    // provide position-based lookup. This is less accurate because it can't
    // resolve bindings, but it still lets us find the syntactic node at the
    // given offset for basic rename operations.
    return findSymbolAtLocationFallback(filePath, offset, parser);
}

/**
 * Fallback method to find AST node at a specific offset using the parser only.
 * Used when the semantic analyzer doesn't provide position-based lookup.
 */
export async function findSymbolAtLocationFallback(
    filePath: string,
    offset: number,
    parser: ParserBridge | null
): Promise<SymbolLocation | null> {
    if (Core.hasMethods(parser, "parse")) {
        try {
            const ast = await parser.parse(filePath);
            return findNodeAtOffset(ast, offset);
        } catch {
            // Silently ignore parse errors and return null instead of propagating
            // the exception. Symbol lookup is advisory—if the file contains syntax
            // errors, the refactor engine will detect them during the main validation
            // pass and present actionable diagnostics to the user. Letting parse
            // failures here crash the symbol query would prevent partial symbol
            // analysis on otherwise valid sections of the codebase and break workflows
            // that rely on querying symbols in files with temporary syntax issues.
            return null;
        }
    }

    return null;
}

/**
 * Helper to find AST node at a specific offset.
 * @private
 */
function findNodeAtOffset(node: AstNode | null, offset: number): SymbolLocation | null {
    if (!node || typeof node !== "object") {
        return null;
    }

    // Determine whether this node's source range encompasses the given offset.
    // We use closed-interval semantics (<=) so that offsets at the exact start
    // or end positions match the node, which is crucial for cursor-based
    // refactorings where the user clicks on the first or last character.
    if (node.start <= offset && offset <= node.end) {
        // Recurse into child nodes first (depth-first traversal) to find the
        // most specific node at the offset. This ensures we return the innermost
        // identifier or expression rather than a containing block statement.
        if (node.children) {
            for (const child of node.children) {
                const found = findNodeAtOffset(child, offset);
                if (found) {
                    return found;
                }
            }
        }

        // If no child matches, return this node if it's an identifier. We filter
        // by type to avoid returning structural nodes like statements or blocks
        // that happen to contain the offset but aren't meaningful rename targets.
        if (node.type === "identifier" && node.name) {
            return {
                symbolId: `gml/identifier/${node.name}`,
                name: node.name,
                range: { start: node.start, end: node.end }
            };
        }
    }

    return null;
}

/**
 * Validate symbol exists in the semantic index.
 */
export async function validateSymbolExists(
    symbolId: string,
    semantic: PartialSemanticAnalyzer | null
): Promise<boolean> {
    if (!semantic) {
        // When no semantic analyzer is available, assume the symbol exists
        // to permit refactorings to proceed in minimal environments.
        return true;
    }

    // Query the semantic analyzer's symbol table to determine whether the given
    // symbolId exists. This check prevents rename operations from targeting
    // non-existent symbols, which would otherwise silently succeed but produce
    // no edits, confusing users who expect feedback when they mistype a name.
    if (Core.hasMethods(semantic, "hasSymbol")) {
        return await semantic.hasSymbol(symbolId);
    }

    // If the semantic analyzer doesn't expose a validation method, assume the
    // symbol exists. This fallback permits refactorings to proceed in
    // environments where the semantic layer is minimal or still initializing.
    return true;
}

/**
 * Gather all occurrences of a symbol from the semantic analyzer.
 */
export async function gatherSymbolOccurrences(
    symbolName: string,
    semantic: PartialSemanticAnalyzer | null,
    symbolId: string | null = null
): Promise<Array<SymbolOccurrence>> {
    if (!semantic) {
        return [];
    }

    // Request all occurrences (definitions and references) of the symbol from
    // the semantic analyzer. This includes local variables, function parameters,
    // global functions, and any other binding sites. The semantic layer tracks
    // both the location (path, offset) and the kind (definition vs. reference)
    // of each occurrence, which later phases use to construct text edits.
    if (Core.hasMethods(semantic, "getSymbolOccurrences")) {
        return await semantic.getSymbolOccurrences(symbolName, symbolId);
    }

    // If occurrence tracking isn't available, return an empty array so the
    // rename operation can proceed without edits, avoiding a hard error.
    return [];
}

/**
 * Query the semantic analyzer for symbols defined in a specific file.
 * This is useful for hot reload coordination to determine which symbols
 * need recompilation when a file changes.
 */
export async function getFileSymbols(
    filePath: string,
    semantic: PartialSemanticAnalyzer | null
): Promise<Array<FileSymbol>> {
    Core.assertNonEmptyString(filePath, {
        errorMessage: "getFileSymbols requires a valid file path string"
    });

    if (!semantic) {
        return [];
    }

    if (Core.hasMethods(semantic, "getFileSymbols")) {
        return (await semantic.getFileSymbols(filePath)) ?? [];
    }

    return [];
}

/**
 * Query the semantic analyzer for symbols that depend on the given symbols.
 * This is essential for hot reload to determine which symbols need recompilation
 * when dependencies change.
 */
export async function getSymbolDependents(
    symbolIds: Array<string>,
    semantic: PartialSemanticAnalyzer | null
): Promise<Array<DependentSymbol>> {
    Core.assertArray(symbolIds, {
        errorMessage: "getSymbolDependents requires an array of symbol IDs"
    });

    if (symbolIds.length === 0) {
        return [];
    }

    if (!semantic) {
        return [];
    }

    if (Core.hasMethods(semantic, "getDependents")) {
        return (await semantic.getDependents(symbolIds)) ?? [];
    }

    return [];
}

/**
 * Resolve a symbol ID from an identifier name.
 */
export async function resolveSymbolId(
    identifierName: string,
    semantic: PartialSemanticAnalyzer | null
): Promise<string | null> {
    if (!semantic) {
        return null;
    }

    if (Core.hasMethods(semantic, "resolveSymbolId")) {
        return await semantic.resolveSymbolId(identifierName);
    }

    return null;
}
