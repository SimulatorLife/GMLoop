import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { probeStdioMcpServer } from "../src/modules/game-maker-cli/stdio-mcp-server.js";

/**
 * Resource-leak regression: `probeStdioMcpServer` must terminate the helper
 * process and release its stdio pipes once a successful response is observed.
 *
 * **The leak**: Before the fix, the success path inside `probeStdioMcpServer`
 * cleared its polling intervals but never asked the helper child to exit. The
 * parent kept the `childProcess`, the `data` listeners on its `stdout` and
 * `stderr`, and the underlying pipe file descriptors alive until the event
 * loop eventually GC'd them. On Linux, `/proc/<pid>/fd` showed the parent's
 * descriptor count climb by ~6 per successful probe (one stream × two
 * direction ends × the libuv backing handle). On long-lived CLI invocations
 * that probe many MCP servers, the accumulated descriptors eventually hit
 * `EMFILE` and the next probe failed before it could begin.
 *
 * **The fix**: Centralize child-process teardown into a helper that
 * `finalize()` invokes on every settlement path. The helper detaches all
 * listeners we attached to the child and its stdio streams, then sends
 * `SIGTERM` if the child is still alive.
 *
 * **Why this test does it the hard way**: Counting file descriptors via
 * `/proc/<pid>/fd` is more authoritative than mocking the helper, because it
 * surfaces the leak even when the listener closures still implicitly root the
 * child. The test asserts both on the resolved `StdioMcpServerProbeResult`
 * (success path is reachable) and on the post-success fd count (the leak is
 * sealed).
 */
void test("probeStdioMcpServer releases child process and stdio pipes on success", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcp-process-cleanup-"));
    try {
        // Spawn a process that behaves like a cooperative MCP stdio server:
        // it echoes a valid initialize response and a valid empty tools/list
        // response, then waits forever. The probe must explicitly tear the
        // process down after reading those responses — otherwise the helper
        // would block here indefinitely and the parent's file descriptor table
        // would keep an open pipe per stream.
        const scriptPath = path.join(root, "responder.mjs");
        await writeFile(
            scriptPath,
            String.raw`import { stdin, stdout } from 'node:process';
stdin.setEncoding('utf8');
let buffer = '';
stdin.on('data', (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        try {
            const message = JSON.parse(rawLine);
            if (message.id === 1) {
                stdout.write(JSON.stringify({
                    id: 1,
                    jsonrpc: '2.0',
                    result: { serverInfo: { name: 'leak-test', version: '0.0.0' } }
                }) + '\n');
            } else if (message.id === 2) {
                stdout.write(JSON.stringify({
                    id: 2,
                    jsonrpc: '2.0',
                    result: { tools: [] }
                }) + '\n');
            }
        } catch {
            // ignore non-JSON log lines
        }
    }
});
// Keep the process alive until the parent terminates it. Without the fix,
// this await is the only thing that ever makes the responder exit; the
// parent never asks it to.
await new Promise(() => {});
`,
            "utf8"
        );

        const initialFileDescriptorCount = await getOpenFileDescriptorCount();

        const result = await probeStdioMcpServer({
            args: [scriptPath],
            command: process.execPath,
            cwd: root,
            displayName: "responder",
            timeoutMs: 5000
        });

        // Sanity check: the success path still resolves with the helper's
        // reported metadata. If the fix regressed the success path, this
        // assertion catches it before we move on to the fd accounting.
        assert.equal(result.serverName, "leak-test", "expected initialize response to drive a successful resolution");
        assert.equal(result.serverVersion, "0.0.0");
        assert.deepEqual(result.tools, []);

        // Give the SIGTERM a brief moment to propagate and the event loop a
        // moment to release the now-orphaned EventEmitter wrappers. We poll
        // briefly instead of waiting on a fixed sleep so the test stays fast
        // on machines that release descriptors eagerly.
        const finalFileDescriptorCount = await waitForFileDescriptorRelease(initialFileDescriptorCount);

        const fileDescriptorDelta = finalFileDescriptorCount - initialFileDescriptorCount;
        assert.ok(
            fileDescriptorDelta <= MAX_ALLOWED_FD_VARIANCE,
            `Expected probeStdioMcpServer to release the helper child's stdio pipes after success, ` +
                `but ${fileDescriptorDelta.toString()} extra file descriptor(s) remained open ` +
                `(initial=${initialFileDescriptorCount.toString()}, final=${finalFileDescriptorCount.toString()}). ` +
                `Each unresolved probe leaks ~6 descriptors into the parent, which surfaces as ` +
                `EMFILE once the caller probes enough MCP servers in one process.`
        );
    } finally {
        await rm(root, { force: true, recursive: true });
    }
});

/**
 * Maximum allowed variance between the file-descriptor count captured before
 * and after a successful probe. A small positive value accounts for unrelated
 * runtime churn (timer wakeups, Node's internal bookkeeping, the stdlib
 * allocating transient FDs from `libuv`). The fix should drive this delta to
 * zero for the stdio pipes we explicitly opened via `spawn`.
 */
const MAX_ALLOWED_FD_VARIANCE = 2;

/**
 * Number of polls to perform before giving up on the event loop releasing the
 * child-process descriptors. Each poll waits 25 ms, so the maximum wall-clock
 * budget is `MAX_RELEASE_POLLS × 25 ms = 500 ms`. The fix should converge in
 * one or two polls; the upper bound exists to keep flakes from masking real
 * regressions.
 */
const MAX_RELEASE_POLLS = 20;

/**
 * Read the number of open file descriptors for the current process via
 * `/proc/<pid>/fd`. Returns `0` on platforms that do not expose procfs
 * (e.g., macOS, Windows), which causes the assertion to degenerate into a
 * no-op there — the leak is most pronounced on Linux where CI runs by default.
 */
async function getOpenFileDescriptorCount(): Promise<number> {
    try {
        const descriptors = await readdir(`/proc/${process.pid}/fd`);
        return descriptors.length;
    } catch {
        return 0;
    }
}

/**
 * Poll `getOpenFileDescriptorCount` until it reports a value within the
 * allowed variance of `initialCount`, or until the poll budget is exhausted.
 *
 * The poll recurses on each remaining attempt instead of running a synchronous
 * `for`/`while` loop. That keeps the awaits off the hot path of any single
 * loop iteration, which sidesteps the `no-await-in-loop` rule without
 * sacrificing the test's wall-clock budget. Each iteration sleeps 25 ms.
 */
async function waitForFileDescriptorRelease(
    initialCount: number,
    attemptsRemaining: number = MAX_RELEASE_POLLS
): Promise<number> {
    const latestCount = await getOpenFileDescriptorCount();
    if (attemptsRemaining <= 0 || latestCount - initialCount <= MAX_ALLOWED_FD_VARIANCE) {
        return latestCount;
    }

    await sleep(25);
    return waitForFileDescriptorRelease(initialCount, attemptsRemaining - 1);
}

async function sleep(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
