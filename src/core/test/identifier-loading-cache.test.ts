import assert from "node:assert/strict";
import test from "node:test";

import {
    clearIdentifierMetadataCache,
    loadManualFunctionNames,
    loadReservedIdentifierNames,
    resetReservedIdentifierMetadataLoader,
    setReservedIdentifierMetadataLoader
} from "../src/resources/gml-identifier-loading.js";

test.afterEach(() => {
    resetReservedIdentifierMetadataLoader();
    clearIdentifierMetadataCache();
});

void test("loadManualFunctionNames returns the same cached Set instance on repeated calls", () => {
    const firstCall = loadManualFunctionNames();
    const secondCall = loadManualFunctionNames();
    const thirdCall = loadManualFunctionNames();

    // Verify all calls return the exact same Set instance (not just equal Sets)
    assert.strictEqual(firstCall, secondCall, "Second call should return same Set instance");
    assert.strictEqual(secondCall, thirdCall, "Third call should return same Set instance");
    assert.strictEqual(firstCall, thirdCall, "First and third calls should return same Set instance");
});

void test("loadManualFunctionNames returns new Set after cache is cleared", () => {
    const firstCall = loadManualFunctionNames();

    clearIdentifierMetadataCache();

    const secondCall = loadManualFunctionNames();

    // After clearing cache, we should get a new instance
    assert.notStrictEqual(firstCall, secondCall, "Should return new Set instance after cache clear");

    // But the contents should be identical
    assert.deepEqual(Array.from(firstCall).toSorted(), Array.from(secondCall).toSorted());
});

void test("loadReservedIdentifierNames returns the same cached Set for identical configurations", () => {
    const firstCall = loadReservedIdentifierNames({ disallowedTypes: ["literal", "keyword"] });
    const secondCall = loadReservedIdentifierNames({ disallowedTypes: ["literal", "keyword"] });
    const thirdCall = loadReservedIdentifierNames({ disallowedTypes: ["literal", "keyword"] });

    // All calls with the same configuration should return the same instance
    assert.strictEqual(firstCall, secondCall, "Same config should return same Set instance");
    assert.strictEqual(secondCall, thirdCall, "Same config should return same Set instance");
});

void test("loadReservedIdentifierNames returns different cached Sets for different configurations", () => {
    const config1 = loadReservedIdentifierNames({ disallowedTypes: ["literal"] });
    const config2 = loadReservedIdentifierNames({ disallowedTypes: ["keyword"] });
    const config3 = loadReservedIdentifierNames({ disallowedTypes: ["literal", "keyword"] });

    // Different configurations should return different instances
    assert.notStrictEqual(config1, config2, "Different configs should return different Set instances");
    assert.notStrictEqual(config1, config3, "Different configs should return different Set instances");
    assert.notStrictEqual(config2, config3, "Different configs should return different Set instances");
});

void test("loadReservedIdentifierNames handles configuration order consistently", () => {
    // Configurations with the same types in different order should return the same Set
    const ordered1 = loadReservedIdentifierNames({ disallowedTypes: ["literal", "keyword"] });
    const ordered2 = loadReservedIdentifierNames({ disallowedTypes: ["keyword", "literal"] });

    // The cache key is sorted, so different order should return the same cached instance
    assert.strictEqual(ordered1, ordered2, "Same types in different order should use same cache");
});

void test("loadReservedIdentifierNames with default config returns cached instance", () => {
    const firstCall = loadReservedIdentifierNames();
    const secondCall = loadReservedIdentifierNames();
    const thirdCall = loadReservedIdentifierNames({});

    assert.strictEqual(firstCall, secondCall, "Default config should return same instance");
    assert.strictEqual(secondCall, thirdCall, "Empty config should match default config");
});

void test("clearIdentifierMetadataCache clears all derived caches", () => {
    // Populate caches
    const manualFunctions1 = loadManualFunctionNames();
    const reservedIds1 = loadReservedIdentifierNames();
    const customReserved1 = loadReservedIdentifierNames({ disallowedTypes: ["literal"] });

    // Clear all caches
    clearIdentifierMetadataCache();

    // Get new instances
    const manualFunctions2 = loadManualFunctionNames();
    const reservedIds2 = loadReservedIdentifierNames();
    const customReserved2 = loadReservedIdentifierNames({ disallowedTypes: ["literal"] });

    // All should be new instances
    assert.notStrictEqual(manualFunctions1, manualFunctions2, "Manual functions should be new instance");
    assert.notStrictEqual(reservedIds1, reservedIds2, "Reserved identifiers should be new instance");
    assert.notStrictEqual(customReserved1, customReserved2, "Custom reserved should be new instance");
});

void test("cache persists across metadata loader changes", () => {
    // Populate cache with custom loader
    const cleanup = setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            foo: { type: "function" },
            bar: { type: "variable" }
        }
    }));

    const firstCall = loadManualFunctionNames();
    const secondCall = loadManualFunctionNames();

    // Verify caching works with custom loader
    assert.strictEqual(firstCall, secondCall, "Cache should work with custom loader");
    assert.deepEqual(Array.from(firstCall).toSorted(), ["foo"]);

    cleanup();
});

void test("throwing loader is caught and returns null metadata gracefully", () => {
    setReservedIdentifierMetadataLoader(() => {
        throw new Error("simulated I/O failure");
    });

    // The inlined try/catch in loadIdentifierMetadata should swallow the error
    const names = loadReservedIdentifierNames();
    assert.strictEqual(names.size, 0, "Throwing loader should produce an empty reserved set");
});

