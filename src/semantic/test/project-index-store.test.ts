import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openSemanticIndexStore } from "../src/project-index/semantic-store.js";

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
    } finally {
        store.close();
    }
});
