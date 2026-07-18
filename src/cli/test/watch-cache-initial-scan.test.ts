/**
 * Integration test for the cache-based initial scan fast path.
 *
 * When collectScriptNames populates fileDataCache before performInitialScan runs,
 * the initial scan skips a second directory traversal and processes files directly
 * from the metadata cache. This test verifies that all pre-existing files are transpiled
 * during the initial scan without being delivered as runtime hot-reload edits.
 * Startup ASTs are deliberately reparsed so the cache remains memory-bounded.
 */

// Node.js deprecated the loose equality helpers (e.g. `assert.equal`) in the
// `node:assert` module. This test suite migrates to the /strict subpath and
// the strict helpers (`assert.strictEqual`, `assert.deepStrictEqual`) for
// value- and type-exact comparisons. Behaviour parity with the original calls
// is validated via: pnpm test src/cli/dist/test/watch-cache-initial-scan.test.js
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import { findAvailablePort } from "./test-helpers/free-port.js";
import { fetchStatusPayload, waitForScanComplete } from "./test-helpers/status-polling.js";
import { connectToHotReloadWebSocket } from "./test-helpers/websocket-client.js";

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

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

    void it("does not replay patches for pre-existing files after initial scan completes", async () => {
        const abortController = new AbortController();
        const websocketPort = await findAvailablePort();
        const statusPort = await findAvailablePort();

        const watchPromise = runWatchCommand(testDir, {
            verbose: false,
            quiet: true,
            websocketPort,
            websocketHost: "127.0.0.1",
            runtimeServer: false,
            statusServer: true,
            statusPort,
            abortSignal: abortController.signal
        });

        const client = await connectToHotReloadWebSocket(`ws://127.0.0.1:${websocketPort}`, {
            connectionTimeoutMs: 6000,
            retryIntervalMs: 25
        });

        try {
            const statusBaseUrl = `http://127.0.0.1:${statusPort}`;
            await waitForScanComplete(statusBaseUrl, 8000, 25);

            const status = await fetchStatusPayload(statusBaseUrl);
            assert.strictEqual(status.patchCount, 0, "Initial metadata scan should not emit runtime patches");
            assert.strictEqual(
                status.totalPatchCount,
                0,
                "Initial scan patches should not count as delivered live edits"
            );
            assert.strictEqual(status.patchHistorySize, 0, "Initial scan patches should not be retained for replay");

            await delay(150);
            assert.deepStrictEqual(
                client.receivedPatches,
                [],
                "Initial scan patches should not be broadcast to clients"
            );
        } finally {
            abortController.abort();
            await client.disconnect();

            try {
                await watchPromise;
            } catch {
                // Expected when aborting
            }
        }
    });
});
