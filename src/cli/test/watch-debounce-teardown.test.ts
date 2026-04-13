/**
 * Resource-leak regression test: debounced handler teardown during SIGTERM shutdown.
 *
 * **The leak**:
 * When `runWatchCommand` receives SIGTERM (or SIGINT) without an external AbortSignal, the
 * `cleanup()` function previously called `debouncedHandler.flush()` on every pending handler.
 * `flush()` invokes the callback immediately after the watcher is already closed. Because no
 * AbortSignal is present in that code path, `readSourceFileWithTransientEmptyRetry()` runs
 * unguarded and — when it encounters a transiently-empty file — creates a new `setTimeout`
 * timer via `delayFileReadRetry(25 ms, undefined)`. That timer has no cancellation mechanism
 * and outlives the cleanup phase, keeping the event loop alive and constituting a
 * resource leak.
 *
 * **The fix**:
 * `debouncedHandler.cancel()` is used instead of `flush()`, which discards the pending
 * debounced args and clears the underlying timer without invoking the callback.
 *
 * **Follow-up considerations**:
 * - All other callers of `DebouncedFunction.flush()` in this codebase should be audited to
 *   confirm they intend to execute (not discard) pending work.
 * - If "drain before shutdown" semantics are ever desired, they should be implemented
 *   explicitly and only after the watcher is still open — not after `watcher.close()`.
 * - A complementary defence — an internal AbortController aborted at the start of cleanup and
 *   threaded through the unknown-scan path — is implemented in the watch command and tested in
 *   watch-unknown-change-abort.test.ts.
 */

import assert from "node:assert/strict";
import type { WatchListener } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import { withTemporaryProperty } from "./test-helpers/temporary-property.js";
import {
    createMockWatchFactory,
    createRetryTimerCounterState,
    isolateSigtermListeners,
    withTrackedRetrySetTimeout
} from "./test-helpers/watch-fixtures.js";

/**
 * The debounce delay used by `delayFileReadRetry` (not exported from watch.ts).
 * This value matches the `TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS` constant.
 */
const TRANSIENT_RETRY_DELAY_MS = 25;

void describe("Watch debounce handler teardown (resource-leak regression)", () => {
    void it("cancels pending debounced handlers on SIGTERM shutdown — prevents spurious retry timers", async () => {
        // The test verifies that debounced file-change handlers are CANCELLED (not
        // FLUSHED) when the watch command shuts down via SIGTERM without an AbortSignal.
        //
        // Setup: start the watch command over an initially-empty directory so that
        // the initial scan records no file-snapshot entries. After the scan, create
        // an empty .gml file and fire a synthetic change event. The debounced handler
        // is now pending (500 ms debounce, so it hasn't fired yet). When SIGTERM fires
        // immediately afterward, cleanup must cancel the handler.
        //
        // Why an empty file matters: if flush() is used, readSourceFileWithTransientEmptyRetry()
        // reads the file, finds it empty, and calls delayFileReadRetry(TRANSIENT_RETRY_DELAY_MS,
        // undefined). That creates a new setTimeout timer with no AbortSignal protection
        // — a resource leak. cancel() avoids invoking the callback entirely.

        // Initially-empty directory: the initial scan records no snapshots, so the
        // subsequent change-event will bypass the mtime-deduplication guard.
        const root = await mkdtemp(path.join(tmpdir(), "watch-debounce-teardown-"));

        const listenerCapture: { listener: WatchListener<string> | undefined } = {
            listener: undefined
        };
        const watchFactory = createMockWatchFactory(listenerCapture);

        // Track any 25 ms timers created after the cleanup phase begins.
        // A non-zero count indicates that flush() was used and the retry timer leaked.
        const retryTimerCounterState = createRetryTimerCounterState();

        const baseSetTimeout = globalThis.setTimeout;

        // Isolate SIGTERM listeners so that emitting SIGTERM only fires the watch
        // command's own handler and does not trigger the test runner's shutdown logic.
        const isolatedSigtermListeners = isolateSigtermListeners();

        try {
            await withTemporaryProperty(
                process,
                "exit",
                // Prevent the watch command from actually exiting the test process.
                (() => {
                    // intentional no-op
                }) as typeof process.exit,
                () =>
                    withTrackedRetrySetTimeout(retryTimerCounterState, TRANSIENT_RETRY_DELAY_MS, async () => {
                        const watchCmdPromise = runWatchCommand(root, {
                            extensions: [".gml"],
                            quiet: true,
                            verbose: false,
                            runtimeServer: false,
                            websocketServer: false,
                            statusServer: false,
                            watchFactory,
                            // Long debounce to guarantee the handler is still pending
                            // when SIGTERM fires; must not expire on its own before
                            // the signal is emitted.
                            debounceDelay: 500
                        });

                        // Wait for the watcher to initialise and the initial scan of
                        // the empty directory to complete. Because the directory is
                        // empty, the scan finishes nearly instantly; 100 ms is a
                        // conservative buffer that keeps the test fast on CI.
                        await new Promise<void>((resolve) => {
                            baseSetTimeout(resolve, 100);
                        });

                        // Create a transiently-empty .gml file AFTER the initial scan
                        // so that runtimeContext.fileSnapshots has no entry for it.
                        // This ensures the mtime-deduplication guard in handleFileChange
                        // does not short-circuit the read path.
                        const gmlPath = path.join(root, "transient.gml");
                        await writeFile(gmlPath, "", "utf8");

                        // Fire a synthetic file-change event. This queues a 500 ms
                        // debounced handler inside runWatchCommand's internal
                        // runtimeContext.debouncedHandlers map.
                        listenerCapture.listener?.("change", "transient.gml");

                        // Activate timer tracking and immediately trigger cleanup.
                        // The 500 ms debounce has not fired yet, so the handler is
                        // still pending in the map when cleanup runs.
                        retryTimerCounterState.cleanupPhaseActive = true;
                        process.emit("SIGTERM");

                        // Await the watch command completing its cleanup (resolve()
                        // is called before process.exit, so this settles promptly).
                        await watchCmdPromise;

                        // Allow any leaked async work (and the timers it creates) to
                        // settle before we read the counter.
                        await new Promise<void>((resolve) => {
                            baseSetTimeout(resolve, 200);
                        });
                    })
            );
        } finally {
            // Restore the test runner's SIGTERM listeners unconditionally.
            isolatedSigtermListeners.restore();
            await rm(root, { recursive: true, force: true });
        }

        // With the fix (cancel): no callback fires post-cleanup → 0 retry timers.
        // Without the fix (flush): callback fires → readSourceFileWithTransientEmptyRetry
        //   → file is empty → delayFileReadRetry(25 ms, undefined) → ≥1 timer created.
        assert.equal(
            retryTimerCounterState.retryTimersCreatedAfterCleanup,
            0,
            "pending debounced handlers must be cancelled (not flushed) during shutdown; " +
                "flush() causes readSourceFileWithTransientEmptyRetry() to run without an " +
                "AbortSignal, which creates spurious retry timers for transiently-empty files"
        );
    });
});
