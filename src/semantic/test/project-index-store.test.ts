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

        const restored = store.readIndex();
        assert.deepEqual(restored?.files, {
            "scripts/main.gml": { filePath: "scripts/main.gml", declarations: [] }
        });
        assert.equal(store.readState()?.generation, 1);

        const second = store.writeIndex({ projectRoot, files: {} }, "full");
        assert.equal(second.generation, 2);
        assert.equal(store.readState()?.tier, "full");

        const definitionsAfterFull = store.writeIndex({ projectRoot, files: { stale: {} } }, "definitions");
        assert.equal(definitionsAfterFull.generation, 2);
        assert.equal(definitionsAfterFull.tier, "full");
        assert.deepEqual(store.readIndex()?.files, {});
    } finally {
        store.close();
    }
});

void test("semantic index store compacts legacy aggregate rows on open", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-migration-"));
    const initialStore = openSemanticIndexStore(projectRoot);
    initialStore.writeIndex({ projectRoot, identifiers: { functions: { main: { displayName: "main" } } } }, "full");
    initialStore.close();

    const database = openGraphIndexDatabase(getSemanticIndexDatabasePath(projectRoot));
    database.prepare("DELETE FROM semantic_records WHERE project_root = ?").run(projectRoot);
    database
        .prepare(
            "INSERT INTO semantic_records(project_root, record_kind, record_key, file_path, content_hash, payload, generation) VALUES (?, 'identifiers', '__value__', NULL, NULL, ?, 1)"
        )
        .run(projectRoot, JSON.stringify({ functions: { main: { displayName: "main" } } }));
    database
        .prepare(
            "INSERT INTO semantic_records(project_root, record_kind, record_key, file_path, content_hash, payload, generation) VALUES (?, 'relationships', '__value__', NULL, NULL, ?, 1)"
        )
        .run(projectRoot, JSON.stringify({ scriptCalls: [{ from: "main", to: "other" }] }));
    database.close();

    const migratedStore = openSemanticIndexStore(projectRoot);
    try {
        const restored = migratedStore.readIndex();
        assert.deepEqual((restored?.identifiers as Record<string, unknown>).functions, {
            main: { displayName: "main" }
        });
        assert.deepEqual(restored?.relationships, { scriptCalls: [{ from: "main", to: "other" }] });
    } finally {
        migratedStore.close();
    }
});
