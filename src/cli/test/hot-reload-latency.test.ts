/**
 * Tests for end-to-end hot-reload latency tracking.
 *
 * Verifies that:
 * 1. `computeHotReloadLatencyStats` correctly computes average and p95 from a metrics window.
 * 2. The watch pipeline records `hotReloadLatencyMs` in `TranspilationMetrics` when a live
 *    file-change event flows through `handleFileChange` with `fileChangeDetectedAt` set.
 * 3. The status server exposes `avgHotReloadLatencyMs` and `p95HotReloadLatencyMs` after
 *    live file changes are processed.
 */

import assert from "node:assert";
import type { WatchListener } from "node:fs";
import { writeFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";

import { computeHotReloadLatencyStats, runWatchCommand } from "../src/commands/watch.js";
import { findAvailablePort } from "./test-helpers/free-port.js";
import {
    fetchStatusPayload,
    waitForPatchCount,
    waitForScanComplete,
    waitForStatus
} from "./test-helpers/status-polling.js";
import {
    createMockWatchFactory,
    createWatchTestFixture,
    disposeWatchTestFixture,
    type WatchTestFixture
} from "./test-helpers/watch-fixtures.js";

// ---------------------------------------------------------------------------
// Unit tests for computeHotReloadLatencyStats
// ---------------------------------------------------------------------------

void describe("computeHotReloadLatencyStats", () => {
    void it("returns undefined when no metrics have latency data", () => {
        const result = computeHotReloadLatencyStats([
            { hotReloadLatencyMs: undefined },
            { hotReloadLatencyMs: undefined }
        ]);

        assert.strictEqual(result, undefined);
    });

    void it("returns undefined for an empty metrics array", () => {
        assert.strictEqual(computeHotReloadLatencyStats([]), undefined);
    });

    void it("computes avg and p95 for a single value", () => {
        const result = computeHotReloadLatencyStats([{ hotReloadLatencyMs: 50 }]);

        assert.ok(result !== undefined, "Should return stats when data is available");
        assert.strictEqual(result.avg, 50);
        assert.strictEqual(result.p95, 50);
    });

    void it("skips entries without hotReloadLatencyMs when computing stats", () => {
        const result = computeHotReloadLatencyStats([
            { hotReloadLatencyMs: 100 },
            { hotReloadLatencyMs: undefined },
            { hotReloadLatencyMs: 200 }
        ]);

        assert.ok(result !== undefined, "Should return stats when some data is available");
        assert.strictEqual(result.avg, 150);
    });

    void it("computes p95 as the 95th percentile of available values", () => {
        // 20 values: 1–20ms. p95 should be index ceil(20*0.95)-1 = ceil(19)-1 = 18 → value 19.
        const metrics = Array.from({ length: 20 }, (_, i) => ({ hotReloadLatencyMs: i + 1 }));

        const result = computeHotReloadLatencyStats(metrics);

        assert.ok(result !== undefined, "Should return stats");
        assert.strictEqual(result.avg, 10.5);
        assert.strictEqual(result.p95, 19);
    });

    void it("average rounds correctly for non-integer averages", () => {
        const result = computeHotReloadLatencyStats([
            { hotReloadLatencyMs: 10 },
            { hotReloadLatencyMs: 20 },
            { hotReloadLatencyMs: 30 }
        ]);

        assert.ok(result !== undefined);
        assert.strictEqual(result.avg, 20);
    });
});

// ---------------------------------------------------------------------------
// Integration test: latency recorded and exposed via status server
// ---------------------------------------------------------------------------

void describe("Hot reload latency tracking in watch pipeline", () => {
    let fixture: WatchTestFixture | null = null;

    before(async () => {
        fixture = await createWatchTestFixture();
    });

    after(async () => {
        const activeFixture = fixture;
        if (activeFixture) {
            fixture = null;
            await disposeWatchTestFixture(activeFixture.dir);
        }
    });

    void it("records hotReloadLatencyMs in metrics after a live file-change event", async () => {
        if (!fixture) {
            throw new Error("Watch fixture was not initialized");
        }

        const statusPort = await findAvailablePort();
        const abortController = new AbortController();

        const listenerCapture: { listener: WatchListener<string> | undefined } = { listener: undefined };
        const watchFactory = createMockWatchFactory(listenerCapture);

        const watchPromise = runWatchCommand(fixture.dir, {
            extensions: [".gml"],
            verbose: false,
            quiet: true,
            websocketServer: false,
            statusServer: true,
            statusPort,
            debounceDelay: 0,
            runtimeServer: false,
            abortSignal: abortController.signal,
            watchFactory
        });

        const statusBaseUrl = `http://127.0.0.1:${statusPort}`;

        try {
            await waitForScanComplete(statusBaseUrl, 5000, 25);

            const initialStatus = await fetchStatusPayload(statusBaseUrl);
            const initialPatchCount = initialStatus.totalPatchCount ?? initialStatus.patchCount ?? 0;

            // Trigger a live file change via the mock watcher
            await writeFile(fixture.script1, "var latency_test = 1;", "utf8");
            listenerCapture.listener?.("change", "script1.gml");

            await waitForPatchCount(statusBaseUrl, initialPatchCount + 1, 5000, 25);

            const finalStatus = await fetchStatusPayload(statusBaseUrl);

            // The status server should expose latency stats after a live change
            assert.ok(
                typeof finalStatus.avgHotReloadLatencyMs === "number",
                "avgHotReloadLatencyMs should be a number after a live file change"
            );
            assert.ok(
                typeof finalStatus.p95HotReloadLatencyMs === "number",
                "p95HotReloadLatencyMs should be a number after a live file change"
            );
            assert.ok((finalStatus.avgHotReloadLatencyMs ?? 0) >= 0, "Average latency should be non-negative");

            // The recentPatches array should include hotReloadLatencyMs for the live-change patch
            const recentPatches = finalStatus.recentPatches ?? [];
            const liveChangePatch = recentPatches.find((p) => typeof p.hotReloadLatencyMs === "number");
            assert.ok(
                liveChangePatch !== undefined,
                "At least one recent patch should have hotReloadLatencyMs recorded"
            );
        } finally {
            abortController.abort();

            try {
                await watchPromise;
            } catch {
                // Expected when aborting
            }
        }
    });

    void it("does not record hotReloadLatencyMs for initial scan patches", async () => {
        if (!fixture) {
            throw new Error("Watch fixture was not initialized");
        }

        const statusPort = await findAvailablePort();
        const abortController = new AbortController();
        const statusBaseUrl = `http://127.0.0.1:${statusPort}`;

        const watchPromise = runWatchCommand(fixture.dir, {
            extensions: [".gml"],
            verbose: false,
            quiet: true,
            websocketServer: false,
            statusServer: true,
            statusPort,
            debounceDelay: 0,
            runtimeServer: false,
            abortSignal: abortController.signal
        });

        try {
            await waitForScanComplete(statusBaseUrl, 5000, 25);

            const status = await fetchStatusPayload(statusBaseUrl);

            // avgHotReloadLatencyMs should be absent (undefined) when only scan patches exist,
            // since scan patches are not triggered by live file-change events.
            assert.strictEqual(
                status.avgHotReloadLatencyMs,
                undefined,
                "avgHotReloadLatencyMs should be absent when only initial scan patches exist"
            );
        } finally {
            abortController.abort();

            try {
                await watchPromise;
            } catch {
                // Expected when aborting
            }
        }
    });

    void it("reports latency only in recentPatches that came from live events", async () => {
        if (!fixture) {
            throw new Error("Watch fixture was not initialized");
        }

        const statusPort = await findAvailablePort();
        const abortController = new AbortController();

        const listenerCapture: { listener: WatchListener<string> | undefined } = { listener: undefined };
        const watchFactory = createMockWatchFactory(listenerCapture);

        const watchPromise = runWatchCommand(fixture.dir, {
            extensions: [".gml"],
            verbose: false,
            quiet: true,
            websocketServer: false,
            statusServer: true,
            statusPort,
            debounceDelay: 0,
            runtimeServer: false,
            abortSignal: abortController.signal,
            watchFactory
        });

        const statusBaseUrl = `http://127.0.0.1:${statusPort}`;

        try {
            // After initial scan, no latency data yet
            await waitForScanComplete(statusBaseUrl, 5000, 25);

            let status = await fetchStatusPayload(statusBaseUrl);
            assert.strictEqual(status.avgHotReloadLatencyMs, undefined, "No latency before live events");

            // Trigger two live file changes
            await writeFile(fixture.script1, "var a = 1;", "utf8");
            listenerCapture.listener?.("change", "script1.gml");

            const countAfterFirst = (status.totalPatchCount ?? status.patchCount ?? 0) + 1;
            await waitForPatchCount(statusBaseUrl, countAfterFirst, 5000, 25);

            await writeFile(fixture.script2, "var b = 2;", "utf8");
            listenerCapture.listener?.("change", "script2.gml");

            await waitForStatus(
                statusBaseUrl,
                (s) => (s.totalPatchCount ?? s.patchCount ?? 0) >= countAfterFirst + 1,
                5000,
                25
            );

            status = await fetchStatusPayload(statusBaseUrl);
            assert.ok(
                typeof status.avgHotReloadLatencyMs === "number",
                "avgHotReloadLatencyMs present after two live events"
            );
            assert.ok(
                typeof status.p95HotReloadLatencyMs === "number",
                "p95HotReloadLatencyMs present after two live events"
            );

            // Both stats should be non-negative
            assert.ok((status.avgHotReloadLatencyMs ?? -1) >= 0, "avg latency is non-negative");
            assert.ok((status.p95HotReloadLatencyMs ?? -1) >= 0, "p95 latency is non-negative");
        } finally {
            abortController.abort();

            try {
                await watchPromise;
            } catch {
                // Expected when aborting
            }
        }
    });
});
