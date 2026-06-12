import assert from "node:assert/strict";
import type { FSWatcher, PathLike, WatchListener, WatchOptions } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import type { StatusServerHandle } from "../src/modules/status/server.js";
import { fetchStatusPayload, waitForStatusReady } from "./test-helpers/status-polling.js";
import { createMockFsWatcher } from "./test-helpers/watch-fixtures.js";

type EmfileWatchErrorListener = (error: Error & { code: "EMFILE" }) => void;

void describe("Watch command watcher error handling", () => {
    void it("cleans up gracefully when watcher creation fails", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "watch-watcher-error-"));
        const abortController = new AbortController();
        let factoryInvoked = false;

        const watchFactory = (
            _path: PathLike,
            _options?: WatchOptions | BufferEncoding | "buffer",
            _listener?: WatchListener<string>
        ): FSWatcher => {
            void _path;
            void _options;
            void _listener;
            factoryInvoked = true;
            throw new Error("synthetic watch failure");
        };

        await runWatchCommand(root, {
            extensions: [".gml"],
            polling: false,
            verbose: false,
            websocketServer: false,
            statusServer: false,
            runtimeServer: false,
            abortSignal: abortController.signal,
            watchFactory
        });

        await rm(root, { recursive: true, force: true });

        assert.equal(factoryInvoked, true, "Watch factory should be invoked");
    });

    void it("falls back to polling when native recursive watching exhausts file handles", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "watch-watcher-emfile-"));
        const scriptPath = path.join(root, "scripts", "scr_player.gml");
        const abortController = new AbortController();
        let statusBaseUrl = "";
        let errorListener: EmfileWatchErrorListener | null = null;
        let watcherClosed = false;

        const watcher = createMockFsWatcher({
            onClose: () => {
                watcherClosed = true;
            },
            onListener: (eventName, listener) => {
                if (eventName === "error") {
                    errorListener = (error) => {
                        listener(error);
                    };
                }
            }
        });

        const watchFactory = (
            _path: PathLike,
            _options?: WatchOptions | BufferEncoding | "buffer",
            _listener?: WatchListener<string>
        ): FSWatcher => {
            void _path;
            void _options;
            void _listener;
            return watcher;
        };

        await mkdir(path.dirname(scriptPath), { recursive: true });
        await writeFile(scriptPath, "function scr_player() { return 1; }", "utf8");

        const watchPromise = runWatchCommand(root, {
            extensions: [".gml"],
            polling: false,
            pollingInterval: 100,
            verbose: false,
            quiet: true,
            websocketServer: false,
            statusServer: true,
            statusPort: 0,
            runtimeServer: false,
            abortSignal: abortController.signal,
            watchFactory,
            onStatusServerReady: (server: StatusServerHandle) => {
                statusBaseUrl = server.url.replace(/\/status$/u, "");
            }
        });

        try {
            const deadline = Date.now() + 5000;
            for (let attempt = 0; attempt < 200; attempt += 1) {
                if (statusBaseUrl.length > 0 && errorListener !== null) {
                    break;
                }
                await new Promise((resolve) => {
                    setTimeout(resolve, 25);
                });
                if (Date.now() >= deadline) {
                    break;
                }
            }

            assert.notEqual(statusBaseUrl, "", "status server should start before native watch fallback");
            assert.ok(errorListener, "watcher error listener should be registered");
            const emfileError = new Error("too many open files") as Error & { code: "EMFILE" };
            emfileError.code = "EMFILE";
            errorListener(emfileError);

            await waitForStatusReady(statusBaseUrl);
            const payload = await fetchStatusPayload(statusBaseUrl);
            assert.equal(payload.scanComplete, true);
            assert.equal(watcherClosed, true, "failed native watcher should be closed");

            const settlement = await Promise.race([
                watchPromise.then(() => "resolved" as const),
                new Promise<"pending">((resolve) => {
                    setTimeout(() => resolve("pending"), 100);
                })
            ]);
            assert.equal(settlement, "pending", "watch command should stay alive after falling back to polling");
        } finally {
            abortController.abort();
            await watchPromise;
            await rm(root, { recursive: true, force: true });
        }
    });
});
