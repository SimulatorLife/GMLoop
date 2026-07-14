export * from "./abort-guard.js";
export * from "./bootstrap-descriptor.js";
export * from "./build-options.js";
export {
    buildProjectIndex,
    createProjectIndexCoordinator,
    publishBuiltProjectIndex,
    publishBuiltProjectIndexIncrement,
    resolveSemanticImpactFilePaths
} from "./builder.js";
export * from "./concurrency.js";
export * from "./constants.js";
export * from "./coordinator.js";
export * from "./fs-facade.js";
export * from "./gml-parser-facade.js";
export * from "./identifier-roles.js";
export * from "./identifier-sink.js";
export * from "./identifier-sink-policy.js";
export * from "./metrics.js";
export * from "./path-info.js";
export * from "./path-normalization.js";
export * from "./project-file-categories.js";
export * from "./project-index-logger.js";
export * from "./project-root.js";
export * from "./project-tree.js";
export * from "./rename-safety.js";
export * from "./resource-analysis.js";
export * from "./semantic-manifest.js";
export type {
    SemanticCapability,
    SemanticCoverage,
    SemanticDependency,
    SemanticGeneration,
    SemanticOccurrence,
    SemanticOccurrenceResolution,
    SemanticRelationship,
    SemanticResource,
    SemanticScope,
    SemanticSnapshot,
    SemanticSnapshotAcquireFailure,
    SemanticSnapshotAcquireResult,
    SemanticSnapshotIdentity,
    SemanticSnapshotLease,
    SemanticSnapshotLeaseMetrics,
    SemanticSnapshotRequirements,
    SemanticSourceRevision,
    SemanticSymbol,
    SemanticTier,
    SemanticUncertainResolution,
    SemanticUnresolvedReference
} from "./semantic-snapshot.js";
export { createSemanticSnapshotFromProjectIndex } from "./semantic-snapshot-codec.js";
export * from "./semantic-store.js";
export * from "./snapshot-refactor-queries.js";
export type { GmlSymbolDocumentation } from "./symbol-documentation.js";
export { createEmptyGmlSymbolDocumentation, parseGmlSymbolDocumentation } from "./symbol-documentation.js";
export * from "./syntax-error-formatter.js";
