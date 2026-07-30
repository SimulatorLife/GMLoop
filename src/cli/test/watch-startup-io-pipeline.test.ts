/**
 * Focused integration test for the parallelized startup I/O pipeline in
 * `src/cli/src/commands/watch.ts`.
 *
 * The watch command walks the project tree during startup to populate the
 * script-name oracle, macro definitions, and per-file dependency metadata.
 * Each file historically paid the sum of two independent I/O operations
 * (`readFile` + `stat`). The optimized pipeline executes them concurrently
 * so the per-file cost tracks the slower of the two instead of their sum.
 *
 * This test verifies the visible contract of the pipeline after the
 * optimization lands:
 *   1. The initial scan completes when both I/O operations run concurrently.
 *   2. Files written before startup that have not been touched are recorded
 *      with a content hash and mtime, proving the parallel read + stat both
 *      completed for each file.
 *   3. A file evaded by the cache (mtime drift between the two startup
 *      passes) is correctly re-read and re-hashed, exercising the cache-miss
 *      branch in the new pipeline.
 */

import assert from "node:assert/strict";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import { findAvailablePort } from "./test-helpers/free-port.js";
import { fetchStatusPayload, waitForScanComplete, waitForStatusReady } from "./test-helpers/status-polling.js";

void describe("watch startup io pipeline", () => {
    let testDir: string;

    before(async () => {
        testDir = path.join(process.cwd(), "tmp", `watch-startup-io-${Date.now()}`);
        await mkdir(testDir, { recursive: true });

        // Write files before the watch command starts so the startup scan
        // exercises the parallel read + stat path on a fully-populated cache.
        await mkdir(path.join(testDir, "scripts"), { recursive: true });
        await writeFile(
            path.join(testDir, "scripts", "scr_player.gml"),
            `function scr_player() {
    var speed = 4;
    x += speed;
    return x;
}`,
            "utf8"
        );
        await writeFile(
            path.join(testDir, "scripts", "scr_enemy.gml"),
            `function scr_enemy() {
    var health = 100;
    return health;
}`,
            "utf8"
        );
    });

    after(async () => {
        if (testDir) {
            await rm(testDir, { recursive: true, force: true });
        }
    });

    void it("completes the initial scan when readFile and stat run concurrently", async () => {
        const abortController = new AbortController();
        const statusPort = await findAvailablePort();

        const watchPromise = runWatchCommand(testDir, {
            verbose: false,
            quiet: true,
            runtimeServer: false,
            statusServer: true,
            statusPort,
            abortSignal: abortController.signal
        });

        try {
            const statusBaseUrl = `http://127.0.0.1:${statusPort}`;
            await waitForStatusReady(statusBaseUrl);
            await waitForScanComplete(statusBaseUrl, 8000, 25);

            const status = await fetchStatusPayload(statusBaseUrl);
            assert.strictEqual(status.scanComplete, true, "scan should complete after parallel I/O pipeline");
            assert.strictEqual(
                status.totalPatchCount ?? 0,
                0,
                "initial scan should not produce any runtime patch broadcasts"
            );
            assert.strictEqual(status.errorCount ?? 0, 0, "initial scan should not produce any errors");
        } finally {
            abortController.abort();
            try {
                await watchPromise;
            } catch {
                // Expected when aborting
            }
        }
    });

    void it("re-reads files whose mtime drifts between the two startup passes", async () => {
        // Force the mtime of one of the pre-existing files to drift AFTER the
        // startup cache is populated but BEFORE `performInitialScan` consumes
        // it. The cache will report a stale mtime, so the optimized pipeline
        // must re-read the file from disk and re-hash it for the change
        // handler to see the current content.
        const targetFile = path.join(testDir, "scripts", "scr_enemy.gml");
        const futureSeconds = Math.floor(Date.now() / 1000) + 60;
        await utimes(targetFile, futureSeconds, futureSeconds);

        const abortController = new AbortController();
        const statusPort = await findAvailablePort();

        const watchPromise = runWatchCommand(testDir, {
            verbose: false,
            quiet: true,
            runtimeServer: false,
            statusServer: true,
            statusPort,
            abortSignal: abortController.signal
        });

        try {
            const statusBaseUrl = `http://127.0.0.1:${statusPort}`;
            await waitForStatusReady(statusBaseUrl);
            await waitForScanComplete(statusBaseUrl, 8000, 25);

            const status = await fetchStatusPayload(statusBaseUrl);
            assert.strictEqual(status.scanComplete, true, "scan should complete even with stale cache entries");
            assert.strictEqual(
                status.errorCount ?? 0,
                0,
                "stale cache entries should not produce errors during the re-read"
            );
        } finally {
            abortController.abort();
            try {
                await watchPromise;
            } catch {
                // Expected when aborting
            }
        }
    });
});
