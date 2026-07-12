import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openGraphIndexDatabase } from "../src/graph-index/database.js";
import { getSemanticIndexDatabasePath, openSemanticIndexStore } from "../src/project-index/semantic-store.js";

void test("semantic index store persists records and generation state in SQLite", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        const first = store.writeIndex(
            {
                projectRoot,
                files: {
                    "scripts/main.gml": { filePath: "scripts/main.gml", declarations: [] }
                },
                identifiers: { functions: { main: { displayName: "main" } } }
            },
            "definitions"
        );
        assert.equal(first.generation, 1);
        assert.equal(first.tier, "definitions");

        const restored = store.readIndexForTier("definitions");
        assert.deepEqual(restored?.files, {
            "scripts/main.gml": { filePath: "scripts/main.gml", declarations: [] }
        });
        assert.equal(store.readStateForTier("definitions")?.generation, 1);

        const second = store.writeIndex({ projectRoot, files: {} }, "full");
        assert.equal(second.generation, 2);
        assert.equal(store.readStateForTier("full")?.tier, "full");

        const definitionsAfterFull = store.writeIndex({ projectRoot, files: { current: {} } }, "definitions");
        assert.equal(definitionsAfterFull.generation, 3);
        assert.equal(definitionsAfterFull.tier, "definitions");
        assert.deepEqual(store.readIndexForTier("full")?.files, {});
        assert.deepEqual(store.readIndexForTier("definitions")?.files, { current: {} });
        assert.equal(store.readStateForTier("full")?.generation, 2);
        assert.equal(store.readStateForTier("definitions")?.generation, 3);
    } finally {
        store.close();
    }
});

void test("semantic index store rejects stale generation publications without changing either slot", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-cas-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        const initialHead = store.readProjectHead();
        const fullPublication = store.publishIndex({
            expectedHeadGeneration: initialHead.generation,
            index: { files: { "scripts/main.gml": { filePath: "scripts/main.gml" } }, projectRoot },
            sourceRevision: "revision-full",
            tier: "full"
        });
        assert.equal(fullPublication.status, "published");
        assert.equal(fullPublication.state?.generation, 1);

        const staleDefinitionsPublication = store.publishIndex({
            expectedHeadGeneration: initialHead.generation,
            index: { files: { "scripts/main.gml": { filePath: "scripts/main.gml" } }, projectRoot },
            sourceRevision: "revision-definitions",
            tier: "definitions"
        });
        assert.deepEqual(staleDefinitionsPublication, { state: null, status: "superseded" });
        assert.equal(store.readProjectHead().generation, 1);
        assert.equal(store.readStateForTier("definitions"), null);
        assert.equal(store.readStateForTier("full")?.sourceSignature, "revision-full");
    } finally {
        store.close();
    }
});

void test("semantic index store restores a matching navigation projection and falls back when it is corrupt", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-projection-"));
    const databasePath = getSemanticIndexDatabasePath(projectRoot);
    const store = openSemanticIndexStore(projectRoot);
    store.writeIndex(
        {
            files: { "scripts/main.gml": { contentHash: "main-hash", filePath: "scripts/main.gml" } },
            identifiers: { functions: { main: { displayName: "main", filePath: "scripts/main.gml" } } },
            projectRoot
        },
        "definitions"
    );
    store.close();

    const database = openGraphIndexDatabase(databasePath);
    try {
        const projection = database
            .prepare(
                "SELECT generation, payload FROM semantic_navigation_projection WHERE project_root = ? AND tier = 'definitions'"
            )
            .get(projectRoot) as { generation: number; payload: string } | undefined;
        assert.equal(projection?.generation, 1);
        assert.deepEqual(JSON.parse(projection?.payload ?? "null"), {
            files: { "scripts/main.gml": { contentHash: "main-hash", filePath: "scripts/main.gml" } },
            identifiers: { functions: { main: { displayName: "main", filePath: "scripts/main.gml" } } },
            projectRoot
        });
        database
            .prepare(
                "UPDATE semantic_navigation_projection SET payload = 'not-json' WHERE project_root = ? AND tier = 'definitions'"
            )
            .run(projectRoot);
    } finally {
        database.close();
    }

    const restoredStore = openSemanticIndexStore(projectRoot);
    try {
        assert.deepEqual(restoredStore.readIndexForTier("definitions"), {
            files: { "scripts/main.gml": { contentHash: "main-hash", filePath: "scripts/main.gml" } },
            identifiers: { functions: { main: { displayName: "main", filePath: "scripts/main.gml" } } },
            projectRoot
        });
    } finally {
        restoredStore.close();
    }
});