void test("loader returning non-object is treated as null metadata", () => {
    setReservedIdentifierMetadataLoader(() => "not-an-object");

    const names = loadReservedIdentifierNames();
    assert.strictEqual(names.size, 0, "Non-object return should produce an empty reserved set");
});

void test("loader returning null is treated as null metadata", () => {
    setReservedIdentifierMetadataLoader(() => null);

    const names = loadReservedIdentifierNames();
    assert.strictEqual(names.size, 0, "Null return should produce an empty reserved set");
});

void test("identifier metadata loader allocations are stable across repeated reserved-name cache misses", () => {
    let loaderInvocations = 0;

    setReservedIdentifierMetadataLoader(() => {
        loaderInvocations += 1;
        return {
            identifiers: {
                alpha: { type: "function" },
                beta: { type: "keyword" },
                gamma: { type: "literal" },
                delta: { type: "variable" }
            }
        };
    });

    const disallowedTypeConfigurations = [
        ["literal", "keyword"],
        ["keyword"],
        ["literal"],
        ["variable"],
        ["keyword", "variable"]
    ];

    for (const config of disallowedTypeConfigurations) {
        loadReservedIdentifierNames({ disallowedTypes: config });
    }

    loadManualFunctionNames();

    assert.strictEqual(
        loaderInvocations,
        1,
        `Expected exactly one metadata loader invocation, received ${loaderInvocations}.`
    );
});

void test("memory allocation is reduced by caching", () => {
    // This test verifies the optimization by ensuring multiple calls
    // don't create new Set instances, thus reducing memory allocations

    const iterations = 100;
    const sets = new Set<Set<string>>();

    // Call loadManualFunctionNames many times
    for (let i = 0; i < iterations; i++) {
        const result = loadManualFunctionNames();
        sets.add(result);
    }

    // All calls should have returned the same Set instance
    assert.strictEqual(
        sets.size,
        1,
        `Expected only 1 unique Set instance, but got ${sets.size}. Cache is not working properly.`
    );
});

void test("LRU eviction prevents unbounded cache growth", () => {
    // Create more unique configurations than the cache limit (10)
    const configs = [
        [],
        ["literal"],
        ["keyword"],
        ["function"],
        ["variable"],
        ["literal", "keyword"],
        ["literal", "function"],
        ["keyword", "function"],
        ["literal", "keyword", "function"],
        ["variable", "keyword"],
        ["variable", "literal"],
        ["variable", "function"],
        ["literal", "keyword", "function", "variable"]
    ];

    // Request each configuration to populate cache beyond limit
    const results: Array<Set<string>> = [];
    for (const config of configs) {
        const result = loadReservedIdentifierNames({ disallowedTypes: config });
        results.push(result);
    }

    // Re-request the first few configurations that should have been evicted
    const evictedConfig1 = loadReservedIdentifierNames({ disallowedTypes: configs[0] });
    const evictedConfig2 = loadReservedIdentifierNames({ disallowedTypes: configs[1] });
    const evictedConfig3 = loadReservedIdentifierNames({ disallowedTypes: configs[2] });

    // These should be NEW instances (not the original cached ones)
    // because they were evicted due to LRU
    assert.notStrictEqual(evictedConfig1, results[0], "First config should have been evicted and recreated");
    assert.notStrictEqual(evictedConfig2, results[1], "Second config should have been evicted and recreated");
    assert.notStrictEqual(evictedConfig3, results[2], "Third config should have been evicted and recreated");

    // But recently accessed configs should still be cached
    const lastConfig = configs.at(-1);
    const lastResult = results.at(-1);
    assert.ok(lastConfig !== undefined, "Last config should exist");
    assert.ok(lastResult !== undefined, "Last result should exist");
    const recentConfig = loadReservedIdentifierNames({ disallowedTypes: lastConfig });
    assert.strictEqual(recentConfig, lastResult, "Most recent config should still be cached");
});

void test("LRU cache promotes frequently accessed entries", () => {
    clearIdentifierMetadataCache();

    // Create configurations to fill the cache
    const configs = Array.from({ length: 10 }, (_, i) => [`type${i}`]);

    // Fill cache to capacity
    for (const config of configs) {
        loadReservedIdentifierNames({ disallowedTypes: config });
    }

    // Access the first config again to promote it (make it most recent)
    const promoted = loadReservedIdentifierNames({ disallowedTypes: configs[0] });

    // Add one more config to trigger eviction
    loadReservedIdentifierNames({ disallowedTypes: ["new_type"] });

    // The promoted config should still be cached (not evicted)
    const stillCached = loadReservedIdentifierNames({ disallowedTypes: configs[0] });
    assert.strictEqual(stillCached, promoted, "Promoted config should remain cached after LRU eviction");

    // But the second config (which wasn't accessed) should have been evicted
    const secondConfig = loadReservedIdentifierNames({ disallowedTypes: configs[1] });
    // We can't directly test if it's a new instance without storing the old one,
    // but we can verify the cache still works by accessing it twice
    const secondConfigAgain = loadReservedIdentifierNames({ disallowedTypes: configs[1] });
    assert.strictEqual(secondConfig, secondConfigAgain, "Re-cached config should return same instance");
});
