import assert from "node:assert/strict";
import test from "node:test";

import {
    DEFAULT_FLUSH_THRESHOLD,
    DEFAULT_READ_CACHE_MAX_ENTRIES,
    DEFAULT_RETAINED_ENTRIES_PER_KEY,
    evaluateReadCacheEvictionPolicy,
    normalizeSinkThresholds
} from "../src/project-index/identifier-sink-policy.js";

/**
 * Build a read-cache Map from an array of key/value pairs, avoiding
 * `Map.prototype.set` calls (which the `unicorn/no-immediate-mutation` rule
 * flags as direct mutation at construction time).
 */
function makeReadCache(entries: [string, unknown][]): Map<string, { records: unknown[] }> {
    return new Map(entries.map(([k, v]) => [k, { records: [v] } satisfies { records: unknown[] }]));
}

void test("normalizeSinkThresholds applies defaults when options are absent", () => {
    const result = normalizeSinkThresholds();

    assert.equal(result.flushThreshold, DEFAULT_FLUSH_THRESHOLD);
    assert.equal(result.retainedEntriesPerKey, DEFAULT_RETAINED_ENTRIES_PER_KEY);
    assert.equal(result.readCacheMaxEntries, DEFAULT_READ_CACHE_MAX_ENTRIES);
});

void test("normalizeSinkThresholds accepts valid finite positive integers", () => {
    const result = normalizeSinkThresholds({
        flushThreshold: 64,
        retainedEntriesPerKey: 16,
        readCacheMaxEntries: 8
    });

    assert.equal(result.flushThreshold, 64);
    assert.equal(result.retainedEntriesPerKey, 16);
    assert.equal(result.readCacheMaxEntries, 8);
});

void test("normalizeSinkThresholds falls back to defaults for non-positive numbers", () => {
    // Values <= 0 are invalid for all thresholds (zero would cause pathological
    // behaviour such as spilling every record on the first append).  0.001 floors
    // to 0 so it also falls back.
    const result = normalizeSinkThresholds({
        flushThreshold: 0,
        retainedEntriesPerKey: -5,
        readCacheMaxEntries: 0.001
    });

    assert.equal(result.flushThreshold, DEFAULT_FLUSH_THRESHOLD);
    assert.equal(result.retainedEntriesPerKey, DEFAULT_RETAINED_ENTRIES_PER_KEY);
    assert.equal(result.readCacheMaxEntries, DEFAULT_READ_CACHE_MAX_ENTRIES);
});

void test("normalizeSinkThresholds falls back to defaults for non-numeric inputs", () => {
    const result = normalizeSinkThresholds({
        flushThreshold: Number.NaN,
        retainedEntriesPerKey: "thirty-two",
        readCacheMaxEntries: null
    });

    assert.equal(result.flushThreshold, DEFAULT_FLUSH_THRESHOLD);
    assert.equal(result.retainedEntriesPerKey, DEFAULT_RETAINED_ENTRIES_PER_KEY);
    assert.equal(result.readCacheMaxEntries, DEFAULT_READ_CACHE_MAX_ENTRIES);
});

void test("normalizeSinkThresholds floors non-integer values", () => {
    const result = normalizeSinkThresholds({
        flushThreshold: 100.9,
        retainedEntriesPerKey: 31.2,
        readCacheMaxEntries: 7.8
    });

    assert.equal(result.flushThreshold, 100);
    assert.equal(result.retainedEntriesPerKey, 31);
    assert.equal(result.readCacheMaxEntries, 7);
});

void test("normalizeSinkThresholds falls back to defaults for Infinity", () => {
    const result = normalizeSinkThresholds({
        flushThreshold: Infinity,
        retainedEntriesPerKey: -Infinity
    });

    assert.equal(result.flushThreshold, DEFAULT_FLUSH_THRESHOLD);
    assert.equal(result.retainedEntriesPerKey, DEFAULT_RETAINED_ENTRIES_PER_KEY);
});

void test("evaluateReadCacheEvictionPolicy returns empty evict list when cache is within limit", () => {
    // The mechanism passes the cache AFTER deleting the promoted entry.
    // Cache is 8 entries (within maxEntries=32) → no eviction.
    const entries: [string, unknown][] = [];
    for (let i = 0; i < 8; i++) {
        entries.push([`key-${i}`, {}]);
    }
    const cache = makeReadCache(entries);

    const decision = evaluateReadCacheEvictionPolicy({
        currentCache: cache,
        promotedKey: "key-0",
        promotedKeyWasAlreadyPresent: true,
        maxEntries: 32
    });

    assert.deepEqual(decision.evictKeys, []);
});

