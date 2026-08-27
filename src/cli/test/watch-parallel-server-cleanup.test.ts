/**
 * Regression test for parallel watch command server cleanup.
 *
 * Previously the watch command's teardown path stopped the runtime, WebSocket,
 * and status servers sequentially. Three independent server stops cost roughly
 * the sum of their individual close times, which inflated SIGINT/SIGTERM
 * shutdown latency for projects that keep all three servers online. The
 * cleanup now runs those stops via {@link Promise.allSettled}, so total
 * teardown tracks the slowest single server.
 *
 * This test injects timing-aware controllers for every server so it can prove
 * the three stops overlap instead of being awaited one after the other. Each
 * fake controller's `stop()` records its wall-clock start, waits long enough
 * that sequential execution would have measurably stacked the starts, then
 * resolves. After the watch command exits, the test verifies every controller
 * saw its stop begin before any other controller's stop ended, which is only
 * possible when the three `await`s actually run concurrently.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import type { StatusServerHandle } from "../src/modules/status/server.js";
import type { PatchWebSocketServer } from "../src/modules/websocket/server.js";

interface StopTimingRecord {
    controller: string;
    startedAt: number;
    finishedAt: number;
}

interface StopTracker {
    records: Array<StopTimingRecord>;
}

interface DeferredValue<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
}

function createDeferredValue<T>(): DeferredValue<T> {
    let resolveValue: ((value: T) => void) | null = null;
    const promise = new Promise<T>((resolve) => {
        resolveValue = resolve;
    });

    return {
        promise,
        resolve(value: T): void {
            assert.ok(resolveValue, "Deferred value resolver must be initialized before use.");
            resolveValue(value);
        }
    };
}

function createStopTracker(): StopTracker {
    return { records: [] };
}

function createTimingAwareStop(serverLabel: string, stopDurationMs: number, tracker: StopTracker) {
    return async function stop(): Promise<void> {
        const startedAt = Date.now();
        await new Promise((resolve) => {
            setTimeout(resolve, stopDurationMs);
        });
        const finishedAt = Date.now();
        tracker.records.push({ controller: serverLabel, startedAt, finishedAt });
    };
}

function createTimingAwareRuntimeServerStarter(stopDurationMs: number, tracker: StopTracker) {
    return async () => ({
        url: "http://127.0.0.1:0/",
        origin: "http://127.0.0.1:0",
        host: "127.0.0.1",
        port: 0,
        root: "/fake/runtime",
        stop: createTimingAwareStop("runtime", stopDurationMs, tracker)
    });
}

/**
 * Replace the `stop` method on `server` with a timing-aware variant that
 * forwards the call to the original `stop` after recording its start and
 * finish timestamps. Used to measure whether the watch command invokes the
 * three server stops concurrently.
 */
function wrapServerStopWithTiming(
    server: PatchWebSocketServer | StatusServerHandle,
    label: string,
    stopDurationMs: number,
    tracker: StopTracker
): void {
    const originalStop = server.stop.bind(server);
    const timedStop = createTimingAwareStop(label, stopDurationMs, tracker);
    Object.defineProperty(server, "stop", {
        configurable: true,
        value: async () => {
            await timedStop();
            await originalStop();
        }
    });
}

const STOP_DURATION_MS = 120;
const PARALLEL_TOLERANCE_MS = 40;
const READY_TIMEOUT_MS = 5000;

void describe("Watch command parallel server cleanup", () => {
    void it("stops the runtime, WebSocket, and status servers concurrently during shutdown", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "watch-parallel-cleanup-"));
        await writeFile(path.join(root, "script.gml"), "var x = 1;", "utf8");

        try {
            const tracker = createStopTracker();
            const runtimeServerStarter = createTimingAwareRuntimeServerStarter(STOP_DURATION_MS, tracker);
            const abortController = new AbortController();

            const websocketServerReady = createDeferredValue<PatchWebSocketServer>();
            const statusServerReady = createDeferredValue<StatusServerHandle>();

            const watchPromise = runWatchCommand(root, {
                polling: false,
                verbose: false,
                quiet: true,
                websocketServer: true,
                websocketPort: 0,
                statusServer: true,
                statusPort: 0,
                runtimeServer: true,
                runtimeRoot: root,
                runtimeServerStarter,
                abortSignal: abortController.signal,
                onWebSocketServerReady: websocketServerReady.resolve,
                onStatusServerReady: statusServerReady.resolve
            });

            const websocketServer = await Promise.race([
                websocketServerReady.promise,
                new Promise<never>((_resolve, reject) => {
                    setTimeout(() => {
                        reject(new Error("WebSocket server failed to become ready within timeout"));
                    }, READY_TIMEOUT_MS).unref();
                })
            ]);
            const statusServer = await Promise.race([
                statusServerReady.promise,
                new Promise<never>((_resolve, reject) => {
                    setTimeout(() => {
                        reject(new Error("Status server failed to become ready within timeout"));
                    }, READY_TIMEOUT_MS).unref();
                })
            ]);

            wrapServerStopWithTiming(websocketServer, "websocket", STOP_DURATION_MS, tracker);
            wrapServerStopWithTiming(statusServer, "status", STOP_DURATION_MS, tracker);

            abortController.abort();
            await watchPromise;

            assert.equal(
                tracker.records.length,
                3,
                "expected exactly three server stops (runtime, websocket, status) during cleanup"
            );

            const labels = tracker.records.map((record) => record.controller).toSorted();
            assert.deepEqual(labels, ["runtime", "status", "websocket"]);

            // Parallel execution proof: the third stop must start before the first
            // stop finishes. Sequential execution would have stacked the starts
            // by roughly STOP_DURATION_MS each, pushing the latest startAt well
            // past the earliest finishedAt. Allow a small tolerance for
            // scheduler jitter.
            const earliestFinishedAt = Math.min(...tracker.records.map((record) => record.finishedAt));
            const latestStartedAt = Math.max(...tracker.records.map((record) => record.startedAt));
            const overlap = earliestFinishedAt - latestStartedAt;

            assert.ok(
                overlap >= -PARALLEL_TOLERANCE_MS,
                `Expected server stops to overlap (got ${overlap}ms gap between latest start and earliest finish); sequential cleanup would have produced at least ~${STOP_DURATION_MS}ms gap`
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
