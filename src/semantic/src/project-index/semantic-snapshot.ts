import type { GmlSymbolDocumentation } from "./symbol-documentation.js";

/** A deterministic semantic source revision. */
export type SemanticSourceRevision = string & { readonly __semanticSourceRevision: unique symbol };

/** A monotonic project-wide semantic generation. */
export type SemanticGeneration = number & { readonly __semanticGeneration: unique symbol };

/** The semantic completeness tier represented by a snapshot. */
export type SemanticTier = "definitions" | "full";

/** One canonical SCIP-shaped symbol fact. */
export type SemanticSymbol = Readonly<{
    definingFilePath: string | null;
    displayName: string;
    documentation: GmlSymbolDocumentation;
    kind: string;
    name: string;
    scopeId: string | null;
    symbolId: string;
}>;

/** One file-owned definition or reference occurrence. */
export type SemanticOccurrence = Readonly<{
    end: number;
    filePath: string;
    role: "definition" | "reference";
    scopeId: string | null;
    start: number;
    symbolId: string;
}>;

/** One canonical scope fact. */
export type SemanticScope = Readonly<{
    displayName: string;
    filePaths: ReadonlyArray<string>;
    kind: string;
    name: string;
    resourcePath: string | null;
    scopeId: string;
}>;

/** One persisted GameMaker resource fact. */
export type SemanticResource = Readonly<{
    name: string;
    resourcePath: string;
    resourceType: string;
}>;

/** A relationship owned by the file that emitted it. */
export type SemanticRelationship = Readonly<{
    kind: string;
    ownerFilePath: string;
    payload: Readonly<Record<string, string | number | boolean | null>>;
    relationshipId: string;
}>;

/** A direct definition/resource-owner to dependent-file edge. */
export type SemanticDependency = Readonly<{
    dependentFilePath: string;
    kind: string;
    ownerFilePath: string;
    symbolId: string | null;
}>;

/** A project-level identifier unresolved by the full semantic tier. */
export type SemanticUnresolvedReference = Readonly<{
    end: number;
    filePath: string;
    name: string;
    start: number;
}>;

/** A normalized semantic snapshot for one project and tier. */
export type SemanticSnapshot = Readonly<{
    dependencies: ReadonlyArray<SemanticDependency>;
    occurrences: ReadonlyArray<SemanticOccurrence>;
    relationships: ReadonlyArray<SemanticRelationship>;
    resources: ReadonlyArray<SemanticResource>;
    scopes: ReadonlyArray<SemanticScope>;
    sourceRevision: SemanticSourceRevision;
    symbols: ReadonlyArray<SemanticSymbol>;
    tier: SemanticTier;
    unresolvedReferences: ReadonlyArray<SemanticUnresolvedReference>;
}>;
