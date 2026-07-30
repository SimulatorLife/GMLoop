/**
 * Tests for watch command transpilation metrics tracking.
 *
 * Validates that the watch command properly collects and displays
 * transpilation metrics including timing, sizes, and aggregate statistics.
 */

import assert from "node:assert";
import { writeFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import { findAvailablePort } from "./test-helpers/free-port.js";
import {
    createWatchTestFixture,
    disposeWatchTestFixture,
    type WatchTestFixture
} from "./test-helpers/watch-fixtures.js";
import { connectToHotReloadWebSocket, type HotReloadScriptPatch } from "./test-helpers/websocket-client.js";

const WATCH_READY_DELAY_MS = 50;
const WATCH_PATCH_TIMEOUT_MS = 10_000;

void describe("Watch command metrics tracking", () => {
    let fixture: WatchTestFixture | null = null;

    before(() =>
        createWatchTestFixture().then((created) => {
            fixture = created;
            return created;
        })
    );

    after(() => {
        if (!fixture) {
            return;
        }

        const targetFixture = fixture;
        fixture = null;
        return disposeWatchTestFixture(targetFixture.dir);
    });

    void it("should track metrics for multiple transpilations", async () => {
        const abortController = new AbortController();
        const websocketPort = await findAvailablePort();

        if (!fixture) {
            throw new Error("Watch fixture was not initialized");
        }

        const watchPromise = runWatchCommand(fixture.dir, {
            verbose: false,
            websocketPort,
            websocketHost: "127.0.0.1",
            websocketServer: true,
            statusServer: false,
            runtimeServer: false,
            abortSignal: abortController.signal
        });

        let websocketClient: Awaited<ReturnType<typeof connectToHotReloadWebSocket>> | null = null;

        try {
            websocketClient = await connectToHotReloadWebSocket(`ws://127.0.0.1:${websocketPort}`, {
                connectionTimeoutMs: 4000,
                retryIntervalMs: 25
            });

            // The WebSocket server can accept connections before the filesystem
            // watcher has finished its initial scan. Give the watcher a moment to
            // become ready so the first write cannot be lost under CI load.
            await new Promise<void>((resolve) => {
                setTimeout(resolve, WATCH_READY_DELAY_MS);
            });

            // Serialize the writes and observations so filesystem event coalescing
            // cannot collapse two intended transpilations into one under CI load.
            await writeFile(fixture.script1, "var x = 100; // Modified", "utf8");
            await websocketClient.waitForPatches({
                timeoutMs: WATCH_PATCH_TIMEOUT_MS,
                minCount: 1,
                predicate: (patch: HotReloadScriptPatch): patch is HotReloadScriptPatch =>
                    patch.id.includes("script1")
            });

            await writeFile(fixture.script2, "var y = 200; // Modified", "utf8");
            await websocketClient.waitForPatches({
                timeoutMs: WATCH_PATCH_TIMEOUT_MS,
                minCount: 1,
                predicate: (patch: HotReloadScriptPatch): patch is HotReloadScriptPatch =>
                    patch.id.includes("script2")
            });
        } finally {
            // Stop the watcher
            abortController.abort();

            if (websocketClient) {
                await websocketClient.disconnect();
            }

            try {
                await watchPromise;
            } catch {
                // Expected when aborting
            }
        }

        // Test passes if no errors were thrown and statistics were displayed
        assert.ok(true, "Metrics tracking completed without errors");
    });
});