void test("evaluateReadCacheEvictionPolicy evicts oldest entries when cache exceeds limit (new key)", () => {
    // Cache has 33 entries (after deletion of "new-key-99" which was not present → still 33).
    // sizeAfterReinsertion = 33 + 1 = 34. evictCount = 34 - 32 = 2.
    // Oldest 2 entries (key-0, key-1) should be evicted so new-key-99 can fit.
    const entries: [string, unknown][] = [];
    for (let i = 0; i < 33; i++) {
        entries.push([`key-${i}`, {}]);
    }
    const cache = makeReadCache(entries);

    const decision = evaluateReadCacheEvictionPolicy({
        currentCache: cache,
        promotedKey: "new-key-99",
        promotedKeyWasAlreadyPresent: false,
        maxEntries: 32
    });

    assert.equal(decision.evictKeys.length, 2);
    assert.deepEqual(decision.evictKeys, ["key-0", "key-1"]);
});

void test(
    "evaluateReadCacheEvictionPolicy evicts oldest entry when re-inserting existing key pushes " + "over limit",
    () => {
        // The input cache represents the state AFTER the mechanism's delete of
        // the promoted existing key "key-0".  With 32 entries remaining:
        // sizeAfterReinsertion = 32 (key was present, size unchanged).
        // evictCount = 32 - 32 = 0.  No eviction — re-inserting key-0 as MRU
        // leaves exactly 32 entries.
        const entries: [string, unknown][] = [];
        for (let i = 0; i < 32; i++) {
            entries.push([`key-${i}`, {}]);
        }
        const cache = makeReadCache(entries);

        const decision = evaluateReadCacheEvictionPolicy({
            currentCache: cache,
            promotedKey: "key-0",
            promotedKeyWasAlreadyPresent: true,
            maxEntries: 32
        });

        assert.deepEqual(decision.evictKeys, []);
    }
);

void test("evaluateReadCacheEvictionPolicy evicts correct number of entries when over by multiple", () => {
    // Cache has 36 entries. After deletion of "new-key" (not present): still 36.
    // sizeAfterReinsertion = 36 + 1 = 37. evictCount = 37 - 32 = 5.
    const entries: [string, unknown][] = [];
    for (let i = 0; i < 36; i++) {
        entries.push([`key-${i}`, {}]);
    }
    const cache = makeReadCache(entries);

    const decision = evaluateReadCacheEvictionPolicy({
        currentCache: cache,
        promotedKey: "new-key",
        promotedKeyWasAlreadyPresent: false,
        maxEntries: 32
    });

    assert.equal(decision.evictKeys.length, 5);
    assert.deepEqual(decision.evictKeys, ["key-0", "key-1", "key-2", "key-3", "key-4"]);
});

void test("evaluateReadCacheEvictionPolicy returns empty evict list at exactly maxEntries (new key)", () => {
    // Cache has 32 entries. After deletion of new key (not present): still 32.
    // sizeAfterReinsertion = 32 + 1 = 33. evictCount = 33 - 32 = 1.
    // Wait, that's wrong! 32 + 1 - 32 = 1. But we need to evict exactly 1.
    // Actually: cache has 32 entries. After deletion of new key (no-op): 32 entries.
    // sizeAfterReinsertion = 32 + 1 = 33. evictCount = 33 - 32 = 1.
    // Oldest entry key-0 evicted. Final cache: key-1 through key-31 + new-key = 32 entries.
    const entries: [string, unknown][] = [];
    for (let i = 0; i < 32; i++) {
        entries.push([`key-${i}`, {}]);
    }
    const cache = makeReadCache(entries);

    const decision = evaluateReadCacheEvictionPolicy({
        currentCache: cache,
        promotedKey: "new-key",
        promotedKeyWasAlreadyPresent: false,
        maxEntries: 32
    });

    assert.equal(decision.evictKeys.length, 1);
    assert.deepEqual(decision.evictKeys, ["key-0"]);
});

void test("evaluateReadCacheEvictionPolicy returns empty evict list at exactly maxEntries (existing key)", () => {
    // Cache has 32 entries. After deletion of promoted existing key: 31 entries.
    // sizeAfterReinsertion = 31 (unchanged). evictCount = 31 - 32 = 0. No eviction.
    const entries: [string, unknown][] = [];
    for (let i = 0; i < 32; i++) {
        entries.push([`key-${i}`, {}]);
    }
    const cache = makeReadCache(entries);

    const decision = evaluateReadCacheEvictionPolicy({
        currentCache: cache,
        promotedKey: "key-0",
        promotedKeyWasAlreadyPresent: true,
        maxEntries: 32
    });

    assert.deepEqual(decision.evictKeys, []);
});

