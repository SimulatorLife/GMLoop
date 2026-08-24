/**
 * Role-decomposed collaborators for the dependency graph used by the watch
 * pipeline.
 *
 * The legacy {@link DependencyTracker} combined writing, querying, removal,
 * and diagnostics for the dependency graph in a single class. The four
 * role interfaces defined in `./dependency-tracker.ts` already documented
 * the intent — each role models one cohesive responsibility and should be
 * depended on independently — but the implementation kept every operation
 * on one monolithic object. External consumers (notably
 * `cli/src/commands/watch.ts`) only used a small fraction of those
 * methods, so the monolithic shape was leaking through every API surface.
 *
 * This module fixes that by:
 *
 * - Owning the underlying {@link DependencyGraphState} in one place so all
 *   four roles always observe the same data.
 * - Giving each role interface its own concrete collaborator that translates
 *   role-method calls into state operations. The collaborators are
 *   internally composed by `DependencyTracker` so the public surface stays
 *   a single object, but tests and future consumers can ask for the
 *   narrower collaborator when they only need one role.
 *
 * The split keeps every behaviour byte-identical with the previous
 * monolithic class — including the order of map mutations, the defensive
 * cloning in `getSnapshot`, and the macro-style transitive traversal.
 */

import type {
    DependencyGraph,
    DependencyGraphDiagnostics,
    DependencyGraphQuery,
    DependencyGraphRemover,
    DependencyGraphWriter
} from "./dependency-tracker.js";

/**
 * Statistics shape returned by {@link DependencyGraphDiagnostics.getStatistics}.
 *
 * Mirrored here so the diagnostics collaborator owns its public return
 * type while the dependency tracker module keeps the role interfaces
 * close to the public facade that composes them.
 */
export type DependencyGraphStatistics = {
    totalFiles: number;
    totalSymbols: number;
    filesWithDefs: number;
    filesWithRefs: number;
    averageDefsPerFile: number;
    averageRefsPerFile: number;
};

/**
 * Mutable dependency-graph state and the primitive operations all four
 * role collaborators share.
 *
 * Keeping the maps and the primitive operations in one place avoids the
 * scenario where the writer, query, remover, and diagnostics collaborators
 * each carry their own copy of the maps and then need to be kept in sync.
 * Every collaborator instead receives the same {@link DependencyGraphState}
 * reference and routes its work through these primitives.
 */
export class DependencyGraphState {
    readonly #fileToDefs = new Map<string, Set<string>>();
    readonly #fileToRefs = new Map<string, Set<string>>();
    readonly #symbolToDefFile = new Map<string, string>();
    readonly #symbolToRefFiles = new Map<string, Set<string>>();

    /**
     * Adds `symbols` to the set of identifiers defined by `filePath`.
     *
     * Mirrors the previous inline behaviour: each symbol's owning file is
     * rewritten in `symbolToDefFile`, which means a later `removeFile` on
     * a different file that happens to define the same symbol will not
     * leave a stale entry pointing at the removed file.
     */
    addFileDefines(filePath: string, symbols: ReadonlyArray<string>): void {
        let defs = this.#fileToDefs.get(filePath);
        if (!defs) {
            defs = new Set();
            this.#fileToDefs.set(filePath, defs);
        }

        for (const symbol of symbols) {
            defs.add(symbol);
            this.#symbolToDefFile.set(symbol, filePath);
        }
    }

    /**
     * Adds `symbols` to the set of identifiers referenced by `filePath`.
     *
     * Each symbol's referencing-file set is created lazily, mirroring the
     * previous behaviour that avoided allocating empty sets for symbols
     * with no consumers yet.
     */
    addFileReferences(filePath: string, symbols: ReadonlyArray<string>): void {
        let refs = this.#fileToRefs.get(filePath);
        if (!refs) {
            refs = new Set();
            this.#fileToRefs.set(filePath, refs);
        }

        for (const symbol of symbols) {
            refs.add(symbol);

            let refFiles = this.#symbolToRefFiles.get(symbol);
            if (!refFiles) {
                refFiles = new Set();
                this.#symbolToRefFiles.set(symbol, refFiles);
            }
            refFiles.add(filePath);
        }
    }

