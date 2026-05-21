import assert from "node:assert/strict";
import { test } from "node:test";

import { IdentifierCacheManager } from "../src/scopes/identifier-cache-manager.js";

void test("IdentifierCacheManager constructor clamps and normalizes cache size options", () => {
    const cache = new IdentifierCacheManager({
        maxTrackedNames: -10,
        maxScopesPerName: 2.9
    });

    cache.write("name-1", "scope-1", null);
    cache.write("name-1", "scope-2", null);
    cache.write("name-1", "scope-3", null);

    assert.strictEqual(cache.read("name-1", "scope-1"), undefined);
    assert.strictEqual(cache.read("name-1", "scope-2"), null);
    assert.strictEqual(cache.read("name-1", "scope-3"), null);
});

void test("IdentifierCacheManager constructor falls back to defaults for non-finite options", () => {
    const cache = new IdentifierCacheManager({
        maxTrackedNames: Number.POSITIVE_INFINITY,
        maxScopesPerName: Number.NaN
    });

    cache.write("name-1", "scope-1", null);
    cache.write("name-2", "scope-1", null);
    cache.write("name-3", "scope-1", null);

    assert.strictEqual(cache.read("name-1", "scope-1"), null);
    assert.strictEqual(cache.read("name-2", "scope-1"), null);
    assert.strictEqual(cache.read("name-3", "scope-1"), null);
});

void test("IdentifierCacheManager treats 0 for maxTrackedNames as fallback to default 4000", () => {
    const cache = new IdentifierCacheManager({ maxTrackedNames: 0, maxScopesPerName: 2 });

    // With maxScopesPerName=2, entries beyond the per-name limit are evicted.
    // maxTrackedNames=0 falls back to the default of 4000, so the global ceiling
    // does not kick in for just 5 names.
    for (let i = 0; i < 5; i++) {
        cache.write(`name-${i}`, "scope-1", null);
    }

    // All names should be retained because the global ceiling (4000 default) is far above 5.
    for (let i = 0; i < 5; i++) {
        assert.strictEqual(cache.read(`name-${i}`, "scope-1"), null);
    }
});

void test("IdentifierCacheManager treats 0 for maxScopesPerName as fallback to default 64", () => {
    const cache = new IdentifierCacheManager({ maxTrackedNames: 3, maxScopesPerName: 0 });

    // With maxTrackedNames=3, only the 3 most-recently-used names survive.
    // maxScopesPerName=0 falls back to 64, so per-name eviction does not trigger
    // for just 2 scopes per name.
    cache.write("name-A", "scope-1", null);
    cache.write("name-B", "scope-1", null);
    cache.write("name-C", "scope-1", null);
    cache.write("name-A", "scope-2", null);
    cache.write("name-B", "scope-2", null);

    // name-A and name-B each have 2 scope entries (well below fallback of 64),
    // so the per-name eviction doesn't fire. Both survive as long as the global
    // ceiling (3) still has room — which it does since only 3 distinct names exist.
    assert.strictEqual(cache.read("name-A", "scope-1"), null);
    assert.strictEqual(cache.read("name-A", "scope-2"), null);
    assert.strictEqual(cache.read("name-B", "scope-1"), null);
});

void test("IdentifierCacheManager accepts Infinity for maxScopesPerName to disable per-name eviction", () => {
    const cache = new IdentifierCacheManager({ maxTrackedNames: 2, maxScopesPerName: Infinity });

    // Add many scopes for a single name — with Infinity, no per-name eviction occurs.
    for (let i = 0; i < 10; i++) {
        cache.write("shared-name", `scope-${i}`, null);
    }

    // All 10 scope entries for "shared-name" should be retained because
    // maxScopesPerName is Infinity (per-name eviction disabled).
    for (let i = 0; i < 10; i++) {
        assert.strictEqual(cache.read("shared-name", `scope-${i}`), null);
    }
});
