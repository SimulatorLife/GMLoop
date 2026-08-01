/**
 * Symbol query operations for the refactor engine.
 * Provides methods to locate symbols, validate existence, and gather occurrences
 * from the semantic analyzer and parser.
 */

import { Core } from "@gmloop/core";

import type {
    DependentSymbol,
    FileSymbol,
    PartialSemanticAnalyzer,
    SymbolLocation,
    SymbolOccurrence
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
    semantic: PartialSemanticAnalyzer | null
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

    return null;
}

/**
 * Check whether a symbol exists in the semantic index.
 *
 * When no semantic analyzer is provided, this function returns `true` to allow
 * refactorings to proceed in minimal environments where symbol tables may not
 * be available. This prevents silent failures for users who invoke rename without
 * a full semantic layer.
 *
 * @param symbolId - Unique identifier for the symbol to validate, in the form
 *                   `gml/{kind}/{name}` (e.g., `gml/function/myFunc`)
 * @param semantic  - Semantic analyzer instance, or `null` if unavailable
 * @returns `true` if the symbol exists (or no semantic layer is present);
 *          `false` if the semantic analyzer confirms the symbol is absent
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
 *
 * @param symbolIds - Array of symbol IDs whose dependents should be retrieved
 * @param semantic   - Semantic analyzer instance, or `null` if unavailable
 * @returns Array of dependent symbols; empty array if no semantic layer is present
 *          or if the analyzer does not expose dependency information
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
