import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { WatchListener } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import type { StatusServerHandle } from "../src/modules/status/server.js";
import {
    fetchStatusPayload,
    waitForScanComplete,
    waitForStatus,
    waitForStatusReady
} from "./test-helpers/status-polling.js";
import { createMockWatchFactory } from "./test-helpers/watch-fixtures.js";
import { runWatchTest } from "./test-helpers/watch-runner.js";

async function startWatchServer(
    projectRoot: string,
    abortController: AbortController,
    watchFactory: ReturnType<typeof createMockWatchFactory>
): Promise<{ statusBaseUrl: string; watchPromise: Promise<unknown> }> {
    let statusBaseUrl = "";
    const watchPromise = runWatchCommand(projectRoot, {
        abortSignal: abortController.signal,
        onStatusServerReady: (server: StatusServerHandle) => {
            statusBaseUrl = server.url.replace(/\/status$/u, "");
        },
        quiet: true,
        runtimeServer: false,
        statusPort: 0,
        statusServer: true,
        watchFactory,
        websocketServer: false
    });

    const deadline = Date.now() + 5000;
    while (statusBaseUrl.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => {
            setTimeout(resolve, 25);
        });
    }

    assert.notEqual(statusBaseUrl, "", "status server URL should resolve");
    return { statusBaseUrl, watchPromise };
}

/**
 * Spin up the watch command against a freshly-created project root containing a single
 * `scr_player.gml` script, wait for the initial scan to finish, and assert that the
 * legitimate project file is reported as transpiled. The caller owns teardown of the
 * project directory tree so each test can choose its own root layout.
 */
async function assertWatchCommandTranspilesProjectScript(
    projectRoot: string,
    cleanupProjectRoot: () => Promise<void>
): Promise<void> {
    const projectScriptPath = path.join(projectRoot, "scripts", "scr_player.gml");
    const abortController = new AbortController();
    const watchFactory = createMockWatchFactory();

    await mkdir(path.dirname(projectScriptPath), { recursive: true });
    await writeFile(projectScriptPath, "function scr_player() { return 1; }", "utf8");

    const { statusBaseUrl, watchPromise } = await startWatchServer(projectRoot, abortController, watchFactory);

    try {
        await waitForStatusReady(statusBaseUrl);
        await waitForScanComplete(statusBaseUrl);

        const payload = await fetchStatusPayload(statusBaseUrl);
        assert.equal(payload.patchCount, 1, "project files under the test root should still be transpiled");
        assert.equal(payload.recentPatches?.[0]?.filePath, path.join("scripts", "scr_player.gml"));
    } finally {
        abortController.abort();
        await watchPromise;
        await cleanupProjectRoot();
    }
}

