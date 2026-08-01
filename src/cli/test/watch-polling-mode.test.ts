import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import { createWatchTestFixture, disposeWatchTestFixture } from "./test-helpers/watch-fixtures.js";

void describe("watch polling mode", () => {
    void it("does not create native filesystem watchers", async () => {
        const fixture = await createWatchTestFixture();
        const abortController = new AbortController();
        let watchFactoryCalled = false;

        try {
            const watchPromise = runWatchCommand(fixture.dir, {
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

            await new Promise<void>((resolve) => {
                setTimeout(resolve, 200);
            });
            abortController.abort();
            await watchPromise;

            assert.equal(watchFactoryCalled, false);
        } finally {
            abortController.abort();
            await disposeWatchTestFixture(fixture.dir);
        }
    });
});
