import {
    type GraphDatabase,
    openExistingGraphDatabase,
    openGraphDatabase,
    runGraphDatabaseTransaction
} from "./sqlite-adapter.js";

/** The canonical normalized SCIP semantic-store schema. */
export const GRAPH_INDEX_SCHEMA_VERSION = 8;

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

function _createSemanticIndexSchemaV3(database: GraphDatabase): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS semantic_state (
            project_root TEXT PRIMARY KEY,
            generation INTEGER NOT NULL,
            tier TEXT NOT NULL CHECK (tier IN ('definitions', 'full')),
            source_signature TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS semantic_records (
            project_root TEXT NOT NULL,
            record_kind TEXT NOT NULL,
            record_key TEXT NOT NULL,
            file_path TEXT,
            content_hash TEXT,
            payload TEXT NOT NULL,
            generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, record_kind, record_key),
            FOREIGN KEY (project_root) REFERENCES semantic_state(project_root) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_semantic_records_file
            ON semantic_records(project_root, file_path);
        CREATE INDEX IF NOT EXISTS idx_semantic_records_generation
            ON semantic_records(project_root, generation);

        CREATE TABLE IF NOT EXISTS semantic_dependencies (
            project_root TEXT NOT NULL,
            source_file TEXT NOT NULL,
            downstream_file TEXT NOT NULL,
            PRIMARY KEY (project_root, source_file, downstream_file),
            FOREIGN KEY (project_root) REFERENCES semantic_state(project_root) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_dependencies_downstream
            ON semantic_dependencies(project_root, downstream_file);
    `);
}

function createSemanticIndexSchemaV4(database: GraphDatabase): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS semantic_projects (
            project_root TEXT PRIMARY KEY,
            head_generation INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS semantic_slots (
            project_root TEXT NOT NULL,
            tier TEXT NOT NULL CHECK (tier IN ('definitions', 'full')),
            generation INTEGER NOT NULL,
            source_revision TEXT NOT NULL,
            base_generation INTEGER,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (project_root, tier),
            FOREIGN KEY (project_root) REFERENCES semantic_projects(project_root) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_slot_records (
            project_root TEXT NOT NULL,
            tier TEXT NOT NULL,
            record_kind TEXT NOT NULL,
            record_key TEXT NOT NULL,
            file_path TEXT,
            content_hash TEXT,
            payload TEXT NOT NULL,
            updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, record_kind, record_key),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_slot_records_file
            ON semantic_slot_records(project_root, tier, file_path);
        CREATE TABLE IF NOT EXISTS semantic_slot_dependencies (
            project_root TEXT NOT NULL,
            tier TEXT NOT NULL,
            source_file TEXT NOT NULL,
            downstream_file TEXT NOT NULL,
            dependency_kind TEXT NOT NULL,
            symbol_id TEXT,
            updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, source_file, downstream_file, dependency_kind, symbol_id),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_slot_dependencies_source
            ON semantic_slot_dependencies(project_root, tier, source_file);
        CREATE TABLE IF NOT EXISTS semantic_navigation_projection (
            project_root TEXT NOT NULL,
            tier TEXT NOT NULL,
            generation INTEGER NOT NULL,
            payload TEXT NOT NULL,
            PRIMARY KEY (project_root, tier),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
    `);
}

function createSemanticIndexSchemaV5(database: GraphDatabase): void {
    createSemanticIndexSchemaV4(database);
    database.exec(`
        CREATE TABLE IF NOT EXISTS semantic_files (
            project_root TEXT NOT NULL,
            tier TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            file_kind TEXT NOT NULL CHECK (file_kind IN ('gml', 'projectManifest', 'resourceMetadata')),
            content_hash TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            mtime_ms INTEGER,
            source_origin TEXT NOT NULL CHECK (source_origin IN ('disk', 'openBuffer')),
            source_version INTEGER,
            updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, relative_path),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_files_generation
            ON semantic_files(project_root, tier, updated_generation);
        CREATE TABLE IF NOT EXISTS semantic_generation_history (
            project_root TEXT NOT NULL,
            generation INTEGER NOT NULL,
            tier TEXT NOT NULL CHECK (tier IN ('definitions', 'full')),
            source_revision TEXT NOT NULL,
            reason TEXT NOT NULL,
            affected_file_count INTEGER NOT NULL,
            published_at TEXT NOT NULL,
            result TEXT NOT NULL CHECK (result IN ('published', 'recovered')),
            PRIMARY KEY (project_root, generation),
            FOREIGN KEY (project_root) REFERENCES semantic_projects(project_root) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_generation_history_project
            ON semantic_generation_history(project_root, generation DESC);
        CREATE TABLE IF NOT EXISTS semantic_unresolved_references (
            project_root TEXT NOT NULL,
            tier TEXT NOT NULL,
            identifier_name TEXT NOT NULL,
            owner_file TEXT NOT NULL,
            updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, identifier_name, owner_file),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_unresolved_references_name
            ON semantic_unresolved_references(project_root, tier, identifier_name);
    `);
}