void describe("watch command ignored generated directories", () => {
    void it("skips .gmcache and cache files during startup scan and status reporting", async () => {
        const testRoot = path.join("/tmp", `watch-ignore-generated-${Date.now()}-${randomUUID()}`);
        const projectScriptPath = path.join(testRoot, "scripts", "scr_player.gml");
        const generatedScriptPath = path.join(testRoot, ".gmcache", "generated", "scr_compat.gml");
        const cacheScriptPath = path.join(testRoot, "cache", "generated", "scr_cached.gml");
        const abortController = new AbortController();
        const watchFactory = createMockWatchFactory();

        await mkdir(path.dirname(projectScriptPath), { recursive: true });
        await mkdir(path.dirname(generatedScriptPath), { recursive: true });
        await mkdir(path.dirname(cacheScriptPath), { recursive: true });
        await writeFile(projectScriptPath, "function scr_player() { return 1; }", "utf8");
        await writeFile(generatedScriptPath, "function scr_compat() { return 2; }", "utf8");
        await writeFile(cacheScriptPath, "function scr_cached() { return 3; }", "utf8");

        const { statusBaseUrl, watchPromise } = await startWatchServer(testRoot, abortController, watchFactory);

        try {
            await waitForStatusReady(statusBaseUrl);
            await waitForScanComplete(statusBaseUrl);

            const payload = await fetchStatusPayload(statusBaseUrl);
            assert.ok(
                (payload.patchCount ?? 0) < 2,
                "generated cache files should not contribute extra startup scan transpilations"
            );
            assert.ok(
                (payload.recentPatches ?? []).every(
                    (patch) =>
                        patch.filePath !== path.join(".gmcache", "generated", "scr_compat.gml") &&
                        patch.filePath !== path.join("cache", "generated", "scr_cached.gml")
                ),
                "ignored generated files should not appear in patch history"
            );
        } finally {
            abortController.abort();
            await watchPromise;
            await rm(testRoot, { force: true, recursive: true });
        }
    });

    void it("ignores .gmcache and cache file change events after the watcher is already running", async () => {
        const listenerCapture: { listener: WatchListener<string> | undefined } = { listener: undefined };
        const watchFactory = createMockWatchFactory(listenerCapture);

        await runWatchTest(
            "watch-ignore-generated-runtime",
            {
                debounceDelay: 0,
                watchFactory
            },
            async (context) => {
                await waitForStatus(context.baseUrl, (status) => status.scanComplete === true, 2000);

                const generatedScriptPath = path.join(context.testDir, ".gmcache", "generated", "scr_compat.gml");
                const cacheScriptPath = path.join(context.testDir, "cache", "generated", "scr_cached.gml");
                await mkdir(path.dirname(generatedScriptPath), { recursive: true });
                await mkdir(path.dirname(cacheScriptPath), { recursive: true });
                await writeFile(generatedScriptPath, "function scr_compat() { return 2; }", "utf8");
                await writeFile(cacheScriptPath, "function scr_cached() { return 3; }", "utf8");

                const beforeStatus = await fetchStatusPayload(context.baseUrl);
                const beforePatchCount = beforeStatus.totalPatchCount ?? 0;

                assert.ok(listenerCapture.listener, "watch listener should be captured");
                listenerCapture.listener?.("change", path.join(".gmcache", "generated", "scr_compat.gml"));
                listenerCapture.listener?.("change", path.join("cache", "generated", "scr_cached.gml"));

                // Poll until the patch count stabilizes or the deadline is reached.
                // Using a polling approach instead of a fixed delay makes this test
                // deterministic across different system speeds and load conditions.
                const stableDeadline = Date.now() + 2000;
                const expectedCount = beforePatchCount;
                while (Date.now() < stableDeadline) {
                    const currentStatus = await fetchStatusPayload(context.baseUrl);
                    const currentCount = currentStatus.totalPatchCount ?? 0;
                    if (currentCount === expectedCount) {
                        // Count is stable at the expected value - processing is complete
                        break;
                    }

                    // A change was detected - wait for processing to settle
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }

                const afterStatus = await fetchStatusPayload(context.baseUrl);
                assert.equal(
                    afterStatus.totalPatchCount ?? 0,
                    beforePatchCount,
                    "generated cache files should not trigger runtime patch generation"
                );
                assert.deepEqual(
                    afterStatus.recentPatches ?? [],
                    beforeStatus.recentPatches ?? [],
                    "generated cache files should not appear in patch history"
                );
            }
        );
    });

    void it("still scans legitimate project files when the project root lives under tmp", async () => {
        const projectRoot = path.join("/tmp", `watch-tmp-root-${Date.now()}-${randomUUID()}`);

        await assertWatchCommandTranspilesProjectScript(projectRoot, async () => {
            await rm(projectRoot, { force: true, recursive: true });
        });
    });

    void it("still scans legitimate project files when the project root lives under vendor/3DSpider", async () => {
        const workspaceRoot = path.join("/tmp", `watch-vendor-root-${Date.now()}-${randomUUID()}`);
        const projectRoot = path.join(workspaceRoot, "vendor", "3DSpider");

        await assertWatchCommandTranspilesProjectScript(projectRoot, async () => {
            await rm(workspaceRoot, { force: true, recursive: true });
        });
    });
});
