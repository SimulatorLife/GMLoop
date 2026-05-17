import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import { withTemporaryProperty } from "./test-helpers/temporary-property.js";

type RuntimeServerStarter = (options: { runtimeRoot: string; verbose?: boolean }) => Promise<{
    url: string;
    origin: string;
    host: string;
    port: number;
    root: string;
    stop: () => Promise<void>;
}>;

function createMockRuntimeServerStarter(onStop: () => void): RuntimeServerStarter {
    return async () => {
        return {
            url: "http://127.0.0.1:8080/",
            origin: "http://127.0.0.1:8080",
            host: "127.0.0.1",
            port: 8080,
            root: "/fake/runtime",
            stop: async () => {
                onStop();
            }
        };
    };
}

void describe("Watch command server startup cleanup", () => {
    void it("cleans up runtime server when WebSocket server fails to start", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "watch-server-cleanup-"));
        let runtimeServerStopped = false;

        const mockRuntimeServerStarter = createMockRuntimeServerStarter(() => {
            runtimeServerStopped = true;
        });

        await withTemporaryProperty(
            process,
            "exit",
            (code?: number) => {
                void code;
                throw new Error("process.exit called");
            },
            async () => {
                try {
                    await runWatchCommand(root, {
                        extensions: [".gml"],
                        polling: false,
                        verbose: false,
                        quiet: true,
                        websocketServer: true,
                        websocketPort: 999_999,
                        statusServer: false,
                        runtimeServer: true,
                        runtimeRoot: root,
                        runtimeServerStarter: mockRuntimeServerStarter
                    });
                } catch {
                    // Expected to fail due to invalid WebSocket port
                }
            }
        );
        await rm(root, { recursive: true, force: true });

        assert.equal(
            runtimeServerStopped,
            true,
            "Runtime server should be stopped when WebSocket server fails to start"
        );
    });

    void it("cleans up all servers when status server fails to start", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "watch-server-cleanup-status-"));
        let runtimeServerStopped = false;

        const mockRuntimeServerStarter = createMockRuntimeServerStarter(() => {
            runtimeServerStopped = true;
        });

        await withTemporaryProperty(
            process,
            "exit",
            (code?: number) => {
                void code;
                throw new Error("process.exit called");
            },
            async () => {
                try {
                    await runWatchCommand(root, {
                        extensions: [".gml"],
                        polling: false,
                        verbose: false,
                        quiet: true,
                        websocketServer: true,
                        websocketPort: 17_890,
                        statusServer: true,
                        statusPort: 999_999,
                        runtimeServer: true,
                        runtimeRoot: root,
                        runtimeServerStarter: mockRuntimeServerStarter
                    });
                } catch {
                    // Expected to fail due to invalid status port
                }
            }
        );

        await rm(root, { recursive: true, force: true });

        assert.equal(runtimeServerStopped, true, "Runtime server should be stopped when status server fails to start");
    });
});