void test("semantic index store migrates a v3 semantic snapshot into its independent slot", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-v3-migration-"));
    const databasePath = getSemanticIndexDatabasePath(projectRoot);
    const database = openGraphIndexDatabase(databasePath);
    try {
        database.exec(`
            DROP TABLE semantic_navigation_projection;
            DROP TABLE semantic_slot_dependencies;
            DROP TABLE semantic_slot_records;
            DROP TABLE semantic_slots;
            DROP TABLE semantic_projects;
            CREATE TABLE semantic_state (
                project_root TEXT PRIMARY KEY,
                generation INTEGER NOT NULL,
                tier TEXT NOT NULL,
                source_signature TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );
            CREATE TABLE semantic_records (
                project_root TEXT NOT NULL,
                record_kind TEXT NOT NULL,
                record_key TEXT NOT NULL,
                file_path TEXT,
                content_hash TEXT,
                payload TEXT NOT NULL,
                generation INTEGER NOT NULL,
                PRIMARY KEY (project_root, record_kind, record_key)
            );
            CREATE TABLE semantic_dependencies (
                project_root TEXT NOT NULL,
                source_file TEXT NOT NULL,
                downstream_file TEXT NOT NULL,
                PRIMARY KEY (project_root, source_file, downstream_file)
            );
        `);
        database.prepare("UPDATE schema_meta SET value = '3' WHERE key = 'schema_version'").run();
        database
            .prepare(
                "INSERT INTO semantic_state(project_root, generation, tier, source_signature, updated_at) VALUES (?, ?, 'full', ?, ?)"
            )
            .run(projectRoot, 7, "v3-source", new Date().toISOString());
        database
            .prepare(
                "INSERT INTO semantic_records(project_root, record_kind, record_key, file_path, content_hash, payload, generation) VALUES (?, 'files', 'scripts/main.gml', 'scripts/main.gml', 'hash-main', ?, 7)"
            )
            .run(projectRoot, JSON.stringify({ contentHash: "hash-main", filePath: "scripts/main.gml" }));
        database
            .prepare("INSERT INTO semantic_dependencies(project_root, source_file, downstream_file) VALUES (?, ?, ?)")
            .run(projectRoot, "scripts/main.gml", "scripts/use-main.gml");
    } finally {
        database.close();
    }

    const store = openSemanticIndexStore(projectRoot);
    try {
        assert.deepEqual(store.readProjectHead(), { generation: 7, projectRoot });
        assert.deepEqual(store.readStateForTier("full"), {
            generation: 7,
            projectRoot,
            sourceSignature: "v3-source",
            tier: "full"
        });
        assert.equal(store.readStateForTier("definitions"), null);
        assert.deepEqual(store.readFileContentHashes(), new Map([["scripts/main.gml", "hash-main"]]));
        assert.deepEqual(store.findImmediateDownstreamFiles("scripts/main.gml"), ["scripts/use-main.gml"]);
    } finally {
        store.close();
    }
});

void test("semantic index store persists file hashes and immediate reverse dependencies", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-dependencies-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        store.writeIndex(
            {
                projectRoot,
                files: {
                    "scripts/a/a.gml": { contentHash: "hash-a", filePath: "scripts/a/a.gml" },
                    "scripts/b/b.gml": { contentHash: "hash-b", filePath: "scripts/b/b.gml" }
                },
                scopes: {
                    "script:a": { filePaths: ["scripts/a/a.gml"] },
                    "script:b": { filePaths: ["scripts/b/b.gml"] }
                },
                relationships: {
                    scriptCalls: [
                        {
                            from: { filePath: "scripts/b/b.gml" },
                            target: { scopeId: "script:a" }
                        }
                    ]
                }
            },
            "full"
        );

        assert.deepEqual(
            store.readFileContentHashes(),
            new Map([
                ["scripts/a/a.gml", "hash-a"],
                ["scripts/b/b.gml", "hash-b"]
            ])
        );
        assert.deepEqual(store.findImmediateDownstreamFiles("scripts/a/a.gml"), ["scripts/b/b.gml"]);
        assert.deepEqual(store.findImmediateDownstreamFiles("scripts/b/b.gml"), []);
    } finally {
        store.close();
    }
});
