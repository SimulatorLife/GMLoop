import path from "node:path";

import { Core } from "@gmloop/core";

import { openGraphIndexDatabase } from "../graph-index/database.js";
import { type GraphDatabase, runGraphDatabaseImmediateTransaction } from "../graph-index/sqlite-adapter.js";
import {
    hasOpenBufferOverlay,
    type SemanticFileManifest,
    type SemanticFileManifestEntry
} from "./semantic-manifest.js";
import { createSemanticMemorySnapshotQueries } from "./semantic-memory-query.js";
import { normalizeSemanticFilePath } from "./semantic-path.js";
import { createSemanticSearchNgrams, normalizeSemanticSearchText } from "./semantic-query-order.js";
import type { SemanticSnapshotQueries } from "./semantic-query-types.js";
import { createSemanticSnapshotReaderPool, type SemanticSnapshotReaderPool } from "./semantic-reader-pool.js";
import {
    parsePersistedOccurrenceResolution,
    parsePersistedSemanticDocumentation,
    parsePersistedUncertainResolution,
    parseSemanticRecordPayload,
    parseSemanticScalarRecordPayload
} from "./semantic-record-codec.js";
import type {
    SemanticCapability,
    SemanticCoverage,
    SemanticDependency,
    SemanticGeneration,
    SemanticOccurrence,
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
    SemanticUnresolvedReference
} from "./semantic-snapshot.js";
import { createSemanticSqliteSnapshotQueries } from "./semantic-sqlite-query.js";

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
    ) => Promise<SemanticSnapshotAcquireResult>;
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

function createAffectedFileSet(
    projectRoot: string,
    affectedFiles: ReadonlyArray<string> | null
): ReadonlySet<string> | null {
    return affectedFiles === null
        ? null
        : new Set(affectedFiles.map((filePath) => normalizeSemanticFilePath(projectRoot, filePath)));
}

function containsSessionLocalOverlay(manifest: SemanticFileManifest | null): boolean {
    return hasOpenBufferOverlay(manifest);
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
    const analyzedFiles = new Set(
        snapshot.analyzedFilePaths.map((filePath) => normalizeSemanticFilePath(projectRoot, filePath))
    );
    const requiredSourceFiles = [...(manifest?.entries.values() ?? [])]
        .filter((entry) => entry.fileKind === "gml")
        .map((entry) => normalizeSemanticFilePath(projectRoot, entry.relativePath));
    if (manifest === null || !requiredSourceFiles.every((filePath) => analyzedFiles.has(filePath))) {
        return Object.freeze({
            analyzedFileCount: analyzedFiles.size,
            analyzedResourceCount: snapshot.resources.length,
            relationshipStatus: "partial",
            status: "partial"
        });
    }
    return Object.freeze({
        analyzedFileCount: analyzedFiles.size,
        analyzedResourceCount: snapshot.resources.length,
        relationshipStatus: snapshot.tier === "full" ? "complete" : "partial",
        status: "complete"
    });
}

