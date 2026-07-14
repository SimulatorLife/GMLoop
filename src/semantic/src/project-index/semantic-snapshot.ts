import type { GmlSymbolDocumentation } from "./symbol-documentation.js";

/** A deterministic semantic source revision. */
export type SemanticSourceRevision = string & { readonly __semanticSourceRevision: unique symbol };

/** A monotonic project-wide semantic generation. */
export type SemanticGeneration = number & { readonly __semanticGeneration: unique symbol };

/** The semantic completeness tier represented by a snapshot. */
export type SemanticTier = "definitions" | "full";

/** A semantic operation whose required facts are explicitly advertised by a snapshot. */
export type SemanticCapability =
    | "completion"
    | "definition"
    | "diagnostics"
    | "documentSymbols"
    | "hover"
    | "references"
    | "renameSafety"
    | "semanticTokens"
    | "workspaceSymbols";

/** Immutable source-coverage facts associated with an acquired snapshot. */
export type SemanticCoverage = Readonly<{
    analyzedFiles: ReadonlySet<string>;
    analyzedResources: ReadonlySet<string>;
    status: "complete";
}>;

/** Validation result associated with an acquired snapshot. */
export type SemanticValidationState = Readonly<{
    status: "valid";
}>;

/** Exact identity of a leased semantic snapshot. */
export type SemanticSnapshotIdentity = Readonly<{
    capabilities: ReadonlySet<SemanticCapability>;
    coverage: SemanticCoverage;
    generation: SemanticGeneration;
    overlayVersions: ReadonlyMap<string, number>;
    projectRevision: SemanticSourceRevision;
    tier: SemanticTier;
    validation: SemanticValidationState;
}>;

/** Facts a caller requires before it can safely consume a snapshot. */
export type SemanticSnapshotRequirements = Readonly<{
    capabilities: ReadonlySet<SemanticCapability>;
    overlayVersions: ReadonlyMap<string, number>;
    requiredFiles: ReadonlySet<string>;
    requiredResources: ReadonlySet<string>;
    tier: SemanticTier;
}>;

/** A request-pinned immutable snapshot. Release it once the request is complete. */
export type SemanticSnapshotLease = Readonly<{
    identity: SemanticSnapshotIdentity;
    release: () => void;
    snapshot: SemanticSnapshot;
}>;

/** A typed reason why a compatible snapshot could not be acquired. */
export type SemanticSnapshotAcquireFailure = Readonly<{
    kind: "cancelled" | "incompleteCoverage" | "missingCapability" | "missingSnapshot" | "overlayMismatch";
}>;

/** Result of an attempted snapshot acquisition. */
export type SemanticSnapshotAcquireResult =
    | Readonly<{ kind: "lease"; lease: SemanticSnapshotLease }>
    | Readonly<{ failure: SemanticSnapshotAcquireFailure; kind: "failure" }>;

/** Observable count of leases retaining a store-owned snapshot. */
export type SemanticSnapshotLeaseMetrics = Readonly<{
    activeLeaseCount: number;
}>;

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

/** The certainty of an occurrence binding in a semantic snapshot. */
export type SemanticOccurrenceResolution =
    | Readonly<{ kind: "exact" }>
    | Readonly<{ candidateSymbolIds: ReadonlyArray<string>; kind: "candidate"; uncertaintyReason: string }>
    | Readonly<{ kind: "dynamic"; uncertaintyReason: string }>
    | Readonly<{ candidateSymbolIds: ReadonlyArray<string>; kind: "ambiguous"; uncertaintyReason: string }>
    | Readonly<{ kind: "unresolved"; uncertaintyReason: string }>
    | Readonly<{ kind: "invalid"; uncertaintyReason: string }>;

/** A non-exact binding state that blocks safety-sensitive operations. */
export type SemanticUncertainResolution = Exclude<SemanticOccurrenceResolution, Readonly<{ kind: "exact" }>>;

/** One file-owned definition or reference occurrence. */
export type SemanticOccurrence = Readonly<{
    end: number;
    filePath: string;
    resolution: SemanticOccurrenceResolution;
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
    resolution: SemanticUncertainResolution;
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
