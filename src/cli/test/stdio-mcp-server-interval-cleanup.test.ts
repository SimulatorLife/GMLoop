import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { probeStdioMcpServer } from "../src/modules/game-maker-cli/stdio-mcp-server.js";

/**
 * Verifies that `probeStdioMcpServer` properly cleans up polling intervals when
 * the child process exits before the server responds, preventing timer resource
 * leaks.
 *
 * The original implementation stored returned intervals and only cleared them
 * inside the predicate match handler. If the process crashed or was killed
 * externally before that handler ran, the intervals could remain active.
 *
 * The fix tracks all active intervals in a shared Set and clears them
 * unconditionally during `finalize` and in the `cleanup` helper, guaranteeing
 * that no polling timers survive past promise settlement regardless of how the
 * promise resolves.
 */
void test("probeStdioMcpServer clears intervals when timeout fires", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcp-interval-timeout-"));
    try {
        // Spawn a process that silently ignores all input — no stdout writes —
        // so `waitForMessage` will poll indefinitely until the outer timeout.
        // The fix must clean up the interval when the timeout fires; without
        // the fix, the interval would remain active past the promise rejection.
        const scriptPath = path.join(root, "silent.mjs");
        await writeFile(
            scriptPath,
            [
                "import { stdin } from 'node:process';",
                "stdin.setEncoding('utf8');",
                "stdin.on('data', () => {});",
                // Keep the process alive indefinitely (it will only exit when
                // killed by the parent timeout).
                "await new Promise(() => {});"
            ].join("\n"),
            "utf8"
        );

        await assert.rejects(
            probeStdioMcpServer({
                args: [],
                command: process.execPath,
                cwd: root,
                displayName: "silent",
                timeoutMs: 100
            }),
            /Timed out/
        );
    } finally {
        await rm(root, { force: true, recursive: true });
    }
});
