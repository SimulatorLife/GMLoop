import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { __test__ } from "../src/cli.js";
import { DEFAULT_MAX_IN_MEMORY_SNAPSHOTS } from "../src/runtime-options/format-memory-constants.js";

const {
    getMemoryManagementStatsForTests,
    setInMemorySnapshotCountForTests,
    setProcessedFileCountForTests,
    addFormattedFileSnapshotForTests,
    clearFormattedFileSnapshotsForTests,
    enforceSnapshotMemoryLimitForTests,
    performPeriodicMemoryCleanupForTests,
    clearFormattingCacheForTests,
    getFormattingCacheStatsForTests,
    setFormattingCacheEntryForTests,
    setDefaultMaxInMemorySnapshotsForTests
} = __test__;

afterEach(() => {
    setDefaultMaxInMemorySnapshotsForTests(DEFAULT_MAX_IN_MEMORY_SNAPSHOTS);
});

void describe("memory snapshot limits", () => {
    beforeEach(() => {
        clearFormattedFileSnapshotsForTests();
        clearFormattingCacheForTests();
        setProcessedFileCountForTests(0);
    });

    void it("enforces MAX_IN_MEMORY_SNAPSHOTS limit", async () => {
        const { maxInMemorySnapshots } = getMemoryManagementStatsForTests();

        // Add snapshots up to the limit
        for (let i = 0; i < maxInMemorySnapshots; i++) {
            addFormattedFileSnapshotForTests(`file-${i}.gml`, `contents-${i}`, null);
        }

        const statsAtLimit = getMemoryManagementStatsForTests();
        assert.equal(statsAtLimit.inMemorySnapshotCount, maxInMemorySnapshots);
        assert.equal(statsAtLimit.formattedFileOriginalContentsSize, maxInMemorySnapshots);

        // Add one more snapshot beyond the limit
        addFormattedFileSnapshotForTests(`file-overflow.gml`, "overflow-contents", null);
        setInMemorySnapshotCountForTests(maxInMemorySnapshots + 1);

        const statsBeforeEnforce = getMemoryManagementStatsForTests();
        assert.equal(statsBeforeEnforce.inMemorySnapshotCount, maxInMemorySnapshots + 1);

        // Enforce the limit - should release the oldest snapshot
        await enforceSnapshotMemoryLimitForTests();

        const statsAfterEnforce = getMemoryManagementStatsForTests();
        assert.ok(
            statsAfterEnforce.inMemorySnapshotCount <= maxInMemorySnapshots,
            `in-memory snapshot count should be at or below ${maxInMemorySnapshots} after enforcement (saw ${statsAfterEnforce.inMemorySnapshotCount})`
        );
    });

    void it("supports tuning the in-memory snapshot limit", async () => {
        setDefaultMaxInMemorySnapshotsForTests(3);

        for (let i = 0; i < 5; i++) {
            addFormattedFileSnapshotForTests(`custom-limit-${i}.gml`, `contents-${i}`, null);
        }
        setInMemorySnapshotCountForTests(5);

        await enforceSnapshotMemoryLimitForTests();

        const statsAfter = getMemoryManagementStatsForTests();
        assert.equal(statsAfter.maxInMemorySnapshots, 3);
        assert.ok(statsAfter.inMemorySnapshotCount <= 3);
    });

    void it("tracks in-memory snapshot count correctly", () => {
        // Start with zero snapshots
        let stats = getMemoryManagementStatsForTests();
        assert.equal(stats.inMemorySnapshotCount, 0);

        // Add an in-memory snapshot
        addFormattedFileSnapshotForTests("file1.gml", "in-memory-contents", null);
        stats = getMemoryManagementStatsForTests();
        assert.equal(stats.inMemorySnapshotCount, 1);

        // Add a disk-backed snapshot (should not increment counter)
        addFormattedFileSnapshotForTests("file2.gml", null, "/tmp/snapshot-path");
        stats = getMemoryManagementStatsForTests();
        assert.equal(stats.inMemorySnapshotCount, 1, "disk-backed snapshots should not increment counter");

        // Add another in-memory snapshot
        addFormattedFileSnapshotForTests("file3.gml", "more-contents", null);
        stats = getMemoryManagementStatsForTests();
        assert.equal(stats.inMemorySnapshotCount, 2);
    });

    void it("enforceSnapshotMemoryLimit releases oldest in-memory snapshots first", async () => {
        const { maxInMemorySnapshots } = getMemoryManagementStatsForTests();

        // Add in-memory snapshots beyond the limit
        for (let i = 0; i < maxInMemorySnapshots + 5; i++) {
            addFormattedFileSnapshotForTests(`memory-file-${i}.gml`, `contents-${i}`, null);
        }

        // Also add some disk-backed snapshots (these should NOT be deleted)
        for (let i = 0; i < 5; i++) {
            addFormattedFileSnapshotForTests(`disk-file-${i}.gml`, null, `/tmp/snapshot-${i}`);
        }

        const statsBefore = getMemoryManagementStatsForTests();
        assert.equal(statsBefore.inMemorySnapshotCount, maxInMemorySnapshots + 5);
        const totalSnapshotsBefore = statsBefore.formattedFileOriginalContentsSize;

        // Enforce limit - should release the 5 oldest in-memory snapshots
        await enforceSnapshotMemoryLimitForTests();

        const statsAfter = getMemoryManagementStatsForTests();
        assert.ok(
            statsAfter.inMemorySnapshotCount <= maxInMemorySnapshots,
            `in-memory snapshot count should be at or below ${maxInMemorySnapshots} after enforcement (saw ${statsAfter.inMemorySnapshotCount})`
        );
        assert.ok(
            statsAfter.formattedFileOriginalContentsSize < totalSnapshotsBefore,
            `should have fewer total snapshots after enforcement (before: ${totalSnapshotsBefore}, after: ${statsAfter.formattedFileOriginalContentsSize})`
        );
    });

    void it("releases inline snapshots even when old disk snapshots appear first", async () => {
        const { maxInMemorySnapshots } = getMemoryManagementStatsForTests();

        for (let i = 0; i < 500; i++) {
            addFormattedFileSnapshotForTests(`disk-only-${i}.gml`, null, `/tmp/disk-only-${i}`);
        }

        for (let i = 0; i < maxInMemorySnapshots + 5; i++) {
            addFormattedFileSnapshotForTests(`inline-${i}.gml`, "x".repeat(4096), null);
        }

        const statsBefore = getMemoryManagementStatsForTests();
        assert.equal(statsBefore.inMemorySnapshotCount, maxInMemorySnapshots + 5);
        assert.ok(statsBefore.inlineSnapshotBytes > 0, "expected inline snapshot bytes before eviction");

        await enforceSnapshotMemoryLimitForTests();

        const statsAfter = getMemoryManagementStatsForTests();
        assert.equal(
            statsAfter.inMemorySnapshotCount,
            maxInMemorySnapshots,
            "limit enforcement should evict only the overflow inline snapshots"
        );
        assert.equal(
            statsBefore.inlineSnapshotBytes - statsAfter.inlineSnapshotBytes,
            5 * 4096 * 2,
            "eviction should reclaim exactly five UTF-16 inline snapshot buffers"
        );
    });

    void it("does not enforce limit when below MAX_IN_MEMORY_SNAPSHOTS", async () => {
        const { maxInMemorySnapshots } = getMemoryManagementStatsForTests();

        // Add snapshots below the limit
        for (let i = 0; i < maxInMemorySnapshots - 10; i++) {
            addFormattedFileSnapshotForTests(`file-${i}.gml`, `contents-${i}`, null);
        }

        const statsBefore = getMemoryManagementStatsForTests();
        const countBefore = statsBefore.inMemorySnapshotCount;

        // Enforce limit (should be a no-op)
        await enforceSnapshotMemoryLimitForTests();

        const statsAfter = getMemoryManagementStatsForTests();
        assert.equal(statsAfter.inMemorySnapshotCount, countBefore, "should not change count when below limit");
    });
});

