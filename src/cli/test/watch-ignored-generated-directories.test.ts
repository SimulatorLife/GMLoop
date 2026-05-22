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
        extensions: [".gml"],
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

void describe("watch command ignored generated directories", () => {
    void it("skips .gmcache files during startup scan and status reporting", async () => {
        const testRoot = path.join("/tmp", `watch-ignore-generated-${Date.now()}-${randomUUID()}`);
        const projectScriptPath = path.join(testRoot, "scripts", "scr_player.gml");
        const generatedScriptPath = path.join(testRoot, ".gmcache", "generated", "scr_compat.gml");
        const abortController = new AbortController();
        const watchFactory = createMockWatchFactory();

        await mkdir(path.dirname(projectScriptPath), { recursive: true });
        await mkdir(path.dirname(generatedScriptPath), { recursive: true });
        await writeFile(projectScriptPath, "function scr_player() { return 1; }", "utf8");
        await writeFile(generatedScriptPath, "function scr_compat() { return 2; }", "utf8");

        const { statusBaseUrl, watchPromise } = await startWatchServer(testRoot, abortController, watchFactory);

        try {
            await waitForStatusReady(statusBaseUrl);
            await waitForScanComplete(statusBaseUrl);

            const payload = await fetchStatusPayload(statusBaseUrl);
            assert.ok(
                (payload.totalPatchCount ?? 0) < 2,
                "generated cache files should not contribute extra startup patches"
            );
            assert.ok(
                (payload.recentPatches ?? []).every(
                    (patch) => patch.filePath !== path.join(".gmcache", "generated", "scr_compat.gml")
                ),
                "ignored generated files should not appear in patch history"
            );
        } finally {
            abortController.abort();
            await watchPromise;
            await rm(testRoot, { force: true, recursive: true });
        }
    });

    void it("ignores .gmcache file change events after the watcher is already running", async () => {
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
                await mkdir(path.dirname(generatedScriptPath), { recursive: true });
                await writeFile(generatedScriptPath, "function scr_compat() { return 2; }", "utf8");

                const beforeStatus = await fetchStatusPayload(context.baseUrl);
                const beforePatchCount = beforeStatus.totalPatchCount ?? 0;

                assert.ok(listenerCapture.listener, "watch listener should be captured");
                listenerCapture.listener?.("change", path.join(".gmcache", "generated", "scr_compat.gml"));

                await new Promise<void>((resolve) => {
                    setTimeout(resolve, 250);
                });

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

    void it("still scans legitimate project files when the project root lives under vendor/3DSpider", async () => {
        const workspaceRoot = path.join("/tmp", `watch-vendor-root-${Date.now()}-${randomUUID()}`);
        const projectRoot = path.join(workspaceRoot, "vendor", "3DSpider");
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
            assert.equal(payload.totalPatchCount, 1, "project files under vendor/3DSpider should still be transpiled");
            assert.equal(payload.recentPatches?.[0]?.filePath, path.join("scripts", "scr_player.gml"));
        } finally {
            abortController.abort();
            await watchPromise;
            await rm(workspaceRoot, { force: true, recursive: true });
        }
    });
});