    /**
     * Drops `filePath`'s definitions from the graph.
     *
     * For every defined symbol whose owning file was `filePath`, the
     * reverse `symbolToDefFile` entry is removed. The forward
     * `symbolToRefFiles` entries are intentionally preserved so consumers
     * can still observe references that were broken by the file removal —
     * the `dependency-tracker.test.ts` suite pins this behaviour.
     */
    removeFileDefinitions(filePath: string): void {
        const defs = this.#fileToDefs.get(filePath);
        if (!defs) {
            return;
        }

        for (const symbol of defs) {
            if (this.#symbolToDefFile.get(symbol) === filePath) {
                this.#symbolToDefFile.delete(symbol);
            }
        }

        this.#fileToDefs.delete(filePath);
    }

    /**
     * Drops `filePath`'s references from the graph.
     *
     * For every referenced symbol, `filePath` is removed from the
     * symbol's referencing-file set; the reverse entry is dropped
     * entirely once it has no remaining files.
     */
    removeFileReferences(filePath: string): void {
        const refs = this.#fileToRefs.get(filePath);
        if (!refs) {
            return;
        }

        for (const symbol of refs) {
            const refFiles = this.#symbolToRefFiles.get(symbol);
            if (refFiles) {
                refFiles.delete(filePath);
                if (refFiles.size === 0) {
                    this.#symbolToRefFiles.delete(symbol);
                }
            }
        }

        this.#fileToRefs.delete(filePath);
    }

    /**
     * Returns a fresh array of symbols defined by `filePath`, or an empty
     * array when the file has no definitions tracked.
     */
    getFileDefinitions(filePath: string): Array<string> {
        const defs = this.#fileToDefs.get(filePath);
        return defs ? Array.from(defs) : [];
    }

    /**
     * Returns a fresh array of symbols referenced by `filePath`, or an
     * empty array when the file has no references tracked.
     */
    getFileReferences(filePath: string): Array<string> {
        const refs = this.#fileToRefs.get(filePath);
        return refs ? Array.from(refs) : [];
    }