void describe("periodic memory cleanup", () => {
    beforeEach(() => {
        clearFormattedFileSnapshotsForTests();
        clearFormattingCacheForTests();
        setProcessedFileCountForTests(0);
    });

    void it("trims formatting cache during cleanup instead of clearing completely", () => {
        // Populate the cache with more entries than the trim target
        for (let i = 0; i < 10; i++) {
            setFormattingCacheEntryForTests(`key-${i}`, `formatted-${i}`);
        }

        const statsBefore = getFormattingCacheStatsForTests();
        assert.equal(statsBefore.size, 10);

        // Perform cleanup - should trim to 5 entries instead of clearing completely
        performPeriodicMemoryCleanupForTests();

        const statsAfter = getFormattingCacheStatsForTests();
        assert.equal(statsAfter.size, 5, "cache should be trimmed to 5 entries after cleanup, not cleared");
    });

    void it("tracks processed file count", () => {
        const { periodicCleanupInterval } = getMemoryManagementStatsForTests();

        setProcessedFileCountForTests(0);
        let stats = getMemoryManagementStatsForTests();
        assert.equal(stats.processedFileCount, 0);

        setProcessedFileCountForTests(25);
        stats = getMemoryManagementStatsForTests();
        assert.equal(stats.processedFileCount, 25);

        setProcessedFileCountForTests(periodicCleanupInterval);
        stats = getMemoryManagementStatsForTests();
        assert.equal(stats.processedFileCount, periodicCleanupInterval);
    });

    void it("verifies PERIODIC_CLEANUP_INTERVAL is set correctly", () => {
        const { periodicCleanupInterval } = getMemoryManagementStatsForTests();
        assert.equal(periodicCleanupInterval, 10, "periodic cleanup should trigger every 10 files");
    });
});

