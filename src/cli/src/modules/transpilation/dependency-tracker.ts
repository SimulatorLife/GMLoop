/**
 * Lightweight dependency tracker for watch command hot-reload coordination.
 *
 * Tracks file-to-symbol mappings and symbol-to-file dependencies to enable
 * intelligent invalidation when files change. This is a stepping stone toward
 * full semantic analysis integration.
 *
 * Example usage:
 * ```ts
 * const tracker = new DependencyTracker();
 *
 * // Register file definitions
 * tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move", "gml_Script_player_jump"]);
 * tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);
 *
 * // When player.gml changes, get dependent files
 * const dependents = tracker.getDependentFiles("scripts/player.gml");
 * // Returns: ["scripts/enemy.gml"] - files that reference symbols from player.gml
 * ```
 */

export interface DependencyGraph {
    fileToDefs: Map<string, Set<string>>;
    fileToRefs: Map<string, Set<string>>;
    symbolToDefFile: Map<string, string>;
    symbolToRefFiles: Map<string, Set<string>>;
}

/**
 * Records a file's defined/referenced symbols.
 *
 * Provides the ability to populate the dependency graph without coupling to
 * traversal queries, removal, or diagnostics. The watch pipeline's
 * post-transpile hooks depend on this role alone to persist the symbols a
 * file just defined or referenced.
 */
export interface DependencyGraphWriter {
    registerFileDefines(filePath: string, symbols: ReadonlyArray<string>): void;
    replaceFileDefines(filePath: string, symbols: ReadonlyArray<string>): void;
    registerFileReferences(filePath: string, symbols: ReadonlyArray<string>): void;
    replaceFileReferences(filePath: string, symbols: ReadonlyArray<string>): void;
}

/**
 * Traverses the dependency graph to find affected files.
 *
 * Provides read-only lookups (direct dependents, symbol-driven traversal,
 * per-file definitions/references) without coupling to writing new entries,
 * removing files, or diagnostics. Hot-reload invalidation logic depends on
 * this role alone.
 */
export interface DependencyGraphQuery {
    getDependentFiles(filePath: string): Array<string>;
    getFilesReferencingSymbols(symbols: ReadonlyArray<string>, excludeFilePath?: string): Array<string>;
    getTransitiveFilesReferencingSymbols(symbols: ReadonlyArray<string>, excludeFilePath?: string): Array<string>;
    getFileDefinitions(filePath: string): Array<string>;
    getFileReferences(filePath: string): Array<string>;
}

/**
 * Removes a file's tracked state.
 *
 * Provides the ability to drop a deleted file's definitions/references (or
 * reset the whole graph) without coupling to writing new entries, querying
 * dependents, or diagnostics. File-deletion cleanup depends on this role
 * alone.
 */
export interface DependencyGraphRemover {
    removeFile(filePath: string): void;
    clear(): void;
}

/**
 * Diagnostic surface for the dependency graph.
 *
 * Provides counters and a debug snapshot without coupling to writing,
 * querying, or removal operations. Verbose-mode logging depends on this
 * role alone.
 */
export interface DependencyGraphDiagnostics {
    getSnapshot(): DependencyGraph;
    getStatistics(): {
        totalFiles: number;
        totalSymbols: number;
        filesWithDefs: number;
        filesWithRefs: number;
        averageDefsPerFile: number;
        averageRefsPerFile: number;
    };
}

/**
 * Composite dependency-graph contract used by consumers (such as the watch
 * command's runtime context) that genuinely need every capability. Consumers
 * that only need a subset should depend on the matching role interface
 * directly — see {@link DependencyGraphWriter}, {@link DependencyGraphQuery},
 * {@link DependencyGraphRemover}, and {@link DependencyGraphDiagnostics} —
 * which is the Interface Segregation Principle in practice.
 */
export type DependencyGraphContract = DependencyGraphWriter &
    DependencyGraphQuery &
    DependencyGraphRemover &
    DependencyGraphDiagnostics;

