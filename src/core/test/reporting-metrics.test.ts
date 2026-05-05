import assert from "node:assert/strict";
import { test } from "node:test";

import { createMetricsTracker } from "../src/utils/metrics.js";

void test("snapshot exposes accumulated metrics as plain objects", () => {
    const tracker = createMetricsTracker({ category: "demo" });
    const { recording, reporting } = tracker;
    const { timers, counters, caches, metadata } = recording;
    const { summary } = reporting;

    const stopTiming = timers.startTimer("parse");
    stopTiming();
    counters.increment("files");
    caches.recordHit("project-index");
    caches.recordMiss("project-index");
    caches.recordStale("project-index");
    caches.recordHit("project-index");
    metadata.setMetadata("mode", "test");

    const report = summary.snapshot({
        counters: { extra: 2 },
        caches: { extraCache: { hits: 5 } },
        metadata: { note: "ok" }
    });

    assert.equal(report.category, "demo");
    assert.ok(report.totalTimeMs >= 0);
    assert.deepEqual(Object.keys(report.timings), ["parse"]);
    assert.deepEqual(report.counters, { files: 1, extra: 2 });
    assert.deepEqual(report.caches["project-index"], {
        hits: 2,
        misses: 1,
        stale: 1
    });
    assert.deepEqual(report.caches.extraCache, { hits: 5 });
    assert.deepEqual(report.metadata, { mode: "test", note: "ok" });
});

void test("snapshot ignores non-object extras", () => {
    const tracker = createMetricsTracker({ category: "noop" });
    const { recording, reporting } = tracker;
    recording.counters.increment("runs");

    const base = reporting.summary.snapshot();
    const withNull = reporting.summary.snapshot(null);
    const withString = reporting.summary.snapshot("invalid");

    assert.deepEqual(withNull, base);
    assert.deepEqual(withString, base);
});

void test("cache summaries include untouched counters", () => {
    const tracker = createMetricsTracker();
    const { recording, reporting } = tracker;
    recording.caches.recordHit("default");

    const stats = reporting.caches.cacheSnapshot("default");
    assert.deepEqual(stats, {
        hits: 1,
        misses: 0,
        stale: 0
    });
});

void test("cacheSnapshot falls back to full cache summary when name omitted", () => {
    const tracker = createMetricsTracker();
    const { recording, reporting } = tracker;
    recording.caches.recordHit("named");

    const caches = reporting.caches.cacheSnapshot();
    assert.deepEqual(caches.named, {
        hits: 1,
        misses: 0,
        stale: 0
    });
});

void test("finalize logs once when auto logging is enabled", () => {
    const events = [];
    const tracker = createMetricsTracker({
        category: "auto",
        autoLog: true,
        logger: {
            debug(message, payload) {
                events.push({ message, payload });
            }
        }
    });

    const { recording, reporting } = tracker;
    recording.counters.increment("items", 3);
    const report = reporting.summary.finalize({ counters: { extra: 1 } });
    const second = reporting.summary.finalize({ counters: { extra: 999 } });

    assert.deepEqual(report.counters, { items: 3, extra: 1 });
    assert.equal(events.length, 1);
    assert.equal(events[0].message, "[auto] summary");
    assert.deepEqual(events[0].payload, report);
    assert.deepEqual(second.counters, { extra: 999 });
    assert.equal(events.length, 1);
});

void test("cache keys are configurable and support custom metrics", () => {
    const tracker = createMetricsTracker({
        cacheKeys: ["hits", "evictions"],
        category: "custom"
    });

    const { recording, reporting } = tracker;
    recording.caches.recordHit("store");
    recording.caches.recordMetric("store", "evictions", 2);
    recording.caches.recordMetric("store", "misses", 3);

    const report = reporting.summary.snapshot();
    assert.deepEqual(report.caches.store, {
        hits: 1,
        evictions: 2,
        misses: 3
    });
});

void test("cache key normalization accepts delimited strings", () => {
    const tracker = createMetricsTracker({ cacheKeys: " hits , misses " });
    const { recording, reporting } = tracker;

    recording.caches.recordHit("store");
    recording.caches.recordMetric("store", "misses", 2);

    const report = reporting.summary.snapshot();
    assert.deepEqual(report.caches.store, {
        hits: 1,
        misses: 2
    });
});

void test("cache key normalization trims duplicates from iterable input", () => {
    const tracker = createMetricsTracker({
        cacheKeys: new Set([" hits ", "", "misses", "hits"])
    });

    const { recording, reporting } = tracker;
    recording.caches.recordHit("store");
    recording.caches.recordMetric("store", "misses", 2);

    const report = reporting.summary.snapshot();
    assert.deepEqual(report.caches.store, {
        hits: 1,
        misses: 2
    });
});

void test("cache key normalization falls back to defaults when empty", () => {
    const tracker = createMetricsTracker({ cacheKeys: [null, undefined] });
    const { recording, reporting } = tracker;
    recording.caches.recordHit("store");

    const report = reporting.summary.snapshot();
    assert.deepEqual(report.caches.store, {
        hits: 1,
        misses: 0,
        stale: 0
    });
});

void test("snapshot returns fresh copies of accumulated metrics", () => {
    const tracker = createMetricsTracker({ category: "clone" });
    const { recording, reporting } = tracker;
    recording.counters.increment("runs");
    recording.caches.recordHit("cache");

    const first = reporting.summary.snapshot();
    first.counters.runs = 99;
    first.caches.cache.hits = 42;

    const second = reporting.summary.snapshot();
    assert.deepEqual(second.counters, { runs: 1 });
    assert.deepEqual(second.caches.cache, { hits: 1, misses: 0, stale: 0 });
});

void test("timers and counters both record through shared increment path", async () => {
    const tracker = createMetricsTracker();
    const { recording, reporting } = tracker;

    recording.counters.increment("files", 2);
    await recording.timers.timeAsync("parse", async () => {});

    const report = reporting.summary.snapshot();
    assert.equal(report.counters.files, 2);
    assert.ok(typeof report.timings.parse === "number");
});
