import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";

import {
    getProjectRootCacheSizeForTests,
    getProjectRootForTests,
    hasProjectRootCacheEntryForTests,
    resetProjectRootCacheForTests
} from "../src/intelligence/identifier-index.js";

// Distinct, never-created file paths under a scratch directory. `getProjectRoot`
// resolves each to `null` quickly (no `.yyp` ancestor exists) while still
// exercising the cache's real insertion/eviction path keyed by resolved path.
const SCRATCH_DIRECTORY = path.join(os.tmpdir(), "gmloop-lsp-project-root-cache-test");

function scratchFilePath(index: number): string {
    return path.join(SCRATCH_DIRECTORY, `file-${index}.gml`);
}

// Populates the cache one entry at a time, in order, awaiting each lookup
// before starting the next so insertion/LRU order stays deterministic.
async function populateSequentially(indices: ReadonlyArray<number>, onEach?: (index: number) => void): Promise<void> {
    await indices.reduce(async (previous, index) => {
        await previous;
        await getProjectRootForTests(scratchFilePath(index));
        onEach?.(index);
    }, Promise.resolve());
}

beforeEach(() => {
    resetProjectRootCacheForTests();
});

void test("project root cache stays bounded across many distinct file paths", async () => {
    const totalEntries = 2010;

    await populateSequentially(
        Array.from({ length: totalEntries }, (_unused, index) => index),
        () => {
            const size = getProjectRootCacheSizeForTests();
            assert.ok(size <= 2000, `cache should stay at or below 2000 entries (saw ${size})`);
        }
    );

    assert.equal(getProjectRootCacheSizeForTests(), 2000);
});

void test("project root cache evicts the least-recently-used entry first", async () => {
    resetProjectRootCacheForTests();

    // Fill the cache to just below its ceiling, then re-touch the very first
    // entry so it becomes most-recently-used before the ceiling is crossed.
    await populateSequentially(Array.from({ length: 2000 }, (_unused, index) => index));
    await getProjectRootForTests(scratchFilePath(0));

    // One more distinct entry pushes the cache over its ceiling. The
    // least-recently-used entry (index 1, never re-touched) should be
    // evicted, not the re-touched entry (index 0).
    await getProjectRootForTests(scratchFilePath(2000));

    assert.equal(getProjectRootCacheSizeForTests(), 2000);
    assert.ok(
        hasProjectRootCacheEntryForTests(scratchFilePath(0)),
        "recently re-touched entry should survive eviction"
    );
    assert.ok(
        !hasProjectRootCacheEntryForTests(scratchFilePath(1)),
        "least-recently-used entry should be evicted first"
    );
});
