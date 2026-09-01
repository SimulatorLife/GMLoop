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
 *
 * ## Composition over monolithic subclass
 *
 * Earlier versions of this module bundled every graph operation into one
 * class, even though the role interfaces below already documented four
 * distinct concerns (writing, querying, removing, and diagnostics). The
 * monolithic shape forced every consumer — including the watch command,
 * which only ever needed a couple of the registered methods — to depend
 * on the full surface. The implementation now delegates each role to a
 * dedicated collaborator that lives in
 * `./dependency-graph-collaborators.ts` and shares a single
 * {@link DependencyGraphState} so every collaborator observes the same
 * data. The public class therefore stays drop-in compatible while its
 * internals are decomposed by responsibility.
 */

import {
    DependencyGraphDiagnosticsInspector,
    DependencyGraphFileRemover,
    DependencyGraphFileWriter,
    DependencyGraphQueryReader,
    DependencyGraphState
} from "./dependency-graph-collaborators.js";

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

/**
 * Thin facade that composes the four role-specific collaborators over a
 * shared dependency-graph state.
 *
 * Public behaviour is identical to the previous monolithic implementation;
 * internals now route through focused collaborators so each method on this
 * class does nothing more than delegate to the matching role.
 */
export class DependencyTracker
    implements DependencyGraphWriter, DependencyGraphQuery, DependencyGraphRemover, DependencyGraphDiagnostics
{
    readonly #state = new DependencyGraphState();
    readonly #writer = new DependencyGraphFileWriter(this.#state);
    readonly #query = new DependencyGraphQueryReader(this.#state);
    readonly #remover = new DependencyGraphFileRemover(this.#state);
    readonly #diagnostics = new DependencyGraphDiagnosticsInspector(this.#state);

    registerFileDefines(filePath: string, symbols: ReadonlyArray<string>): void {
        this.#writer.registerFileDefines(filePath, symbols);
    }

    replaceFileDefines(filePath: string, symbols: ReadonlyArray<string>): void {
        this.#writer.replaceFileDefines(filePath, symbols);
    }

    registerFileReferences(filePath: string, symbols: ReadonlyArray<string>): void {
        this.#writer.registerFileReferences(filePath, symbols);
    }

    replaceFileReferences(filePath: string, symbols: ReadonlyArray<string>): void {
        this.#writer.replaceFileReferences(filePath, symbols);
    }

    getDependentFiles(filePath: string): Array<string> {
        return this.#query.getDependentFiles(filePath);
    }

    getFilesReferencingSymbols(symbols: ReadonlyArray<string>, excludeFilePath?: string): Array<string> {
        return this.#query.getFilesReferencingSymbols(symbols, excludeFilePath);
    }

    getTransitiveFilesReferencingSymbols(symbols: ReadonlyArray<string>, excludeFilePath?: string): Array<string> {
        return this.#query.getTransitiveFilesReferencingSymbols(symbols, excludeFilePath);
    }

    getFileDefinitions(filePath: string): Array<string> {
        return this.#query.getFileDefinitions(filePath);
    }

    getFileReferences(filePath: string): Array<string> {
        return this.#query.getFileReferences(filePath);
    }

    removeFile(filePath: string): void {
        this.#remover.removeFile(filePath);
    }

    clear(): void {
        this.#remover.clear();
    }

    getSnapshot(): DependencyGraph {
        return this.#diagnostics.getSnapshot();
    }

    getStatistics(): {
        totalFiles: number;
        totalSymbols: number;
        filesWithDefs: number;
        filesWithRefs: number;
        averageDefsPerFile: number;
        averageRefsPerFile: number;
    } {
        return this.#diagnostics.getStatistics();
    }
}
