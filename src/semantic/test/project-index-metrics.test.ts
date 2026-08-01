import assert from "node:assert/strict";
import test from "node:test";

import { Core } from "@gmloop/core";

import {
    buildProjectIndex,
    type MetricsSnapshot,
    type ProjectIndexMetricsContracts
} from "../src/project-index/index.js";
import { createTempProjectWorkspace } from "./test-project-helpers.js";

// Use Core.createMetricsTracker instead of destructuring the namespace.

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

type ProjectIndexWithMetrics = Readonly<{
    metrics: MetricsSnapshot;
}>;

const noop = (): void => {};

class TestMetricsTracker implements ProjectIndexMetricsContracts {
    readonly category = "custom-metrics";

    startTimerCalls = 0;

    finalizeCalls = 0;

    startTimer = (_label: string): (() => void) => {
        this.startTimerCalls += 1;
        return noop;
    };

    readonly recording: ProjectIndexMetricsContracts["recording"];

    readonly reporting: ProjectIndexMetricsContracts["reporting"];

    constructor() {
        this.recording = Object.freeze({
            category: this.category,
            timers: Object.freeze({
                startTimer: this.startTimer,
                timeAsync: async <Result>(_label: string, callback: () => Promise<Result>): Promise<Result> =>
                    callback(),
                timeSync: <Result>(_label: string, callback: () => Result): Result => callback()
            }),
            counters: Object.freeze({
                increment(_label: string, _amount: number = 1): void {}
            }),
            caches: Object.freeze({
                recordHit(_name: string): void {},
                recordMiss(_name: string): void {},
                recordStale(_name: string): void {},
                recordMetric(_name: string, _key: string, _amount: number = 1): void {}
            }),
            metadata: Object.freeze({
                setMetadata(_key: string, _value: unknown): void {}
            })
        });

        this.reporting = Object.freeze({
            summary: Object.freeze({
                snapshot: (extra: Record<string, unknown> = {}): MetricsSnapshot => ({
                    category: this.category,
                    totalTimeMs: 0,
                    timings: {},
                    counters: {},
                    caches: {},
                    metadata: { provided: true },
                    ...extra
                }),
                finalize: (extra: Record<string, unknown> = {}): MetricsSnapshot => {
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
                cachesSnapshot: (_extra: Record<string, unknown> = {}): unknown => ({}),
                cacheSnapshot: (_cacheName: string, _extra: Record<string, unknown> = {}): unknown => ({})
            }),
            logger: Object.freeze({
                logSummary(_message?: string, _extra?: Record<string, unknown>): void {}
            })
        });
    }
}

void test("buildProjectIndex falls back to a noop metrics tracker when override is invalid", async () => {
    const fixture = await createProjectFixture();

    try {
        const index: ProjectIndexWithMetrics = await buildProjectIndex(fixture.projectRoot, undefined, {
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
        const index: ProjectIndexWithMetrics = await buildProjectIndex(fixture.projectRoot, undefined, {
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

void test("buildProjectIndex records precise file phases and build identity", async () => {
    const fixture = await createProjectFixture("project-index-phase-metrics-");

    try {
        const index: ProjectIndexWithMetrics = await buildProjectIndex(fixture.projectRoot, undefined, {
            definitionsOnly: true
        });

        assert.equal(index.metrics.counters["files.gmlRead"], 1);
        assert.equal(index.metrics.counters["files.gmlParsed"], 1);
        assert.equal(index.metrics.counters["files.gmlAnalysed"], 1);
        assert.equal(index.metrics.counters["files.incrementalSelected"], 0);
        assert.equal(index.metrics.metadata.buildMode, "project");
        assert.equal(index.metrics.metadata.analysisTier, "definitions");
        assert.ok(Number(index.metrics.metadata["memory.sampledPeakRssBytes"]) > 0);
        assert.ok(Number(index.metrics.metadata["memory.sampledPeakHeapUsedBytes"]) > 0);
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
    const tracker: ReturnType<typeof Core.createMetricsTracker> = Reflect.apply(Core.createMetricsTracker, undefined, [
        { cacheKeys: 42 }
    ]);

    tracker.recording.caches.recordMetric("demo", "custom", 0);

    assert.deepEqual(tracker.reporting.caches.cacheSnapshot("demo", {}), {
        hits: 0,
        misses: 0,
        stale: 0,
        custom: 0
    });
});
