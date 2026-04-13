/**
 * Resource-leak regression test: unknown-filename scan abort during SIGTERM shutdown.
 *
 * **The leak**:
 * When a file system event fires with `filename === null` (an "unknown" event, common on
 * macOS and during high-churn periods), the watch command calls `scheduleUnknownFileChanges`
 * directly (no debounce when `debounceDelay === 0`, or via a debounced callback). Inside that
 * async call chain, `handleFileChange` is called for every discovered GML file. If a file is
 * transiently empty at read time, `readSourceFileWithTransientEmptyRetry` calls
 * `delayFileReadRetry(N, signal?)` to schedule a retry via `setTimeout`.
 *
 * Previously, no `AbortSignal` was threaded into `scheduleUnknownFileChanges` or its callees.
 * When SIGTERM fired and cleanup ran, debounced handlers were cancelled but any in-flight
 * unknown scan continued unguarded. If the file read happened after cleanup started, the
 * timer created by `delayFileReadRetry(N, undefined)` had no cancellation mechanism and
 * outlived the cleanup phase — a resource leak that keeps the event loop alive.
 *
 * **The fix**:
 * An internal `AbortController` (`internalAbortController`) is created in `runWatchCommand`
 * and is aborted as the very first action in `cleanup()`. Its signal is passed through
 * `scheduleUnknownFileChanges` → `processQueuedUnknownFileChanges` →
 * `handleUnknownFileChanges` → `handleFileChange` → `readSourceFileWithTransientEmptyRetry`
 * → `delayFileReadRetry`. When the scan encounters a transiently-empty file after cleanup
 * has started, `delayFileReadRetry` detects that the signal is already aborted and returns
 * `false` immediately without creating a `setTimeout` timer.
 *
 * **Test strategy**:
 * The watcher callback, file reads, and directory scans are all asynchronous. When the
 * watcher callback fires synchronously (via the mock factory), the actual I/O work is queued
 * on the microtask/macrotask queues and runs **after** the current synchronous block
 * completes. This means:
 *   1. `void triggerUnknown()` is called — async chain queued but not yet started.
 *   2. `cleanupPhaseActive = true` is set synchronously.
 *   3. `process.emit("SIGTERM")` fires — `cleanup()` runs synchronously (in its sync part),
 *      aborting `internalAbortController` before the I/O work begins.
 *   4. The async scan eventually runs, but `delayFileReadRetry` now sees an already-aborted
 *      signal and returns `false` without calling `setTimeout(_, 25)`.
 *
 * The test intercepts `setTimeout` to detect any 25 ms retry timers created after the
 * cleanup phase starts. A count of 0 confirms the fix; a positive count indicates the leak.
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
 * Retry delay constant from `delayFileReadRetry` (matches
 * `DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS` in watch-constants.ts).
 */
const TRANSIENT_RETRY_DELAY_MS = 25;

void describe("Watch unknown-scan abort signal (resource-leak regression)", () => {
    void it("prevents transient-empty retry timers when SIGTERM fires during an unknown-filename scan", async () => {
        // The test verifies that when a watcher event with filename===null triggers an
        // asynchronous unknown-file scan, and SIGTERM fires while that scan is in-flight,
        // no 25 ms retry timer is created by delayFileReadRetry().
        //
        // Setup: start the watch command over an empty directory (so the initial scan
        // records no snapshot entries). After the scan, create a transiently-empty .gml
        // file. Fire a synthetic unknown-filename event (filename=null). Because
        // debounceDelay=0, triggerUnknown() is called synchronously in the watcher
        // callback but its async body is queued on the event loop. We then immediately
        // set cleanupPhaseActive=true and emit SIGTERM. Cleanup aborts the internal
        // AbortController before the async scan body runs. When the scan eventually
        // reads the empty file and calls delayFileReadRetry(25, signal), the signal is
        // already aborted — no setTimeout is invoked.

        const root = await mkdtemp(path.join(tmpdir(), "watch-unknown-abort-"));

        const listenerCapture: { listener: WatchListener<string> | undefined } = {
            listener: undefined
        };
        const watchFactory = createMockWatchFactory(listenerCapture);

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
                            // debounceDelay=0 so the unknown event calls
                            // scheduleUnknownFileChanges directly (no debounce to
                            // cancel). This is the path that previously leaked.
                            debounceDelay: 0
                        });

                        // Wait for the watcher to initialise and for the initial scan
                        // of the empty directory to complete. The directory is empty
                        // so the scan finishes nearly instantly; 100 ms is a
                        // conservative buffer that keeps the test fast on CI.
                        await new Promise<void>((resolve) => {
                            baseSetTimeout(resolve, 100);
                        });

                        // Create a transiently-empty .gml file AFTER the initial scan
                        // so that runtimeContext.fileSnapshots has no entry for it.
                        // This ensures the mtime-deduplication guard in handleFileChange
                        // does not short-circuit the read path. The file is empty so
                        // readSourceFileWithTransientEmptyRetry will attempt a retry.
                        const gmlPath = path.join(root, "transient.gml");
                        await writeFile(gmlPath, "", "utf8");

                        // Fire a synthetic unknown-filename event (filename === null /
                        // undefined). In debounceDelay=0 mode the watcher callback calls
                        // `void triggerUnknown()` synchronously, which starts the async
                        // scheduleUnknownFileChanges chain. The async body (readdir, stat,
                        // readFile) is queued and has NOT run yet when we proceed.
                        listenerCapture.listener?.("change", undefined as unknown as string);

                        // Activate timer tracking and immediately trigger cleanup.
                        // Because the async scan body hasn't run yet, the abort from
                        // internalAbortController fires before delayFileReadRetry is called.
                        retryTimerCounterState.cleanupPhaseActive = true;
                        process.emit("SIGTERM");

                        // Await the watch command completing its cleanup.
                        await watchCmdPromise;

                        // Allow the async scan (and any leaked work) to settle before
                        // reading the counter.
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

        // With the fix: the internal AbortController is aborted before the async scan
        // runs, so delayFileReadRetry receives an already-aborted signal and returns
        // false without calling setTimeout — count is 0.
        //
        // Without the fix: scheduleUnknownFileChanges receives no signal, the empty file
        // is read, delayFileReadRetry(25, undefined) is called, and a timer is created
        // post-cleanup — count > 0.
        assert.equal(
            retryTimerCounterState.retryTimersCreatedAfterCleanup,
            0,
            "the internal AbortController must be aborted before the unknown-scan runs so " +
                "delayFileReadRetry receives an already-aborted signal and skips the retry timer; " +
                "a non-zero count means the signal was not threaded through scheduleUnknownFileChanges"
        );
    });
});
