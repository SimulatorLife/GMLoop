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

function isListenPermissionError(error: unknown): boolean {
    return (
        error instanceof Error &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string" &&
        (error as { code: string }).code === "EPERM"
    );
}

void test("graph visualization server serves UI-rendered HTML and exposes regeneration JSON", async (testContext) => {
    let openedPath: string | null = null;
    let handle;
    try {
        handle = await startGraphVisualizationServer({
            regenerate: async () => ({ changed: true }),
            openProjectTargets: async (input) => {
                openedPath = input.path;
                return { changed: true };
            },
            renderBundle: (isServerMode) =>
                UI.renderGraphVisualizationBundle(createSampleGraphVisualizationData(), {
                    isServerMode,
                    title: "/tmp/project"
                })
        });
    } catch (error) {
        if (isListenPermissionError(error)) {
            testContext.skip("Local HTTP listen is not permitted in this environment.");
            return;
        }
        throw error;
    }

    try {
        const htmlResponse = await fetch(handle.url);
        assert.equal(htmlResponse.status, 200);
        const htmlText = await htmlResponse.text();
        assert.match(htmlText, /id="regenerate"/u);
        assert.match(htmlText, /assets\/graph-visualization\.js/u);
        assert.match(htmlText, /assets\/vendor\/d3\.min\.js/u);
        assert.doesNotMatch(htmlText, /cdn\./u);

        const scriptResponse = await fetch(`${handle.url}/assets/graph-visualization.js`);
        assert.equal(scriptResponse.status, 200);
        const scriptText = await scriptResponse.text();
        assert.match(scriptText, /player_update/u);
        assert.match(scriptText, /bootstrapGraphVisualizationApp/u);

        const d3Response = await fetch(`${handle.url}/assets/vendor/d3.min.js`);
        assert.equal(d3Response.status, 200);

        const reindexResponse = await fetch(`${handle.url}/api/reindex`, { method: "POST" });
        assert.equal(reindexResponse.status, 200);
        const reindexPayload = (await reindexResponse.json()) as { changed: boolean; ok: boolean };
        assert.deepEqual(reindexPayload, { changed: true, ok: true });

        const openPath = "/tmp/project/Project.yyp";
        const openResponse = await fetch(`${handle.url}/api/open`, {
            body: JSON.stringify({ path: openPath }),
            headers: {
                "Content-Type": "application/json"
            },
            method: "POST"
        });
        assert.equal(openResponse.status, 200);
        const openPayload = (await openResponse.json()) as { changed: boolean; ok: boolean };
        assert.deepEqual(openPayload, { changed: true, ok: true });
        assert.equal(openedPath, openPath);
    } finally {
        await handle.stop();
    }
});

void test("graph visualization server keeps the current view accessible while regeneration is pending", async (testContext) => {
    let finishRegeneration: (() => void) | null = null;
    const regenerationComplete = new Promise<void>((resolve) => {
        finishRegeneration = resolve;
    });

    let handle;
    try {
        handle = await startGraphVisualizationServer({
            regenerate: async () => {
                await regenerationComplete;
                return { changed: false };
            },
            renderBundle: (isServerMode) =>
                UI.renderGraphVisualizationBundle(createSampleGraphVisualizationData(), {
                    isServerMode,
                    title: "/tmp/project"
                })
        });
    } catch (error) {
        if (isListenPermissionError(error)) {
            testContext.skip("Local HTTP listen is not permitted in this environment.");
            return;
        }
        throw error;
    }

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
