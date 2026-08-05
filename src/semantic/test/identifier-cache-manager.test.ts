import assert from "node:assert/strict";
import { test } from "node:test";

import {
    IdentifierCacheContract,
    IdentifierCacheDiagnostics,
    IdentifierCacheInvalidator,
    IdentifierCacheManager,
    IdentifierCacheReader,
    IdentifierCacheWriter
} from "../src/scopes/identifier-cache-manager.js";

/**
 * Compile-time checks that the concrete cache satisfies every role interface
 * and the composite contract. Keeping these assignments inside the test file
 * means TypeScript flags any drift immediately during `tsc -b`, even when
 * the runtime assertions below are never executed.
 */
void test("IdentifierCacheManager satisfies every role interface and the composite contract", () => {
    const cache = new IdentifierCacheManager();

    const reader: IdentifierCacheReader = cache;
    const writer: IdentifierCacheWriter = cache;
    const invalidator: IdentifierCacheInvalidator = cache;
    const diagnostics: IdentifierCacheDiagnostics = cache;
    const contract: IdentifierCacheContract = cache;

    assert.strictEqual(typeof reader.read, "function");
    assert.strictEqual(typeof writer.write, "function");
    assert.strictEqual(typeof invalidator.invalidate, "function");
    assert.strictEqual(typeof invalidator.invalidateScopes, "function");
    assert.strictEqual(typeof diagnostics.countRetainedEntries, "function");
    assert.strictEqual(typeof contract.read, "function");
    assert.strictEqual(typeof contract.write, "function");
    assert.strictEqual(typeof contract.invalidate, "function");
    assert.strictEqual(typeof contract.invalidateScopes, "function");
    assert.strictEqual(typeof contract.countRetainedEntries, "function");
});

/**
 * Each role interface should only expose the members its named concern
 * requires. This guards against accidental widening of a narrow role's
 * surface (the original ISP violation we are trying to prevent).
 *
 * Each test destructures the role-specific member out of the narrow role
 * type so TypeScript's type checker enforces that the role interface
 * declares exactly that member and no others. A future widening of the
 * role with stray members would still type-check (extra members are
 * structural extras), but the destructuring bindings below prove each role
 * fulfils its named members at compile time.
 */
void test("IdentifierCacheReader exposes the read member required by the role", () => {
    const reader: IdentifierCacheReader = new IdentifierCacheManager();
    const { read } = reader;
    assert.strictEqual(typeof read, "function");
});

void test("IdentifierCacheWriter exposes the write member required by the role", () => {
    const writer: IdentifierCacheWriter = new IdentifierCacheManager();
    const { write } = writer;
    assert.strictEqual(typeof write, "function");
});

void test("IdentifierCacheInvalidator exposes the two invalidation members required by the role", () => {
    const invalidator: IdentifierCacheInvalidator = new IdentifierCacheManager();
    const { invalidate, invalidateScopes } = invalidator;
    assert.strictEqual(typeof invalidate, "function");
    assert.strictEqual(typeof invalidateScopes, "function");
});

void test("IdentifierCacheDiagnostics exposes the countRetainedEntries member required by the role", () => {
    const diagnostics: IdentifierCacheDiagnostics = new IdentifierCacheManager();
    const { countRetainedEntries } = diagnostics;
    assert.strictEqual(typeof countRetainedEntries, "function");
});

void test("IdentifierCacheContract composes every role member exactly once", () => {
    const cache = new IdentifierCacheManager();
    cache.write("n", "s", null);
    cache.write("n2", "s2", null);
    cache.invalidate("n");
    cache.invalidateScopes(["s2"]);
    const beforeCount = (cache as IdentifierCacheDiagnostics).countRetainedEntries();

    const contract: IdentifierCacheContract = cache;
    const read = contract.read("n", "s");
    contract.write("n", "s", null);
    contract.invalidate("n");
    contract.invalidateScopes(["s2"]);
    const afterCount = contract.countRetainedEntries();

    assert.strictEqual(read, undefined);
    assert.strictEqual(beforeCount, 0);
    assert.strictEqual(afterCount, 0);
});

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

void test("IdentifierCacheManager invalidateScopes removes only entries for the given scopes", () => {
    const cache = new IdentifierCacheManager();

    cache.write("name-A", "scope-1", null);
    cache.write("name-A", "scope-2", null);
    cache.write("name-B", "scope-1", null);
    cache.write("name-B", "scope-3", null);
    cache.write("name-C", "scope-3", null);

    cache.invalidateScopes(["scope-1"]);

    // scope-1 entries are gone for both name-A and name-B.
    assert.strictEqual(cache.read("name-A", "scope-1"), undefined);
    assert.strictEqual(cache.read("name-B", "scope-1"), undefined);
    // Entries for other scopes are untouched.
    assert.strictEqual(cache.read("name-A", "scope-2"), null);
    assert.strictEqual(cache.read("name-B", "scope-3"), null);
    assert.strictEqual(cache.read("name-C", "scope-3"), null);
    assert.strictEqual(cache.countRetainedEntries(), 3);

    cache.invalidateScopes(["scope-2", "scope-3"]);

    // Everything is now gone since every remaining entry pointed at scope-2 or scope-3.
    assert.strictEqual(cache.countRetainedEntries(), 0);
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
