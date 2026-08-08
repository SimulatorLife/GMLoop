import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import { withTemporaryProperty } from "./test-helpers/temporary-property.js";
import { createWatchTestFixture, disposeWatchTestFixture } from "./test-helpers/watch-fixtures.js";

const POLLING_STARTUP_TIMEOUT_MS = 5000;

void describe("watch polling mode", () => {
    void it("does not create native filesystem watchers", { timeout: POLLING_STARTUP_TIMEOUT_MS }, async () => {
        const fixture = await createWatchTestFixture();
        const abortController = new AbortController();
        let watchFactoryCalled = false;
        let watchPromise: Promise<void> | undefined;
        let resolvePollingStarted: () => void = () => {};
        const pollingStarted = new Promise<void>((resolve) => {
            resolvePollingStarted = resolve;
        });
        const originalSetInterval = globalThis.setInterval;
        const replacementSetInterval = ((handler: () => void, ms?: number, ...args: Array<unknown>) => {
            const handle = originalSetInterval(handler, ms, ...args);
            resolvePollingStarted();
            return handle;
        }) as typeof setInterval;

        try {
            await withTemporaryProperty(globalThis, "setInterval", replacementSetInterval, async () => {
                watchPromise = runWatchCommand(fixture.dir, {
                    polling: true,
                    pollingInterval: 100,
                    websocketServer: false,
                    statusServer: false,
                    runtimeServer: false,
                    abortSignal: abortController.signal,
                    watchFactory() {
                        watchFactoryCalled = true;
                        throw new Error("Polling mode must not create a native watcher.");
                    }
                });

                let startupTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
                try {
                    await Promise.race([
                        pollingStarted,
                        new Promise<never>((_resolve, reject) => {
                            startupTimeoutHandle = setTimeout(() => {
                                reject(new Error("Polling interval was not installed before the test timed out."));
                            }, POLLING_STARTUP_TIMEOUT_MS);
                        })
                    ]);
                    assert.equal(watchFactoryCalled, false);
                } finally {
                    if (startupTimeoutHandle !== undefined) {
                        clearTimeout(startupTimeoutHandle);
                    }
                    abortController.abort();
                    await watchPromise;
                }
            });
        } finally {
            abortController.abort();
            if (watchPromise !== undefined) {
                await watchPromise;
            }
            await disposeWatchTestFixture(fixture.dir);
        }
    });
});