void describe("formatting cache memory limits", () => {
    beforeEach(() => {
        clearFormattingCacheForTests();
    });

    void it("verifies reduced MAX_FORMATTING_CACHE_ENTRIES (10)", () => {
        const { maxEntries } = getFormattingCacheStatsForTests();
        assert.equal(maxEntries, 10, "cache should be limited to 10 entries to prevent memory exhaustion");
    });

    void it("evicts oldest entries when cache exceeds limit", () => {
        const { maxEntries } = getFormattingCacheStatsForTests();

        // Fill cache beyond limit
        for (let i = 0; i < maxEntries + 5; i++) {
            setFormattingCacheEntryForTests(`key-${i}`, `formatted-${i}`);
        }

        const stats = getFormattingCacheStatsForTests();
        assert.ok(stats.size <= maxEntries, `cache should stay at or below ${maxEntries} entries (saw ${stats.size})`);
    });
});

void describe("memory management constants", () => {
    void it("validates MAX_IN_MEMORY_SNAPSHOTS is set to 50", () => {
        const { maxInMemorySnapshots } = getMemoryManagementStatsForTests();
        assert.equal(maxInMemorySnapshots, 50, "in-memory snapshot limit should be 50 to prevent unbounded growth");
    });

    void it("validates all memory management constants are reasonable", () => {
        const { maxInMemorySnapshots, periodicCleanupInterval } = getMemoryManagementStatsForTests();
        const { maxEntries } = getFormattingCacheStatsForTests();

        assert.ok(maxInMemorySnapshots > 0, "snapshot limit must be positive");
        assert.ok(maxInMemorySnapshots <= 100, "snapshot limit should be reasonable");
        assert.ok(periodicCleanupInterval > 0, "cleanup interval must be positive");
        assert.ok(periodicCleanupInterval <= 100, "cleanup interval should be reasonable");
        assert.ok(maxEntries > 0, "cache size must be positive");
        assert.ok(maxEntries <= 50, "cache size should be conservative to prevent OOM");
    });
});
