// Public API: expose a single public coordinator type for external consumers.
export * from "./identifier-scope.js";
export * from "./occurrence.js";
export * from "./path-sorting.js";
export * from "./scope-override-keywords.js";
export * from "./types.js";

// Deliberately exclude `ScopeTracker` from the default public exports to enforce
// a clear architectural boundary. External consumers should use the
// `SemanticScopeCoordinator` facade. Higher-level modules within the semantic
// package can still import the underlying tracker classes if needed by
// referencing them explicitly.
export { IdentifierCacheManager } from "./identifier-cache-manager.js";
export { GlobalIdentifierRegistry } from "./registry.js";
export { IdentifierRoleTracker } from "./role-tracker.js";
export { Scope } from "./scope.js";
export { ScopeTracker } from "./scope-tracker.js";
