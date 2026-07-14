import path from "node:path";

import { Core } from "@gmloop/core";

import { openGraphIndexDatabase } from "../graph-index/database.js";
import { type GraphDatabase, runGraphDatabaseImmediateTransaction } from "../graph-index/sqlite-adapter.js";
import type { SemanticFileManifest, SemanticFileManifestEntry } from "./semantic-manifest.js";
import type {
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
import {
    createEmptyGmlSymbolDocumentation,
    type GmlSymbolDocumentation,
    parseGmlSymbolDocumentation
} from "./symbol-documentation.js";

type SemanticNavigationProjectionRow = Readonly<{
    generation: number;
    payload: string;
}>;

type SemanticManifestRow = Readonly<{
    content_hash: string;
    file_kind: "gml" | "projectManifest" | "resourceMetadata";
    mtime_ms: number | null;
    relative_path: string;
    size_bytes: number;
    source_origin: "disk" | "openBuffer";
    source_version: number | null;
}>;

export type SemanticStoreState = Readonly<{
    baseGeneration: number | null;
    generation: number;
    projectRoot: string;
    sourceSignature: string;
    tier: "definitions" | "full";
}>;

/** Monotonic project-wide semantic publication boundary. */
export type SemanticProjectHead = Readonly<{
    generation: number;
    projectRoot: string;
}>;

/** Result of a generation-guarded semantic publication attempt. */
export type SemanticPublishResult = Readonly<{
    state: SemanticStoreState | null;
    /** `notPersisted` means a valid session-local overlay was deliberately kept out of shared storage. */
    status: "notPersisted" | "published" | "superseded";
}>;

/** Active tier descriptors and whether a full slot matches the newest facts. */
export type SemanticActiveSlots = Readonly<{
    definitions: SemanticStoreState | null;
    full: SemanticStoreState | null;
    hasMatchingFull: boolean;
    newestDefinitionsRevision: string | null;
}>;

/** Complete cold/recovery publication replacing one semantic tier. */
export type SemanticSnapshotPublicationRequest = Readonly<{
    authoritative: boolean;
    baseGeneration: number | null;
    expectedHeadGeneration: number;
    manifest: SemanticFileManifest | null;
    navigationProjection: Readonly<Record<string, unknown>>;
    snapshot: SemanticSnapshot;
    sourceRevision: string;
    tier: SemanticTier;
}>;

/** Atomic normalized-row publication for one complete impacted file set. */
export type SemanticIncrementPublicationRequest = SemanticSnapshotPublicationRequest &
    Readonly<{ affectedFiles: ReadonlyArray<string> }>;

/** An immutable, overlay-backed snapshot retained only for the current semantic-store session. */
export type SemanticSessionSnapshotPublicationRequest = Readonly<{
    manifest: SemanticFileManifest;
    snapshot: SemanticSnapshot;
}>;

/** Result of attempting to publish a session-local overlay snapshot. */
export type SemanticSessionSnapshotPublishResult =
    | Readonly<{ identity: SemanticSnapshotIdentity; kind: "published" }>
    | Readonly<{ kind: "incompatibleDefinitions" | "invalidOverlay" | "invalidSnapshot" }>;

/** Complete project snapshot published through definitions and matching-full tiers. */
export type SemanticTwoTierPublicationRequest = Readonly<{
    definitionsSnapshot: SemanticSnapshot;
    fullSnapshot: SemanticSnapshot;
    manifest: SemanticFileManifest | null;
    navigationProjection: Readonly<Record<string, unknown>>;
    sourceRevision: string;
}>;

export type SemanticIndexStore = Readonly<{
    /** Acquire an immutable, capability-qualified snapshot lease for one request. */
    acquireSemanticSnapshot: (
        requirements: SemanticSnapshotRequirements,
        signal: AbortSignal
    ) => SemanticSnapshotAcquireResult;
    /** Flushes all accepted semantic publications. */
    flush: () => Promise<void>;
    /** Flushes accepted work and closes the SQLite connection. */
    close: () => Promise<void>;
    /** Reads both active tier descriptors and their exact revision compatibility. */
    readActiveSemanticSlots: () => SemanticActiveSlots;
    /** Reads the persisted file manifest for one semantic tier. */
    readSemanticManifest: (tier: SemanticTier) => SemanticFileManifest | null;
    /** Returns the number of leases retaining a snapshot in this store. */
    readSemanticSnapshotLeaseMetrics: () => SemanticSnapshotLeaseMetrics;
    /** Reads the generation-checked derived navigation payload used for warm restore. */
    readSemanticNavigationProjection: (tier: SemanticTier) => Record<string, unknown> | null;
    /** Reads the project-wide compare-and-publish generation boundary. */
    readSemanticProjectHead: () => SemanticProjectHead;
    /** Reconstructs the canonical normalized semantic facts for one tier. */
    readSemanticSnapshot: (tier: SemanticTier) => SemanticSnapshot | null;
    applySemanticIncrement: (request: SemanticIncrementPublicationRequest) => SemanticPublishResult;
    publishSemanticSnapshot: (request: SemanticSnapshotPublicationRequest) => SemanticPublishResult;
    /** Retains an overlay-backed snapshot in memory without writing unsaved content to SQLite. */
    publishSessionSemanticSnapshot: (
        request: SemanticSessionSnapshotPublicationRequest
    ) => SemanticSessionSnapshotPublishResult;
    findImmediateDownstreamFiles: (filePath: string) => ReadonlyArray<string>;
    findUnresolvedDependents: (identifierNames: ReadonlyArray<string>) => ReadonlyArray<string>;
}>;

function normalizeSemanticFilePath(projectRoot: string, filePath: string): string {
    const relativePath = path.isAbsolute(filePath) ? path.relative(projectRoot, filePath) : filePath;
    return path.normalize(relativePath).split(path.sep).join("/").replaceAll("\\", "/");
}

function createAffectedFileSet(
    projectRoot: string,
    affectedFiles: ReadonlyArray<string> | null
): ReadonlySet<string> | null {
    return affectedFiles === null
        ? null
        : new Set(affectedFiles.map((filePath) => normalizeSemanticFilePath(projectRoot, filePath)));
}

function containsSessionLocalOverlay(manifest: SemanticFileManifest | null): boolean {
    if (manifest === null) {
        return false;
    }
    return [...manifest.entries.values()].some((entry) => entry.sourceOrigin === "openBuffer");
}

function isAffectedSemanticFile(affectedFiles: ReadonlySet<string> | null, filePath: string | null): boolean {
    return affectedFiles === null || (filePath !== null && affectedFiles.has(filePath));
}

function createSnapshotCapabilities(tier: SemanticTier): ReadonlySet<SemanticCapability> {
    const capabilities: ReadonlySet<SemanticCapability> =
        tier === "definitions"
            ? new Set(["completion", "definition", "documentSymbols", "hover", "semanticTokens", "workspaceSymbols"])
            : new Set([
                  "completion",
                  "definition",
                  "diagnostics",
                  "documentSymbols",
                  "hover",
                  "references",
                  "renameSafety",
                  "semanticTokens",
                  "workspaceSymbols"
              ]);
    return Object.freeze(capabilities);
}

function createSnapshotCoverage(
    projectRoot: string,
    manifest: SemanticFileManifest | null,
    snapshot: SemanticSnapshot
): SemanticCoverage {
    const analyzedFiles = new Set<string>();
    for (const filePath of manifest?.entries.keys() ?? []) {
        analyzedFiles.add(normalizeSemanticFilePath(projectRoot, filePath));
    }
    for (const occurrence of snapshot.occurrences) {
        analyzedFiles.add(normalizeSemanticFilePath(projectRoot, occurrence.filePath));
    }
    for (const scope of snapshot.scopes) {
        for (const filePath of scope.filePaths) {
            analyzedFiles.add(normalizeSemanticFilePath(projectRoot, filePath));
        }
    }
    return Object.freeze({
        analyzedFiles: Object.freeze(analyzedFiles),
        analyzedResources: Object.freeze(new Set(snapshot.resources.map((resource) => resource.resourcePath))),
        status: "complete"
    });
}

function createSnapshotIdentity(
    generation: number,
    snapshot: SemanticSnapshot,
    coverage: SemanticCoverage,
    overlayVersions: ReadonlyMap<string, number> = new Map()
): SemanticSnapshotIdentity {
    return Object.freeze({
        capabilities: createSnapshotCapabilities(snapshot.tier),
        coverage,
        generation: generation as SemanticGeneration,
        overlayVersions: Object.freeze(new Map(overlayVersions)),
        projectRevision: snapshot.sourceRevision,
        tier: snapshot.tier,
        validation: Object.freeze({ status: "valid" })
    });
}

function normalizeOverlayVersions(
    projectRoot: string,
    overlayVersions: ReadonlyMap<string, number>
): ReadonlyMap<string, number> {
    return new Map(
        [...overlayVersions.entries()].map(([filePath, documentVersion]) => [
            normalizeSemanticFilePath(projectRoot, filePath),
            documentVersion
        ])
    );
}

function createManifestOverlayVersions(
    projectRoot: string,
    manifest: SemanticFileManifest
): ReadonlyMap<string, number> | null {
    const overlayVersions = new Map<string, number>();
    for (const entry of manifest.entries.values()) {
        if (entry.sourceOrigin !== "openBuffer") {
            continue;
        }
        if (entry.sourceVersion === null) {
            return null;
        }
        overlayVersions.set(normalizeSemanticFilePath(projectRoot, entry.relativePath), entry.sourceVersion);
    }
    return overlayVersions.size > 0 ? overlayVersions : null;
}

function areOverlayVersionsEqual(
    projectRoot: string,
    left: ReadonlyMap<string, number>,
    right: ReadonlyMap<string, number>
): boolean {
    const normalizedLeft = normalizeOverlayVersions(projectRoot, left);
    const normalizedRight = normalizeOverlayVersions(projectRoot, right);
    return (
        normalizedLeft.size === normalizedRight.size &&
        [...normalizedLeft.entries()].every(
            ([filePath, documentVersion]) => normalizedRight.get(filePath) === documentVersion
        )
    );
}

function areSnapshotRequirementsSatisfied(
    projectRoot: string,
    identity: SemanticSnapshotIdentity,
    requirements: SemanticSnapshotRequirements
): SemanticSnapshotAcquireFailure | null {
    if (!areOverlayVersionsEqual(projectRoot, identity.overlayVersions, requirements.overlayVersions)) {
        return Object.freeze({ kind: "overlayMismatch" });
    }
    if (![...requirements.capabilities].every((capability) => identity.capabilities.has(capability))) {
        return Object.freeze({ kind: "missingCapability" });
    }
    const hasRequiredFileCoverage = [...requirements.requiredFiles].every((filePath) =>
        identity.coverage.analyzedFiles.has(normalizeSemanticFilePath(projectRoot, filePath))
    );
    const hasRequiredResourceCoverage = [...requirements.requiredResources].every((resourcePath) =>
        identity.coverage.analyzedResources.has(resourcePath)
    );
    return hasRequiredFileCoverage && hasRequiredResourceCoverage
        ? null
        : Object.freeze({ kind: "incompleteCoverage" });
}

function readSymbolIdsDefinedByFiles(
    database: GraphDatabase,
    projectRoot: string,
    tier: SemanticTier,
    affectedFiles: ReadonlySet<string> | null
): ReadonlySet<string> {
    if (affectedFiles === null || affectedFiles.size === 0) {
        return new Set();
    }
    const paths = [...affectedFiles];
    const placeholders = paths.map(() => "?").join(", ");
    const rows = database
        .prepare(
            `SELECT DISTINCT symbol_id FROM semantic_occurrences WHERE project_root = ? AND tier = ? AND role = 'definition' AND file_path IN (${placeholders})`
        )
        .all(projectRoot, tier, ...paths) as unknown as ReadonlyArray<{ symbol_id: string }>;
    return new Set(rows.map((row) => row.symbol_id));
}

function readScopeIdsOwnedByFiles(
    database: GraphDatabase,
    projectRoot: string,
    tier: SemanticTier,
    affectedFiles: ReadonlySet<string> | null
): ReadonlySet<string> {
    if (affectedFiles === null || affectedFiles.size === 0) {
        return new Set();
    }
    const paths = [...affectedFiles];
    const placeholders = paths.map(() => "?").join(", ");
    const rows = database
        .prepare(
            `SELECT DISTINCT scope_id FROM semantic_scope_files WHERE project_root = ? AND tier = ? AND file_path IN (${placeholders}) UNION SELECT scope_id FROM semantic_scopes WHERE project_root = ? AND tier = ? AND resource_path IN (${placeholders})`
        )
        .all(projectRoot, tier, ...paths, projectRoot, tier, ...paths) as unknown as ReadonlyArray<{
        scope_id: string;
    }>;
    return new Set(rows.map((row) => row.scope_id));
}

function deleteAffectedRows(
    database: GraphDatabase,
    projectRoot: string,
    tier: SemanticTier,
    affectedFiles: ReadonlySet<string> | null
): void {
    if (affectedFiles === null) {
        for (const tableName of [
            "semantic_dependencies",
            "semantic_occurrences",
            "semantic_scope_files",
            "semantic_relationships",
            "semantic_symbols",
            "semantic_scopes",
            "semantic_resources",
            "semantic_files",
            "semantic_unresolved_references"
        ]) {
            database.prepare(`DELETE FROM ${tableName} WHERE project_root = ? AND tier = ?`).run(projectRoot, tier);
        }
        return;
    }
    if (affectedFiles.size === 0) {
        return;
    }
    const paths = [...affectedFiles];
    const placeholders = paths.map(() => "?").join(", ");
    const parameters = [projectRoot, tier, ...paths];
    database
        .prepare(
            `DELETE FROM semantic_dependencies WHERE project_root = ? AND tier = ? AND (owner_file_path IN (${placeholders}) OR dependent_file_path IN (${placeholders}))`
        )
        .run(...parameters, ...paths);
    database
        .prepare(
            `DELETE FROM semantic_scope_files WHERE project_root = ? AND tier = ? AND file_path IN (${placeholders})`
        )
        .run(...parameters);
    database
        .prepare(
            `DELETE FROM semantic_occurrences WHERE project_root = ? AND tier = ? AND file_path IN (${placeholders})`
        )
        .run(...parameters);
    database
        .prepare(
            `DELETE FROM semantic_relationships WHERE project_root = ? AND tier = ? AND owner_file_path IN (${placeholders})`
        )
        .run(...parameters);
    database
        .prepare(
            `DELETE FROM semantic_unresolved_references WHERE project_root = ? AND tier = ? AND file_path IN (${placeholders})`
        )
        .run(...parameters);
    database
        .prepare(
            `DELETE FROM semantic_files WHERE project_root = ? AND tier = ? AND relative_path IN (${placeholders})`
        )
        .run(...parameters);
    database
        .prepare(
            `DELETE FROM semantic_resources WHERE project_root = ? AND tier = ? AND resource_path IN (${placeholders})`
        )
        .run(...parameters);
}

function parseRecordPayload(payload: string): unknown {
    try {
        return JSON.parse(payload) as unknown;
    } catch {
        return null;
    }
}

function readSemanticManifest(
    database: GraphDatabase,
    projectRoot: string,
    tier: "definitions" | "full"
): SemanticFileManifest | null {
    const state = readSemanticSlotState(database, projectRoot, tier);
    if (state === null || state.sourceSignature.length === 0) {
        return null;
    }
    const rows = database
        .prepare(
            "SELECT relative_path, file_kind, content_hash, size_bytes, mtime_ms, source_origin, source_version FROM semantic_files WHERE project_root = ? AND tier = ? ORDER BY relative_path"
        )
        .all(projectRoot, tier) as unknown as ReadonlyArray<SemanticManifestRow>;
    if (rows.length === 0) {
        return null;
    }
    const entries = new Map<string, SemanticFileManifestEntry>(
        rows.map((row) => [
            row.relative_path,
            Object.freeze({
                contentHash: row.content_hash,
                fileKind: row.file_kind,
                mtimeMs: row.mtime_ms,
                relativePath: row.relative_path,
                sizeBytes: row.size_bytes,
                sourceOrigin: row.source_origin,
                sourceVersion: row.source_version
            })
        ])
    );
    return Object.freeze({ entries, sourceRevision: state.sourceSignature as SemanticFileManifest["sourceRevision"] });
}

function parsePersistedDocumentation(value: string): GmlSymbolDocumentation {
    const parsed = parseRecordPayload(value);
    const record = Core.isObjectLike(parsed) ? Object.fromEntries(Object.entries(parsed)) : null;
    if (record === null || typeof record.normalizedText !== "string") {
        return createEmptyGmlSymbolDocumentation();
    }
    // The parser remains the single documentation normalization owner. The
    // persisted structured representation is used when valid and gracefully
    // repaired from its normalized text when a future schema changes shape.
    return parseGmlSymbolDocumentation(record.normalizedText);
}

function parseOccurrenceResolution(value: string): SemanticOccurrenceResolution | null {
    const parsed = parseRecordPayload(value);
    if (!Core.isObjectLike(parsed)) {
        return null;
    }
    const record = Object.fromEntries(Object.entries(parsed));
    if (record.kind === "exact") {
        return Object.freeze({ kind: "exact" });
    }
    const uncertaintyReason = typeof record.uncertaintyReason === "string" ? record.uncertaintyReason : null;
    if (uncertaintyReason === null) {
        return null;
    }
    if (record.kind === "dynamic" || record.kind === "unresolved" || record.kind === "invalid") {
        return Object.freeze({ kind: record.kind, uncertaintyReason });
    }
    if (record.kind !== "candidate" && record.kind !== "ambiguous") {
        return null;
    }
    const candidateSymbolIds = Array.isArray(record.candidateSymbolIds)
        ? record.candidateSymbolIds.filter((candidate): candidate is string => typeof candidate === "string")
        : [];
    return Object.freeze({
        candidateSymbolIds: Object.freeze(candidateSymbolIds),
        kind: record.kind,
        uncertaintyReason
    });
}

function parseUncertainResolution(value: string): SemanticUncertainResolution | null {
    const resolution = parseOccurrenceResolution(value);
    return resolution === null || resolution.kind === "exact" ? null : resolution;
}

/** Read normalized current-schema facts without decoding the optional navigation projection. */
function readSemanticSnapshot(
    database: GraphDatabase,
    projectRoot: string,
    tier: SemanticTier
): SemanticSnapshot | null {
    const state = readSemanticSlotState(database, projectRoot, tier);
    if (state === null) {
        return null;
    }
    const symbols = database
        .prepare(
            "SELECT symbol_id, kind, name, display_name, defining_file_path, scope_id, documentation_json FROM semantic_symbols WHERE project_root = ? AND tier = ? ORDER BY symbol_id"
        )
        .all(projectRoot, tier)
        .flatMap(
            (row): ReadonlyArray<SemanticSymbol> =>
                typeof row.symbol_id === "string" &&
                typeof row.kind === "string" &&
                typeof row.name === "string" &&
                typeof row.display_name === "string" &&
                typeof row.documentation_json === "string"
                    ? [
                          Object.freeze({
                              definingFilePath:
                                  typeof row.defining_file_path === "string" ? row.defining_file_path : null,
                              displayName: row.display_name,
                              documentation: parsePersistedDocumentation(row.documentation_json),
                              kind: row.kind,
                              name: row.name,
                              scopeId: typeof row.scope_id === "string" ? row.scope_id : null,
                              symbolId: row.symbol_id
                          })
                      ]
                    : []
        );
    const occurrences = database
        .prepare(
            "SELECT symbol_id, file_path, role, start_offset, end_offset, scope_id, resolution_json FROM semantic_occurrences WHERE project_root = ? AND tier = ? ORDER BY file_path, start_offset, symbol_id"
        )
        .all(projectRoot, tier)
        .flatMap((row): ReadonlyArray<SemanticOccurrence> => {
            const resolution =
                typeof row.resolution_json === "string" ? parseOccurrenceResolution(row.resolution_json) : null;
            return typeof row.symbol_id === "string" &&
                typeof row.file_path === "string" &&
                (row.role === "definition" || row.role === "reference") &&
                typeof row.start_offset === "number" &&
                typeof row.end_offset === "number" &&
                resolution !== null
                ? [
                      Object.freeze({
                          end: row.end_offset,
                          filePath: row.file_path,
                          resolution,
                          role: row.role,
                          scopeId: typeof row.scope_id === "string" ? row.scope_id : null,
                          start: row.start_offset,
                          symbolId: row.symbol_id
                      })
                  ]
                : [];
        });
    const scopeFilePaths = new Map<string, string[]>();
    for (const row of database
        .prepare(
            "SELECT scope_id, file_path FROM semantic_scope_files WHERE project_root = ? AND tier = ? ORDER BY scope_id, file_path"
        )
        .all(projectRoot, tier)) {
        if (typeof row.scope_id !== "string" || typeof row.file_path !== "string") {
            continue;
        }
        const filePaths = Core.getOrCreateMapEntry(scopeFilePaths, row.scope_id, () => []);
        filePaths.push(row.file_path);
    }
    const scopes = database
        .prepare(
            "SELECT scope_id, kind, name, display_name, resource_path FROM semantic_scopes WHERE project_root = ? AND tier = ? ORDER BY scope_id"
        )
        .all(projectRoot, tier)
        .flatMap(
            (row): ReadonlyArray<SemanticScope> =>
                typeof row.scope_id === "string" &&
                typeof row.kind === "string" &&
                typeof row.name === "string" &&
                typeof row.display_name === "string"
                    ? [
                          Object.freeze({
                              displayName: row.display_name,
                              filePaths: Object.freeze(scopeFilePaths.get(row.scope_id) ?? []),
                              kind: row.kind,
                              name: row.name,
                              resourcePath: typeof row.resource_path === "string" ? row.resource_path : null,
                              scopeId: row.scope_id
                          })
                      ]
                    : []
        );
    const resources = database
        .prepare(
            "SELECT resource_path, name, resource_type FROM semantic_resources WHERE project_root = ? AND tier = ? ORDER BY resource_path"
        )
        .all(projectRoot, tier)
        .flatMap(
            (row): ReadonlyArray<SemanticResource> =>
                typeof row.resource_path === "string" &&
                typeof row.name === "string" &&
                typeof row.resource_type === "string"
                    ? [
                          Object.freeze({
                              name: row.name,
                              resourcePath: row.resource_path,
                              resourceType: row.resource_type
                          })
                      ]
                    : []
        );
    const relationships = database
        .prepare(
            "SELECT relationship_id, owner_file_path, relationship_kind, payload_json FROM semantic_relationships WHERE project_root = ? AND tier = ? ORDER BY relationship_id"
        )
        .all(projectRoot, tier)
        .flatMap((row): ReadonlyArray<SemanticRelationship> => {
            const payload = typeof row.payload_json === "string" ? parseRecordPayload(row.payload_json) : null;
            if (
                typeof row.relationship_id !== "string" ||
                typeof row.owner_file_path !== "string" ||
                typeof row.relationship_kind !== "string" ||
                !Core.isObjectLike(payload)
            ) {
                return [];
            }
            const values = Object.entries(payload).flatMap(([key, value]) =>
                typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
                    ? [[key, value] as const]
                    : []
            );
            return [
                Object.freeze({
                    kind: row.relationship_kind,
                    ownerFilePath: row.owner_file_path,
                    payload: Object.freeze(Object.fromEntries(values)),
                    relationshipId: row.relationship_id
                })
            ];
        });
    const dependencies = database
        .prepare(
            "SELECT owner_file_path, dependent_file_path, dependency_kind, symbol_id FROM semantic_dependencies WHERE project_root = ? AND tier = ? ORDER BY owner_file_path, dependent_file_path, dependency_kind"
        )
        .all(projectRoot, tier)
        .flatMap(
            (row): ReadonlyArray<SemanticDependency> =>
                typeof row.owner_file_path === "string" &&
                typeof row.dependent_file_path === "string" &&
                typeof row.dependency_kind === "string"
                    ? [
                          Object.freeze({
                              dependentFilePath: row.dependent_file_path,
                              kind: row.dependency_kind,
                              ownerFilePath: row.owner_file_path,
                              symbolId: typeof row.symbol_id === "string" ? row.symbol_id : null
                          })
                      ]
                    : []
        );
    const unresolvedReferences = database
        .prepare(
            "SELECT name, file_path, start_offset, end_offset, resolution_json FROM semantic_unresolved_references WHERE project_root = ? AND tier = ? ORDER BY file_path, start_offset, name"
        )
        .all(projectRoot, tier)
        .flatMap((row): ReadonlyArray<SemanticUnresolvedReference> => {
            const resolution =
                typeof row.resolution_json === "string" ? parseUncertainResolution(row.resolution_json) : null;
            return typeof row.name === "string" &&
                typeof row.file_path === "string" &&
                typeof row.start_offset === "number" &&
                typeof row.end_offset === "number" &&
                resolution !== null
                ? [
                      Object.freeze({
                          end: row.end_offset,
                          filePath: row.file_path,
                          name: row.name,
                          resolution,
                          start: row.start_offset
                      })
                  ]
                : [];
        });
    return Object.freeze({
        dependencies: Object.freeze(dependencies),
        occurrences: Object.freeze(occurrences),
        relationships: Object.freeze(relationships),
        resources: Object.freeze(resources),
        scopes: Object.freeze(scopes),
        sourceRevision: state.sourceSignature as SemanticSourceRevision,
        symbols: Object.freeze(symbols),
        tier,
        unresolvedReferences: Object.freeze(unresolvedReferences)
    });
}

function findImmediateDownstreamFiles(
    database: GraphDatabase,
    projectRoot: string,
    filePath: string
): ReadonlyArray<string> {
    return (
        database
            .prepare(
                "SELECT dependent_file_path AS downstream_file FROM semantic_dependencies WHERE project_root = ? AND tier = 'full' AND owner_file_path = ? ORDER BY dependent_file_path"
            )
            .all(projectRoot, filePath) as unknown as ReadonlyArray<{ downstream_file: string }>
    ).map((row) => row.downstream_file);
}

function findUnresolvedDependents(
    database: GraphDatabase,
    projectRoot: string,
    identifierNames: ReadonlyArray<string>
): ReadonlyArray<string> {
    const names = [...new Set(identifierNames.filter((name) => name.length > 0))];
    if (names.length === 0) {
        return [];
    }
    const placeholders = names.map(() => "?").join(", ");
    const rows = database
        .prepare(
            `SELECT DISTINCT file_path AS owner_file FROM semantic_unresolved_references WHERE project_root = ? AND tier = 'full' AND name IN (${placeholders}) ORDER BY file_path`
        )
        .all(projectRoot, ...names) as unknown as ReadonlyArray<{ owner_file: string }>;
    return rows.map((row) => row.owner_file);
}

function createStorePath(projectRoot: string): string {
    return path.join(path.resolve(projectRoot), ".gmloop", "graph-index.sqlite");
}

function flushSynchronousSemanticPublications(): Promise<void> {
    // SQLite publications are synchronous transactions. The promise preserves
    // an awaitable lifecycle boundary without exposing that implementation.
    return Promise.resolve();
}

function readSemanticSlotState(
    database: GraphDatabase,
    projectRoot: string,
    tier: "definitions" | "full"
): SemanticStoreState | null {
    const row = database
        .prepare(
            "SELECT base_generation, generation, tier, source_revision FROM semantic_slots WHERE project_root = ? AND tier = ?"
        )
        .get(projectRoot, tier) as
        | { base_generation?: number | null; generation?: number; source_revision?: string; tier?: string }
        | undefined;
    if (!row || (row.tier !== "definitions" && row.tier !== "full") || typeof row.generation !== "number") {
        return null;
    }
    return Object.freeze({
        baseGeneration: typeof row.base_generation === "number" ? row.base_generation : null,
        generation: row.generation,
        projectRoot,
        sourceSignature: row.source_revision ?? "",
        tier: row.tier
    });
}

function readSemanticProjectHead(database: GraphDatabase, projectRoot: string): SemanticProjectHead {
    const row = database
        .prepare("SELECT head_generation FROM semantic_projects WHERE project_root = ?")
        .get(projectRoot) as { head_generation?: number } | undefined;
    return Object.freeze({ generation: row?.head_generation ?? 0, projectRoot });
}

function readActiveSemanticSlots(database: GraphDatabase, projectRoot: string): SemanticActiveSlots {
    const definitions = readSemanticSlotState(database, projectRoot, "definitions");
    const full = readSemanticSlotState(database, projectRoot, "full");
    // Definitions are the authoritative navigation boundary whenever they
    // exist. A full slot is usable for reference operations only when it was
    // derived from that exact source revision; generation ordering alone is
    // insufficient because the slots publish independently.
    const definitionsCapable = definitions ?? full;
    return Object.freeze({
        definitions,
        full,
        hasMatchingFull:
            full !== null &&
            definitionsCapable !== null &&
            full.sourceSignature.length > 0 &&
            full.sourceSignature === definitionsCapable.sourceSignature,
        newestDefinitionsRevision: definitionsCapable?.sourceSignature || null
    });
}

function readSemanticNavigationProjection(
    database: GraphDatabase,
    projectRoot: string,
    tier: "definitions" | "full"
): Record<string, unknown> | null {
    const state = readSemanticSlotState(database, projectRoot, tier);
    if (!state) {
        return null;
    }

    const projection = database
        .prepare(
            "SELECT generation, payload FROM semantic_navigation_projection WHERE project_root = ? AND tier = ? AND generation = ?"
        )
        .get(projectRoot, state.tier, state.generation) as SemanticNavigationProjectionRow | undefined;
    if (projection) {
        const projectedIndex = parseRecordPayload(projection.payload);
        if (Core.isObjectLike(projectedIndex)) {
            return projectedIndex as Record<string, unknown>;
        }
    }

    // The projection is the warm-restore acceleration payload. Normalized
    // v6 facts are authoritative; a corrupt projection is treated as a cache
    // miss until the typed reconstruction path is available.
    return null;
}

function publishSemanticFacts(
    database: GraphDatabase,
    projectRoot: string,
    request: Readonly<{
        expectedHeadGeneration: number | null;
        authoritative: boolean;
        affectedFiles: ReadonlyArray<string> | null;
        baseGeneration: number | null;
        manifest: SemanticFileManifest | null;
        navigationProjection: Readonly<Record<string, unknown>>;
        snapshot: SemanticSnapshot;
        sourceRevision: string;
        tier: "definitions" | "full";
    }>
): SemanticPublishResult {
    let publishedState: SemanticStoreState | null = null;
    const updatedAt = new Date().toISOString();
    const snapshot = request.snapshot;

    // Open documents are session-local editor state. Persisting a revision
    // derived from one would leak unsaved content into a later process, where
    // its revision could be mistaken for disk-backed project truth.
    if (containsSessionLocalOverlay(request.manifest)) {
        return Object.freeze({ state: null, status: "notPersisted" });
    }

    if (snapshot.tier !== request.tier || snapshot.sourceRevision !== request.sourceRevision) {
        return Object.freeze({ state: null, status: "superseded" });
    }

    runGraphDatabaseImmediateTransaction(database, () => {
        const head = database
            .prepare("SELECT head_generation FROM semantic_projects WHERE project_root = ?")
            .get(projectRoot) as { head_generation?: number } | undefined;
        const currentHeadGeneration = head?.head_generation ?? 0;
        if (request.expectedHeadGeneration !== null && currentHeadGeneration !== request.expectedHeadGeneration) {
            return;
        }
        const currentSlot = database
            .prepare("SELECT generation FROM semantic_slots WHERE project_root = ? AND tier = ?")
            .get(projectRoot, request.tier) as { generation?: number } | undefined;
        const currentSlotGeneration = typeof currentSlot?.generation === "number" ? currentSlot.generation : null;
        if (currentSlotGeneration !== request.baseGeneration) {
            return;
        }
        if (request.tier === "full") {
            const definitionsSlot = database
                .prepare("SELECT source_revision FROM semantic_slots WHERE project_root = ? AND tier = 'definitions'")
                .get(projectRoot) as { source_revision?: string } | undefined;
            const definitionsRevision = definitionsSlot?.source_revision;
            if (
                request.authoritative
                    ? definitionsRevision !== undefined
                    : definitionsRevision !== request.sourceRevision
            ) {
                return;
            }
        }
        const generation = currentHeadGeneration + 1;
        database
            .prepare(
                "INSERT INTO semantic_projects(project_root, head_generation, semantic_format_version, updated_at) VALUES (?, ?, 6, ?) ON CONFLICT(project_root) DO UPDATE SET head_generation = excluded.head_generation, semantic_format_version = excluded.semantic_format_version, updated_at = excluded.updated_at"
            )
            .run(projectRoot, generation, updatedAt);
        database
            .prepare(
                "INSERT INTO semantic_slots(project_root, tier, generation, source_revision, base_generation, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_root, tier) DO UPDATE SET generation = excluded.generation, source_revision = excluded.source_revision, base_generation = excluded.base_generation, updated_at = excluded.updated_at"
            )
            .run(projectRoot, request.tier, generation, request.sourceRevision, request.baseGeneration, updatedAt);
        const affectedFiles = createAffectedFileSet(projectRoot, request.affectedFiles);
        const affectedSymbolIds = new Set([
            ...readSymbolIdsDefinedByFiles(database, projectRoot, request.tier, affectedFiles),
            ...snapshot.occurrences
                .filter(
                    (occurrence) =>
                        occurrence.role === "definition" && isAffectedSemanticFile(affectedFiles, occurrence.filePath)
                )
                .map((occurrence) => occurrence.symbolId)
        ]);
        const affectedScopeIds = new Set([
            ...readScopeIdsOwnedByFiles(database, projectRoot, request.tier, affectedFiles),
            ...snapshot.occurrences
                .filter((occurrence) => isAffectedSemanticFile(affectedFiles, occurrence.filePath))
                .flatMap((occurrence) => (occurrence.scopeId === null ? [] : [occurrence.scopeId])),
            ...snapshot.scopes
                .filter((scope) => scope.filePaths.some((filePath) => isAffectedSemanticFile(affectedFiles, filePath)))
                .map((scope) => scope.scopeId)
        ]);
        deleteAffectedRows(database, projectRoot, request.tier, affectedFiles);
        if (affectedFiles === null) {
            database
                .prepare("DELETE FROM semantic_symbols WHERE project_root = ? AND tier = ?")
                .run(projectRoot, request.tier);
            database
                .prepare("DELETE FROM semantic_scopes WHERE project_root = ? AND tier = ?")
                .run(projectRoot, request.tier);
            database
                .prepare("DELETE FROM semantic_resources WHERE project_root = ? AND tier = ?")
                .run(projectRoot, request.tier);
        }
        const insertSymbol = database.prepare(
            "INSERT INTO semantic_symbols(project_root, tier, symbol_id, kind, name, display_name, defining_file_path, scope_id, documentation_json, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_root, tier, symbol_id) DO UPDATE SET kind = excluded.kind, name = excluded.name, display_name = excluded.display_name, defining_file_path = excluded.defining_file_path, scope_id = excluded.scope_id, documentation_json = excluded.documentation_json, updated_generation = excluded.updated_generation"
        );
        for (const symbol of snapshot.symbols) {
            if (
                !isAffectedSemanticFile(affectedFiles, symbol.definingFilePath) &&
                !affectedSymbolIds.has(symbol.symbolId)
            ) {
                continue;
            }
            insertSymbol.run(
                projectRoot,
                request.tier,
                symbol.symbolId,
                symbol.kind,
                symbol.name,
                symbol.displayName,
                symbol.definingFilePath,
                symbol.scopeId,
                JSON.stringify(symbol.documentation),
                generation
            );
        }
        const insertScope = database.prepare(
            "INSERT INTO semantic_scopes(project_root, tier, scope_id, kind, name, display_name, resource_path, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_root, tier, scope_id) DO UPDATE SET kind = excluded.kind, name = excluded.name, display_name = excluded.display_name, resource_path = excluded.resource_path, updated_generation = excluded.updated_generation"
        );
        const insertScopeFile = database.prepare(
            "INSERT INTO semantic_scope_files(project_root, tier, scope_id, file_path, updated_generation) VALUES (?, ?, ?, ?, ?)"
        );
        for (const scope of snapshot.scopes) {
            if (
                affectedFiles !== null &&
                !affectedScopeIds.has(scope.scopeId) &&
                !isAffectedSemanticFile(affectedFiles, scope.resourcePath)
            ) {
                continue;
            }
            insertScope.run(
                projectRoot,
                request.tier,
                scope.scopeId,
                scope.kind,
                scope.name,
                scope.displayName,
                scope.resourcePath,
                generation
            );
            for (const filePath of scope.filePaths) {
                if (!isAffectedSemanticFile(affectedFiles, filePath)) {
                    continue;
                }
                insertScopeFile.run(projectRoot, request.tier, scope.scopeId, filePath, generation);
            }
        }
        if (affectedFiles !== null && affectedScopeIds.size > 0) {
            const retainedScopeIds = new Set(snapshot.scopes.map((scope) => scope.scopeId));
            const removedScopeIds = [...affectedScopeIds].filter((scopeId) => !retainedScopeIds.has(scopeId));
            if (removedScopeIds.length > 0) {
                const placeholders = removedScopeIds.map(() => "?").join(", ");
                database
                    .prepare(
                        `DELETE FROM semantic_scopes WHERE project_root = ? AND tier = ? AND scope_id IN (${placeholders})`
                    )
                    .run(projectRoot, request.tier, ...removedScopeIds);
            }
        }
        const insertResource = database.prepare(
            "INSERT INTO semantic_resources(project_root, tier, resource_path, name, resource_type, updated_generation) VALUES (?, ?, ?, ?, ?, ?)"
        );
        for (const resource of snapshot.resources) {
            if (!isAffectedSemanticFile(affectedFiles, resource.resourcePath)) {
                continue;
            }
            insertResource.run(
                projectRoot,
                request.tier,
                resource.resourcePath,
                resource.name,
                resource.resourceType,
                generation
            );
        }
        const insertRelationship = database.prepare(
            "INSERT INTO semantic_relationships(project_root, tier, relationship_id, owner_file_path, relationship_kind, payload_json, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?)"
        );
        for (const relationship of snapshot.relationships) {
            if (!isAffectedSemanticFile(affectedFiles, relationship.ownerFilePath)) {
                continue;
            }
            insertRelationship.run(
                projectRoot,
                request.tier,
                relationship.relationshipId,
                relationship.ownerFilePath,
                relationship.kind,
                JSON.stringify(relationship.payload),
                generation
            );
        }
        const insertOccurrence = database.prepare(
            "INSERT INTO semantic_occurrences(project_root, tier, symbol_id, file_path, role, start_offset, end_offset, scope_id, resolution_json, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        for (const occurrence of snapshot.occurrences) {
            if (!isAffectedSemanticFile(affectedFiles, occurrence.filePath)) {
                continue;
            }
            insertOccurrence.run(
                projectRoot,
                request.tier,
                occurrence.symbolId,
                occurrence.filePath,
                occurrence.role,
                occurrence.start,
                occurrence.end,
                occurrence.scopeId,
                JSON.stringify(occurrence.resolution),
                generation
            );
        }
        if (affectedFiles !== null && affectedSymbolIds.size > 0) {
            const symbolIds = [...affectedSymbolIds];
            const placeholders = symbolIds.map(() => "?").join(", ");
            database
                .prepare(
                    `DELETE FROM semantic_symbols WHERE project_root = ? AND tier = ? AND symbol_id IN (${placeholders}) AND NOT EXISTS (SELECT 1 FROM semantic_occurrences WHERE semantic_occurrences.project_root = semantic_symbols.project_root AND semantic_occurrences.tier = semantic_symbols.tier AND semantic_occurrences.symbol_id = semantic_symbols.symbol_id AND semantic_occurrences.role = 'definition')`
                )
                .run(projectRoot, request.tier, ...symbolIds);
        }

        const insertDependency = database.prepare(
            "INSERT INTO semantic_dependencies(project_root, tier, owner_file_path, dependent_file_path, dependency_kind, symbol_id, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?)"
        );
        for (const dependency of snapshot.dependencies) {
            if (
                !isAffectedSemanticFile(affectedFiles, dependency.ownerFilePath) &&
                !isAffectedSemanticFile(affectedFiles, dependency.dependentFilePath)
            ) {
                continue;
            }
            insertDependency.run(
                projectRoot,
                request.tier,
                dependency.ownerFilePath,
                dependency.dependentFilePath,
                dependency.kind,
                dependency.symbolId,
                generation
            );
        }
        if (request.tier === "full") {
            const insertUnresolved = database.prepare(
                "INSERT INTO semantic_unresolved_references(project_root, tier, name, file_path, start_offset, end_offset, resolution_json, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            );
            for (const unresolvedReference of snapshot.unresolvedReferences) {
                if (!isAffectedSemanticFile(affectedFiles, unresolvedReference.filePath)) {
                    continue;
                }
                insertUnresolved.run(
                    projectRoot,
                    request.tier,
                    unresolvedReference.name,
                    unresolvedReference.filePath,
                    unresolvedReference.start,
                    unresolvedReference.end,
                    JSON.stringify(unresolvedReference.resolution),
                    generation
                );
            }
        }
        if (request.manifest !== null) {
            const insertManifestFile = database.prepare(
                "INSERT INTO semantic_files(project_root, tier, relative_path, file_kind, content_hash, size_bytes, mtime_ms, source_origin, source_version, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            for (const entry of request.manifest.entries.values()) {
                if (!isAffectedSemanticFile(affectedFiles, entry.relativePath)) {
                    continue;
                }
                insertManifestFile.run(
                    projectRoot,
                    request.tier,
                    entry.relativePath,
                    entry.fileKind,
                    entry.contentHash,
                    entry.sizeBytes,
                    entry.mtimeMs,
                    entry.sourceOrigin,
                    entry.sourceVersion,
                    generation
                );
            }
        }
        database
            .prepare(
                "INSERT INTO semantic_navigation_projection(project_root, tier, generation, payload) VALUES (?, ?, ?, ?) ON CONFLICT(project_root, tier) DO UPDATE SET generation = excluded.generation, payload = excluded.payload"
            )
            .run(projectRoot, request.tier, generation, JSON.stringify(request.navigationProjection));
        database
            .prepare(
                "INSERT INTO semantic_generation_history(project_root, generation, tier, source_revision, reason, affected_file_count, published_at, result) VALUES (?, ?, ?, ?, ?, ?, ?, 'published')"
            )
            .run(
                projectRoot,
                generation,
                request.tier,
                request.sourceRevision,
                affectedFiles === null ? "snapshot" : "increment",
                affectedFiles?.size ?? request.manifest?.entries.size ?? 0,
                updatedAt
            );
        database
            .prepare(
                "DELETE FROM semantic_generation_history WHERE project_root = ? AND generation NOT IN (SELECT generation FROM semantic_generation_history WHERE project_root = ? ORDER BY generation DESC LIMIT 32)"
            )
            .run(projectRoot, projectRoot);
        publishedState = Object.freeze({
            baseGeneration: request.baseGeneration,
            generation,
            projectRoot,
            sourceSignature: request.sourceRevision,
            tier: request.tier
        });
    });

    return Object.freeze({
        state: publishedState,
        status: publishedState === null ? "superseded" : "published"
    });
}

function acquirePersistedSemanticSnapshot(
    database: GraphDatabase,
    projectRoot: string,
    requirements: SemanticSnapshotRequirements,
    signal: AbortSignal,
    registerLease: () => () => void
): SemanticSnapshotAcquireResult {
    if (signal.aborted) {
        return Object.freeze({ failure: Object.freeze({ kind: "cancelled" }), kind: "failure" });
    }
    if (requirements.tier === "full" && !readActiveSemanticSlots(database, projectRoot).hasMatchingFull) {
        return Object.freeze({ failure: Object.freeze({ kind: "missingSnapshot" }), kind: "failure" });
    }
    const state = readSemanticSlotState(database, projectRoot, requirements.tier);
    if (state === null) {
        return Object.freeze({ failure: Object.freeze({ kind: "missingSnapshot" }), kind: "failure" });
    }
    const snapshot = readSemanticSnapshot(database, projectRoot, requirements.tier);
    if (snapshot === null) {
        return Object.freeze({ failure: Object.freeze({ kind: "missingSnapshot" }), kind: "failure" });
    }
    const identity = createSnapshotIdentity(
        state.generation,
        snapshot,
        createSnapshotCoverage(projectRoot, readSemanticManifest(database, projectRoot, requirements.tier), snapshot)
    );
    const failure = areSnapshotRequirementsSatisfied(projectRoot, identity, requirements);
    if (failure !== null) {
        return Object.freeze({ failure, kind: "failure" });
    }
    return createSemanticSnapshotLease(identity, snapshot, registerLease);
}

function createSemanticSnapshotLease(
    identity: SemanticSnapshotIdentity,
    snapshot: SemanticSnapshot,
    registerLease: () => () => void
): SemanticSnapshotAcquireResult {
    const unregisterLease = registerLease();
    let released = false;
    const lease: SemanticSnapshotLease = Object.freeze({
        identity,
        release: () => {
            if (!released) {
                released = true;
                unregisterLease();
            }
        },
        snapshot
    });
    return Object.freeze({ kind: "lease", lease });
}

type SessionSemanticSnapshot = Readonly<{
    identity: SemanticSnapshotIdentity;
    snapshot: SemanticSnapshot;
}>;

type SemanticSnapshotLeaseCounter = {
    activeLeaseCount: number;
};

function registerSemanticSnapshotLease(counter: SemanticSnapshotLeaseCounter): () => void {
    counter.activeLeaseCount += 1;
    return () => {
        counter.activeLeaseCount -= 1;
    };
}

function acquireSessionSemanticSnapshot(
    projectRoot: string,
    sessionSnapshots: ReadonlyMap<SemanticTier, SessionSemanticSnapshot>,
    requirements: SemanticSnapshotRequirements,
    signal: AbortSignal,
    registerLease: () => () => void
): SemanticSnapshotAcquireResult {
    if (signal.aborted) {
        return Object.freeze({ failure: Object.freeze({ kind: "cancelled" }), kind: "failure" });
    }
    const sessionSnapshot = sessionSnapshots.get(requirements.tier);
    if (sessionSnapshot === undefined) {
        return Object.freeze({ failure: Object.freeze({ kind: "missingSnapshot" }), kind: "failure" });
    }
    if (requirements.tier === "full") {
        const definitionsSnapshot = sessionSnapshots.get("definitions");
        if (
            definitionsSnapshot === undefined ||
            definitionsSnapshot.identity.projectRevision !== sessionSnapshot.identity.projectRevision ||
            !areOverlayVersionsEqual(
                projectRoot,
                definitionsSnapshot.identity.overlayVersions,
                sessionSnapshot.identity.overlayVersions
            )
        ) {
            return Object.freeze({ failure: Object.freeze({ kind: "missingSnapshot" }), kind: "failure" });
        }
    }
    const failure = areSnapshotRequirementsSatisfied(projectRoot, sessionSnapshot.identity, requirements);
    return failure === null
        ? createSemanticSnapshotLease(sessionSnapshot.identity, sessionSnapshot.snapshot, registerLease)
        : Object.freeze({ failure, kind: "failure" });
}

function publishSessionSemanticSnapshot(
    projectRoot: string,
    sessionSnapshots: Map<SemanticTier, SessionSemanticSnapshot>,
    generation: number,
    request: SemanticSessionSnapshotPublicationRequest
): SemanticSessionSnapshotPublishResult {
    const overlayVersions = createManifestOverlayVersions(projectRoot, request.manifest);
    if (overlayVersions === null) {
        return Object.freeze({ kind: "invalidOverlay" });
    }
    if (request.snapshot.sourceRevision !== request.manifest.sourceRevision) {
        return Object.freeze({ kind: "invalidSnapshot" });
    }
    const definitionsSnapshot = sessionSnapshots.get("definitions");
    if (
        request.snapshot.tier === "full" &&
        (definitionsSnapshot === undefined ||
            definitionsSnapshot.identity.projectRevision !== request.snapshot.sourceRevision ||
            !areOverlayVersionsEqual(projectRoot, definitionsSnapshot.identity.overlayVersions, overlayVersions))
    ) {
        return Object.freeze({ kind: "incompatibleDefinitions" });
    }
    const identity = createSnapshotIdentity(
        generation,
        request.snapshot,
        createSnapshotCoverage(projectRoot, request.manifest, request.snapshot),
        overlayVersions
    );
    sessionSnapshots.set(request.snapshot.tier, Object.freeze({ identity, snapshot: request.snapshot }));
    if (request.snapshot.tier === "definitions") {
        const fullSnapshot = sessionSnapshots.get("full");
        if (
            fullSnapshot !== undefined &&
            (fullSnapshot.identity.projectRevision !== identity.projectRevision ||
                !areOverlayVersionsEqual(projectRoot, fullSnapshot.identity.overlayVersions, identity.overlayVersions))
        ) {
            sessionSnapshots.delete("full");
        }
    }
    return Object.freeze({ identity, kind: "published" });
}

/** Open the canonical project semantic store shared by LSP, CLI, and graph tooling. */
export function openSemanticIndexStore(projectRoot: string): SemanticIndexStore {
    const resolvedRoot = path.resolve(projectRoot);
    const database = openGraphIndexDatabase(createStorePath(resolvedRoot));
    let closePromise: Promise<void> | null = null;
    const leaseCounter: SemanticSnapshotLeaseCounter = { activeLeaseCount: 0 };
    let sessionGeneration = readSemanticProjectHead(database, resolvedRoot).generation;
    const sessionSnapshots = new Map<SemanticTier, SessionSemanticSnapshot>();
    const closeDatabase = (): Promise<void> =>
        flushSynchronousSemanticPublications().then(() => {
            sessionSnapshots.clear();
            database.close();
            return undefined;
        });
    return {
        acquireSemanticSnapshot: (requirements, signal) =>
            requirements.overlayVersions.size > 0
                ? acquireSessionSemanticSnapshot(resolvedRoot, sessionSnapshots, requirements, signal, () =>
                      registerSemanticSnapshotLease(leaseCounter)
                  )
                : acquirePersistedSemanticSnapshot(database, resolvedRoot, requirements, signal, () =>
                      registerSemanticSnapshotLease(leaseCounter)
                  ),
        applySemanticIncrement: (request) =>
            publishSemanticFacts(database, resolvedRoot, { ...request, affectedFiles: request.affectedFiles }),
        close() {
            closePromise ??= closeDatabase();
            return closePromise;
        },
        flush: flushSynchronousSemanticPublications,
        findImmediateDownstreamFiles: (filePath) =>
            findImmediateDownstreamFiles(database, resolvedRoot, normalizeSemanticFilePath(resolvedRoot, filePath)),
        findUnresolvedDependents: (identifierNames) =>
            findUnresolvedDependents(database, resolvedRoot, identifierNames),
        readActiveSemanticSlots: () => readActiveSemanticSlots(database, resolvedRoot),
        readSemanticManifest: (tier) => readSemanticManifest(database, resolvedRoot, tier),
        readSemanticSnapshotLeaseMetrics: () => Object.freeze({ activeLeaseCount: leaseCounter.activeLeaseCount }),
        readSemanticNavigationProjection: (tier) => readSemanticNavigationProjection(database, resolvedRoot, tier),
        readSemanticProjectHead: () => readSemanticProjectHead(database, resolvedRoot),
        readSemanticSnapshot: (tier) => readSemanticSnapshot(database, resolvedRoot, tier),
        publishSemanticSnapshot: (request) =>
            publishSemanticFacts(database, resolvedRoot, { ...request, affectedFiles: null }),
        publishSessionSemanticSnapshot: (request) => {
            const nextSessionGeneration =
                Math.max(sessionGeneration, readSemanticProjectHead(database, resolvedRoot).generation) + 1;
            const result = publishSessionSemanticSnapshot(
                resolvedRoot,
                sessionSnapshots,
                nextSessionGeneration,
                request
            );
            if (result.kind === "published") {
                sessionGeneration = nextSessionGeneration;
            }
            return result;
        }
    };
}

/** Publishes definitions first when necessary, then a full snapshot for the exact same revision. */
export function publishSemanticTwoTierSnapshot(
    store: SemanticIndexStore,
    request: SemanticTwoTierPublicationRequest
): SemanticPublishResult {
    let activeSlots = store.readActiveSemanticSlots();
    if (activeSlots.definitions?.sourceSignature !== request.sourceRevision) {
        const definitionsPublication = store.publishSemanticSnapshot({
            authoritative: false,
            baseGeneration: activeSlots.definitions?.generation ?? null,
            expectedHeadGeneration: store.readSemanticProjectHead().generation,
            manifest: request.manifest,
            navigationProjection: request.navigationProjection,
            snapshot: request.definitionsSnapshot,
            sourceRevision: request.sourceRevision,
            tier: "definitions"
        });
        if (definitionsPublication.status === "superseded") {
            return definitionsPublication;
        }
        activeSlots = store.readActiveSemanticSlots();
    }
    return store.publishSemanticSnapshot({
        authoritative: false,
        baseGeneration: activeSlots.full?.generation ?? null,
        expectedHeadGeneration: store.readSemanticProjectHead().generation,
        manifest: request.manifest,
        navigationProjection: request.navigationProjection,
        snapshot: request.fullSnapshot,
        sourceRevision: request.sourceRevision,
        tier: "full"
    });
}

/** Return the canonical database path for a project root. */
export function getSemanticIndexDatabasePath(projectRoot: string): string {
    return createStorePath(projectRoot);
}
