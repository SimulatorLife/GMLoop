import assert from "node:assert/strict";
import test from "node:test";

import { UI } from "@gmloop/ui";

import { startGraphVisualizationServer } from "../src/modules/server/graph-visualization-server.js";

function createSampleGraphVisualizationData() {
    return {
        edges: [
            {
                source: "project::resource::Project.yyp",
                target: "project::gml/script/player_update",
                type: "contains"
            }
        ],
        generatedAt: "2026-01-01T00:00:00.000Z",
        graphs: [
            {
                edgeCount: 1,
                graphId: "project",
                nodeCount: 2,
                rootPath: "/tmp/project"
            }
        ],
        nodes: [
            {
                displayName: "Project",
                graphId: "project",
                id: "project::resource::Project.yyp",
                kind: "project",
                name: "Project",
                snippet: "",
                summary: "project root"
            },
            {
                displayName: "player_update",
                graphId: "project",
                id: "project::gml/script/player_update",
                kind: "script",
                name: "player_update",
                snippet: "function player_update() {}",
                summary: "script node"
            }
        ],
        projectRoot: "/tmp/project"
    } as const;
}

void test("graph visualization server serves UI-rendered HTML and exposes regeneration JSON", async () => {
    const handle = await startGraphVisualizationServer({
        regenerate: async () => ({ changed: true }),
        selectDirectory: async () => ({ changed: true }),
        selectFiles: async () => ({ changed: false }),
        renderHtml: (isServerMode) =>
            UI.renderGraphVisualizationHtml(createSampleGraphVisualizationData(), {
                isServerMode,
                title: "/tmp/project"
            })
    });

    try {
        const htmlResponse = await fetch(handle.url);
        assert.equal(htmlResponse.status, 200);
        const htmlText = await htmlResponse.text();
        assert.match(htmlText, /player_update/u);
        assert.match(htmlText, /id="regenerate"/u);

        const reindexResponse = await fetch(`${handle.url}/api/reindex`, { method: "POST" });
        assert.equal(reindexResponse.status, 200);
        const reindexPayload = (await reindexResponse.json()) as { changed: boolean; ok: boolean };
        assert.deepEqual(reindexPayload, { changed: true, ok: true });

        const selectDirectoryResponse = await fetch(`${handle.url}/api/select-directory`, { method: "POST" });
        assert.equal(selectDirectoryResponse.status, 200);
        const selectDirectoryPayload = (await selectDirectoryResponse.json()) as { changed: boolean; ok: boolean };
        assert.deepEqual(selectDirectoryPayload, { changed: true, ok: true });

        const selectFilesResponse = await fetch(`${handle.url}/api/select-files`, { method: "POST" });
        assert.equal(selectFilesResponse.status, 200);
        const selectFilesPayload = (await selectFilesResponse.json()) as { changed: boolean; ok: boolean };
        assert.deepEqual(selectFilesPayload, { changed: false, ok: true });
    } finally {
        await handle.stop();
    }
});

void test("graph visualization server keeps the current view accessible while regeneration is pending", async () => {
    let finishRegeneration: (() => void) | null = null;
    const regenerationComplete = new Promise<void>((resolve) => {
        finishRegeneration = resolve;
    });

    const handle = await startGraphVisualizationServer({
        regenerate: async () => {
            await regenerationComplete;
            return { changed: false };
        },
        renderHtml: (isServerMode) =>
            UI.renderGraphVisualizationHtml(createSampleGraphVisualizationData(), {
                isServerMode,
                title: "/tmp/project"
            })
    });

    try {
        const reindexPromise = fetch(`${handle.url}/api/reindex`, { method: "POST" });
        await new Promise((resolve) => setTimeout(resolve, 25));

        const htmlResponse = await fetch(handle.url);
        assert.equal(htmlResponse.status, 200);
        const htmlText = await htmlResponse.text();
        assert.match(htmlText, /Graph Index/u);

        if (!finishRegeneration) {
            assert.fail("Expected regeneration completion callback to be set.");
        }
        finishRegeneration();

        const reindexResponse = await reindexPromise;
        assert.equal(reindexResponse.status, 200);
        const reindexPayload = (await reindexResponse.json()) as { changed: boolean; ok: boolean };
        assert.deepEqual(reindexPayload, { changed: false, ok: true });
    } finally {
        await handle.stop();
    }
});
