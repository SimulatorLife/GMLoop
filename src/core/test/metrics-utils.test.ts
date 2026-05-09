import assert from "node:assert/strict";
import { test } from "node:test";

import { createMetricsTracker } from "../src/reporting/metrics.js";

function getCacheKeys(contracts, cacheName = "example") {
    const { recording, reporting } = contracts;
    recording.caches.recordHit(cacheName);
    return Object.keys(reporting.caches.cacheSnapshot(cacheName) ?? {});
}

void test("createMetricsTracker uses default cache keys when none provided", () => {
    const tracker = createMetricsTracker();

    assert.deepEqual(getCacheKeys(tracker), ["hits", "misses", "stale"]);
});

void test("createMetricsTracker trims and deduplicates custom cache keys", () => {
    const tracker = createMetricsTracker({
        cacheKeys: [" hits ", "hits", " misses "]
    });

    assert.deepEqual(getCacheKeys(tracker), ["hits", "misses"]);
});

void test("createMetricsTracker falls back to defaults when overrides are empty", () => {
    const tracker = createMetricsTracker({ cacheKeys: ["   ", null] });

    assert.deepEqual(getCacheKeys(tracker), ["hits", "misses", "stale"]);
});
