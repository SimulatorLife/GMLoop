import assert from "node:assert/strict";
import type { WatchListener } from "node:fs";
import { describe, it } from "node:test";

import { startGraphVisualizationFeatherMetadataWatcher } from "../src/commands/graph/visualize/watchers.js";
import { createMockFsWatcher } from "./test-helpers/watch-fixtures.js";

void describe("Graph visualization feather metadata watcher error handling", () => {
    void it("closes the underlying fs watcher when a watch error is emitted", async () => {
        let watcherClosed = false;
        let errorListener: WatchListener<string> | null = null;

        const watcher = createMockFsWatcher({
            onClose: () => {
                watcherClosed = true;
            },
            onListener: (eventName, listener) => {
                if (eventName === "error") {
                    errorListener = listener;
                }
            }
        });

        const errors: Array<unknown> = [];

        const handle = startGraphVisualizationFeatherMetadataWatcher({
            featherMetadataPath: "/tmp/does-not-matter/feather-metadata.json",
            onChanged: () => {},
            onError: (error) => {
                errors.push(error);
            },
            watchFactory: () => watcher,
            readFileFn: async () => "{}"
        });

        // The watcher is created inside an async IIFE; let it settle before
        // simulating the platform emitting an "error" event.
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        assert.ok(errorListener, "watcher error listener should be registered");

        // fs.watch's "error" listener is invoked with an Error, not the
        // (eventType, filename) signature used for change events.
        const emit = errorListener as unknown as (error: Error) => void;
        emit(new Error("synthetic watch failure"));

        assert.equal(errors.length, 1, "onError should be invoked once");
        assert.equal(
            watcherClosed,
            true,
            "the fs watcher must be closed after an error so its file descriptor/inotify handle is released"
        );

        handle.close();
    });
});
