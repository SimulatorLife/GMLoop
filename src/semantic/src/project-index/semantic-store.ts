import path from "node:path";

import { Core } from "@gmloop/core";

import { openGraphIndexDatabase } from "../graph-index/database.js";
import { type GraphDatabase, runGraphDatabaseTransaction } from "../graph-index/sqlite-adapter.js";

type SemanticRecordRow = Readonly<{
    payload: string;
    record_key: string;
    record_kind: string;
}>;

type SemanticFileHashRow = Readonly<{
    content_hash: string | null;
    file_path: string;
}>;

export type SemanticStoreState = Readonly<{
    generation: number;
    projectRoot: string;
    sourceSignature: string;
    tier: "definitions" | "full";
}>;

export type SemanticIndexStore = Readonly<{
    close: () => void;
    readIndex: () => Record<string, unknown> | null;
    readFileContentHashes: () => ReadonlyMap<string, string>;
    readState: () => SemanticStoreState | null;
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
            "SELECT file_path, content_hash FROM semantic_records WHERE project_root = ? AND record_kind = 'files' AND content_hash IS NOT NULL ORDER BY file_path"
        )
        .all(projectRoot) as unknown as ReadonlyArray<SemanticFileHashRow>;
    return new Map(rows.flatMap((row) => (row.content_hash ? [[row.file_path, row.content_hash] as const] : [])));
}

function findImmediateDownstreamFiles(
    database: GraphDatabase,
    projectRoot: string,
    filePath: string
): ReadonlyArray<string> {
    return (
        database
            .prepare(
                "SELECT downstream_file FROM semantic_dependencies WHERE project_root = ? AND source_file = ? ORDER BY downstream_file"
            )
            .all(projectRoot, filePath) as unknown as ReadonlyArray<{ downstream_file: string }>
    ).map((row) => row.downstream_file);
}

