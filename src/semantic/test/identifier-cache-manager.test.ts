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
