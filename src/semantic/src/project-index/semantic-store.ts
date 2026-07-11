import path from "node:path";

import { Core } from "@gmloop/core";

import { openGraphIndexDatabase } from "../graph-index/database.js";
import { type GraphDatabase, runGraphDatabaseTransaction } from "../graph-index/sqlite-adapter.js";

type SemanticRecordRow = Readonly<{
    payload: string;
    record_key: string;
    record_kind: string;
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
    readState: () => SemanticStoreState | null;
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
    const generation = (previous?.generation ?? 0) + 1;
    const updatedAt = new Date().toISOString();

    runGraphDatabaseTransaction(database, () => {
        database
            .prepare(
                "INSERT OR REPLACE INTO semantic_state(project_root, generation, tier, source_signature, updated_at) VALUES (?, ?, ?, ?, ?)"
            )
            .run(projectRoot, generation, tier, sourceSignature, updatedAt);
        database.prepare("DELETE FROM semantic_records WHERE project_root = ?").run(projectRoot);

        const insert = database.prepare(
            "INSERT INTO semantic_records(project_root, record_kind, record_key, file_path, content_hash, payload, generation) VALUES (?, ?, ?, ?, ?, ?, ?)"
        );
        for (const [recordKind, value] of Object.entries(index)) {
            if (!Core.isObjectLike(value)) {
                insert.run(projectRoot, recordKind, "__value__", null, null, JSON.stringify(value), generation);
                continue;
            }
            for (const [recordKey, recordValue] of Object.entries(value as Record<string, unknown>)) {
                insert.run(projectRoot, recordKind, recordKey, null, null, JSON.stringify(recordValue), generation);
            }
        }
    });

    return Object.freeze({ generation, projectRoot, sourceSignature, tier });
}

/** Open the canonical project semantic store shared by LSP, CLI, and graph tooling. */
export function openSemanticIndexStore(projectRoot: string): SemanticIndexStore {
    const resolvedRoot = path.resolve(projectRoot);
    const database = openGraphIndexDatabase(createStorePath(resolvedRoot));
    return {
        close: () => database.close(),
        readIndex: () => readIndex(database, resolvedRoot),
        readState: () => readState(database, resolvedRoot),
        writeIndex: (index, tier, sourceSignature) => writeIndex(database, resolvedRoot, index, tier, sourceSignature)
    };
}

/** Return the canonical database path for a project root. */
export function getSemanticIndexDatabasePath(projectRoot: string): string {
    return createStorePath(projectRoot);
}