function calculatePersistedSnapshotCoverage(
    database: GraphDatabase,
    projectRoot: string,
    tier: SemanticTier
): SemanticCoverage {
    const analyzedFileCount = (
        database
            .prepare(
                "SELECT COUNT(*) AS count FROM (" +
                    "SELECT file_path FROM semantic_analyzed_files WHERE project_root = ? AND tier = ? " +
                    "UNION SELECT file_path FROM semantic_occurrences WHERE project_root = ? AND tier = ? " +
                    "UNION SELECT file_path FROM semantic_scope_files WHERE project_root = ? AND tier = ?" +
                    ")"
            )
            .get(projectRoot, tier, projectRoot, tier, projectRoot, tier) as { count: number }
    ).count;
    const analyzedResourceCount = (
        database
            .prepare("SELECT COUNT(*) AS count FROM semantic_resources WHERE project_root = ? AND tier = ?")
            .get(projectRoot, tier) as { count: number }
    ).count;
    const manifestEntryCount = (
        database
            .prepare("SELECT COUNT(*) AS count FROM semantic_files WHERE project_root = ? AND tier = ?")
            .get(projectRoot, tier) as { count: number }
    ).count;
    const missingAnalyzedFile = database
        .prepare(
            "SELECT 1 AS present FROM semantic_files AS files " +
                "WHERE files.project_root = ? AND files.tier = ? AND files.file_kind = 'gml' " +
                "AND NOT EXISTS (SELECT 1 FROM semantic_analyzed_files AS analyzed " +
                "WHERE analyzed.project_root = files.project_root AND analyzed.tier = files.tier " +
                "AND analyzed.file_path = files.relative_path) " +
                "AND NOT EXISTS (SELECT 1 FROM semantic_occurrences AS occurrences " +
                "WHERE occurrences.project_root = files.project_root AND occurrences.tier = files.tier " +
                "AND occurrences.file_path = files.relative_path) " +
                "AND NOT EXISTS (SELECT 1 FROM semantic_scope_files AS scope_files " +
                "WHERE scope_files.project_root = files.project_root AND scope_files.tier = files.tier " +
                "AND scope_files.file_path = files.relative_path) LIMIT 1"
        )
        .get(projectRoot, tier);
    if (manifestEntryCount > 0 && missingAnalyzedFile === undefined) {
        return Object.freeze({
            analyzedFileCount,
            analyzedResourceCount,
            relationshipStatus: tier === "full" ? "complete" : "partial",
            status: "complete"
        });
    }
    return Object.freeze({
        analyzedFileCount,
        analyzedResourceCount,
        relationshipStatus: "partial",
        status: "partial"
    });
}

function readPersistedSnapshotCoverage(
    database: GraphDatabase,
    projectRoot: string,
    tier: SemanticTier
): SemanticCoverage {
    const row = database
        .prepare(
            "SELECT analyzed_file_count, analyzed_resource_count, coverage_status, relationship_status " +
                "FROM semantic_slots WHERE project_root = ? AND tier = ?"
        )
        .get(projectRoot, tier);
    if (
        row !== undefined &&
        typeof row.analyzed_file_count === "number" &&
        typeof row.analyzed_resource_count === "number" &&
        (row.coverage_status === "complete" || row.coverage_status === "partial") &&
        (row.relationship_status === "complete" || row.relationship_status === "partial")
    ) {
        return row.coverage_status === "complete"
            ? Object.freeze({
                  analyzedFileCount: row.analyzed_file_count,
                  analyzedResourceCount: row.analyzed_resource_count,
                  relationshipStatus: row.relationship_status,
                  status: "complete"
              })
            : Object.freeze({
                  analyzedFileCount: row.analyzed_file_count,
                  analyzedResourceCount: row.analyzed_resource_count,
                  relationshipStatus: "partial",
                  status: "partial"
              });
    }
    return Object.freeze({
        analyzedFileCount: 0,
        analyzedResourceCount: 0,
        relationshipStatus: "partial",
        status: "partial"
    });
}

function writePersistedSnapshotCoverage(database: GraphDatabase, projectRoot: string, tier: SemanticTier): void {
    const coverage = calculatePersistedSnapshotCoverage(database, projectRoot, tier);
    database
        .prepare(
            "UPDATE semantic_slots SET analyzed_file_count = ?, analyzed_resource_count = ?, " +
                "coverage_status = ?, relationship_status = ? WHERE project_root = ? AND tier = ?"
        )
        .run(
            coverage.analyzedFileCount,
            coverage.analyzedResourceCount,
            coverage.status,
            coverage.relationshipStatus,
            projectRoot,
            tier
        );
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
        validation: createSnapshotValidation(snapshot)
    });
}

function createSnapshotValidation(snapshot: SemanticSnapshot): SemanticSnapshotIdentity["validation"] {
    const symbolIds = new Set<string>();
    for (const symbol of snapshot.symbols) {
        if (symbolIds.has(symbol.symbolId)) {
            return Object.freeze({ reason: `Duplicate semantic symbol id '${symbol.symbolId}'.`, status: "invalid" });
        }
        symbolIds.add(symbol.symbolId);
    }
    for (const occurrence of snapshot.occurrences) {
        if (occurrence.end < occurrence.start || !symbolIds.has(occurrence.symbolId)) {
            return Object.freeze({
                reason: `Invalid semantic occurrence for symbol '${occurrence.symbolId}'.`,
                status: "invalid"
            });
        }
    }
    if (
        snapshot.unresolvedReferences.length > 0 ||
        snapshot.occurrences.some((occurrence) => occurrence.resolution.kind !== "exact")
    ) {
        return Object.freeze({
            affectedCapabilities: Object.freeze(new Set<SemanticCapability>(["references", "renameSafety"])),
            reason: "The snapshot contains unresolved or uncertain semantic bindings.",
            status: "degraded"
        });
    }
    return Object.freeze({ status: "valid" });
}

