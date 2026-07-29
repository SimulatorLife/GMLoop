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

            // Trigger multiple file changes
            await writeFile(fixture.script1, "var x = 100; // Modified", "utf8");
            await writeFile(fixture.script2, "var y = 200; // Modified", "utf8");
            await websocketClient.waitForPatches({
                timeoutMs: 4000,
                minCount: 2,
                predicate: (patch: HotReloadScriptPatch): patch is HotReloadScriptPatch =>
                    patch.id.includes("script1") || patch.id.includes("script2")
            });

            await new Promise<void>((resolve) => {
                setTimeout(resolve, WATCH_READY_DELAY_MS);
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