export class DependencyTracker
    implements DependencyGraphWriter, DependencyGraphQuery, DependencyGraphRemover, DependencyGraphDiagnostics
{
    private fileToDefs: Map<string, Set<string>>;
    private fileToRefs: Map<string, Set<string>>;
    private symbolToDefFile: Map<string, string>;
    private symbolToRefFiles: Map<string, Set<string>>;

    constructor() {
        this.fileToDefs = new Map();
        this.fileToRefs = new Map();
        this.symbolToDefFile = new Map();
        this.symbolToRefFiles = new Map();
    }

    /**
     * Register symbols defined by a file.
     * @param filePath - Path to the file
     * @param symbols - Symbols defined in the file
     */
    registerFileDefines(filePath: string, symbols: ReadonlyArray<string>): void {
        let defs = this.fileToDefs.get(filePath);
        if (!defs) {
            defs = new Set();
            this.fileToDefs.set(filePath, defs);
        }

        for (const symbol of symbols) {
            defs.add(symbol);
            this.symbolToDefFile.set(symbol, filePath);
        }
    }

    /**
     * Replace symbols defined by a file, clearing previous definitions first.
     *
     * @param filePath - Path to the file
     * @param symbols - Symbols defined in the file
     */
    replaceFileDefines(filePath: string, symbols: ReadonlyArray<string>): void {
        this.clearFileDefinitions(filePath);
        if (symbols.length === 0) {
            return;
        }

        this.registerFileDefines(filePath, symbols);
    }

    /**
     * Register symbols referenced by a file.
     * @param filePath - Path to the file
     * @param symbols - Symbols referenced in the file
     */
    registerFileReferences(filePath: string, symbols: ReadonlyArray<string>): void {
        let refs = this.fileToRefs.get(filePath);
        if (!refs) {
            refs = new Set();
            this.fileToRefs.set(filePath, refs);
        }

        for (const symbol of symbols) {
            refs.add(symbol);

            let refFiles = this.symbolToRefFiles.get(symbol);
            if (!refFiles) {
                refFiles = new Set();
                this.symbolToRefFiles.set(symbol, refFiles);
            }
            refFiles.add(filePath);
        }
    }

    /**
     * Replace symbols referenced by a file, clearing previous references first.
     *
     * @param filePath - Path to the file
     * @param symbols - Symbols referenced in the file
     */
    replaceFileReferences(filePath: string, symbols: ReadonlyArray<string>): void {
        this.clearFileReferences(filePath);
        if (symbols.length === 0) {
            return;
        }

        this.registerFileReferences(filePath, symbols);
    }

    /**
     * Get files that depend on symbols defined in the given file.
     * When a file changes, these dependent files may need re-transpilation.
     *
     * @param filePath - Path to the changed file
     * @returns Array of file paths that depend on this file
     */
    getDependentFiles(filePath: string): Array<string> {
        const defs = this.fileToDefs.get(filePath);
        if (!defs) {
            return [];
        }

        const dependents = new Set<string>();
        for (const symbol of defs) {
            const refFiles = this.symbolToRefFiles.get(symbol);
            if (refFiles) {
                for (const refFile of refFiles) {
                    if (refFile !== filePath) {
                        dependents.add(refFile);
                    }
                }
            }
        }

        return Array.from(dependents);
    }

    /**
     * Get files that reference any symbol in the provided set.
     *
     * This targeted lookup lets the watch pipeline retranspile only files that
     * can be affected by a concrete symbol-delta, instead of all dependents for
     * a definition file.
     *
     * @param symbols - Symbols whose referencing files should be returned
     * @param excludeFilePath - Optional file path to omit from the returned set
     * @returns Array of file paths that reference at least one provided symbol
     */
    getFilesReferencingSymbols(symbols: ReadonlyArray<string>, excludeFilePath?: string): Array<string> {
        if (symbols.length === 0) {
            return [];
        }

        const dependents = new Set<string>();

        for (const symbol of symbols) {
            const refFiles = this.symbolToRefFiles.get(symbol);
            if (!refFiles) {
                continue;
            }

            for (const refFile of refFiles) {
                if (excludeFilePath !== undefined && refFile === excludeFilePath) {
                    continue;
                }

                dependents.add(refFile);
            }
        }

        return Array.from(dependents);
    }

    /**
     * Get the transitive files affected by a set of changed definitions.
     *
     * This is used for compile-time macro changes. A macro can define another
     * macro, so recompiling only the first direct consumer leaves downstream
     * macro consumers stale. Ordinary runtime script changes continue to use
     * the direct lookup above because their already-broadcast patch does not
     * require every caller to be re-emitted.
     *
     * @param symbols Initial changed definition symbols.
     * @param excludeFilePath Optional source file to omit from the result.
     * @returns Files that directly or transitively reference the changed symbols.
     */
    getTransitiveFilesReferencingSymbols(symbols: ReadonlyArray<string>, excludeFilePath?: string): Array<string> {
        const pendingSymbols = [...symbols];
        const visitedSymbols = new Set<string>();
        const affectedFiles = new Set<string>();

        while (pendingSymbols.length > 0) {
            const symbol = pendingSymbols.pop();
            if (symbol === undefined || visitedSymbols.has(symbol)) {
                continue;
            }
            visitedSymbols.add(symbol);

            for (const filePath of this.getFilesReferencingSymbols([symbol], excludeFilePath)) {
                if (!affectedFiles.add(filePath)) {
                    continue;
                }

                pendingSymbols.push(...this.getFileDefinitions(filePath));
            }
        }

        return Array.from(affectedFiles);
    }

    /**
     * Get symbols defined by a file.
     * @param filePath - Path to the file
     * @returns Array of symbols defined in the file
     */
    getFileDefinitions(filePath: string): Array<string> {
        const defs = this.fileToDefs.get(filePath);
        return defs ? Array.from(defs) : [];
    }

    /**
     * Get symbols referenced by a file.
     * @param filePath - Path to the file
     * @returns Array of symbols referenced in the file
     */
    getFileReferences(filePath: string): Array<string> {
        const refs = this.fileToRefs.get(filePath);
        return refs ? Array.from(refs) : [];
    }

    private clearFileDefinitions(filePath: string): void {
        const defs = this.fileToDefs.get(filePath);
        if (!defs) {
            return;
        }

        for (const symbol of defs) {
            if (this.symbolToDefFile.get(symbol) === filePath) {
                this.symbolToDefFile.delete(symbol);
            }
            // Do not delete symbolToRefFiles here - other files may still reference this symbol.
            // REASON: When a file is removed, its symbol definitions are no longer available,
            // but other files in the workspace may still contain references to those symbols.
            // Preserving the reference mapping allows the dependency tracker to detect
            // broken references and report "undefined symbol" diagnostics to the user.
            // WHAT WOULD BREAK: Deleting symbolToRefFiles entries prematurely would hide
            // broken references and prevent the tracker from warning about missing imports.
        }

        this.fileToDefs.delete(filePath);
    }

    private clearFileReferences(filePath: string): void {
        const refs = this.fileToRefs.get(filePath);
        if (!refs) {
            return;
        }

        for (const symbol of refs) {
            const refFiles = this.symbolToRefFiles.get(symbol);
            if (refFiles) {
                refFiles.delete(filePath);
                if (refFiles.size === 0) {
                    this.symbolToRefFiles.delete(symbol);
                }
            }
        }

        this.fileToRefs.delete(filePath);
    }

    /**
     * Remove all tracking data for a file.
     * Call this when a file is deleted.
     *
     * @param filePath - Path to the file
     */
    removeFile(filePath: string): void {
        this.clearFileDefinitions(filePath);
        this.clearFileReferences(filePath);
    }

    /**
     * Clear all tracking data.
     */
    clear(): void {
        this.fileToDefs.clear();
        this.fileToRefs.clear();
        this.symbolToDefFile.clear();
        this.symbolToRefFiles.clear();
    }

    /**
     * Get a snapshot of the current dependency graph.
     * Useful for debugging and testing.
     *
     * @returns Copy of the internal dependency graph
     */
    getSnapshot(): DependencyGraph {
        return {
            fileToDefs: new Map(Array.from(this.fileToDefs.entries()).map(([k, v]) => [k, new Set(v)])),
            fileToRefs: new Map(Array.from(this.fileToRefs.entries()).map(([k, v]) => [k, new Set(v)])),
            symbolToDefFile: new Map(this.symbolToDefFile),
            symbolToRefFiles: new Map(Array.from(this.symbolToRefFiles.entries()).map(([k, v]) => [k, new Set(v)]))
        };
    }

    /**
     * Get summary statistics about tracked dependencies.
     * Useful for monitoring and diagnostics.
     */
    getStatistics(): {
        totalFiles: number;
        totalSymbols: number;
        filesWithDefs: number;
        filesWithRefs: number;
        averageDefsPerFile: number;
        averageRefsPerFile: number;
    } {
        const totalFiles = new Set([...this.fileToDefs.keys(), ...this.fileToRefs.keys()]).size;

        const totalDefs = Array.from(this.fileToDefs.values()).reduce((sum, defs) => sum + defs.size, 0);
        const totalRefs = Array.from(this.fileToRefs.values()).reduce((sum, refs) => sum + refs.size, 0);

        return {
            totalFiles,
            totalSymbols: this.symbolToDefFile.size,
            filesWithDefs: this.fileToDefs.size,
            filesWithRefs: this.fileToRefs.size,
            averageDefsPerFile: this.fileToDefs.size > 0 ? totalDefs / this.fileToDefs.size : 0,
            averageRefsPerFile: this.fileToRefs.size > 0 ? totalRefs / this.fileToRefs.size : 0
        };
    }
}
