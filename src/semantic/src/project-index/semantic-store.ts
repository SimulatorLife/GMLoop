import path from "node:path";

import { Core } from "@gmloop/core";

import { openGraphIndexDatabase } from "../graph-index/database.js";
import { type GraphDatabase, runGraphDatabaseImmediateTransaction } from "../graph-index/sqlite-adapter.js";
import type { SemanticFileManifest, SemanticFileManifestEntry } from "./semantic-manifest.js";

type SemanticRecordRow = Readonly<{
    payload: string;
    record_key: string;
    record_kind: string;
}>;

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
    readIndexForTier: (tier: "definitions" | "full") => Record<string, unknown> | null;
    readStateForTier: (tier: "definitions" | "full") => SemanticStoreState | null;
    readProjectHead: () => SemanticProjectHead;
    publishIndex: (
        request: Readonly<{
            expectedHeadGeneration: number;
            index: Record<string, unknown>;
            manifest: SemanticFileManifest | null;
            sourceRevision: string;
            tier: "definitions" | "full";
        }>
    ) => SemanticPublishResult;
    findImmediateDownstreamFiles: (filePath: string) => ReadonlyArray<string>;
    writeIndex: (
        index: Record<string, unknown>,
        tier: "definitions" | "full",
        sourceSignature?: string
    ) => SemanticStoreState;
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
            "SELECT file_path, content_hash FROM semantic_slot_records WHERE project_root = ? AND tier = 'full' AND record_kind = 'files' AND content_hash IS NOT NULL ORDER BY file_path"
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

function findImmediateDownstreamFiles(
    database: GraphDatabase,
    projectRoot: string,
    filePath: string
): ReadonlyArray<string> {
    return (
        database
            .prepare(
                "SELECT downstream_file FROM semantic_slot_dependencies WHERE project_root = ? AND tier = 'full' AND source_file = ? ORDER BY downstream_file"
            )
            .all(projectRoot, filePath) as unknown as ReadonlyArray<{ downstream_file: string }>
    ).map((row) => row.downstream_file);
}

