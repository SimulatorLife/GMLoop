/**
 * Tests for the live-reload session-startup resource-leak fix.
 *
 * # The Leak
 *
 * `startManagedLiveReloadSession` opens a session log via `fs.open(path, "a")`
 * and immediately passes the resulting `log.fd` to a detached child via
 * `spawn({ stdio })`. The parent's `FileHandle` is then closed after `spawn`
 * returns. The original implementation only had a single `try/finally` around
 * the lock-file cleanup, so any synchronous failure of `spawn` (or its
 * downstream `child.unref()` call) would skip the `await log.close()` and
 * strand the parent-side file descriptor until the next GC cycle.
 *
 * # The Fix
 *
 * The log `FileHandle` is now wrapped in a dedicated `try/finally` that
 * guarantees `log.close()` runs on every code path. The lock-file cleanup is
 * unchanged. The function also accepts an injectable `spawnFn` so the failure
 * path can be exercised without spawning real workers.
 *
 * These tests assert both observable guarantees:
 *   1. The function rejects with the error raised by the failed `spawn`.
 *   2. The lock file is removed after the failure (no half-started state).
 *   3. The parent process does NOT accumulate additional open file
 *      descriptors as a result of the failed startup, so the next attempt
 *      starts from a clean baseline. On platforms without `/proc/self/fd`
 *      (e.g. Windows) the test is skipped to keep the suite portable.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { startManagedLiveReloadSession } from "../src/modules/live-reload/session-controller.js";

async function createTemporaryGameMakerProject(): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-live-reload-leak-"));
    await writeFile(
        path.join(projectRoot, "Game.yyp"),
        `${JSON.stringify({ name: "Game", resourceType: "GMProject", resources: [] }, null, 2)}\n`,
        "utf8"
    );
    return projectRoot;
}

async function countOpenFileDescriptors(): Promise<number | null> {
    // `/proc/self/fd` is the most reliable cross-process check on Linux for
    // detecting a parent-side file-descriptor leak. macOS exposes `/dev/fd/`
    // but with stricter permissions in some environments; the test treats
    // either platform's missing directory as a skip signal. Windows has no
    // equivalent, so the test is no-op there.
    if (process.platform !== "linux" && process.platform !== "darwin") {
        return null;
    }
    try {
        const entries = await readdir("/proc/self/fd");
        return entries.length;
    } catch {
        return null;
    }
}

void test("startManagedLiveReloadSession closes the log file handle when spawn fails", async () => {
    const projectRoot = await createTemporaryGameMakerProject();
    const lockPath = path.join(projectRoot, ".gmloop", "live-reload-session.lock");

    try {
        const failingSpawnError = new Error("mock spawn ENOENT");
        const throwingSpawn = (): never => {
            throw failingSpawnError;
        };

        const baselineFdCount = await countOpenFileDescriptors();

        await assert.rejects(
            () =>
                startManagedLiveReloadSession(
                    {
                        forceStart: false,
                        startArguments: [],
                        stop: false,
                        targetPath: projectRoot
                    },
                    "started",
                    throwingSpawn
                ),
            (error: unknown) => error === failingSpawnError
        );

        // Lock file should always be cleaned up, even when the spawn fails.
        // The original single-finally already covered this; the regression
        // here is that the log handle is now also released.
        const lockStillExists = await readdir(path.dirname(lockPath))
            .then((entries) => entries.includes(path.basename(lockPath)))
            .catch(() => false);
        assert.equal(lockStillExists, false, "lock file should be removed after failed startup");

        if (baselineFdCount !== null) {
            // Allow any pending promise callbacks / Node-internal allocations
            // to settle before re-counting. Two microtask flushes is enough
            // for the synchronous spawn throw path; if the GC happens to
            // reclaim a leaked handle later the assertion would still hold.
            for (let index = 0; index < 4; index += 1) {
                await new Promise<void>((resolve) => {
                    setImmediate(resolve);
                });
            }
            const afterFdCount = await countOpenFileDescriptors();
            assert.ok(afterFdCount !== null, "fd count should be available on this platform");
            assert.equal(
                afterFdCount,
                baselineFdCount,
                "open file descriptor count should return to baseline after spawn failure (no log handle leak)"
            );
        }
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("startManagedLiveReloadSession closes the log file handle on repeated spawn failures", async () => {
    // Regression for the most realistic leak scenario: the parent retries the
    // session startup several times in a row (e.g. user spamming `gmloop
    // live-reload session --force-start` while the entrypoint is broken). The
    // pre-fix code leaked one log descriptor per attempt; the fixed version
    // must keep the fd count flat across the whole retry storm.
    const projectRoot = await createTemporaryGameMakerProject();

    try {
        const failingSpawnError = new Error("mock spawn EACCES");
        const throwingSpawn = (): never => {
            throw failingSpawnError;
        };

        const baselineFdCount = await countOpenFileDescriptors();

        const attempts = 5;
        for (let index = 0; index < attempts; index += 1) {
            await assert.rejects(
                () =>
                    startManagedLiveReloadSession(
                        {
                            forceStart: true,
                            startArguments: [],
                            stop: false,
                            targetPath: projectRoot
                        },
                        "started",
                        throwingSpawn
                    ),
                (error: unknown) => error === failingSpawnError
            );
        }

        if (baselineFdCount !== null) {
            for (let index = 0; index < 4; index += 1) {
                await new Promise<void>((resolve) => {
                    setImmediate(resolve);
                });
            }
            const afterFdCount = await countOpenFileDescriptors();
            assert.ok(afterFdCount !== null, "fd count should be available on this platform");
            assert.equal(
                afterFdCount,
                baselineFdCount,
                `open file descriptor count should remain flat across ${String(attempts)} failed startup attempts`
            );
        }
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});
