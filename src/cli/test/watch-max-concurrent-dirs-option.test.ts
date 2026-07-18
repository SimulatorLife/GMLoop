/**
 * Tests for the watch command --max-concurrent-dirs option.
 *
 * The runtime test ("respects low max-concurrent-dirs values while completing
 * initial scan") previously started the status server on a port obtained from
 * `findAvailablePort()`. That helper has a known time-of-check / time-of-use
 * (TOCTOU) race:
 *
 *   1. It binds a listener to port 0 to let the kernel pick a free port.
 *   2. It reads the assigned port, closes the listener, and returns the port
 *      number.
 *   3. Between the close and the test calling `runWatchCommand(..., { statusPort })`,
 *      another process (typically another test in the same pnpm run) can bind
 *      the same port.
 *   4. The watch command then fails to start its status server with
 *      `EADDRINUSE`, which surfaces as a sporadic `Error: Port ${port} already
 *      in use` failure with no deterministic reproduction.
 *
 * The fix is to skip the preflight probe entirely: pass `statusPort: 0` to the
 * watch command (so the kernel assigns an ephemeral port when the status
 * server starts) and read the actual port back through the
 * `onStatusServerReady` hook. The same pattern is already used by
 * `hot-reload-integration.test.ts` and `watch-ignored-generated-directories.test.ts`.
 */

import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { createWatchCommand, runWatchCommand } from "../src/commands/watch.js";
import type { StatusServerHandle } from "../src/modules/status/server.js";
import { fetchStatusPayload, waitForScanComplete } from "./test-helpers/status-polling.js";

/**
 * Start a watch command for `projectRoot` and resolve with both the status
 * server base URL (e.g. `http://127.0.0.1:43211`) and the running promise.
 *
 * The status server is bound to an OS-assigned ephemeral port (`statusPort: 0`)
 * and the real URL is reported through `onStatusServerReady`; the small polling
 * loop simply waits for that hook to fire so callers can await a known URL.
 */
async function startWatchCommandWithStatusServer(
    projectRoot: string,
    abortController: AbortController
): Promise<{ statusBaseUrl: string; watchPromise: Promise<unknown> }> {
    let statusBaseUrl = "";
    const watchPromise = runWatchCommand(projectRoot, {
        abortSignal: abortController.signal,
        maxConcurrentDirs: 1,
        onStatusServerReady: (server: StatusServerHandle) => {
            statusBaseUrl = server.url.replace(/\/status$/u, "");
        },
        quiet: true,
        runtimeServer: false,
        statusPort: 0,
        statusServer: true,
        verbose: false,
        websocketServer: false
    });

    // The hook is invoked synchronously from the status server start path,
    // but the assignment to `statusBaseUrl` is scheduled on the event loop.
    // Poll briefly to give it a chance to fire; this is bounded and only
    // depends on the event loop, not on a real-time duration.
    const deadline = Date.now() + 5000;
    while (statusBaseUrl.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => {
            setTimeout(resolve, 25);
        });
    }

    assert.notEqual(statusBaseUrl, "", "status server URL should resolve via onStatusServerReady");
    return { statusBaseUrl, watchPromise };
}

void describe("watch command max-concurrent-dirs option", () => {
    void it("should have max-concurrent-dirs option", () => {
        const command = createWatchCommand();
        const maxConcurrentDirsOption = command.options.find((opt) => opt.long === "--max-concurrent-dirs");

        assert.ok(maxConcurrentDirsOption, "Should have --max-concurrent-dirs option");
        assert.equal(maxConcurrentDirsOption.defaultValue, 4, "Default max concurrent directories should be 4");
    });

    void it("should have max-concurrent-dirs with correct description", () => {
        const command = createWatchCommand();
        const maxConcurrentDirsOption = command.options.find((opt) => opt.long === "--max-concurrent-dirs");

        assert.ok(maxConcurrentDirsOption, "Should have --max-concurrent-dirs option");
        assert.ok(
            maxConcurrentDirsOption.description.includes("Maximum number of directories"),
            "Should have descriptive help text"
        );
        assert.ok(
            maxConcurrentDirsOption.description.includes("initial file discovery"),
            "Should mention initial file discovery"
        );
    });

    void it("respects low max-concurrent-dirs values while completing initial scan", async () => {
        const fixtureDir = path.join(process.cwd(), "tmp", `watch-max-concurrent-dirs-${Date.now()}`);
        await mkdir(fixtureDir, { recursive: true });

        const nestedDirectories = ["a", "a/b", "a/b/c", "d", "d/e", "d/e/f"];
        await Promise.all(
            nestedDirectories.map(async (relativePath) =>
                mkdir(path.join(fixtureDir, relativePath), { recursive: true })
            )
        );

        const gmlFiles = [
            "root_script.gml",
            "a/alpha.gml",
            "a/b/beta.gml",
            "a/b/c/gamma.gml",
            "d/delta.gml",
            "d/e/f/epsilon.gml"
        ];
        await Promise.all(
            gmlFiles.map(async (relativePath) =>
                writeFile(path.join(fixtureDir, relativePath), "var value = 1;", "utf8")
            )
        );

        const abortController = new AbortController();
        const { statusBaseUrl, watchPromise } = await startWatchCommandWithStatusServer(fixtureDir, abortController);

        try {
            await waitForScanComplete(statusBaseUrl, 10_000, 25);
            const status = await fetchStatusPayload(statusBaseUrl);
            assert.equal(status.scanComplete, true, "Initial scan should complete");
            assert.strictEqual(status.patchCount, 0, "Initial metadata scan should not emit runtime patches");
        } finally {
            abortController.abort();

            try {
                await watchPromise;
            } catch {
                // Expected when aborting.
            }

            await rm(fixtureDir, { recursive: true, force: true });
        }
    });
});