function collectFileDependencies(index: Record<string, unknown>): ReadonlyArray<readonly [string, string]> {
    const scopes = Core.isObjectLike(index.scopes) ? (index.scopes as Record<string, unknown>) : {};
    const filesByScopeId = new Map<string, ReadonlyArray<string>>();
    for (const [scopeId, rawScope] of Object.entries(scopes)) {
        if (!Core.isObjectLike(rawScope) || !Array.isArray(rawScope.filePaths)) {
            continue;
        }
        const filePaths = rawScope.filePaths.filter((filePath): filePath is string => typeof filePath === "string");
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

/** Compact pre-normalized aggregate rows into the canonical one-fact-per-row layout. */
function migrateAggregateRecords(database: GraphDatabase, projectRoot: string): void {
    const rows = database
        .prepare(
            "SELECT record_kind, record_key, payload, generation FROM semantic_records WHERE project_root = ? AND record_kind IN ('identifiers', 'relationships')"
        )
        .all(projectRoot) as unknown as ReadonlyArray<SemanticRecordRow & { generation: number }>;
    const identifierRows = rows.filter((row) => row.record_kind === "identifiers" && !row.record_key.includes(":"));
    const relationshipRows = rows.filter((row) => row.record_kind === "relationships");
    if (identifierRows.length === 0 && relationshipRows.length === 0) return;

    runGraphDatabaseTransaction(database, () => {
        const insert = database.prepare(
            "INSERT OR REPLACE INTO semantic_records(project_root, record_kind, record_key, file_path, content_hash, payload, generation) VALUES (?, ?, ?, NULL, NULL, ?, ?)"
        );
        for (const row of identifierRows) {
            const value = parseRecordPayload(row.payload);
            if (!Core.isObjectLike(value)) continue;
            for (const [collectionName, collectionValue] of Object.entries(value)) {
                if (!Core.isObjectLike(collectionValue)) continue;
                for (const [entryKey, entryValue] of Object.entries(collectionValue)) {
                    insert.run(
                        projectRoot,
                        "identifiers",
                        `${collectionName}:${entryKey}`,
                        JSON.stringify(entryValue),
                        row.generation
                    );
                }
            }
        }
        for (const row of relationshipRows) {
            const value = parseRecordPayload(row.payload);
            if (!Core.isObjectLike(value)) continue;
            const calls = (value as Record<string, unknown>).scriptCalls;
            if (!Array.isArray(calls)) continue;
            for (const [callIndex, call] of calls.entries()) {
                insert.run(projectRoot, "relationship", String(callIndex), JSON.stringify(call), row.generation);
            }
        }
        database
            .prepare(
                "DELETE FROM semantic_records WHERE project_root = ? AND (record_kind = 'relationships' OR (record_kind = 'identifiers' AND instr(record_key, ':') = 0))"
            )
            .run(projectRoot);
    });
}

function createStorePath(projectRoot: string): string {
    return path.join(path.resolve(projectRoot), ".gmloop", "graph-index.sqlite");
}

function readState(database: GraphDatabase, projectRoot: string): SemanticStoreState | null {
    const row = database
        .prepare("SELECT generation, tier, source_signature FROM semantic_state WHERE project_root = ?")
        .get(projectRoot) as { generation?: number; source_signature?: string; tier?: string } | undefined;
    if (!row || (row.tier !== "definitions" && row.tier !== "full") || typeof row.generation !== "number") {
        return null;
    }
    return Object.freeze({
        generation: row.generation,
        projectRoot,
        sourceSignature: row.source_signature ?? "",
        tier: row.tier
    });
}

function readIndex(database: GraphDatabase, projectRoot: string): Record<string, unknown> | null {
    const state = readState(database, projectRoot);
    if (!state) {
        return null;
    }

    const rows = database
        .prepare(
            "SELECT record_kind, record_key, payload FROM semantic_records WHERE project_root = ? ORDER BY record_kind, record_key"
        )
        .all(projectRoot) as unknown as ReadonlyArray<SemanticRecordRow>;
    const result: Record<string, unknown> = {};
    for (const row of rows) {
        const parsedPayload = parseRecordPayload(row.payload);
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
    const previous = readState(database, projectRoot);
    if (previous?.tier === "full" && tier === "definitions") {
        return previous;
    }
    const generation = (previous?.generation ?? 0) + 1;
    const updatedAt = new Date().toISOString();

    runGraphDatabaseTransaction(database, () => {
        database
            .prepare(
                "INSERT OR REPLACE INTO semantic_state(project_root, generation, tier, source_signature, updated_at) VALUES (?, ?, ?, ?, ?)"
            )
            .run(projectRoot, generation, tier, sourceSignature, updatedAt);
        database.prepare("DELETE FROM semantic_records WHERE project_root = ?").run(projectRoot);
        database.prepare("DELETE FROM semantic_dependencies WHERE project_root = ?").run(projectRoot);

        const insert = database.prepare(
            "INSERT INTO semantic_records(project_root, record_kind, record_key, file_path, content_hash, payload, generation) VALUES (?, ?, ?, ?, ?, ?, ?)"
        );
        for (const [recordKind, value] of Object.entries(index)) {
            if (recordKind === "files" && Core.isObjectLike(value)) {
                for (const [filePath, fileRecord] of Object.entries(value as Record<string, unknown>)) {
                    insert.run(
                        projectRoot,
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
                insert.run(projectRoot, recordKind, "__value__", null, null, JSON.stringify(value), generation);
                continue;
            }
            for (const [recordKey, recordValue] of Object.entries(value as Record<string, unknown>)) {
                insert.run(projectRoot, recordKind, recordKey, null, null, JSON.stringify(recordValue), generation);
            }
        }
        const insertDependency = database.prepare(
            "INSERT INTO semantic_dependencies(project_root, source_file, downstream_file) VALUES (?, ?, ?)"
        );
        for (const [sourceFile, downstreamFile] of collectFileDependencies(index)) {
            insertDependency.run(projectRoot, sourceFile, downstreamFile);
        }
    });

    return Object.freeze({ generation, projectRoot, sourceSignature, tier });
}

/** Open the canonical project semantic store shared by LSP, CLI, and graph tooling. */
export function openSemanticIndexStore(projectRoot: string): SemanticIndexStore {
    const resolvedRoot = path.resolve(projectRoot);
    const database = openGraphIndexDatabase(createStorePath(resolvedRoot));
    migrateAggregateRecords(database, resolvedRoot);
    return {
        close: () => database.close(),
        findImmediateDownstreamFiles: (filePath) => findImmediateDownstreamFiles(database, resolvedRoot, filePath),
        readFileContentHashes: () => readFileContentHashes(database, resolvedRoot),
        readIndex: () => readIndex(database, resolvedRoot),
        readState: () => readState(database, resolvedRoot),
        writeIndex: (index, tier, sourceSignature) => writeIndex(database, resolvedRoot, index, tier, sourceSignature)
    };
}

/** Return the canonical database path for a project root. */
export function getSemanticIndexDatabasePath(projectRoot: string): string {
    return createStorePath(projectRoot);
}
