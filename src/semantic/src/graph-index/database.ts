import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const GRAPH_INDEX_SCHEMA_VERSION = 1;

const TABLE_RESET_STATEMENTS = Object.freeze([
    "DELETE FROM index_state",
    "DELETE FROM embeddings",
    "DELETE FROM aliases",
    "DELETE FROM edges",
    "DELETE FROM node_fts",
    "DELETE FROM nodes",
    "DELETE FROM files",
    "DELETE FROM graphs"
]);

function createGraphIndexSchema(database: DatabaseSync): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS schema_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS graphs (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            root_path TEXT NOT NULL,
            manifest_path TEXT,
            last_indexed_at TEXT NOT NULL,
            schema_version INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS files (
            graph_id TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            content_hash TEXT,
            mtime_ms INTEGER,
            indexed_at TEXT NOT NULL,
            PRIMARY KEY (graph_id, relative_path)
        );

        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            graph_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            scip_symbol TEXT,
            relative_path TEXT,
            resource_path TEXT,
            scope_id TEXT,
            line_start INTEGER,
            line_end INTEGER,
            summary TEXT NOT NULL,
            snippet TEXT NOT NULL,
            content_hash TEXT
        );

        CREATE TABLE IF NOT EXISTS edges (
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            type TEXT NOT NULL,
            ordinal INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (from_id, to_id, type, ordinal)
        );

        CREATE TABLE IF NOT EXISTS aliases (
            alias TEXT NOT NULL,
            node_id TEXT NOT NULL,
            source TEXT NOT NULL,
            PRIMARY KEY (alias, node_id, source)
        );

        CREATE TABLE IF NOT EXISTS embeddings (
            node_id TEXT PRIMARY KEY,
            model_id TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            vector_blob BLOB NOT NULL,
            content_hash TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS index_state (
            graph_id TEXT PRIMARY KEY,
            file_count INTEGER NOT NULL,
            node_count INTEGER NOT NULL,
            edge_count INTEGER NOT NULL,
            embedding_model TEXT NOT NULL,
            build_duration_ms INTEGER NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS node_fts USING fts5(
            id UNINDEXED,
            name,
            display_name,
            summary,
            content
        );

        CREATE INDEX IF NOT EXISTS idx_nodes_graph_kind_name ON nodes(graph_id, kind, name);
        CREATE INDEX IF NOT EXISTS idx_nodes_scip_symbol ON nodes(scip_symbol);
        CREATE INDEX IF NOT EXISTS idx_edges_from_type ON edges(from_id, type);
        CREATE INDEX IF NOT EXISTS idx_edges_to_type ON edges(to_id, type);
        CREATE INDEX IF NOT EXISTS idx_aliases_alias ON aliases(alias);
    `);
    database
        .prepare("INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('schema_version', ?)")
        .run(String(GRAPH_INDEX_SCHEMA_VERSION));
}

/**
 * Open the graph-index database and ensure the v1 schema exists.
 */
export function openGraphIndexDatabase(databasePath: string): DatabaseSync {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA foreign_keys = ON;");
    createGraphIndexSchema(database);

    return database;
}

/**
 * Open an existing graph-index database without creating a missing database.
 */
export function openExistingGraphIndexDatabase(databasePath: string): DatabaseSync {
    if (!existsSync(databasePath)) {
        throw new Error(`Graph database not found at ${databasePath}. Run 'gmloop graph index' first.`);
    }

    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = ON;");
    return database;
}

/**
 * Read the schema version stored in a graph-index database.
 */
export function readGraphIndexSchemaVersion(database: DatabaseSync): number | null {
    try {
        const row = database.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as
            | { value: string }
            | undefined;
        const parsedVersion = Number.parseInt(row?.value ?? "", 10);
        return Number.isFinite(parsedVersion) ? parsedVersion : null;
    } catch {
        return null;
    }
}

/**
 * Reset all graph-index tables before a full rebuild.
 */
export function resetGraphIndexDatabase(database: DatabaseSync): void {
    database.exec("BEGIN");
    try {
        for (const statement of TABLE_RESET_STATEMENTS) {
            database.exec(statement);
        }
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}