    /**
     * Returns every file that references any symbol defined in `filePath`.
     *
     * The defining file is intentionally excluded — a file that defines
     * and references its own symbol should not appear in its own
     * dependent set. This matches the previous `getDependentFiles`
     * behaviour and is pinned by `dependency-tracker.test.ts`.
     */
    getDependentFiles(filePath: string): Array<string> {
        const defs = this.#fileToDefs.get(filePath);
        if (!defs) {
            return [];
        }

        const dependents = new Set<string>();
        for (const symbol of defs) {
            const refFiles = this.#symbolToRefFiles.get(symbol);
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
     * Returns every file that references at least one of `symbols`, with
     * `excludeFilePath` omitted from the result when provided.
     */
    getFilesReferencingSymbols(symbols: ReadonlyArray<string>, excludeFilePath?: string): Array<string> {
        if (symbols.length === 0) {
            return [];
        }

        const dependents = new Set<string>();

        for (const symbol of symbols) {
            const refFiles = this.#symbolToRefFiles.get(symbol);
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
     * Returns the transitive set of files affected by a change to any of
     * `symbols`.
     *
     * Used by compile-time macro changes, where one macro can define
     * another and downstream consumers must therefore be re-emitted. The
     * walk follows `getFileDefinitions` to discover new symbols at each
     * hop and stops on cycles via a visited-symbol set.
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
     * Returns a deep copy of the graph suitable for debugging or test
     * inspection.
     *
     * The snapshot is decoupled from the live state, so subsequent
     * mutations (including `clear`) leave the previously-returned
     * snapshot untouched — this is the contract pinned by
     * `dependency-tracker.test.ts`.
     */
    snapshot(): DependencyGraph {
        return {
            fileToDefs: new Map(Array.from(this.#fileToDefs.entries()).map(([k, v]) => [k, new Set(v)])),
            fileToRefs: new Map(Array.from(this.#fileToRefs.entries()).map(([k, v]) => [k, new Set(v)])),
            symbolToDefFile: new Map(this.#symbolToDefFile),
            symbolToRefFiles: new Map(Array.from(this.#symbolToRefFiles.entries()).map(([k, v]) => [k, new Set(v)]))
        };
    }

    /**
     * Returns aggregate counters for monitoring and regression tests.
     */
    getStatistics(): DependencyGraphStatistics {
        const totalFiles = new Set([...this.#fileToDefs.keys(), ...this.#fileToRefs.keys()]).size;

        const totalDefs = Array.from(this.#fileToDefs.values()).reduce((sum, defs) => sum + defs.size, 0);
        const totalRefs = Array.from(this.#fileToRefs.values()).reduce((sum, refs) => sum + refs.size, 0);

        return {
            totalFiles,
            totalSymbols: this.#symbolToDefFile.size,
            filesWithDefs: this.#fileToDefs.size,
            filesWithRefs: this.#fileToRefs.size,
            averageDefsPerFile: this.#fileToDefs.size > 0 ? totalDefs / this.#fileToDefs.size : 0,
            averageRefsPerFile: this.#fileToRefs.size > 0 ? totalRefs / this.#fileToRefs.size : 0
        };
    }

    /**
     * Resets every internal map in place, returning the graph to its
     * empty initial state.
     *
     * Uses `clear()` rather than reassigning the maps so any outside
     * reference captured before the call (for example via `getSnapshot`)
     * continues to observe a stable snapshot. This matches the previous
     * monolithic behaviour where `clear()` reset every internal Map in
     * place.
     */
    clearAll(): void {
        this.#fileToDefs.clear();
        this.#fileToRefs.clear();
        this.#symbolToDefFile.clear();
        this.#symbolToRefFiles.clear();
    }
}

/**
 * Writer-role collaborator.
 *
 * Owns register/replace semantics for a file's defined and referenced
 * symbols. Always delegated to a shared {@link DependencyGraphState}, so a
 * writer instance is stateless beyond the state reference it holds.
 */
export class DependencyGraphFileWriter implements DependencyGraphWriter {
    readonly #state: DependencyGraphState;

    constructor(state: DependencyGraphState) {
        this.#state = state;
    }

    registerFileDefines(filePath: string, symbols: ReadonlyArray<string>): void {
        this.#state.addFileDefines(filePath, symbols);
    }

    replaceFileDefines(filePath: string, symbols: ReadonlyArray<string>): void {
        this.#state.removeFileDefinitions(filePath);
        if (symbols.length === 0) {
            return;
        }

        this.#state.addFileDefines(filePath, symbols);
    }

    registerFileReferences(filePath: string, symbols: ReadonlyArray<string>): void {
        this.#state.addFileReferences(filePath, symbols);
    }

    replaceFileReferences(filePath: string, symbols: ReadonlyArray<string>): void {
        this.#state.removeFileReferences(filePath);
        if (symbols.length === 0) {
            return;
        }

        this.#state.addFileReferences(filePath, symbols);
    }
}

/**
 * Query-role collaborator.
 *
 * Provides read-only lookups over the shared graph state. The
 * collaborator exposes only traversal — never mutates the state — so
 * consumers that only need lookups can depend on this role without
 * acquiring the writer or remover capabilities.
 */
export class DependencyGraphQueryReader implements DependencyGraphQuery {
    readonly #state: DependencyGraphState;

    constructor(state: DependencyGraphState) {
        this.#state = state;
    }

    getDependentFiles(filePath: string): Array<string> {
        return this.#state.getDependentFiles(filePath);
    }

    getFilesReferencingSymbols(symbols: ReadonlyArray<string>, excludeFilePath?: string): Array<string> {
        return this.#state.getFilesReferencingSymbols(symbols, excludeFilePath);
    }

    getTransitiveFilesReferencingSymbols(symbols: ReadonlyArray<string>, excludeFilePath?: string): Array<string> {
        return this.#state.getTransitiveFilesReferencingSymbols(symbols, excludeFilePath);
    }

    getFileDefinitions(filePath: string): Array<string> {
        return this.#state.getFileDefinitions(filePath);
    }

    getFileReferences(filePath: string): Array<string> {
        return this.#state.getFileReferences(filePath);
    }
}

/**
 * Remover-role collaborator.
 *
 * Owns the file-deletion cleanup path and the `clear` reset operation.
 * Both path names are routed through the shared state so the writer and
 * remover never race on the underlying maps.
 */
export class DependencyGraphFileRemover implements DependencyGraphRemover {
    readonly #state: DependencyGraphState;

    constructor(state: DependencyGraphState) {
        this.#state = state;
    }

    removeFile(filePath: string): void {
        this.#state.removeFileDefinitions(filePath);
        this.#state.removeFileReferences(filePath);
    }

    clear(): void {
        this.#state.clearAll();
    }
}

/**
 * Diagnostics-role collaborator.
 *
 * Exposes the snapshot-and-statistics surface used by verbose-mode
 * logging and regression tests. The collaborator itself is read-only and
 * keeps no internal state beyond the shared graph reference.
 */
export class DependencyGraphDiagnosticsInspector implements DependencyGraphDiagnostics {
    readonly #state: DependencyGraphState;

    constructor(state: DependencyGraphState) {
        this.#state = state;
    }

    getSnapshot(): DependencyGraph {
        return this.#state.snapshot();
    }

    getStatistics(): DependencyGraphStatistics {
        return this.#state.getStatistics();
    }
}