function collectFileDependencies(index: Record<string, unknown>): ReadonlyArray<readonly [string, string]> {
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
    const dependencies = new Set<string>();
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
            if (sourceFile !== downstreamFile) {
                dependencies.add(`${sourceFile}\u0000${downstreamFile}`);
            }
        }
    }
    return [...dependencies]
        .map((dependency) => dependency.split("\u0000") as [string, string])
        .toSorted(([leftSource, leftDownstream], [rightSource, rightDownstream]) =>
            leftSource === rightSource
                ? leftDownstream.localeCompare(rightDownstream)
                : leftSource.localeCompare(rightSource)
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
        .prepare("SELECT generation, tier, source_revision FROM semantic_slots WHERE project_root = ? AND tier = ?")
        .get(projectRoot, tier) as { generation?: number; source_revision?: string; tier?: string } | undefined;
    if (!row || (row.tier !== "definitions" && row.tier !== "full") || typeof row.generation !== "number") {
        return null;
    }
    return Object.freeze({
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
    const newest =
        definitions === null || (full !== null && full.generation > definitions.generation) ? full : definitions;
    return Object.freeze({
        definitions,
        full,
        hasMatchingFull:
            full !== null &&
            newest !== null &&
            full.sourceSignature.length > 0 &&
            full.sourceSignature === newest.sourceSignature,
        newestDefinitionsRevision: newest?.sourceSignature || null
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

    const rows = database
        .prepare(
            "SELECT record_kind, record_key, payload FROM semantic_slot_records WHERE project_root = ? AND tier = ? ORDER BY record_kind, record_key"
        )
        .all(projectRoot, state.tier) as unknown as ReadonlyArray<SemanticRecordRow>;
    const result: Record<string, unknown> = {};
    for (const row of rows) {
        const parsedPayload = parseRecordPayload(row.payload);
        if (row.record_kind === "files" && row.record_key === "__value__") {
            result.files = parsedPayload;
            continue;
        }
        if (row.record_kind === "identifiers") {
            const separator = row.record_key.indexOf(":");
            if (separator > 0) {
                const collectionName = row.record_key.slice(0, separator);
                const entryKey = row.record_key.slice(separator + 1);
                const collection = (result.identifiers ??= {}) as Record<string, unknown>;
                const entries = (collection[collectionName] ??= {}) as Record<string, unknown>;
                entries[entryKey] = parsedPayload;
                continue;
            }
        }
        if (row.record_kind === "relationship") {
            const relationships = (result.relationships ??= { scriptCalls: [] }) as Record<string, unknown>;
            const calls = relationships.scriptCalls;
            if (Array.isArray(calls)) {
                calls.push(parsedPayload);
            }
            continue;
        }
        if (row.record_key === "__value__") {
            result[row.record_kind] = parsedPayload;
            continue;
        }
        const bucket = result[row.record_kind];
        if (bucket === undefined) {
            result[row.record_kind] = {};
        }
        const target = result[row.record_kind] as Record<string, unknown>;
        target[row.record_key] = parsedPayload;
    }
    return result;
}

function writeIndex(
    database: GraphDatabase,
    projectRoot: string,
    index: Record<string, unknown>,
    tier: "definitions" | "full",
    sourceSignature = ""
): SemanticStoreState {
    const result = publishIndex(database, projectRoot, {
        expectedHeadGeneration: null,
        index,
        manifest: null,
        sourceRevision: sourceSignature,
        tier
    });
    if (result.state === null) {
        throw new Error("Unconditional semantic publication was unexpectedly superseded.");
    }
    return result.state;
}

function publishIndex(
    database: GraphDatabase,
    projectRoot: string,
    request: Readonly<{
        expectedHeadGeneration: number | null;
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
        const generation = currentHeadGeneration + 1;
        database
            .prepare(
                "INSERT INTO semantic_projects(project_root, head_generation, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_root) DO UPDATE SET head_generation = excluded.head_generation, updated_at = excluded.updated_at"
            )
            .run(projectRoot, generation, updatedAt);
        database
            .prepare(
                "INSERT INTO semantic_slots(project_root, tier, generation, source_revision, base_generation, updated_at) VALUES (?, ?, ?, ?, NULL, ?) ON CONFLICT(project_root, tier) DO UPDATE SET generation = excluded.generation, source_revision = excluded.source_revision, base_generation = excluded.base_generation, updated_at = excluded.updated_at"
            )
            .run(projectRoot, request.tier, generation, request.sourceRevision, updatedAt);
        database
            .prepare("DELETE FROM semantic_slot_records WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);
        database
            .prepare("DELETE FROM semantic_slot_dependencies WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);
        database
            .prepare("DELETE FROM semantic_files WHERE project_root = ? AND tier = ?")
            .run(projectRoot, request.tier);

        const insert = database.prepare(
            "INSERT INTO semantic_slot_records(project_root, tier, record_kind, record_key, file_path, content_hash, payload, updated_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        for (const [recordKind, value] of Object.entries(request.index)) {
            if (recordKind === "files" && Core.isObjectLike(value)) {
                if (Object.keys(value).length === 0) {
                    insert.run(
                        projectRoot,
                        request.tier,
                        recordKind,
                        "__value__",
                        null,
                        null,
                        JSON.stringify(value),
                        generation
                    );
                    continue;
                }
                for (const [filePath, fileRecord] of Object.entries(value as Record<string, unknown>)) {
                    insert.run(
                        projectRoot,
                        request.tier,
                        recordKind,
                        filePath,
                        filePath,
                        readRecordString(fileRecord, "contentHash"),
                        JSON.stringify(fileRecord),
                        generation
                    );
                }
                continue;
            }
            if (recordKind === "identifiers" && Core.isObjectLike(value)) {
                for (const [collectionName, collectionValue] of Object.entries(value as Record<string, unknown>)) {
                    if (!Core.isObjectLike(collectionValue)) {
                        continue;
                    }
                    for (const [entryKey, entryValue] of Object.entries(collectionValue as Record<string, unknown>)) {
                        insert.run(
                            projectRoot,
                            request.tier,
                            "identifiers",
                            `${collectionName}:${entryKey}`,
                            readRecordString(entryValue, "filePath"),
                            null,
                            JSON.stringify(entryValue),
                            generation
                        );
                    }
                }
                continue;
            }
            if (recordKind === "relationships" && Core.isObjectLike(value)) {
                const scriptCalls = (value as Record<string, unknown>).scriptCalls;
                if (Array.isArray(scriptCalls)) {
                    for (const [callIndex, call] of scriptCalls.entries()) {
                        insert.run(
                            projectRoot,
                            request.tier,
                            "relationship",
                            String(callIndex),
                            Core.isObjectLike(call) && Core.isObjectLike(call.from)
                                ? readRecordString(call.from, "filePath")
                                : null,
                            null,
                            JSON.stringify(call),
                            generation
                        );
                    }
                }
                continue;
            }
            if (!Core.isObjectLike(value)) {
                insert.run(
                    projectRoot,
                    request.tier,
                    recordKind,
                    "__value__",
                    null,
                    null,
                    JSON.stringify(value),
                    generation
                );
                continue;
            }
            for (const [recordKey, recordValue] of Object.entries(value as Record<string, unknown>)) {
                insert.run(
                    projectRoot,
                    request.tier,
                    recordKind,
                    recordKey,
                    null,
                    null,
                    JSON.stringify(recordValue),
                    generation
                );
            }
        }
        const insertDependency = database.prepare(
            "INSERT INTO semantic_slot_dependencies(project_root, tier, source_file, downstream_file, dependency_kind, symbol_id, updated_generation) VALUES (?, ?, ?, ?, 'script-call', NULL, ?)"
        );
        for (const [sourceFile, downstreamFile] of collectFileDependencies(request.index)) {
            insertDependency.run(projectRoot, request.tier, sourceFile, downstreamFile, generation);
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
        readActiveSlots: () => readActiveSlots(database, resolvedRoot),
        readManifestForTier: (tier) => readManifestForTier(database, resolvedRoot, tier),
        readFileContentHashes: () => readFileContentHashes(database, resolvedRoot),
        readIndexForTier: (tier) => readIndexForTier(database, resolvedRoot, tier),
        readProjectHead: () => readProjectHead(database, resolvedRoot),
        readStateForTier: (tier) => readStateForTier(database, resolvedRoot, tier),
        publishIndex: (request) => publishIndex(database, resolvedRoot, request),
        writeIndex: (index, tier, sourceSignature) => writeIndex(database, resolvedRoot, index, tier, sourceSignature)
    };
}

/** Return the canonical database path for a project root. */
export function getSemanticIndexDatabasePath(projectRoot: string): string {
    return createStorePath(projectRoot);
}