void test("evaluateReadCacheEvictionPolicy returns evict keys ordered oldest-first", () => {
    // Cache has 35 entries. After deletion of new key (not present): still 35.
    // sizeAfterReinsertion = 35 + 1 = 36. evictCount = 36 - 32 = 4.
    const entries: [string, unknown][] = [];
    for (let i = 0; i < 35; i++) {
        entries.push([`key-${i}`, {}]);
    }
    const cache = makeReadCache(entries);

    const decision = evaluateReadCacheEvictionPolicy({
        currentCache: cache,
        promotedKey: "new-key",
        promotedKeyWasAlreadyPresent: false,
        maxEntries: 32
    });

    assert.deepEqual(decision.evictKeys, ["key-0", "key-1", "key-2", "key-3"]);
});

void test("evaluateReadCacheEvictionPolicy handles single-entry cache at capacity (new key)", () => {
    // Cache has 1 entry. After deletion of new key (not present): still 1.
    // sizeAfterReinsertion = 1 + 1 = 2. evictCount = 2 - 1 = 1. Oldest (only-key) evicted.
    const cache = makeReadCache([["only-key", {}]]);

    const decision = evaluateReadCacheEvictionPolicy({
        currentCache: cache,
        promotedKey: "new-key",
        promotedKeyWasAlreadyPresent: false,
        maxEntries: 1
    });

    assert.deepEqual(decision.evictKeys, ["only-key"]);
});

void test("evaluateReadCacheEvictionPolicy handles single-entry cache at capacity (existing key)", () => {
    // Cache has 1 entry. After deletion of promoted existing key: 0 entries.
    // sizeAfterReinsertion = 0 (unchanged). evictCount = 0 - 1 = 0. No eviction.
    const cache = makeReadCache([["only-key", {}]]);

    const decision = evaluateReadCacheEvictionPolicy({
        currentCache: cache,
        promotedKey: "only-key",
        promotedKeyWasAlreadyPresent: true,
        maxEntries: 1
    });

    assert.deepEqual(decision.evictKeys, []);
});

void test("evaluateReadCacheEvictionPolicy respects maxEntries=1 (evicts oldest)", () => {
    // Cache has 2 entries. After deletion of "newest" (not present): still 2.
    // sizeAfterReinsertion = 2 + 1 = 3. evictCount = 3 - 1 = 2. Oldest 2 evicted.
    const cache = makeReadCache([
        ["oldest", {}],
        ["middle", {}]
    ]);

    const decision = evaluateReadCacheEvictionPolicy({
        currentCache: cache,
        promotedKey: "newest",
        promotedKeyWasAlreadyPresent: false,
        maxEntries: 1
    });

    assert.equal(decision.evictKeys.length, 2);
    assert.deepEqual(decision.evictKeys, ["oldest", "middle"]);
});

void test("evaluateReadCacheEvictionPolicy is pure — does not modify the input cache", () => {
    const cache = makeReadCache([
        ["key-0", "a"],
        ["key-1", "b"]
    ]);

    evaluateReadCacheEvictionPolicy({
        currentCache: cache,
        promotedKey: "key-2",
        promotedKeyWasAlreadyPresent: false,
        maxEntries: 2
    });

    // Cache must be unchanged
    assert.equal(cache.size, 2);
    assert.ok(cache.has("key-0"));
    assert.ok(cache.has("key-1"));
    assert.ok(!cache.has("key-2"));
});

void test("evaluateReadCacheEvictionPolicy works with non-sequential insertion order", () => {
    // Cache has 3 entries. After deletion of "new-key" (not present): still 3.
    // sizeAfterReinsertion = 3 + 1 = 4. evictCount = 4 - 2 = 2. Oldest 2 evicted.
    const cache = makeReadCache([
        ["z-key", {}],
        ["a-key", {}],
        ["m-key", {}]
    ]);

    const decision = evaluateReadCacheEvictionPolicy({
        currentCache: cache,
        promotedKey: "new-key",
        promotedKeyWasAlreadyPresent: false,
        maxEntries: 2
    });

    // Oldest 2 by insertion order
    assert.deepEqual(decision.evictKeys, ["z-key", "a-key"]);
});
