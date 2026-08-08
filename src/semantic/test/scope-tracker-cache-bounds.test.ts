import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ScopeTracker } from "../src/scopes/scope-tracker.js";

void test("ScopeTracker bounds lookup cache entries with LRU eviction", () => {
    const tracker = new ScopeTracker({ enabled: true, lookupCacheMaxEntries: 3 });
    tracker.enterScope("program");

    tracker.declare("alpha", {
        name: "alpha",
        start: { line: 1, column: 0, index: 0 },
        end: { line: 1, column: 5, index: 5 }
    });

    tracker.declare("beta", {
        name: "beta",
        start: { line: 2, column: 0, index: 6 },
        end: { line: 2, column: 4, index: 10 }
    });

    tracker.declare("gamma", {
        name: "gamma",
        start: { line: 3, column: 0, index: 11 },
        end: { line: 3, column: 5, index: 16 }
    });

    assert.strictEqual(tracker.countRetainedLookupCacheEntries(), 0, "Cache should be empty before any lookups");

    // Look up more distinct names than lookupCacheMaxEntries allows. If eviction were
    // broken (unbounded growth), the retained count below would exceed the configured cap.
    assert.strictEqual(tracker.lookup("alpha")?.name, "alpha");
    assert.strictEqual(tracker.lookup("beta")?.name, "beta");
    assert.strictEqual(tracker.lookup("gamma")?.name, "gamma");
    assert.strictEqual(tracker.lookup("delta"), null);

    assert.strictEqual(
        tracker.countRetainedLookupCacheEntries(),
        3,
        "Cache should never retain more entries than lookupCacheMaxEntries"
    );

    // Re-resolving the same names must not grow the cache further, and every name must
    // keep resolving correctly regardless of whether it was evicted from the cache -
    // eviction is a memory optimization, not a source of stale or missing results.
    for (let i = 0; i < 25; i++) {
        assert.strictEqual(tracker.lookup("alpha")?.name, "alpha");
        assert.strictEqual(tracker.lookup("beta")?.name, "beta");
        assert.strictEqual(tracker.lookup("gamma")?.name, "gamma");
        assert.strictEqual(tracker.lookup("delta"), null);
    }

    assert.strictEqual(
        tracker.countRetainedLookupCacheEntries(),
        3,
        "Cache should stay bounded after repeated lookups of the same names"
    );
});

void test("ScopeTracker bounds identifier resolution cache entries", () => {
    const tracker = new ScopeTracker({
        enabled: true,
        identifierCacheMaxTrackedNames: 2,
        identifierCacheMaxScopesPerName: 2
    });
    const rootScope = tracker.enterScope("program");

    tracker.declare("one", {
        name: "one",
        start: { line: 1, column: 0, index: 0 },
        end: { line: 1, column: 3, index: 3 }
    });

    tracker.declare("two", {
        name: "two",
        start: { line: 2, column: 0, index: 4 },
        end: { line: 2, column: 3, index: 7 }
    });

    tracker.declare("three", {
        name: "three",
        start: { line: 3, column: 0, index: 8 },
        end: { line: 3, column: 5, index: 13 }
    });

    assert.strictEqual(
        tracker.countRetainedIdentifierResolutionCacheEntries(),
        0,
        "Cache should be empty before any resolutions"
    );

    // Resolve more distinct names than identifierCacheMaxTrackedNames allows. Every
    // resolution must still return the correct declaration regardless of eviction.
    assert.strictEqual(tracker.resolveIdentifier("one", rootScope.id)?.name, "one");
    assert.strictEqual(tracker.resolveIdentifier("two", rootScope.id)?.name, "two");
    assert.strictEqual(tracker.resolveIdentifier("three", rootScope.id)?.name, "three");

    assert.ok(
        tracker.countRetainedIdentifierResolutionCacheEntries() <= 2,
        "Cache should never retain more tracked names than identifierCacheMaxTrackedNames"
    );
});
