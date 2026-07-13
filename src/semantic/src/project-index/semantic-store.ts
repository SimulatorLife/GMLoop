import path from "node:path";

import { Core } from "@gmloop/core";

import { openGraphIndexDatabase } from "../graph-index/database.js";
import { type GraphDatabase, runGraphDatabaseImmediateTransaction } from "../graph-index/sqlite-adapter.js";
import type { SemanticFileManifest, SemanticFileManifestEntry } from "./semantic-manifest.js";
import type {
    SemanticDependency,
    SemanticOccurrence,
    SemanticRelationship,
    SemanticResource,
    SemanticScope,
    SemanticSnapshot,
    SemanticSourceRevision,
    SemanticSymbol,
    SemanticTier,
    SemanticUnresolvedReference
} from "./semantic-snapshot.js";
import { createSemanticSnapshotFromProjectIndex } from "./semantic-snapshot-codec.js";
import {
    createEmptyGmlSymbolDocumentation,
    type GmlSymbolDocumentation,
    parseGmlSymbolDocumentation
} from "./symbol-documentation.js";

type SemanticNavigationProjectionRow = Readonly<{
    generation: number;
    payload: string;
}>;

type SemanticFileHashRow = Readonly<{
    content_hash: string | null;
    file_path: string;
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
    status: "published" | "superseded";
}>;

/** Active tier descriptors and whether a full slot matches the newest facts. */
export type SemanticActiveSlots = Readonly<{
    definitions: SemanticStoreState | null;
    full: SemanticStoreState | null;
    hasMatchingFull: boolean;
    newestDefinitionsRevision: string | null;
}>;

export type SemanticIndexStore = Readonly<{
    close: () => void;
    readFileContentHashes: () => ReadonlyMap<string, string>;
    readActiveSlots: () => SemanticActiveSlots;
    readManifestForTier: (tier: "definitions" | "full") => SemanticFileManifest | null;
    readSemanticSnapshot: (tier: SemanticTier) => SemanticSnapshot | null;
    readIndexForTier: (tier: "definitions" | "full") => Record<string, unknown> | null;
    readStateForTier: (tier: "definitions" | "full") => SemanticStoreState | null;
    readProjectHead: () => SemanticProjectHead;
    publishIndex: (
        request: Readonly<{
            authoritative: boolean;
            baseGeneration: number | null;
            expectedHeadGeneration: number;
            index: Record<string, unknown>;
            manifest: SemanticFileManifest | null;
            sourceRevision: string;
            tier: "definitions" | "full";
        }>
    ) => SemanticPublishResult;
    findImmediateDownstreamFiles: (filePath: string) => ReadonlyArray<string>;
    findUnresolvedDependents: (identifierNames: ReadonlyArray<string>) => ReadonlyArray<string>;
}>;

function parseRecordPayload(payload: string): unknown {
    try {
        return JSON.parse(payload) as unknown;
    } catch {
        return null;
    }
}

