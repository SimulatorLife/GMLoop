import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import test from "node:test";

import { createTempFileStorageBackend } from "../src/backends/index.js";

async function overwriteAndReadEntryRepeatedly(
    backend: ReturnType<typeof createTempFileStorageBackend>,
    key: string,
    payload: string,
    overwriteCount: number
): Promise<void> {
    async function runIteration(iteration: number): Promise<void> {
        if (iteration >= overwriteCount) {
            return;
        }

        const content = `${payload}${iteration}`;
        await backend.writeEntry(key, content);
        assert.equal(await backend.readEntry(key), content);
        await runIteration(iteration + 1);
    }

    await runIteration(0);
}

void test("TempFileStorageBackend writes, reads, and deletes entries", async () => {
    const backend = createTempFileStorageBackend({ readCacheMaxEntries: 2 });

    try {
        await backend.writeEntry("alpha", "content-a");
        await backend.writeEntry("beta", "content-b");

        assert.equal(await backend.readEntry("alpha"), "content-a");
        assert.equal(await backend.readEntry("alpha"), "content-a");
        assert.equal(await backend.readEntry("missing"), null);

        await backend.deleteEntry("alpha");
        assert.equal(await backend.readEntry("alpha"), null);

        const stats = backend.getStats();
        assert.ok(stats.writes >= 2);
        assert.ok(stats.reads >= 4);
        assert.ok(stats.cacheHits >= 1);
        assert.ok(stats.cacheMisses >= 1);
    } finally {
        await backend.dispose();
    }
});

void test("TempFileStorageBackend seeds the read cache from writes to avoid reread churn", async () => {
    const backend = createTempFileStorageBackend({ readCacheMaxEntries: 2 });

    try {
        await backend.writeEntry("alpha", "content-a");

        assert.equal(await backend.readEntry("alpha"), "content-a");

        const stats = backend.getStats();
        assert.equal(stats.cacheHits, 1);
        assert.equal(stats.cacheMisses, 0);
    } finally {
        await backend.dispose();
    }
});

void test("TempFileStorageBackend measurement: write-seeded cache avoids repeated spill-file string allocations", async () => {
    const backend = createTempFileStorageBackend({ readCacheMaxEntries: 1 });
    const payload = "payload-".repeat(4096);
    const overwriteCount = 25;

    try {
        await overwriteAndReadEntryRepeatedly(backend, "alpha", payload, overwriteCount);

        const stats = backend.getStats();
        const payloadBytes = Buffer.byteLength(`${payload}${overwriteCount - 1}`, "utf8");
        const historicalColdReadBytes = overwriteCount * payloadBytes;
        const actualColdReadBytes = stats.cacheMisses * payloadBytes;

        assert.equal(stats.cacheMisses, 0);
        assert.equal(stats.cacheHits, overwriteCount);
        assert.ok(
            historicalColdReadBytes > actualColdReadBytes,
            `Expected write-seeded cache to avoid cold spill rereads (historical=${historicalColdReadBytes}, actual=${actualColdReadBytes})`
        );
    } finally {
        await backend.dispose();
    }
});

void test("TempFileStorageBackend isolates keys that sanitize to the same file prefix", async () => {
    const backend = createTempFileStorageBackend({ readCacheMaxEntries: 2 });

    try {
        await backend.writeEntry("scripts/a-b.gml", "first-content");
        await backend.writeEntry("scripts/a?b.gml", "second-content");

        assert.equal(await backend.readEntry("scripts/a-b.gml"), "first-content");
        assert.equal(await backend.readEntry("scripts/a?b.gml"), "second-content");
        assert.equal(backend.getStats().spilledEntries, 2);
    } finally {
        await backend.dispose();
    }
});

void test("TempFileStorageBackend falls back to cache after external spill-file removal and then misses after eviction", async () => {
    const backend = createTempFileStorageBackend({ readCacheMaxEntries: 1 });

    try {
        await backend.writeEntry("external-removal", "payload");
        const backingPath = (backend as unknown as { pathByKey: Map<string, string> }).pathByKey.get(
            "external-removal"
        );

        assert.equal(typeof backingPath, "string");
        await rm(backingPath, { force: true });

        assert.equal(await backend.readEntry("external-removal"), "payload");

        await backend.writeEntry("cache-pressure", "other-payload");
        assert.equal(await backend.readEntry("external-removal"), null);
    } finally {
        await backend.dispose();
    }
});

void test("TempFileStorageBackend rejects writes after disposal", async () => {
    const backend = createTempFileStorageBackend({ readCacheMaxEntries: 2 });

    await backend.dispose();
    await assert.rejects(async () => {
        await backend.writeEntry("after-dispose", "payload");
    }, /cannot write after dispose/i);
});

void test("TempFileStorageBackend returns null for reads after disposal", async () => {
    const backend = createTempFileStorageBackend({ readCacheMaxEntries: 2 });

    await backend.writeEntry("before-dispose", "payload");
    await backend.dispose();

    assert.equal(await backend.readEntry("before-dispose"), null);
});

void test("TempFileStorageBackend dispose cleans up temp directory when mkdtemp is in-flight", async () => {
    const backend = createTempFileStorageBackend({ readCacheMaxEntries: 2 });

    // Start a write that triggers mkdtemp() internally, but do NOT await it
    // yet — this simulates the race where dispose() is called while the
    // directory creation is still in-flight.
    const writePromise = backend.writeEntry("race-key", "race-payload");

    // Dispose immediately, before the write (and mkdtemp) can settle.
    await backend.dispose();

    // The write may reject because the backend is now disposed, but it must
    // not leave an orphaned temp directory on disk.
    await writePromise.catch(() => {
        // Expected: the write may fail after disposal.
    });

    // Access the private tempRootPath to verify it was not set after disposal.
    const leakedPath = (backend as unknown as { tempRootPath: string | null }).tempRootPath;
    assert.equal(leakedPath, null, "tempRootPath must be null after dispose — the directory should not leak");
});

void test("TempFileStorageBackend dispose awaits in-flight mkdtemp and removes the directory", async () => {
    const backend = createTempFileStorageBackend({ readCacheMaxEntries: 2 });

    // Trigger directory creation by starting a write.
    const writePromise = backend.writeEntry("inflight-key", "inflight-payload");

    // Allow the write to settle so mkdtemp completes and we can capture the path.
    await writePromise;
    const createdPath = (backend as unknown as { tempRootPath: string | null }).tempRootPath;
    assert.ok(createdPath, "Expected tempRootPath to be set after a successful write");

    // Verify the directory exists before disposal.
    const existsBeforeDispose = await stat(createdPath)
        .then((s) => s.isDirectory())
        .catch(() => false);
    assert.ok(existsBeforeDispose, "Temp directory should exist before dispose");

    await backend.dispose();

    // Verify the directory was removed by dispose.
    const existsAfterDispose = await stat(createdPath)
        .then((s) => s.isDirectory())
        .catch(() => false);
    assert.equal(existsAfterDispose, false, "Temp directory must be removed after dispose");
});
