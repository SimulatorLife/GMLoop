import assert from "node:assert";
import { describe, it } from "node:test";

import type {
    PatchQueueMetrics,
    WebSocketPatchQueueFlusher,
    WebSocketPatchQueueMetricsReader
} from "../src/browser/websocket/types.js";

/**
 * Structural contract tests for the role interfaces carved out of the
 * historical `WebSocketPatchQueueManager` aggregate.
 *
 * The pre-split `WebSocketPatchQueueManager` mixed two unrelated concerns:
 *   - Side-effect-free observation of patch-queue metrics (via
 *     `getPatchQueueMetrics`), which only needs read access to the
 *     queue's bookkeeping.
 *   - Manual queue flushing (via `flushPatchQueue`), which mutates the
 *     queue and applies queued patches.
 *
 * Diagnostic consumers that only need to surface queue health (e.g.
 * status dashboards or regression tests) previously had to depend on
 * the flush capability as well, violating the Interface Segregation
 * Principle. After the refactor:
 *   - `WebSocketPatchQueueMetricsReader` can be satisfied by an object
 *     declaring only `getPatchQueueMetrics`.
 *   - `WebSocketPatchQueueFlusher` can be satisfied by an object
 *     declaring only `flushPatchQueue`.
 */

function createMetricsReader(): WebSocketPatchQueueMetricsReader {
    return {
        getPatchQueueMetrics(): Readonly<PatchQueueMetrics> | null {
            return Object.freeze({
                flushCount: 0,
                lastFlushSize: 0,
                lastFlushedAt: null,
                maxQueueDepth: 0,
                totalDeduplicated: 0,
                totalDropped: 0,
                totalFlushed: 0,
                totalQueued: 0
            });
        }
    };
}

function createFlusher(): WebSocketPatchQueueFlusher {
    let flushedTotal = 0;
    return {
        flushPatchQueue(): number {
            const nextCount = flushedTotal + 1;
            flushedTotal = nextCount;
            return nextCount;
        }
    };
}

void describe("WebSocket patch queue role interfaces", () => {
    void it("WebSocketPatchQueueMetricsReader is satisfied by an object declaring only getPatchQueueMetrics", () => {
        const reader: WebSocketPatchQueueMetricsReader = createMetricsReader();
        const metrics = reader.getPatchQueueMetrics();
        assert.ok(metrics, "Reader should produce metrics when queueing is enabled.");
        assert.strictEqual(metrics.totalQueued, 0);
        assert.strictEqual(metrics.totalFlushed, 0);
    });

    void it("WebSocketPatchQueueMetricsReader can report null when queueing is disabled", () => {
        const reader: WebSocketPatchQueueMetricsReader = {
            getPatchQueueMetrics(): Readonly<PatchQueueMetrics> | null {
                return null;
            }
        };
        assert.strictEqual(reader.getPatchQueueMetrics(), null);
    });

    void it("WebSocketPatchQueueFlusher is satisfied by an object declaring only flushPatchQueue", () => {
        const flusher: WebSocketPatchQueueFlusher = createFlusher();
        assert.strictEqual(flusher.flushPatchQueue(), 1);
        assert.strictEqual(flusher.flushPatchQueue(), 2);
    });

    void it("flusher role does not leak metrics access to consumers that only flush", () => {
        // `WebSocketPatchQueueFlusher` is intentionally narrower than the
        // metrics role: depending on the flusher alone should not surface
        // the read-only metrics method, so a diagnostic-only consumer
        // cannot accidentally gain the ability to mutate queue state.
        const flusher: WebSocketPatchQueueFlusher = createFlusher();
        assert.strictEqual(Object.hasOwn(flusher, "getPatchQueueMetrics"), false);
    });

    void it("metrics role does not leak flush access to consumers that only observe", () => {
        // The metrics role must not surface the mutating flush method,
        // because callers that wire it into a read-only status pipeline
        // (e.g. an HTTP status snapshot) must not be able to drain the
        // queue. The narrower role makes that capability invisible.
        const reader: WebSocketPatchQueueMetricsReader = createMetricsReader();
        assert.strictEqual(Object.hasOwn(reader, "flushPatchQueue"), false);
    });
});
