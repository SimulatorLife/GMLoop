/**
 * Test suite for watch command quiet mode.
 *
 * Verifies that the --quiet flag properly suppresses non-essential output
 * while keeping errors and server URLs visible.
 */

import assert from "node:assert";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it, mock } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import { findAvailablePort } from "./test-helpers/free-port.js";
import { withTemporaryProperty } from "./test-helpers/temporary-property.js";
import { connectToHotReloadWebSocket } from "./test-helpers/websocket-client.js";

async function runQuietVerboseConflictWatchCommand(testDir: string): Promise<void> {
    await runWatchCommand(testDir, {
        extensions: [".gml"],
        quiet: true,
        verbose: true,
        runtimeServer: false,
        websocketServer: false
    }).catch(() => {
        // Expected to throw from mocked process.exit.
    });
}

void describe("Watch command quiet mode", () => {
    let testDir: string;
    let testFile: string;

    before(async () => {
        testDir = path.join(process.cwd(), "tmp", `test-watch-quiet-${Date.now()}`);
        await mkdir(testDir, { recursive: true });
        testFile = path.join(testDir, "test_script.gml");
        await writeFile(testFile, "var x = 10;", "utf8");
    });

    after(async () => {
        if (testDir) {
            await rm(testDir, { recursive: true, force: true });
        }
    });

    void it("should start successfully with --quiet flag", async () => {
        const websocketPort = await findAvailablePort();
        const abortController = new AbortController();
        const logMessages: Array<string> = [];
        const restoreLog = mock.method(console, "log", (...args) => {
            logMessages.push(args.join(" "));
        });

        const watchPromise = runWatchCommand(testDir, {
            extensions: [".gml"],
            quiet: true,
            verbose: false,
            runtimeServer: false,
            websocketServer: true,
            websocketPort,
            statusServer: false,
            abortSignal: abortController.signal
        });

        let websocketClient: Awaited<ReturnType<typeof connectToHotReloadWebSocket>> | null = null;

        try {
            websocketClient = await connectToHotReloadWebSocket(`ws://127.0.0.1:${websocketPort}`, {
                connectionTimeoutMs: 1200,
                retryIntervalMs: 25
            });
        } finally {
            // Stop the watcher
            abortController.abort();

            if (websocketClient) {
                await websocketClient.disconnect();
            }

            restoreLog.mock.restore();
            await watchPromise;
        }

        // If we get here without errors, the test passes
        assert.ok(true, "Watch command started and stopped successfully in quiet mode");
        assert.ok(
            logMessages.some((line) =>
                line.includes(`WebSocket patch server ready at ws://127.0.0.1:${websocketPort}`)
            ),
            "Quiet mode should still log WebSocket server URLs"
        );
    });

    void it("should reject both --verbose and --quiet together", async () => {
        const capturedErrors: Array<string> = [];
        let exitCode: number | undefined;

        await withTemporaryProperty(
            console,
            "error",
            (message: string, ...args: Array<unknown>): void => {
                capturedErrors.push(String(message));
                if (args.length > 0) {
                    capturedErrors.push(...args.map(String));
                }
            },
            () =>
                withTemporaryProperty(
                    process,
                    "exit",
                    (code?: number) => {
                        exitCode = code;
                        throw new Error("process.exit called");
                    },
                    () => runQuietVerboseConflictWatchCommand(testDir)
                )
        );

        assert.strictEqual(exitCode, 1, "Should exit with code 1");
        assert.ok(
            capturedErrors.some((line) => line.includes("--verbose and --quiet cannot be used together")),
            "Should show error message about conflicting flags"
        );
    });
});