function createPersistedSnapshotValidation(
    database: GraphDatabase,
    projectRoot: string,
    tier: SemanticTier
): SemanticSnapshotIdentity["validation"] {
    const invalidOccurrence = database
        .prepare(
            "SELECT 1 AS present FROM semantic_occurrences WHERE project_root = ? AND tier = ? " +
                "AND end_offset < start_offset LIMIT 1"
        )
        .get(projectRoot, tier) as { present: number } | undefined;
    if (invalidOccurrence !== undefined) {
        return Object.freeze({
            reason: "The persisted snapshot contains an invalid semantic occurrence.",
            status: "invalid"
        });
    }
    const uncertainOccurrence = database
        .prepare(
            "SELECT 1 AS present FROM semantic_occurrences WHERE project_root = ? AND tier = ? " +
                "AND json_extract(resolution_json, '$.kind') <> 'exact' LIMIT 1"
        )
        .get(projectRoot, tier) as { present: number } | undefined;
    const unresolvedReference = database
        .prepare("SELECT 1 AS present FROM semantic_unresolved_references WHERE project_root = ? AND tier = ? LIMIT 1")
        .get(projectRoot, tier) as { present: number } | undefined;
    return uncertainOccurrence !== undefined || unresolvedReference !== undefined
        ? Object.freeze({
              affectedCapabilities: Object.freeze(new Set<SemanticCapability>(["references", "renameSafety"])),
              reason: "The snapshot contains unresolved or uncertain semantic bindings.",
              status: "degraded"
          })
        : Object.freeze({ status: "valid" });
}

