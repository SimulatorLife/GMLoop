import type { SemanticOccurrence, SemanticSymbol } from "./semantic-snapshot.js";
import type { SemanticSnapshotRefactorQueries } from "./snapshot-refactor-queries.js";

/** A symbol occurrence paired with the canonical symbol fact it resolves to. */
export type SemanticSymbolOccurrenceMatch = Readonly<{
    occurrence: SemanticOccurrence;
    symbol: SemanticSymbol;
}>;

/** One ordered enum member returned by a pinned semantic query. */
export type SemanticEnumMember = Readonly<{
    name: string;
    order: number;
    symbolId: string;
    value: string | null;
}>;

/** A project resource paired with the GML files owned by its semantic scopes. */
export type SemanticResourceQueryResult = Readonly<{
    filePaths: ReadonlyArray<string>;
    name: string;
    resourcePath: string;
    resourceType: string;
}>;

/**
 * Indexed semantic reads bound to one immutable snapshot lease.
 *
 * Every method observes the exact identity on the owning lease. Consumers must
 * release that lease after completing the request.
 */
export type SemanticSnapshotQueries = Readonly<{
    /** Find the smallest, most-specific occurrence covering a UTF-16 offset. */
    findSymbolAtPosition: (filePath: string, offset: number) => SemanticSymbolOccurrenceMatch | null;
    /** Read one canonical symbol by its stable semantic identifier. */
    findSymbol: (symbolId: string) => SemanticSymbol | null;
    /** Resolve the deterministic preferred symbol identifier for an exact name. */
    resolveSymbolId: (name: string) => string | null;
    /** Return whether the pinned snapshot contains a symbol identifier. */
    hasSymbol: (symbolId: string) => boolean;
    /** List definitions for a symbol in deterministic source order. */
    findDefinitions: (symbolId: string) => ReadonlyArray<SemanticSymbolOccurrenceMatch>;
    /** List references, optionally including definitions, in deterministic source order. */
    findReferences: (symbolId: string, includeDefinitions: boolean) => ReadonlyArray<SemanticSymbolOccurrenceMatch>;
    /** List definitions owned by one file in deterministic source order. */
    listDocumentSymbols: (filePath: string) => ReadonlyArray<SemanticSymbolOccurrenceMatch>;
    /** Search canonical symbols by display name with a bounded result count. */
    searchWorkspaceSymbols: (query: string, limit: number) => ReadonlyArray<SemanticSymbol>;
    /** List all resolved occurrences in one file in deterministic source order. */
    listFileOccurrences: (filePath: string) => ReadonlyArray<SemanticSymbolOccurrenceMatch>;
    /** List project resources in deterministic resource-path order. */
    listResources: () => ReadonlyArray<SemanticResourceQueryResult>;
    /** Resolve only resources whose exact names occur in the caller's bounded input set. */
    findResourcesByNames: (names: ReadonlyArray<string>) => ReadonlyArray<SemanticResourceQueryResult>;
    /** Resolve the enum that owns an enum or enum-member symbol. */
    findEnumOwner: (symbolId: string) => SemanticSymbol | null;
    /** List the ordered members belonging to an enum symbol. */
    listEnumMembers: (symbolId: string) => ReadonlyArray<SemanticEnumMember>;
    /** Snapshot-pinned semantic facts consumed by refactor planning. */
    refactor: SemanticSnapshotRefactorQueries;
}>;
