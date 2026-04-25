import {
    type GraphDatabase,
    openExistingGraphDatabase,
    openGraphDatabase,
    runGraphDatabaseTransaction
} from "./sqlite-adapter.js";

export const GRAPH_INDEX_SCHEMA_VERSION = 2;

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

const LEGACY_TABLE_NAMES = Object.freeze(["graphs", "files", "nodes", "edges", "aliases", "embeddings", "index_state"]);

function tableExists(database: GraphDatabase, tableName: string): boolean {
    const row = database
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?")
        .get(tableName) as { name?: string } | undefined;
    return row?.name === tableName;
}

function createSchemaMetaTable(database: GraphDatabase): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS schema_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);
}

function createGraphIndexSchemaV2(database: GraphDatabase): void {
    database.exec(`
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
            PRIMARY KEY (graph_id, relative_path),
            FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE
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
            content_hash TEXT,
            FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS edges (
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            type TEXT NOT NULL,
            ordinal INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (from_id, to_id, type, ordinal),
            FOREIGN KEY (from_id) REFERENCES nodes(id) ON DELETE CASCADE,
            FOREIGN KEY (to_id) REFERENCES nodes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS aliases (
            alias TEXT NOT NULL,
            node_id TEXT NOT NULL,
            source TEXT NOT NULL,
            PRIMARY KEY (alias, node_id, source),
            FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS embeddings (
            node_id TEXT PRIMARY KEY,
            model_id TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            vector_blob BLOB NOT NULL,
            content_hash TEXT NOT NULL,
            FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS index_state (
            graph_id TEXT PRIMARY KEY,
            file_count INTEGER NOT NULL,
            node_count INTEGER NOT NULL,
            edge_count INTEGER NOT NULL,
            embedding_model TEXT NOT NULL,
            build_duration_ms INTEGER NOT NULL,
            FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE
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
        CREATE INDEX IF NOT EXISTS idx_files_graph_path ON files(graph_id, relative_path);
        CREATE INDEX IF NOT EXISTS idx_edges_from_type ON edges(from_id, type);
        CREATE INDEX IF NOT EXISTS idx_edges_to_type ON edges(to_id, type);
        CREATE INDEX IF NOT EXISTS idx_aliases_alias ON aliases(alias);
    `);
}

function writeGraphIndexSchemaVersion(database: GraphDatabase): void {
    database
        .prepare("INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('schema_version', ?)")
        .run(String(GRAPH_INDEX_SCHEMA_VERSION));
}

function createGraphIndexSchema(database: GraphDatabase): void {
    createSchemaMetaTable(database);
    createGraphIndexSchemaV2(database);
    writeGraphIndexSchemaVersion(database);
}