function createSemanticIndexSchema(database: GraphDatabase): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS semantic_projects (
            project_root TEXT PRIMARY KEY,
            head_generation INTEGER NOT NULL,
            semantic_format_version INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS semantic_slots (
            project_root TEXT NOT NULL,
            tier TEXT NOT NULL CHECK (tier IN ('definitions', 'full')),
            generation INTEGER NOT NULL,
            source_revision TEXT NOT NULL,
            base_generation INTEGER,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (project_root, tier),
            FOREIGN KEY (project_root) REFERENCES semantic_projects(project_root) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_files (
            project_root TEXT NOT NULL, tier TEXT NOT NULL, relative_path TEXT NOT NULL,
            file_kind TEXT NOT NULL, content_hash TEXT NOT NULL, size_bytes INTEGER NOT NULL, mtime_ms INTEGER,
            source_origin TEXT NOT NULL, source_version INTEGER, updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, relative_path),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_symbols (
            project_root TEXT NOT NULL, tier TEXT NOT NULL, symbol_id TEXT NOT NULL,
            kind TEXT NOT NULL, name TEXT NOT NULL, display_name TEXT NOT NULL, defining_file_path TEXT,
            scope_id TEXT, documentation_json TEXT NOT NULL, updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, symbol_id),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_occurrences (
            project_root TEXT NOT NULL, tier TEXT NOT NULL, symbol_id TEXT NOT NULL, file_path TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('definition', 'reference')), start_offset INTEGER NOT NULL,
            end_offset INTEGER NOT NULL, scope_id TEXT, resolution_json TEXT NOT NULL, updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, symbol_id, file_path, role, start_offset, end_offset),
            FOREIGN KEY (project_root, tier, symbol_id) REFERENCES semantic_symbols(project_root, tier, symbol_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_scopes (
            project_root TEXT NOT NULL, tier TEXT NOT NULL, scope_id TEXT NOT NULL, kind TEXT NOT NULL,
            name TEXT NOT NULL, display_name TEXT NOT NULL, resource_path TEXT, updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, scope_id),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_scope_files (
            project_root TEXT NOT NULL, tier TEXT NOT NULL, scope_id TEXT NOT NULL, file_path TEXT NOT NULL,
            updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, scope_id, file_path),
            FOREIGN KEY (project_root, tier, scope_id) REFERENCES semantic_scopes(project_root, tier, scope_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_resources (
            project_root TEXT NOT NULL, tier TEXT NOT NULL, resource_path TEXT NOT NULL, name TEXT NOT NULL,
            resource_type TEXT NOT NULL, updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, resource_path),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_relationships (
            project_root TEXT NOT NULL, tier TEXT NOT NULL, relationship_id TEXT NOT NULL, owner_file_path TEXT NOT NULL,
            relationship_kind TEXT NOT NULL, payload_json TEXT NOT NULL, updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, relationship_id),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_dependencies (
            project_root TEXT NOT NULL, tier TEXT NOT NULL, owner_file_path TEXT NOT NULL, dependent_file_path TEXT NOT NULL,
            dependency_kind TEXT NOT NULL, symbol_id TEXT, updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, owner_file_path, dependent_file_path, dependency_kind, symbol_id),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_unresolved_references (
            project_root TEXT NOT NULL, tier TEXT NOT NULL, name TEXT NOT NULL, file_path TEXT NOT NULL,
            start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, resolution_json TEXT NOT NULL,
            updated_generation INTEGER NOT NULL,
            PRIMARY KEY (project_root, tier, name, file_path, start_offset, end_offset),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_navigation_projection (
            project_root TEXT NOT NULL, tier TEXT NOT NULL, generation INTEGER NOT NULL, payload TEXT NOT NULL,
            PRIMARY KEY (project_root, tier),
            FOREIGN KEY (project_root, tier) REFERENCES semantic_slots(project_root, tier) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_generation_history (
            project_root TEXT NOT NULL, generation INTEGER NOT NULL, tier TEXT NOT NULL, source_revision TEXT NOT NULL,
            reason TEXT NOT NULL, affected_file_count INTEGER NOT NULL, published_at TEXT NOT NULL, result TEXT NOT NULL,
            PRIMARY KEY (project_root, generation),
            FOREIGN KEY (project_root) REFERENCES semantic_projects(project_root) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_files_manifest ON semantic_files(project_root, tier, relative_path);
        CREATE INDEX IF NOT EXISTS idx_semantic_symbols_name ON semantic_symbols(project_root, tier, name);
        CREATE INDEX IF NOT EXISTS idx_semantic_symbols_owner ON semantic_symbols(project_root, tier, defining_file_path);
        CREATE INDEX IF NOT EXISTS idx_semantic_occurrences_file ON semantic_occurrences(project_root, tier, file_path);
        CREATE INDEX IF NOT EXISTS idx_semantic_dependencies_owner ON semantic_dependencies(project_root, tier, owner_file_path);
        CREATE INDEX IF NOT EXISTS idx_semantic_unresolved_name ON semantic_unresolved_references(project_root, tier, name);
        CREATE INDEX IF NOT EXISTS idx_semantic_history_project ON semantic_generation_history(project_root, generation DESC);
    `);
}

function _migrateSemanticIndexSchemaV3ToV4(database: GraphDatabase): void {
    runGraphDatabaseTransaction(database, () => {
        database.exec("ALTER TABLE semantic_state RENAME TO semantic_state_v3");
        database.exec("ALTER TABLE semantic_records RENAME TO semantic_records_v3");
        database.exec("ALTER TABLE semantic_dependencies RENAME TO semantic_dependencies_v3");
        createSemanticIndexSchemaV4(database);
        database.exec(`
            INSERT INTO semantic_projects(project_root, head_generation, updated_at)
            SELECT project_root, generation, updated_at FROM semantic_state_v3;
            INSERT INTO semantic_slots(project_root, tier, generation, source_revision, base_generation, updated_at)
            SELECT project_root, tier, generation, source_signature, NULL, updated_at FROM semantic_state_v3;
            INSERT INTO semantic_slot_records(project_root, tier, record_kind, record_key, file_path, content_hash, payload, updated_generation)
            SELECT records.project_root, state.tier, records.record_kind, records.record_key, records.file_path, records.content_hash, records.payload, records.generation
            FROM semantic_records_v3 records JOIN semantic_state_v3 state ON state.project_root = records.project_root;
            INSERT INTO semantic_slot_dependencies(project_root, tier, source_file, downstream_file, dependency_kind, symbol_id, updated_generation)
            SELECT dependencies.project_root, state.tier, dependencies.source_file, dependencies.downstream_file, 'script-call', NULL, state.generation
            FROM semantic_dependencies_v3 dependencies JOIN semantic_state_v3 state ON state.project_root = dependencies.project_root;
        `);
        database.exec("DROP TABLE semantic_dependencies_v3");
        database.exec("DROP TABLE semantic_records_v3");
        database.exec("DROP TABLE semantic_state_v3");
    });
}

function _migrateSemanticIndexSchemaV4ToV5(database: GraphDatabase): void {
    runGraphDatabaseTransaction(database, () => {
        createSemanticIndexSchemaV5(database);
        database.exec(`
            INSERT OR IGNORE INTO semantic_files(
                project_root, tier, relative_path, file_kind, content_hash, size_bytes, mtime_ms,
                source_origin, source_version, updated_generation
            )
            SELECT
                project_root, tier, file_path, 'gml', content_hash, 0, NULL, 'disk', NULL, updated_generation
            FROM semantic_slot_records
            WHERE record_kind = 'files' AND file_path IS NOT NULL AND content_hash IS NOT NULL;
        `);
    });
}

function _ensureSemanticStateSignatureColumn(database: GraphDatabase): void {
    try {
        database.exec("ALTER TABLE semantic_state ADD COLUMN source_signature TEXT NOT NULL DEFAULT ''");
    } catch {
        // The column already exists on current databases.
    }
}

function writeGraphIndexSchemaVersion(database: GraphDatabase): void {
    database
        .prepare("INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('schema_version', ?)")
        .run(String(GRAPH_INDEX_SCHEMA_VERSION));
}

function createGraphIndexSchema(database: GraphDatabase): void {
    createSchemaMetaTable(database);
    createGraphIndexSchemaV2(database);
    createSemanticIndexSchema(database);
    writeGraphIndexSchemaVersion(database);
}

const DERIVED_SEMANTIC_TABLES = Object.freeze([
    "semantic_navigation_projection",
    "semantic_unresolved_references",
    "semantic_dependencies",
    "semantic_relationships",
    "semantic_scope_files",
    "semantic_occurrences",
    "semantic_symbols",
    "semantic_scopes",
    "semantic_resources",
    "semantic_files",
    "semantic_generation_history",
    "semantic_slot_dependencies",
    "semantic_slot_records",
    "semantic_slots",
    "semantic_records",
    "semantic_state",
    "semantic_projects",
    "node_fts",
    "embeddings",
    "aliases",
    "edges",
    "nodes",
    "files",
    "index_state",
    "graphs"
]);

/** Drop derived cache facts before recreating the current schema. */
function resetDerivedDatabaseForCurrentSchema(database: GraphDatabase): void {
    runGraphDatabaseTransaction(database, () => {
        for (const tableName of DERIVED_SEMANTIC_TABLES) {
            database.exec(`DROP TABLE IF EXISTS ${tableName}`);
        }
        createGraphIndexSchema(database);
    });
}

function _migrateGraphIndexSchemaV1ToV2(database: GraphDatabase): void {
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
    if (schemaVersion === GRAPH_INDEX_SCHEMA_VERSION) {
        createGraphIndexSchema(database);
        return;
    }

    // Graph and semantic cache rows are derived facts. A hard reset avoids any
    // old-reader or dual-write path and guarantees the current schema starts with no slots.
    resetDerivedDatabaseForCurrentSchema(database);
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
