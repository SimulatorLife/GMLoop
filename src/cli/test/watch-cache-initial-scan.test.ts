/**
 * Integration test for the cache-based initial scan fast path.
 *
 * When collectScriptNames populates fileDataCache before performInitialScan runs,
 * the initial scan skips a second directory traversal and processes files directly
 * from the cache. This test verifies that all pre-existing files are transpiled
 * during the initial scan and their patches are available for WebSocket replay.
 */

import assert from "node:assert";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import { findAvailablePort } from "./test-helpers/free-port.js";
import { waitForPatchCount, waitForScanComplete } from "./test-helpers/status-polling.js";
import { connectToHotReloadWebSocket } from "./test-helpers/websocket-client.js";

void describe("Cache-based initial scan", () => {
    let testDir: string;

    before(async () => {
        testDir = path.join(process.cwd(), "tmp", `watch-cache-scan-${Date.now()}`);
        await mkdir(testDir, { recursive: true });

        // Write GML files before the watch command starts so collectScriptNames
        // populates fileDataCache with all of them. performInitialScan should then
        // use the cache-based fast path (skipping a second readdir pass).
        await Promise.all([
            writeFile(
                path.join(testDir, "scr_player.gml"),
                `function scr_player() {
    var speed = 4;
    x += speed;
}`,
                "utf8"
            ),
            writeFile(
                path.join(testDir, "scr_enemy.gml"),
                `function scr_enemy() {
    var health = 100;
    return health;
}`,
                "utf8"
            ),
            writeFile(
                path.join(testDir, "scr_util.gml"),
                `function scr_util_clamp(value, lo, hi) {
    return clamp(value, lo, hi);
}`,
                "utf8"
            )
        ]);
    });

    after(async () => {
        if (testDir) {
            await rm(testDir, { recursive: true, force: true });
        }
    });

    void it("replays patches for all pre-existing files after initial scan completes", async () => {
        const abortController = new AbortController();
        const websocketPort = await findAvailablePort();
        const statusPort = await findAvailablePort();

        const watchPromise = runWatchCommand(testDir, {
            extensions: [".gml"],
            verbose: false,
            quiet: true,
            websocketPort,
            websocketHost: "127.0.0.1",
            runtimeServer: false,
            statusServer: true,
            statusPort,
            abortSignal: abortController.signal
        });

        const receivedPatches = await (async () => {
            const client = await connectToHotReloadWebSocket(`ws://127.0.0.1:${websocketPort}`, {
                connectionTimeoutMs: 6000,
                retryIntervalMs: 25
            });

            try {
                // Wait for the initial scan to finish and for all 3 file patches to be available.
                // The status server reports scanComplete and patchCount so we can observe both.
                await waitForScanComplete(`http://127.0.0.1:${statusPort}`, 8000, 25);
                await waitForPatchCount(`http://127.0.0.1:${statusPort}`, 3, 5000, 25);

                // The 3 patches from the initial scan should be replayed immediately
                // when the client connects (orderPatchesForReplay sends lastSuccessfulPatches).
                return await client.waitForPatches({ minCount: 3, timeoutMs: 5000 });
            } finally {
                abortController.abort();
                await client.disconnect();

                try {
                    await watchPromise;
                } catch {
                    // Expected when aborting
                }
            }
        })();

        assert.ok(receivedPatches.length >= 3, `Expected at least 3 replayed patches, got ${receivedPatches.length}`);

        const patchIds = receivedPatches.map((p) => p.id);
        assert.ok(
            patchIds.some((id) => id.includes("scr_player")),
            `Expected a patch for scr_player, got: ${patchIds.join(", ")}`
        );
        assert.ok(
            patchIds.some((id) => id.includes("scr_enemy")),
            `Expected a patch for scr_enemy, got: ${patchIds.join(", ")}`
        );
        assert.ok(
            patchIds.some((id) => id.includes("scr_util")),
            `Expected a patch for scr_util, got: ${patchIds.join(", ")}`
        );
    });
});