function createPersistedSnapshotIdentity(
    database: GraphDatabase,
    projectRoot: string,
    state: SemanticStoreState
): SemanticSnapshotIdentity {
    return Object.freeze({
        capabilities: createSnapshotCapabilities(state.tier),
        coverage: readPersistedSnapshotCoverage(database, projectRoot, state.tier),
        generation: state.generation as SemanticGeneration,
        overlayVersions: Object.freeze(new Map<string, number>()),
        projectRevision: state.sourceSignature as SemanticSourceRevision,
        tier: state.tier,
        validation: createPersistedSnapshotValidation(database, projectRoot, state.tier)
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
    requirements: SemanticSnapshotRequirements,
    hasRequiredCoverage: boolean
): SemanticSnapshotAcquireFailure | null {
    if (identity.validation.status === "invalid") {
        return Object.freeze({ kind: "invalidSnapshot" });
    }
    if (requirements.projectRevision !== "current" && identity.projectRevision !== requirements.projectRevision) {
        return Object.freeze({ kind: "revisionMismatch" });
    }
    if (!areOverlayVersionsEqual(projectRoot, identity.overlayVersions, requirements.overlayVersions)) {
        return Object.freeze({ kind: "overlayMismatch" });
    }
    if (![...requirements.capabilities].every((capability) => identity.capabilities.has(capability))) {
        return Object.freeze({ kind: "missingCapability" });
    }
    if (!hasRequiredCoverage) {
        return Object.freeze({ kind: "incompleteCoverage" });
    }
    return requirements.requireCompleteProjectRelationships && identity.coverage.relationshipStatus !== "complete"
        ? Object.freeze({ kind: "incompleteRelationships" })
        : null;
}

function hasPersistedRequiredCoverage(
    database: GraphDatabase,
    projectRoot: string,
    tier: SemanticTier,
    requirements: SemanticSnapshotRequirements
): boolean {
    const findAnalyzedFile = database.prepare(
        "SELECT 1 AS present WHERE " +
            "EXISTS (SELECT 1 FROM semantic_analyzed_files WHERE project_root = ? AND tier = ? AND file_path = ?) " +
            "OR EXISTS (SELECT 1 FROM semantic_occurrences WHERE project_root = ? AND tier = ? AND file_path = ?) " +
            "OR EXISTS (SELECT 1 FROM semantic_scope_files WHERE project_root = ? AND tier = ? AND file_path = ?)"
    );
    for (const filePath of requirements.requiredFiles) {
        const normalizedFilePath = normalizeSemanticFilePath(projectRoot, filePath);
        if (
            findAnalyzedFile.get(
                projectRoot,
                tier,
                normalizedFilePath,
                projectRoot,
                tier,
                normalizedFilePath,
                projectRoot,
                tier,
                normalizedFilePath
            ) === undefined
        ) {
            return false;
        }
    }
    const findResource = database.prepare(
        "SELECT 1 AS present FROM semantic_resources WHERE project_root = ? AND tier = ? AND resource_path = ? LIMIT 1"
    );
    for (const resourcePath of requirements.requiredResources) {
        if (findResource.get(projectRoot, tier, resourcePath) === undefined) {
            return false;
        }
    }
    return true;
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
        .flatMap((row): ReadonlyArray<SemanticSymbol> =>
            typeof row.symbol_id === "string" &&
            typeof row.kind === "string" &&
            typeof row.name === "string" &&
            typeof row.display_name === "string" &&
            typeof row.documentation_json === "string"
                ? [
                      Object.freeze({
                          definingFilePath: typeof row.defining_file_path === "string" ? row.defining_file_path : null,
                          displayName: row.display_name,
                          documentation: parsePersistedSemanticDocumentation(row.documentation_json),
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
                typeof row.resolution_json === "string"
                    ? parsePersistedOccurrenceResolution(row.resolution_json)
                    : null;
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
        .flatMap((row): ReadonlyArray<SemanticScope> =>
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
        .flatMap((row): ReadonlyArray<SemanticResource> =>
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
            const payload =
                typeof row.payload_json === "string" ? parseSemanticScalarRecordPayload(row.payload_json) : null;
            if (
                typeof row.relationship_id !== "string" ||
                typeof row.owner_file_path !== "string" ||
                typeof row.relationship_kind !== "string" ||
                !Core.isObjectLike(payload)
            ) {
                return [];
            }
            return [
                Object.freeze({
                    kind: row.relationship_kind,
                    ownerFilePath: row.owner_file_path,
                    payload,
                    relationshipId: row.relationship_id
                })
            ];
        });
    const dependencies = database
        .prepare(
            "SELECT owner_file_path, dependent_file_path, dependency_kind, symbol_id FROM semantic_dependencies WHERE project_root = ? AND tier = ? ORDER BY owner_file_path, dependent_file_path, dependency_kind"
        )
        .all(projectRoot, tier)
        .flatMap((row): ReadonlyArray<SemanticDependency> =>
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
                typeof row.resolution_json === "string" ? parsePersistedUncertainResolution(row.resolution_json) : null;
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
    const analyzedFilePaths = database
        .prepare(
            "SELECT file_path FROM semantic_analyzed_files WHERE project_root = ? AND tier = ? " +
                "UNION SELECT DISTINCT file_path FROM semantic_occurrences WHERE project_root = ? AND tier = ? " +
                "UNION SELECT DISTINCT file_path FROM semantic_scope_files WHERE project_root = ? AND tier = ? " +
                "ORDER BY file_path"
        )
        .all(projectRoot, tier, projectRoot, tier, projectRoot, tier)
        .flatMap((row): ReadonlyArray<string> => (typeof row.file_path === "string" ? [row.file_path] : []));
    return Object.freeze({
        analyzedFilePaths: Object.freeze(analyzedFilePaths),
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
        { base_generation?: number | null; generation?: number; source_revision?: string; tier?: string } | undefined;
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
        const projectedIndex = parseSemanticRecordPayload(projection.payload);
        if (projectedIndex !== null) {
            return projectedIndex;
        }
    }

    // The projection is the warm-restore acceleration payload. Normalized
    // v6 facts are authoritative; a corrupt projection is treated as a cache
    // miss until the typed reconstruction path is available.
    return null;
}

function insertAnalyzedFiles(
    database: GraphDatabase,
    projectRoot: string,
    tier: string,
    analyzedFilePaths: ReadonlyArray<string>,
    generation: number
): void {
    const insertAnalyzedFile = database.prepare(
        "INSERT INTO semantic_analyzed_files(project_root, tier, file_path, updated_generation) VALUES (?, ?, ?, ?)"
    );
    for (const filePath of analyzedFilePaths) {
        insertAnalyzedFile.run(projectRoot, tier, filePath, generation);
    }
}

function insertSemanticSymbols(
    database: GraphDatabase,
    projectRoot: string,
    tier: string,
    symbols: ReadonlyArray<SemanticSymbol>,
    affectedFiles: ReadonlySet<string> | null,
    affectedSymbolIds: ReadonlySet<string>,
    generation: number
): void {
    const insertSymbol = database.prepare(
        "INSERT INTO semantic_symbols(" +
            "project_root, tier, symbol_id, kind, name, display_name, normalized_display_name, " +
            "defining_file_path, scope_id, documentation_json, updated_generation" +
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(project_root, tier, symbol_id) DO UPDATE SET kind = excluded.kind, " +
            "name = excluded.name, display_name = excluded.display_name, " +
            "normalized_display_name = excluded.normalized_display_name, " +
            "defining_file_path = excluded.defining_file_path, scope_id = excluded.scope_id, " +
            "documentation_json = excluded.documentation_json, updated_generation = excluded.updated_generation"
    );
    const deleteSymbolSearchNgrams = database.prepare(
        "DELETE FROM semantic_symbol_search_ngrams WHERE project_root = ? AND tier = ? AND symbol_id = ?"
    );
    const insertSymbolSearchNgram = database.prepare(
        "INSERT INTO semantic_symbol_search_ngrams(project_root, tier, symbol_id, search_ngram) VALUES (?, ?, ?, ?)"
    );
    for (const symbol of symbols) {
        if (
            !isAffectedSemanticFile(affectedFiles, symbol.definingFilePath) &&
            !affectedSymbolIds.has(symbol.symbolId)
        ) {
            continue;
        }
        const normalizedDisplayName = normalizeSemanticSearchText(symbol.displayName);
        insertSymbol.run(
            projectRoot,
            tier,
            symbol.symbolId,
            symbol.kind,
            symbol.name,
            symbol.displayName,
            normalizedDisplayName,
            symbol.definingFilePath,
            symbol.scopeId,
            JSON.stringify(symbol.documentation),
            generation
        );
        deleteSymbolSearchNgrams.run(projectRoot, tier, symbol.symbolId);
        for (const searchNgram of createSemanticSearchNgrams(normalizedDisplayName)) {
            insertSymbolSearchNgram.run(projectRoot, tier, symbol.symbolId, searchNgram);
        }
    }
}

function insertSemanticScopes(
    database: GraphDatabase,
    projectRoot: string,
    tier: string,
    scopes: ReadonlyArray<SemanticScope>,
    affectedFiles: ReadonlySet<string> | null,
    affectedScopeIds: ReadonlySet<string>,
    generation: number
): void {
    const insertScope = database.prepare(
        "INSERT INTO semantic_scopes(project_root, tier, scope_id, kind, name, display_name, resource_path, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_root, tier, scope_id) DO UPDATE SET kind = excluded.kind, name = excluded.name, display_name = excluded.display_name, resource_path = excluded.resource_path, updated_generation = excluded.updated_generation"
    );
    const insertScopeFile = database.prepare(
        "INSERT INTO semantic_scope_files(project_root, tier, scope_id, file_path, updated_generation) VALUES (?, ?, ?, ?, ?)"
    );
    for (const scope of scopes) {
        if (
            affectedFiles !== null &&
            !affectedScopeIds.has(scope.scopeId) &&
            !isAffectedSemanticFile(affectedFiles, scope.resourcePath)
        ) {
            continue;
        }
        insertScope.run(
            projectRoot,
            tier,
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
            insertScopeFile.run(projectRoot, tier, scope.scopeId, filePath, generation);
        }
    }
}

function insertSemanticResources(
    database: GraphDatabase,
    projectRoot: string,
    tier: string,
    resources: ReadonlyArray<SemanticResource>,
    affectedFiles: ReadonlySet<string> | null,
    generation: number
): void {
    const insertResource = database.prepare(
        "INSERT INTO semantic_resources(project_root, tier, resource_path, name, resource_type, updated_generation) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const resource of resources) {
        if (!isAffectedSemanticFile(affectedFiles, resource.resourcePath)) {
            continue;
        }
        insertResource.run(projectRoot, tier, resource.resourcePath, resource.name, resource.resourceType, generation);
    }
}

function insertSemanticRelationships(
    database: GraphDatabase,
    projectRoot: string,
    tier: string,
    relationships: ReadonlyArray<SemanticRelationship>,
    affectedFiles: ReadonlySet<string> | null,
    generation: number
): void {
    const insertRelationship = database.prepare(
        "INSERT INTO semantic_relationships(project_root, tier, relationship_id, owner_file_path, relationship_kind, payload_json, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const relationship of relationships) {
        if (!isAffectedSemanticFile(affectedFiles, relationship.ownerFilePath)) {
            continue;
        }
        insertRelationship.run(
            projectRoot,
            tier,
            relationship.relationshipId,
            relationship.ownerFilePath,
            relationship.kind,
            JSON.stringify(relationship.payload),
            generation
        );
    }
}

function insertSemanticOccurrences(
    database: GraphDatabase,
    projectRoot: string,
    tier: string,
    occurrences: ReadonlyArray<SemanticOccurrence>,
    affectedFiles: ReadonlySet<string> | null,
    generation: number
): void {
    const insertOccurrence = database.prepare(
        "INSERT INTO semantic_occurrences(project_root, tier, symbol_id, file_path, role, start_offset, end_offset, scope_id, resolution_json, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const occurrence of occurrences) {
        if (!isAffectedSemanticFile(affectedFiles, occurrence.filePath)) {
            continue;
        }
        insertOccurrence.run(
            projectRoot,
            tier,
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
}

function insertSemanticDependencies(
    database: GraphDatabase,
    projectRoot: string,
    tier: string,
    dependencies: ReadonlyArray<SemanticDependency>,
    affectedFiles: ReadonlySet<string> | null,
    generation: number
): void {
    const insertDependency = database.prepare(
        "INSERT INTO semantic_dependencies(project_root, tier, owner_file_path, dependent_file_path, dependency_kind, symbol_id, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const dependency of dependencies) {
        if (
            !isAffectedSemanticFile(affectedFiles, dependency.ownerFilePath) &&
            !isAffectedSemanticFile(affectedFiles, dependency.dependentFilePath)
        ) {
            continue;
        }
        insertDependency.run(
            projectRoot,
            tier,
            dependency.ownerFilePath,
            dependency.dependentFilePath,
            dependency.kind,
            dependency.symbolId,
            generation
        );
    }
}

function insertSemanticUnresolvedReferences(
    database: GraphDatabase,
    projectRoot: string,
    tier: string,
    unresolvedReferences: ReadonlyArray<SemanticUnresolvedReference>,
    affectedFiles: ReadonlySet<string> | null,
    generation: number
): void {
    const insertUnresolved = database.prepare(
        "INSERT INTO semantic_unresolved_references(project_root, tier, name, file_path, start_offset, end_offset, resolution_json, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const unresolvedReference of unresolvedReferences) {
        if (!isAffectedSemanticFile(affectedFiles, unresolvedReference.filePath)) {
            continue;
        }
        insertUnresolved.run(
            projectRoot,
            tier,
            unresolvedReference.name,
            unresolvedReference.filePath,
            unresolvedReference.start,
            unresolvedReference.end,
            JSON.stringify(unresolvedReference.resolution),
            generation
        );
    }
}

function insertSemanticManifestFiles(
    database: GraphDatabase,
    projectRoot: string,
    tier: string,
    manifest: SemanticFileManifest,
    affectedFiles: ReadonlySet<string> | null,
    generation: number
): void {
    const insertManifestFile = database.prepare(
        "INSERT INTO semantic_files(project_root, tier, relative_path, file_kind, content_hash, size_bytes, mtime_ms, source_origin, source_version, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const entry of manifest.entries.values()) {
        if (!isAffectedSemanticFile(affectedFiles, entry.relativePath)) {
            continue;
        }
        insertManifestFile.run(
            projectRoot,
            tier,
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
                "INSERT INTO semantic_slots(" +
                    "project_root, tier, generation, source_revision, base_generation, analyzed_file_count, " +
                    "analyzed_resource_count, coverage_status, relationship_status, updated_at" +
                    ") VALUES (?, ?, ?, ?, ?, 0, 0, 'partial', 'partial', ?) " +
                    "ON CONFLICT(project_root, tier) DO UPDATE SET generation = excluded.generation, " +
                    "source_revision = excluded.source_revision, base_generation = excluded.base_generation, " +
                    "analyzed_file_count = excluded.analyzed_file_count, " +
                    "analyzed_resource_count = excluded.analyzed_resource_count, " +
                    "coverage_status = excluded.coverage_status, relationship_status = excluded.relationship_status, " +
                    "updated_at = excluded.updated_at"
            )
            .run(projectRoot, request.tier, generation, request.sourceRevision, request.baseGeneration, updatedAt);
        database
            .prepare("DELETE FROM semantic_analyzed_files WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);

        insertAnalyzedFiles(database, projectRoot, request.tier, snapshot.analyzedFilePaths, generation);

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

        insertSemanticSymbols(
            database,
            projectRoot,
            request.tier,
            snapshot.symbols,
            affectedFiles,
            affectedSymbolIds,
            generation
        );

        insertSemanticScopes(
            database,
            projectRoot,
            request.tier,
            snapshot.scopes,
            affectedFiles,
            affectedScopeIds,
            generation
        );

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

        insertSemanticResources(database, projectRoot, request.tier, snapshot.resources, affectedFiles, generation);

        insertSemanticRelationships(
            database,
            projectRoot,
            request.tier,
            snapshot.relationships,
            affectedFiles,
            generation
        );

        insertSemanticOccurrences(database, projectRoot, request.tier, snapshot.occurrences, affectedFiles, generation);

        if (affectedFiles !== null && affectedSymbolIds.size > 0) {
            const symbolIds = [...affectedSymbolIds];
            const placeholders = symbolIds.map(() => "?").join(", ");
            database
                .prepare(
                    `DELETE FROM semantic_symbols WHERE project_root = ? AND tier = ? AND symbol_id IN (${placeholders}) AND NOT EXISTS (SELECT 1 FROM semantic_occurrences WHERE semantic_occurrences.project_root = semantic_symbols.project_root AND semantic_occurrences.tier = semantic_symbols.tier AND semantic_occurrences.symbol_id = semantic_symbols.symbol_id AND semantic_occurrences.role = 'definition')`
                )
                .run(projectRoot, request.tier, ...symbolIds);
        }

        insertSemanticDependencies(
            database,
            projectRoot,
            request.tier,
            snapshot.dependencies,
            affectedFiles,
            generation
        );

        if (request.tier === "full") {
            insertSemanticUnresolvedReferences(
                database,
                projectRoot,
                request.tier,
                snapshot.unresolvedReferences,
                affectedFiles,
                generation
            );
        }
        if (request.manifest !== null) {
            insertSemanticManifestFiles(
                database,
                projectRoot,
                request.tier,
                request.manifest,
                affectedFiles,
                generation
            );
        }
        writePersistedSnapshotCoverage(database, projectRoot, request.tier);
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

async function acquirePersistedSemanticSnapshot(
    readerPool: SemanticSnapshotReaderPool,
    projectRoot: string,
    requirements: SemanticSnapshotRequirements,
    signal: AbortSignal,
    registerLease: () => () => void
): Promise<SemanticSnapshotAcquireResult> {
    if (signal.aborted) {
        return Object.freeze({ failure: Object.freeze({ kind: "cancelled" }), kind: "failure" });
    }
    const queryDatabase = await readerPool.acquire(signal);
    if (queryDatabase === null) {
        return Object.freeze({ failure: Object.freeze({ kind: "cancelled" }), kind: "failure" });
    }
    let retained = false;
    let transactionOpen = false;
    const releaseQueryDatabase = (): void => {
        try {
            if (transactionOpen) {
                queryDatabase.exec("ROLLBACK");
                transactionOpen = false;
            }
        } finally {
            readerPool.release(queryDatabase);
        }
    };
    try {
        queryDatabase.exec("BEGIN");
        transactionOpen = true;
        if (requirements.tier === "full" && !readActiveSemanticSlots(queryDatabase, projectRoot).hasMatchingFull) {
            return Object.freeze({ failure: Object.freeze({ kind: "missingSnapshot" }), kind: "failure" });
        }
        const state = readSemanticSlotState(queryDatabase, projectRoot, requirements.tier);
        if (state === null) {
            return Object.freeze({ failure: Object.freeze({ kind: "missingSnapshot" }), kind: "failure" });
        }
        const identity = createPersistedSnapshotIdentity(queryDatabase, projectRoot, state);
        const failure = areSnapshotRequirementsSatisfied(
            projectRoot,
            identity,
            requirements,
            hasPersistedRequiredCoverage(queryDatabase, projectRoot, state.tier, requirements)
        );
        if (failure !== null) {
            return Object.freeze({ failure, kind: "failure" });
        }
        if (signal.aborted) {
            return Object.freeze({ failure: Object.freeze({ kind: "cancelled" }), kind: "failure" });
        }
        retained = true;
        return createSemanticSnapshotLease(
            identity,
            createSemanticSqliteSnapshotQueries(queryDatabase, projectRoot, state.tier),
            registerLease,
            releaseQueryDatabase
        );
    } finally {
        if (!retained) {
            releaseQueryDatabase();
        }
    }
}

function createSemanticSnapshotLease(
    identity: SemanticSnapshotIdentity,
    queries: SemanticSnapshotQueries,
    registerLease: () => () => void,
    releaseSnapshot: () => void = () => {}
): SemanticSnapshotAcquireResult {
    const unregisterLease = registerLease();
    let released = false;
    const release = (): void => {
        if (!released) {
            released = true;
            try {
                releaseSnapshot();
            } finally {
                unregisterLease();
            }
        }
    };
    const lease: SemanticSnapshotLease = Object.freeze({
        identity,
        queries,
        release
    });
    return Object.freeze({ kind: "lease", lease });
}

type SessionSemanticSnapshot = Readonly<{
    analyzedFiles: ReadonlySet<string>;
    analyzedResources: ReadonlySet<string>;
    identity: SemanticSnapshotIdentity;
    queries: SemanticSnapshotQueries;
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
    const hasRequiredCoverage =
        [...requirements.requiredFiles].every((filePath) =>
            sessionSnapshot.analyzedFiles.has(normalizeSemanticFilePath(projectRoot, filePath))
        ) &&
        [...requirements.requiredResources].every((resourcePath) =>
            sessionSnapshot.analyzedResources.has(resourcePath)
        );
    const failure = areSnapshotRequirementsSatisfied(
        projectRoot,
        sessionSnapshot.identity,
        requirements,
        hasRequiredCoverage
    );
    return failure === null
        ? createSemanticSnapshotLease(sessionSnapshot.identity, sessionSnapshot.queries, registerLease)
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
    sessionSnapshots.set(
        request.snapshot.tier,
        Object.freeze({
            analyzedFiles: Object.freeze(
                new Set(
                    request.snapshot.analyzedFilePaths.map((filePath) =>
                        normalizeSemanticFilePath(projectRoot, filePath)
                    )
                )
            ),
            analyzedResources: Object.freeze(
                new Set(request.snapshot.resources.map((resource) => resource.resourcePath))
            ),
            identity,
            queries: createSemanticMemorySnapshotQueries(projectRoot, request.snapshot)
        })
    );
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
    const databasePath = createStorePath(resolvedRoot);
    const database = openGraphIndexDatabase(databasePath);
    const readerPool = createSemanticSnapshotReaderPool(databasePath);
    let closePromise: Promise<void> | null = null;
    const leaseCounter: SemanticSnapshotLeaseCounter = { activeLeaseCount: 0 };
    let sessionGeneration = readSemanticProjectHead(database, resolvedRoot).generation;
    const sessionSnapshots = new Map<SemanticTier, SessionSemanticSnapshot>();
    const closeDatabase = async (): Promise<void> => {
        await flushSynchronousSemanticPublications();
        sessionSnapshots.clear();
        readerPool.close();
        database.close();
    };
    return {
        acquireSemanticSnapshot: (requirements, signal) =>
            requirements.overlayVersions.size > 0
                ? Promise.resolve(
                      acquireSessionSemanticSnapshot(resolvedRoot, sessionSnapshots, requirements, signal, () =>
                          registerSemanticSnapshotLease(leaseCounter)
                      )
                  )
                : acquirePersistedSemanticSnapshot(readerPool, resolvedRoot, requirements, signal, () =>
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
