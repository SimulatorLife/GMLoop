/**
 * Tests for the pure helpers exposed by
 * `src/cli/src/commands/watch/file-change-handler.ts`.
 *
 * These tests focus on the helpers that can be exercised without standing
 * up the full watch command: the `isRoomResourcePath` predicate,
 * `readFileStats` / `updateFileSnapshot` I/O wrappers, and the
 * `scanComplete` short-circuit in `scheduleUnknownFileChanges`.
 *
 * Coverage for the higher-level `handleFileChange` /
 * `handleUnknownFileChanges` flows already exists under
 * `watch-file-read-error.test.ts`, `watch-unknown-change.test.ts`, and
 * related integration tests, which drive the helpers through the full
 * `runWatchCommand` orchestration.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
    type FileChangeRuntimeContext,
    isRoomResourcePath,
    readFileStats,
    scheduleUnknownFileChanges,
    updateFileSnapshot
} from "../src/commands/watch/file-change-handler.js";

void describe("watch/file-change-handler isRoomResourcePath", () => {
    void it("returns true for paths inside a rooms/ directory", () => {
        assert.equal(isRoomResourcePath("/project/rooms/rm_a/rm_a.yy"), true);
        assert.equal(isRoomResourcePath(path.normalize("/project/rooms/sub/rm_b.yy")), true);
    });

    void it("returns false for paths outside a rooms/ directory", () => {
        assert.equal(isRoomResourcePath("/project/scripts/foo.gml"), false);
        assert.equal(isRoomResourcePath("/project/objects/obj_player/Step_0.gml"), false);
        assert.equal(isRoomResourcePath("/project/random.gml"), false);
    });
});

void describe("watch/file-change-handler readFileStats", () => {
    void it("returns null for paths that do not exist", async () => {
        const stats = await readFileStats(path.join(tmpdir(), `definitely-missing-${Date.now()}`));
        assert.equal(stats, null);
    });

    void it("returns stats for existing files", async () => {
        const directory = await mkdtemp(path.join(tmpdir(), "watch-file-stats-"));
        try {
            const filePath = path.join(directory, "exists.gml");
            await writeFile(filePath, "// exists\n", "utf8");
            const stats = await readFileStats(filePath);
            assert.ok(stats !== null, "stats should be returned for existing files");
            assert.equal(stats.isFile(), true);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});

void describe("watch/file-change-handler updateFileSnapshot", () => {
    void it("writes the mtime for an existing file", async () => {
        const directory = await mkdtemp(path.join(tmpdir(), "watch-snapshot-update-"));
        try {
            const filePath = path.join(directory, "foo.gml");
            await writeFile(filePath, "// content\n", "utf8");
            const snapshots = new Map<string, number>();

            await updateFileSnapshot({ fileSnapshots: snapshots }, filePath);

            assert.ok(snapshots.has(filePath), "snapshot entry should be created");
            assert.equal(typeof snapshots.get(filePath), "number");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    void it("removes the snapshot when stat fails", async () => {
        const snapshots = new Map<string, number>([["/missing/path.gml", 123]]);
        await updateFileSnapshot({ fileSnapshots: snapshots }, "/missing/path.gml");
        assert.equal(snapshots.has("/missing/path.gml"), false);
    });
});

void describe("watch/file-change-handler scheduleUnknownFileChanges", () => {
    void it("returns a no-op promise when the initial scan has not completed", () => {
        const runtimeContext = createFakeRuntimeContext({ scanComplete: false });
        const promise = scheduleUnknownFileChanges(runtimeContext);
        assert.equal(promise instanceof Promise, true);
        // The promise should resolve immediately without scheduling any work.
        runtimeContext.unknownScanPromise = null;
        runtimeContext.unknownScanDetectedAt = null;
    });

    void it("coalesces concurrent calls into a single in-flight scan", async () => {
        const directory = await mkdtemp(path.join(tmpdir(), "watch-schedule-coalesce-"));
        try {
            await mkdir(path.join(directory, "scripts"), { recursive: true });
            await writeFile(path.join(directory, "scripts", "a.gml"), "// a\n", "utf8");

            const runtimeContext = createFakeRuntimeContext({ scanComplete: true, watchRoot: directory });
            const firstPromise = scheduleUnknownFileChanges(runtimeContext);
            assert.ok(firstPromise !== undefined, "first call should return a promise");

            // While the first scan is in-flight, the second call should observe
            // the queued state.
            const secondPromise = scheduleUnknownFileChanges(runtimeContext);
            assert.equal(runtimeContext.unknownScanQueued, true);

            await firstPromise;
            await secondPromise;
            assert.equal(runtimeContext.unknownScanPromise, null, "scan promise should be cleared after completion");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});

function createFakeRuntimeContext(overrides: Partial<FileChangeRuntimeContext> = {}): FileChangeRuntimeContext {
    return {
        roomResources: new Map(),
        fileSnapshots: new Map(),
        fileContentHashes: new Map(),
        fileContentLengths: new Map(),
        scriptNames: new Set(),
        resourcePatches: new Map(),
        totalPatchCount: 0,
        websocketServer: null,
        debouncedHandlers: new Map(),
        lastSuccessfulPatches: new Map(),
        sourcePathToPatchIds: new Map(),
        macroDefinitionsBySourcePath: new Map(),
        macroDefinitions: new Map(),
        watchRoot: "/tmp",
        extensionMatcher: { extensions: new Set([".gml"]), matches: () => false },
        maxConcurrentDirs: 2,
        transientEmptyFileReadRetryCount: 1,
        transientEmptyFileReadRetryDelayMs: 1,
        unknownScanConcurrency: 1,
        unknownScanPromise: null,
        unknownScanQueued: false,
        unknownScanDetectedAt: null,
        scanComplete: true,
        verbose: false,
        quiet: true,
        ...overrides
    };
}
