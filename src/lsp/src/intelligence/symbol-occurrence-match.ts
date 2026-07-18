import type { Semantic } from "@gmloop/semantic";

type SemanticIndexStore = ReturnType<typeof Semantic.openSemanticIndexStore>;
type SemanticSnapshotAcquireResult = Awaited<ReturnType<SemanticIndexStore["acquireSemanticSnapshot"]>>;
type SemanticSnapshotLease = Extract<SemanticSnapshotAcquireResult, Readonly<{ kind: "lease" }>>["lease"];
type SemanticSnapshotQueries = SemanticSnapshotLease["queries"];
type SemanticOccurrenceMatch = ReturnType<SemanticSnapshotQueries["findDefinitions"]>[number];
type ResolutionKind = SemanticOccurrenceMatch["occurrence"]["resolution"]["kind"];

/**
 * Read the canonical name from a symbol occurrence match.
 *
 * Collapses the `match.symbol.name` two-segment walk so collaborators do
 * not have to reach through the `symbol` sub-object just to compare a
 * typed identifier against the name pinned by the snapshot.
 */
export function readSymbolNameFromMatch(match: SemanticOccurrenceMatch): string {
    return match.symbol.name;
}

/**
 * Read the canonical semantic symbol identifier from a symbol occurrence
 * match.
 *
 * Collapses the `match.symbol.symbolId` walk used by rename, reference, and
 * definition lookups. Every collaborator that needs to feed the identifier
 * into another query can call this helper instead of repeating the
 * two-segment traversal at each call site.
 */
export function readSymbolIdFromMatch(match: SemanticOccurrenceMatch): string {
    return match.symbol.symbolId;
}

/**
 * Read the user-facing display name from a symbol occurrence match.
 *
 * Collapses the `match.symbol.displayName` walk used when emitting LSP
 * workspace symbol responses. Keeping the accessor next to its siblings
 * stops the file from accidentally reaching past `displayName` into
 * `name` (or vice versa) when it only needs the label.
 */
export function readSymbolDisplayNameFromMatch(match: SemanticOccurrenceMatch): string {
    return match.symbol.displayName;
}

/**
 * Read the symbol kind discriminator from a symbol occurrence match.
 *
 * Collapses the `match.symbol.kind` walk so collaborators that need to map
 * the kind to an LSP symbol kind (or semantic token type) only talk to a
 * single immediate neighbour.
 */
export function readSymbolKindFromMatch(match: SemanticOccurrenceMatch): string {
    return match.symbol.kind;
}

/**
 * Read the resolution-kind discriminator from a symbol occurrence match.
 *
 * Collapses the `match.occurrence.resolution.kind` three-segment walk so
 * collaborators that need to branch on certainty only have to read one
 * field. The returned string preserves the discriminated-union shape of
 * `SemanticOccurrenceResolution["kind"]` so callers stay narrowed.
 */
export function readResolutionKindFromMatch(match: SemanticOccurrenceMatch): ResolutionKind {
    return match.occurrence.resolution.kind;
}

/**
 * Return `true` when a symbol occurrence match resolves with full certainty.
 *
 * Collapses the `match.occurrence.resolution.kind === "exact"` three-segment
 * walk into a single boolean predicate. Collaborators that gate
 * safety-sensitive operations (rename, hover, go-to-definition) can call
 * this helper instead of repeating the nested resolution check at each
 * guard.
 */
export function hasExactResolution(match: SemanticOccurrenceMatch): boolean {
    return match.occurrence.resolution.kind === "exact";
}

/**
 * Read the occurrence role ("definition" or "reference") from a match.
 *
 * Collapses the `match.occurrence.role` walk for collaborators that
 * differentiate between definitions and references — for example, when
 * building semantic highlight payloads.
 */
export function readOccurrenceRoleFromMatch(match: SemanticOccurrenceMatch): "definition" | "reference" {
    return match.occurrence.role;
}

/**
 * Read the start offset of the occurrence from a match.
 *
 * Collapses the `match.occurrence.start` walk so callers building LSP
 * ranges or document positions only address a single neighbour.
 */
export function readOccurrenceStartFromMatch(match: SemanticOccurrenceMatch): number {
    return match.occurrence.start;
}

/**
 * Read the end offset of the occurrence from a match.
 *
 * Collapses the `match.occurrence.end` walk so callers building LSP
 * ranges or document positions only address a single neighbour.
 */
export function readOccurrenceEndFromMatch(match: SemanticOccurrenceMatch): number {
    return match.occurrence.end;
}

/**
 * Read the file path of the occurrence from a match.
 *
 * Collapses the `match.occurrence.filePath` walk so collaborators that
 * resolve occurrence locations do not have to traverse the nested
 * occurrence shape.
 */
export function readOccurrenceFilePathFromMatch(match: SemanticOccurrenceMatch): string {
    return match.occurrence.filePath;
}