function migrateGraphIndexSchemaV1ToV2(database: GraphDatabase): void {
    runGraphDatabaseTransaction(database, () => {
        for (const tableName of LEGACY_TABLE_NAMES) {
            if (tableExists(database, tableName)) {
                database.exec(`ALTER TABLE ${tableName} RENAME TO ${tableName}_v1_legacy`);
            }
        }
        if (tableExists(database, "node_fts")) {
            database.exec("DROP TABLE node_fts");
        }
        database.exec("DROP TABLE IF EXISTS schema_meta");

        createGraphIndexSchema(database);

        if (tableExists(database, "graphs_v1_legacy")) {
            database.exec(`
                INSERT OR REPLACE INTO graphs(id, scope, root_path, manifest_path, last_indexed_at, schema_version)
                SELECT id, scope, root_path, manifest_path, last_indexed_at, ${String(GRAPH_INDEX_SCHEMA_VERSION)}
                FROM graphs_v1_legacy
            `);
        }
        if (tableExists(database, "files_v1_legacy")) {
            database.exec(`
                INSERT OR REPLACE INTO files(graph_id, relative_path, content_hash, mtime_ms, indexed_at)
                SELECT graph_id, relative_path, content_hash, mtime_ms, indexed_at
                FROM files_v1_legacy
            `);
        }
        if (tableExists(database, "nodes_v1_legacy")) {
            database.exec(`
                INSERT OR REPLACE INTO nodes(
                    id, graph_id, kind, name, display_name, scip_symbol, relative_path, resource_path, scope_id,
                    line_start, line_end, summary, snippet, content_hash
                )
                SELECT
                    id, graph_id, kind, name, display_name, scip_symbol, relative_path, resource_path, scope_id,
                    line_start, line_end, summary, snippet, content_hash
                FROM nodes_v1_legacy
            `);
            database.exec(`
                INSERT OR REPLACE INTO node_fts(id, name, display_name, summary, content)
                SELECT id, name, display_name, summary, summary || '\n' || snippet
                FROM nodes_v1_legacy
            `);
        }
        if (tableExists(database, "edges_v1_legacy")) {
            database.exec(`
                INSERT OR REPLACE INTO edges(from_id, to_id, type, ordinal)
                SELECT from_id, to_id, type, ordinal
                FROM edges_v1_legacy
            `);
        }
        if (tableExists(database, "aliases_v1_legacy")) {
            database.exec(`
                INSERT OR REPLACE INTO aliases(alias, node_id, source)
                SELECT alias, node_id, source
                FROM aliases_v1_legacy
            `);
        }
        if (tableExists(database, "embeddings_v1_legacy")) {
            database.exec(`
                INSERT OR REPLACE INTO embeddings(node_id, model_id, dimensions, vector_blob, content_hash)
                SELECT node_id, model_id, dimensions, vector_blob, content_hash
                FROM embeddings_v1_legacy
            `);
        }
        if (tableExists(database, "index_state_v1_legacy")) {
            database.exec(`
                INSERT OR REPLACE INTO index_state(graph_id, file_count, node_count, edge_count, embedding_model, build_duration_ms)
                SELECT graph_id, file_count, node_count, edge_count, embedding_model, build_duration_ms
                FROM index_state_v1_legacy
            `);
        }

        for (const tableName of LEGACY_TABLE_NAMES) {
            if (tableExists(database, `${tableName}_v1_legacy`)) {
                database.exec(`DROP TABLE ${tableName}_v1_legacy`);
            }
        }
    });
}

function ensureGraphIndexSchema(database: GraphDatabase): void {
    createSchemaMetaTable(database);
    const schemaVersion = readGraphIndexSchemaVersion(database);
    if (schemaVersion === null) {
        createGraphIndexSchema(database);
        return;
    }

    if (schemaVersion === 1) {
        migrateGraphIndexSchemaV1ToV2(database);
        return;
    }

    if (schemaVersion !== GRAPH_INDEX_SCHEMA_VERSION) {
        throw new Error(
            `Graph database schema ${String(schemaVersion)} is incompatible with expected schema ${String(GRAPH_INDEX_SCHEMA_VERSION)}.`
        );
    }

    createGraphIndexSchemaV2(database);
    writeGraphIndexSchemaVersion(database);
}

/**
 * Open the graph-index database and ensure the latest schema exists.
 */
export function openGraphIndexDatabase(databasePath: string): GraphDatabase {
    const database = openGraphDatabase(databasePath);
    ensureGraphIndexSchema(database);

    return database;
}

/**
 * Open an existing graph-index database without creating a missing database.
 */
export function openExistingGraphIndexDatabase(databasePath: string): GraphDatabase {
    const database = openExistingGraphDatabase(databasePath);
    ensureGraphIndexSchema(database);
    return database;
}

/**
 * Read the schema version stored in a graph-index database.
 */
export function readGraphIndexSchemaVersion(database: GraphDatabase): number | null {
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
export function resetGraphIndexDatabase(database: GraphDatabase): void {
    runGraphDatabaseTransaction(database, () => {
        for (const statement of TABLE_RESET_STATEMENTS) {
            database.exec(statement);
        }
    });
}
