import assert from "node:assert/strict";
import type { WatchListener } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import { DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS } from "../src/commands/watch/constants.js";
import { delayFileReadRetry } from "../src/commands/watch/source-analysis.js";
import { withTemporaryProperty } from "./test-helpers/temporary-property.js";
import { createMockWatchFactory } from "./test-helpers/watch-fixtures.js";

void describe("Watch command file read errors", () => {
    void it("logs read failures even in quiet mode", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "watch-read-error-"));
        const problematicDir = path.join(root, "dir-as-file.gml");
        await mkdir(problematicDir, { recursive: true });

        const abortController = new AbortController();
        const capturedErrors: Array<string> = [];
        let resolveErrorLogged: (() => void) | null = null;
        const errorLogged = new Promise<void>((resolve) => {
            resolveErrorLogged = resolve;
        });

        const listenerCapture: { listener: WatchListener<string> | undefined } = { listener: undefined };
        const watchFactory = createMockWatchFactory(listenerCapture);

        await withTemporaryProperty(
            console,
            "error",
            (...args: Array<unknown>): void => {
                capturedErrors.push(args.map(String).join(" "));
                resolveErrorLogged?.();
            },
            async () => {
                const watchPromise = runWatchCommand(root, {
                    extensions: [".gml"],
                    quiet: true,
                    verbose: false,
                    runtimeServer: false,
                    websocketServer: false,
                    statusServer: false,
                    abortSignal: abortController.signal,
                    watchFactory,
                    debounceDelay: 0
                });

                await new Promise((resolve) => setTimeout(resolve, 50));

                listenerCapture.listener?.("change", path.basename(problematicDir));

                await Promise.race([errorLogged, new Promise((resolve) => setTimeout(resolve, 500))]);

                abortController.abort();
                await watchPromise;
            }
        );

        await rm(root, { recursive: true, force: true });

        assert.ok(
            capturedErrors.some((line) => line.includes("Error reading dir-as-file.gml")),
            "should log file read errors even when quiet"
        );
    });

    void it("clears transient file-read retry timer when aborted", async () => {
        const abortController = new AbortController();

        const originalSetTimeout = globalThis.setTimeout;
        const originalClearTimeout = globalThis.clearTimeout;
        const retryTimerIds = new Set<ReturnType<typeof setTimeout>>();
        let clearedRetryTimers = 0;

        const retryResult = await withTemporaryProperty(
            globalThis,
            "setTimeout",
            ((handler: (...args: Array<unknown>) => void, timeout?: number, ...args: Array<unknown>) => {
                const timeoutId = originalSetTimeout(
                    handler as (...handlerArgs: Array<unknown>) => void,
                    timeout,
                    ...args
                );
                if (timeout === DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS) {
                    retryTimerIds.add(timeoutId);
                    originalSetTimeout(() => {
                        abortController.abort();
                    }, 0);
                }
                return timeoutId;
            }) as typeof setTimeout,
            () =>
                withTemporaryProperty(
                    globalThis,
                    "clearTimeout",
                    ((timeoutId?: ReturnType<typeof setTimeout>) => {
                        if (timeoutId !== undefined && retryTimerIds.has(timeoutId)) {
                            clearedRetryTimers += 1;
                            retryTimerIds.delete(timeoutId);
                        }
                        return originalClearTimeout(timeoutId);
                    }) as typeof clearTimeout,
                    async () =>
                        delayFileReadRetry(DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS, abortController.signal)
                )
        );

        assert.equal(retryResult, false, "expected retry delay to return aborted state");
        assert.ok(clearedRetryTimers > 0, "expected abort to clear retry timer");
    });
});