function readRecordString(value: unknown, key: string): string | null {
    if (!Core.isObjectLike(value)) {
        return null;
    }
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function readFileContentHashes(database: GraphDatabase, projectRoot: string): ReadonlyMap<string, string> {
    const rows = database
        .prepare(
            "SELECT relative_path AS file_path, content_hash FROM semantic_files WHERE project_root = ? AND tier = 'full' ORDER BY relative_path"
        )
        .all(projectRoot) as unknown as ReadonlyArray<SemanticFileHashRow>;
    return new Map(rows.flatMap((row) => (row.content_hash ? [[row.file_path, row.content_hash] as const] : [])));
}

function readManifestForTier(
    database: GraphDatabase,
    projectRoot: string,
    tier: "definitions" | "full"
): SemanticFileManifest | null {
    const state = readStateForTier(database, projectRoot, tier);
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

/** Read normalized v6 facts without decoding the optional navigation projection. */
function readSemanticSnapshot(
    database: GraphDatabase,
    projectRoot: string,
    tier: SemanticTier
): SemanticSnapshot | null {
    const state = readStateForTier(database, projectRoot, tier);
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
            "SELECT symbol_id, file_path, role, start_offset, end_offset, scope_id FROM semantic_occurrences WHERE project_root = ? AND tier = ? ORDER BY file_path, start_offset, symbol_id"
        )
        .all(projectRoot, tier)
        .flatMap(
            (row): ReadonlyArray<SemanticOccurrence> =>
                typeof row.symbol_id === "string" &&
                typeof row.file_path === "string" &&
                (row.role === "definition" || row.role === "reference") &&
                typeof row.start_offset === "number" &&
                typeof row.end_offset === "number"
                    ? [
                          Object.freeze({
                              end: row.end_offset,
                              filePath: row.file_path,
                              role: row.role,
                              scopeId: typeof row.scope_id === "string" ? row.scope_id : null,
                              start: row.start_offset,
                              symbolId: row.symbol_id
                          })
                      ]
                    : []
        );
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
            "SELECT name, file_path, start_offset, end_offset FROM semantic_unresolved_references WHERE project_root = ? AND tier = ? ORDER BY file_path, start_offset, name"
        )
        .all(projectRoot, tier)
        .flatMap(
            (row): ReadonlyArray<SemanticUnresolvedReference> =>
                typeof row.name === "string" &&
                typeof row.file_path === "string" &&
                typeof row.start_offset === "number" &&
                typeof row.end_offset === "number"
                    ? [
                          Object.freeze({
                              end: row.end_offset,
                              filePath: row.file_path,
                              name: row.name,
                              start: row.start_offset
                          })
                      ]
                    : []
        );
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

type FileDependency = Readonly<{
    downstreamFile: string;
    kind: "resolved-symbol-reference" | "script-call";
    sourceFile: string;
}>;

function collectFileDependencies(index: Record<string, unknown>): ReadonlyArray<FileDependency> {
    const scopes = Core.isObjectLike(index.scopes) ? (index.scopes as Record<string, unknown>) : {};
    const filesByScopeId = new Map<string, ReadonlyArray<string>>();
    for (const [scopeId, rawScope] of Object.entries(scopes)) {
        const scope = Core.isObjectLike(rawScope) ? (rawScope as Record<string, unknown>) : null;
        if (!scope || !Array.isArray(scope.filePaths)) {
            continue;
        }
        const filePaths = scope.filePaths.filter((filePath): filePath is string => typeof filePath === "string");
        if (filePaths.length > 0) {
            filesByScopeId.set(scopeId, filePaths);
        }
    }
    const relationships = Core.isObjectLike(index.relationships)
        ? (index.relationships as Record<string, unknown>)
        : {};
    const scriptCalls = Array.isArray(relationships.scriptCalls) ? relationships.scriptCalls : [];
    const dependencies = new Map<string, FileDependency>();
    const registerDependency = (sourceFile: string, downstreamFile: string, kind: FileDependency["kind"]): void => {
        if (sourceFile === downstreamFile) {
            return;
        }
        dependencies.set(
            `${kind}\u0000${sourceFile}\u0000${downstreamFile}`,
            Object.freeze({ downstreamFile, kind, sourceFile })
        );
    };

    const identifiers = Core.isObjectLike(index.identifiers) ? (index.identifiers as Record<string, unknown>) : {};
    for (const collection of Object.values(identifiers)) {
        if (!Core.isObjectLike(collection)) {
            continue;
        }
        for (const rawEntry of Object.values(collection as Record<string, unknown>)) {
            if (!Core.isObjectLike(rawEntry)) {
                continue;
            }
            const entry = rawEntry as Record<string, unknown>;
            const declarations = Array.isArray(entry.declarations) ? entry.declarations : [];
            const references = Array.isArray(entry.references) ? entry.references : [];
            const declarationFiles = declarations.flatMap((declaration) => {
                const filePath = readRecordString(declaration, "filePath");
                return filePath ? [filePath] : [];
            });
            for (const reference of references) {
                const referenceFile = readRecordString(reference, "filePath");
                if (!referenceFile) {
                    continue;
                }
                for (const declarationFile of declarationFiles) {
                    registerDependency(declarationFile, referenceFile, "resolved-symbol-reference");
                }
            }
        }
    }
    for (const rawCall of scriptCalls) {
        if (!Core.isObjectLike(rawCall)) {
            continue;
        }
        const from = Core.isObjectLike(rawCall.from) ? rawCall.from : {};
        const target = Core.isObjectLike(rawCall.target) ? rawCall.target : {};
        const downstreamFile = readRecordString(from, "filePath");
        const targetScopeId = readRecordString(target, "scopeId");
        if (!downstreamFile || !targetScopeId) {
            continue;
        }
        for (const sourceFile of filesByScopeId.get(targetScopeId) ?? []) {
            registerDependency(sourceFile, downstreamFile, "script-call");
        }
    }
    return [...dependencies.values()].toSorted((left, right) =>
        left.sourceFile === right.sourceFile
            ? left.downstreamFile === right.downstreamFile
                ? left.kind.localeCompare(right.kind)
                : left.downstreamFile.localeCompare(right.downstreamFile)
            : left.sourceFile.localeCompare(right.sourceFile)
    );
}

function createStorePath(projectRoot: string): string {
    return path.join(path.resolve(projectRoot), ".gmloop", "graph-index.sqlite");
}

function readStateForTier(
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

function readProjectHead(database: GraphDatabase, projectRoot: string): SemanticProjectHead {
    const row = database
        .prepare("SELECT head_generation FROM semantic_projects WHERE project_root = ?")
        .get(projectRoot) as { head_generation?: number } | undefined;
    return Object.freeze({ generation: row?.head_generation ?? 0, projectRoot });
}

function readActiveSlots(database: GraphDatabase, projectRoot: string): SemanticActiveSlots {
    const definitions = readStateForTier(database, projectRoot, "definitions");
    const full = readStateForTier(database, projectRoot, "full");
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

function readIndexForTier(
    database: GraphDatabase,
    projectRoot: string,
    tier: "definitions" | "full"
): Record<string, unknown> | null {
    const state = readStateForTier(database, projectRoot, tier);
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

function publishIndex(
    database: GraphDatabase,
    projectRoot: string,
    request: Readonly<{
        expectedHeadGeneration: number | null;
        authoritative: boolean;
        baseGeneration: number | null;
        index: Record<string, unknown>;
        manifest: SemanticFileManifest | null;
        sourceRevision: string;
        tier: "definitions" | "full";
    }>
): SemanticPublishResult {
    let publishedState: SemanticStoreState | null = null;
    const updatedAt = new Date().toISOString();

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
        if (request.tier === "full" && !request.authoritative) {
            const definitionsSlot = database
                .prepare("SELECT source_revision FROM semantic_slots WHERE project_root = ? AND tier = 'definitions'")
                .get(projectRoot) as { source_revision?: string } | undefined;
            if (
                definitionsSlot?.source_revision !== undefined &&
                definitionsSlot.source_revision !== request.sourceRevision
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
        database
            .prepare("DELETE FROM semantic_dependencies WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);
        database
            .prepare("DELETE FROM semantic_occurrences WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);
        database
            .prepare("DELETE FROM semantic_scope_files WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);
        database
            .prepare("DELETE FROM semantic_relationships WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);
        database
            .prepare("DELETE FROM semantic_symbols WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);
        database
            .prepare("DELETE FROM semantic_scopes WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);
        database
            .prepare("DELETE FROM semantic_resources WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);
        database
            .prepare("DELETE FROM semantic_files WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);
        database
            .prepare("DELETE FROM semantic_unresolved_references WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);

        const snapshot = createSemanticSnapshotFromProjectIndex(
            request.index,
            request.tier,
            request.sourceRevision as SemanticSourceRevision
        );
        const insertSymbol = database.prepare(
            "INSERT INTO semantic_symbols(project_root, tier, symbol_id, kind, name, display_name, defining_file_path, scope_id, documentation_json, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        for (const symbol of snapshot.symbols) {
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
            "INSERT INTO semantic_scopes(project_root, tier, scope_id, kind, name, display_name, resource_path, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        for (const scope of snapshot.scopes) {
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
        }
        const insertResource = database.prepare(
            "INSERT INTO semantic_resources(project_root, tier, resource_path, name, resource_type, updated_generation) VALUES (?, ?, ?, ?, ?, ?)"
        );
        for (const resource of snapshot.resources) {
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
            "INSERT INTO semantic_occurrences(project_root, tier, symbol_id, file_path, role, start_offset, end_offset, scope_id, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        for (const occurrence of snapshot.occurrences) {
            insertOccurrence.run(
                projectRoot,
                request.tier,
                occurrence.symbolId,
                occurrence.filePath,
                occurrence.role,
                occurrence.start,
                occurrence.end,
                occurrence.scopeId,
                generation
            );
        }

        const insertDependency = database.prepare(
            "INSERT INTO semantic_dependencies(project_root, tier, owner_file_path, dependent_file_path, dependency_kind, symbol_id, updated_generation) VALUES (?, ?, ?, ?, ?, NULL, ?)"
        );
        for (const dependency of collectFileDependencies(request.index)) {
            insertDependency.run(
                projectRoot,
                request.tier,
                dependency.sourceFile,
                dependency.downstreamFile,
                dependency.kind,
                generation
            );
        }
        if (request.tier === "full" && Core.isObjectLike(request.index.files)) {
            const insertUnresolved = database.prepare(
                "INSERT INTO semantic_unresolved_references(project_root, tier, name, file_path, start_offset, end_offset, updated_generation) VALUES (?, ?, ?, ?, 0, 0, ?)"
            );
            for (const [filePath, rawFile] of Object.entries(request.index.files as Record<string, unknown>)) {
                if (!Core.isObjectLike(rawFile)) {
                    continue;
                }
                const fileRecord = rawFile as Record<string, unknown>;
                const ignoredIdentifiers = Array.isArray(fileRecord.ignoredIdentifiers)
                    ? fileRecord.ignoredIdentifiers
                    : [];
                for (const ignoredIdentifier of ignoredIdentifiers) {
                    const identifierName = readRecordString(ignoredIdentifier, "name");
                    if (identifierName) {
                        insertUnresolved.run(projectRoot, request.tier, identifierName, filePath, generation);
                    }
                }
            }
        }
        if (request.manifest !== null) {
            const insertManifestFile = database.prepare(
                "INSERT INTO semantic_files(project_root, tier, relative_path, file_kind, content_hash, size_bytes, mtime_ms, source_origin, source_version, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            for (const entry of request.manifest.entries.values()) {
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
            .run(projectRoot, request.tier, generation, JSON.stringify(request.index));
        database
            .prepare(
                "INSERT INTO semantic_generation_history(project_root, generation, tier, source_revision, reason, affected_file_count, published_at, result) VALUES (?, ?, ?, ?, 'publication', ?, ?, 'published')"
            )
            .run(
                projectRoot,
                generation,
                request.tier,
                request.sourceRevision,
                request.manifest?.entries.size ?? 0,
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

/** Open the canonical project semantic store shared by LSP, CLI, and graph tooling. */
export function openSemanticIndexStore(projectRoot: string): SemanticIndexStore {
    const resolvedRoot = path.resolve(projectRoot);
    const database = openGraphIndexDatabase(createStorePath(resolvedRoot));
    return {
        close: () => database.close(),
        findImmediateDownstreamFiles: (filePath) => findImmediateDownstreamFiles(database, resolvedRoot, filePath),
        findUnresolvedDependents: (identifierNames) =>
            findUnresolvedDependents(database, resolvedRoot, identifierNames),
        readActiveSlots: () => readActiveSlots(database, resolvedRoot),
        readManifestForTier: (tier) => readManifestForTier(database, resolvedRoot, tier),
        readSemanticSnapshot: (tier) => readSemanticSnapshot(database, resolvedRoot, tier),
        readFileContentHashes: () => readFileContentHashes(database, resolvedRoot),
        readIndexForTier: (tier) => readIndexForTier(database, resolvedRoot, tier),
        readProjectHead: () => readProjectHead(database, resolvedRoot),
        readStateForTier: (tier) => readStateForTier(database, resolvedRoot, tier),
        publishIndex: (request) => publishIndex(database, resolvedRoot, request)
    };
}

/** Return the canonical database path for a project root. */
export function getSemanticIndexDatabasePath(projectRoot: string): string {
    return createStorePath(projectRoot);
}
