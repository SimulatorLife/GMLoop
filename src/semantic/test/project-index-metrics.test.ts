import assert from "node:assert/strict";
import test from "node:test";

import { Core } from "@gmloop/core";

import { buildProjectIndex } from "../src/project-index/index.js";
import { createTempProjectWorkspace } from "./test-project-helpers.js";

// Use Core.Reporting.createMetricsTracker instead of destructuring the namespace.

async function createProjectFixture(prefix = "project-index-metrics-") {
    const { projectRoot, writeProjectFile, cleanup } = await createTempProjectWorkspace(prefix);

    const manifest = {
        name: "MetricsProject",
        resourceType: "GMProject"
    };

    const scriptDescriptor = {
        resourceType: "GMScript",
        name: "metricsScript"
    };

    await writeProjectFile("MetricsProject.yyp", JSON.stringify(manifest));

    await writeProjectFile("scripts/metricsScript/metricsScript.yy", JSON.stringify(scriptDescriptor));

    await writeProjectFile("scripts/metricsScript/metricsScript.gml", "/// @function metricsScript\nreturn 1;\n");

    return {
        projectRoot,
        async cleanup() {
            await cleanup();
        }
    };
}

const noop = () => {};

class TestMetricsTracker {
    startTimerCalls = 0;

    finalizeCalls = 0;

    startTimer = () => {
        this.startTimerCalls += 1;
        return noop;
    };

    constructor() {
        this.recording = Object.freeze({
            category: this.category,
            timers: Object.freeze({
                startTimer: this.startTimer,
                timeAsync: async (_label, callback) => callback(),
                timeSync: (_label, callback) => callback()
            }),
            counters: Object.freeze({
                increment() {}
            }),
            caches: Object.freeze({
                recordHit() {},
                recordMiss() {},
                recordStale() {},
                recordMetric() {}
            }),
            metadata: Object.freeze({
                setMetadata() {}
            })
        });

        this.reporting = Object.freeze({
            summary: Object.freeze({
                snapshot: (extra = {}) => ({
                    category: this.category,
                    totalTimeMs: 0,
                    timings: {},
                    counters: {},
                    caches: {},
                    metadata: { provided: true },
                    ...extra
                }),
                finalize: (extra = {}) => {
                    this.finalizeCalls += 1;
                    return {
                        category: this.category,
                        totalTimeMs: 0,
                        timings: {},
                        counters: {},
                        caches: {},
                        metadata: { provided: true },
                        ...extra
                    };
                }
            }),
            caches: Object.freeze({
                cachesSnapshot: () => ({}),
                cacheSnapshot: () => ({})
            }),
            logger: Object.freeze({
                logSummary() {}
            })
        });
    }
    category = "custom-metrics";

    recording: any;
    reporting: any;
}

void test("buildProjectIndex falls back to a noop metrics tracker when override is invalid", async () => {
    const fixture = await createProjectFixture();

    try {
        const index: any = await buildProjectIndex(fixture.projectRoot, undefined, {
            metrics: {}
        });

        assert.deepEqual(index.metrics, {
            category: "project-index",
            totalTimeMs: 0,
            timings: {},
            counters: {},
            caches: {},
            metadata: {}
        });
    } finally {
        await fixture.cleanup();
    }
});

void test("buildProjectIndex reuses a provided metrics tracker", async () => {
    const fixture = await createProjectFixture();
    const tracker = new TestMetricsTracker();

    try {
        const index: any = await buildProjectIndex(fixture.projectRoot, undefined, {
            metrics: tracker
        });

        assert.ok(tracker.startTimerCalls > 0, "expected custom metrics tracker to be exercised");
        assert.equal(tracker.finalizeCalls, 1);
        assert.equal(index.metrics.category, "custom-metrics");
        assert.deepEqual(index.metrics.metadata, { provided: true });
    } finally {
        await fixture.cleanup();
    }
});

void test("buildProjectIndex supports loggers that only expose a debug method", async () => {
    const fixture = await createProjectFixture("project-index-debug-logger-");
    const debugCalls: Array<{ message: string; payload: unknown }> = [];

    try {
        await buildProjectIndex(fixture.projectRoot, undefined, {
            logger: {
                debug(message?: string, payload?: unknown) {
                    debugCalls.push({
                        message: message ?? "",
                        payload: payload ?? null
                    });
                }
            }
        });

        assert.ok(debugCalls.length > 0, "expected buildProjectIndex to emit debug messages");
    } finally {
        await fixture.cleanup();
    }
});

void test("createMetricsTracker trims and deduplicates configured cache keys", () => {
    const tracker = Core.createMetricsTracker({
        cacheKeys: new Set([" hits ", "Misses", "custom", "custom", "", null, " stale "])
    });

    tracker.recording.caches.recordMetric("demo", "custom", 0);

    assert.deepEqual(tracker.reporting.caches.cacheSnapshot("demo", {}), {
        hits: 0,
        Misses: 0,
        custom: 0,
        stale: 0
    });
});

void test("createMetricsTracker falls back to default cache keys when normalization is empty", () => {
    const tracker = Core.createMetricsTracker({
        cacheKeys: [null, "   "]
    });

    tracker.recording.caches.recordMetric("demo", "custom", 0);

    assert.deepEqual(tracker.reporting.caches.cacheSnapshot("demo", {}), {
        hits: 0,
        misses: 0,
        stale: 0,
        custom: 0
    });
});

void test("createMetricsTracker falls back to default cache keys when option is invalid", () => {
    const tracker = Core.createMetricsTracker({ cacheKeys: 42 as any });

    tracker.recording.caches.recordMetric("demo", "custom", 0);

    assert.deepEqual(tracker.reporting.caches.cacheSnapshot("demo", {}), {
        hits: 0,
        misses: 0,
        stale: 0,
        custom: 0
    });
});
