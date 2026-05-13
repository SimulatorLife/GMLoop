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
                filePath: null,
                graphId: "project",
                id: "project::resource::Project.yyp",
                kind: "project",
                name: "Project",
                resourcePath: "Project.yyp",
                snippet: "",
                summary: "project root"
            },
            {
                displayName: "player_update",
                filePath: "scripts/player_update/player_update.gml",
                graphId: "project",
                id: "project::gml/script/player_update",
                kind: "script",
                name: "player_update",
                resourcePath: "scripts/player_update/player_update.yy",
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

        const openWithoutBodyResponse = await fetch(`${handle.url}/api/open`, { method: "POST" });
        assert.equal(openWithoutBodyResponse.status, 200);
        const openWithoutBodyPayload = (await openWithoutBodyResponse.json()) as { changed: boolean; ok: boolean };
        assert.deepEqual(openWithoutBodyPayload, { changed: true, ok: true });
        assert.equal(openedPath, null);

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

void test("graph visualization server rejects malformed JSON on /api/open with 400", async (testContext) => {
    let handle;
    try {
        handle = await startGraphVisualizationServer({
            regenerate: async () => ({ changed: true }),
            openProjectTargets: async () => ({ changed: true }),
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
        const response = await fetch(`${handle.url}/api/open`, {
            body: "not valid json",
            headers: { "Content-Type": "application/json" },
            method: "POST"
        });
        assert.equal(response.status, 400);
        const payload = (await response.json()) as { error: string };
        assert.equal(payload.error, "Invalid JSON or non-object payload");
    } finally {
        await handle.stop();
    }
});

void test("graph visualization server rejects non-object JSON on /api/open with 400", async (testContext) => {
    let handle;
    try {
        handle = await startGraphVisualizationServer({
            regenerate: async () => ({ changed: true }),
            openProjectTargets: async () => ({ changed: true }),
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
        const response = await fetch(`${handle.url}/api/open`, {
            body: JSON.stringify("just a string"),
            headers: { "Content-Type": "application/json" },
            method: "POST"
        });
        assert.equal(response.status, 400);
        const payload = (await response.json()) as { error: string };
        assert.equal(payload.error, "Invalid JSON or non-object payload");
    } finally {
        await handle.stop();
    }
});

void test("graph visualization server rejects malformed JSON on /api/playground/process with 400", async (testContext) => {
    let handle;
    try {
        handle = await startGraphVisualizationServer({
            regenerate: async () => ({ changed: true }),
            renderBundle: (isServerMode) =>
                UI.renderGraphVisualizationBundle(createSampleGraphVisualizationData(), {
                    isServerMode,
                    title: "/tmp/project"
                }),
            processPlayground: async () => ({ ast: "", output: "", error: null })
        });
    } catch (error) {
        if (isListenPermissionError(error)) {
            testContext.skip("Local HTTP listen is not permitted in this environment.");
            return;
        }
        throw error;
    }

    try {
        const response = await fetch(`${handle.url}/api/playground/process`, {
            body: "{ invalid json",
            headers: { "Content-Type": "application/json" },
            method: "POST"
        });
        assert.equal(response.status, 400);
        const payload = (await response.json()) as { error: string };
        assert.equal(payload.error, "Invalid JSON or non-object payload");
    } finally {
        await handle.stop();
    }
});

void test("graph visualization server rejects non-object JSON on /api/playground/process with 400", async (testContext) => {
    let handle;
    try {
        handle = await startGraphVisualizationServer({
            regenerate: async () => ({ changed: true }),
            renderBundle: (isServerMode) =>
                UI.renderGraphVisualizationBundle(createSampleGraphVisualizationData(), {
                    isServerMode,
                    title: "/tmp/project"
                }),
            processPlayground: async () => ({ ast: "", output: "", error: null })
        });
    } catch (error) {
        if (isListenPermissionError(error)) {
            testContext.skip("Local HTTP listen is not permitted in this environment.");
            return;
        }
        throw error;
    }

    try {
        const response = await fetch(`${handle.url}/api/playground/process`, {
            body: JSON.stringify(42),
            headers: { "Content-Type": "application/json" },
            method: "POST"
        });
        assert.equal(response.status, 400);
        const payload = (await response.json()) as { error: string };
        assert.equal(payload.error, "Invalid JSON or non-object payload");
    } finally {
        await handle.stop();
    }
});

void test("graph visualization server serves UI revision for hot-reload polling", async (testContext) => {
    let handle;
    try {
        handle = await startGraphVisualizationServer({
            getUiRevision: () => 7,
            regenerate: async () => ({ changed: true }),
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
        const response = await fetch(`${handle.url}/api/ui-revision`);
        assert.equal(response.status, 200);
        const payload = (await response.json()) as { revision: number };
        assert.equal(payload.revision, 7);
    } finally {
        await handle.stop();
    }
});

void test("graph visualization server forwards sanitized lint rule ids for playground processing", async (testContext) => {
    let receivedLintRuleIds: ReadonlyArray<string> = [];
    let receivedFormatOptionNames: ReadonlyArray<string> = [];
    let receivedCodemodIds: ReadonlyArray<string> = [];
    let handle;
    try {
        handle = await startGraphVisualizationServer({
            regenerate: async () => ({ changed: true }),
            renderBundle: (isServerMode) =>
                UI.renderGraphVisualizationBundle(createSampleGraphVisualizationData(), {
                    isServerMode,
                    title: "/tmp/project"
                }),
            processPlayground: async (input) => {
                receivedFormatOptionNames = input.formatOptionNames;
                receivedLintRuleIds = input.lintRuleIds;
                receivedCodemodIds = input.codemodIds;
                return { ast: "", output: "", error: null };
            }
        });
    } catch (error) {
        if (isListenPermissionError(error)) {
            testContext.skip("Local HTTP listen is not permitted in this environment.");
            return;
        }
        throw error;
    }

    try {
        const response = await fetch(`${handle.url}/api/playground/process`, {
            body: JSON.stringify({
                format: true,
                formatOptionNames: ["printWidth", "  ", 42, "useTabs"],
                gml: "show_debug_message('x');",
                lint: true,
                lintRuleIds: ["@gmloop/no-constructor-assignment", 42, "", "no-undef"],
                refactor: false,
                codemodIds: ["docCommentAlignment", "", 123, "scientificNotation"],
                transpileMode: "none"
            }),
            headers: { "Content-Type": "application/json" },
            method: "POST"
        });
        assert.equal(response.status, 200);
        assert.deepEqual(receivedFormatOptionNames, ["printWidth", "useTabs"]);
        assert.deepEqual(receivedLintRuleIds, ["@gmloop/no-constructor-assignment", "no-undef"]);
        assert.deepEqual(receivedCodemodIds, ["docCommentAlignment", "scientificNotation"]);
    } finally {
        await handle.stop();
    }
});

/**
 * Verify that the server's error reporting uses the capability probe contract
 * (`Core.isErrorLike`) rather than `instanceof Error`, so that cross-realm error
 * objects (e.g. from worker threads or sandboxed modules) are reported correctly.
 */
void test("graph visualization server reports cross-realm error messages via capability probe", async (testContext) => {
    // Simulate a cross-realm error that is NOT instanceof Error but matches the
    // error-like shape (message + name) that Core.isErrorLike recognizes. The cast
    // satisfies the `only-throw-error` lint rule while preserving the non-Error
    // prototype so the test actually exercises the capability-probe contract.
    const crossRealmErrorLike = Object.freeze({
        message: "sandboxed-module-failure",
        name: "SandboxedError"
    }) as unknown as Error;

    let handle;
    try {
        handle = await startGraphVisualizationServer({
            regenerate: async () => {
                // Simulate a cross-realm error that is NOT instanceof Error
                throw crossRealmErrorLike;
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
        const response = await fetch(`${handle.url}/api/reindex`, { method: "POST" });
        assert.equal(response.status, 500);

        const payload = (await response.json()) as { error: string };
        assert.equal(
            payload.error,
            "sandboxed-module-failure",
            "The server should surface the cross-realm error's message via Core.isErrorLike"
        );
    } finally {
        await handle.stop();
    }
});
