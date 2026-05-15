import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import type { StatusServerHandle } from "../src/modules/status/server.js";
import { fetchStatusPayload, waitForScanComplete, waitForStatusReady } from "./test-helpers/status-polling.js";

void describe("watch command ignored generated directories", () => {
    void it("skips .gmcache files during startup scan and status reporting", async () => {
        const testRoot = path.join("/tmp", `watch-ignore-generated-${Date.now()}-${randomUUID()}`);
        const projectScriptPath = path.join(testRoot, "scripts", "scr_player.gml");
        const generatedScriptPath = path.join(testRoot, ".gmcache", "generated", "scr_compat.gml");
        const abortController = new AbortController();

        await mkdir(path.dirname(projectScriptPath), { recursive: true });
        await mkdir(path.dirname(generatedScriptPath), { recursive: true });
        await writeFile(projectScriptPath, "function scr_player() { return 1; }", "utf8");
        await writeFile(generatedScriptPath, "function scr_compat() { return 2; }", "utf8");

        let statusBaseUrl = "";
        const watchPromise = runWatchCommand(testRoot, {
            abortSignal: abortController.signal,
            extensions: [".gml"],
            onStatusServerReady: (server: StatusServerHandle) => {
                statusBaseUrl = server.url.replace(/\/status$/u, "");
            },
            quiet: true,
            runtimeServer: false,
            statusPort: 0,
            statusServer: true,
            websocketServer: false
        });

        try {
            const deadline = Date.now() + 5000;
            while (statusBaseUrl.length === 0 && Date.now() < deadline) {
                await new Promise((resolve) => {
                    setTimeout(resolve, 25);
                });
            }

            assert.notEqual(statusBaseUrl, "", "status server URL should resolve");
            await waitForStatusReady(statusBaseUrl);
            await waitForScanComplete(statusBaseUrl);

            const payload = await fetchStatusPayload(statusBaseUrl);
            assert.equal(payload.totalPatchCount, 1, "only project-owned GML should contribute patches");
            assert.equal(
                payload.recentPatches?.length,
                1,
                "ignored generated files should not appear in patch history"
            );
            assert.equal(payload.recentPatches?.[0]?.filePath, path.join("scripts", "scr_player.gml"));
        } finally {
            abortController.abort();
            await watchPromise;
            await rm(testRoot, { force: true, recursive: true });
        }
    });
});
