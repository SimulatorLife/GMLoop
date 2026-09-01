import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import type { StatusServerHandle } from "../src/modules/status/server.js";
import type { PatchWebSocketServer } from "../src/modules/websocket/server.js";
import { withTemporaryProperty } from "./test-helpers/temporary-property.js";

type RuntimeServerStarter = (options: { runtimeRoot: string; verbose?: boolean }) => Promise<{
    url: string;
    origin: string;
    host: string;
    port: number;
    root: string;
    stop: () => Promise<void>;
}>;

function createMockRuntimeServerStarter(onStart: () => void, onStop: () => void): RuntimeServerStarter {
    return async () => {
        onStart();
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
    void it("does not start runtime server when WebSocket server fails to start", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "watch-server-cleanup-"));
        let runtimeServerStarted = false;

        const mockRuntimeServerStarter = createMockRuntimeServerStarter(
            () => {
                runtimeServerStarted = true;
            },
            () => {}
        );

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

        assert.equal(runtimeServerStarted, false, "Runtime server should not start before WebSocket server succeeds");
    });

    void it("does not start runtime server when status server fails to start", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "watch-server-cleanup-status-"));
        let runtimeServerStarted = false;

        const mockRuntimeServerStarter = createMockRuntimeServerStarter(
            () => {
                runtimeServerStarted = true;
            },
            () => {}
        );

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
                        polling: false,
                        verbose: false,
                        quiet: true,
                        websocketServer: true,
                        websocketPort: 0,
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

        assert.equal(runtimeServerStarted, false, "Runtime server should not start before status server succeeds");
    });

    void it("stops the WebSocket, status, and runtime servers when startup fails after they are already listening", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "watch-server-cleanup-late-failure-"));

        // A regular file (not a directory) makes `fs.mkdir(<file>/.gmloop, { recursive: true })`
        // reject with ENOTDIR inside `writeLiveReloadSessionRegistry`, which runs *after* the
        // WebSocket, status, and runtime servers have already started listening.
        const bogusProjectRoot = path.join(root, "not-a-directory");
        await writeFile(bogusProjectRoot, "not a directory", "utf8");

        let runtimeServerStopped = false;
        const mockRuntimeServerStarter = createMockRuntimeServerStarter(
            () => {},
            () => {
                runtimeServerStopped = true;
            }
        );

        let websocketServerController: PatchWebSocketServer | null = null;
        let statusServerController: StatusServerHandle | null = null;

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
                        polling: false,
                        verbose: false,
                        quiet: true,
                        websocketServer: true,
                        websocketPort: 0,
                        statusServer: true,
                        statusPort: 0,
                        runtimeServer: true,
                        runtimeRoot: root,
                        runtimeServerStarter: mockRuntimeServerStarter,
                        onWebSocketServerReady: (server) => {
                            websocketServerController = server;
                        },
                        onStatusServerReady: (server) => {
                            statusServerController = server;
                        },
                        liveReloadSession: {
                            projectRoot: bogusProjectRoot,
                            sessionId: "watch-server-cleanup-late-failure",
                            startSource: "cli",
                            yypPath: null
                        }
                    });
                    assert.fail("runWatchCommand should have failed once the session-registry write rejected");
                } catch (error) {
                    // Expected: process.exit is stubbed to throw instead of terminating the test.
                    assert.match(String(error), /process\.exit called/);
                }
            }
        );

        assert.ok(websocketServerController, "WebSocket server should have started before the failure");
        assert.ok(statusServerController, "Status server should have started before the failure");
        assert.equal(runtimeServerStopped, true, "Runtime server should be stopped after the late startup failure");

        await assertServerNotListening(statusServerController.url);
        await assertServerNotListening(websocketServerController.url);

        await rm(root, { recursive: true, force: true });
    });
});

/** Assert that nothing is listening on the host/port encoded in `serverUrl`. */
async function assertServerNotListening(serverUrl: string): Promise<void> {
    const { hostname, port } = new URL(serverUrl);

    await new Promise<void>((resolve, reject) => {
        const socket = net.connect({ host: hostname, port: Number(port) });
        socket.once("connect", () => {
            socket.destroy();
            reject(new Error(`Expected no listener at ${serverUrl}, but a connection succeeded.`));
        });
        socket.once("error", () => {
            // Connection refused (or similar) confirms the server was actually stopped.
            resolve();
        });
    });
}
