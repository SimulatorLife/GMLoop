import { Core } from "@gmloop/core";

const PROJECT_INDEX_METRICS_CATEGORY = "project-index";
const REQUIRED_RECORDING_GROUPS = Object.freeze({
    timers: ["startTimer", "timeAsync", "timeSync"],
    counters: ["increment"],
    caches: ["recordHit", "recordMiss", "recordStale", "recordMetric"],
    metadata: ["setMetadata"]
});

const REQUIRED_REPORTING_GROUPS = Object.freeze({
    summary: ["snapshot", "finalize"],
    caches: ["cachesSnapshot", "cacheSnapshot"],
    logger: ["logSummary"]
});

export type MetricsSnapshot = {
    category: string;
    totalTimeMs: number;
    timings: Record<string, number>;
    counters: Record<string, number>;
    caches: Record<string, Record<string, number>>;
    metadata: Record<string, unknown>;
};

export type ProjectIndexMetricsRecording = {
    category: string;
    timers: {
        startTimer(label: string): () => void;
        timeSync<T>(label: string, callback: () => T): T;
        timeAsync<T>(label: string, callback: () => Promise<T>): Promise<T>;
    };
    counters: {
        increment(label: string, amount?: number): void;
    };
    caches: {
        recordHit(name: string): void;
        recordMiss(name: string): void;
        recordStale(name: string): void;
        recordMetric(name: string, key: string, amount?: number): void;
    };
    metadata: {
        setMetadata(key: string, value: unknown): void;
    };
};

export type ProjectIndexMetricsReporting = {
    summary: {
        snapshot(extra?: Record<string, unknown>): MetricsSnapshot;
        finalize(extra?: Record<string, unknown>): MetricsSnapshot;
    };
    caches: {
        cachesSnapshot(extra?: Record<string, unknown>): unknown;
        cacheSnapshot(cacheName: string, extra?: Record<string, unknown>): unknown;
    };
    logger: {
        logSummary(message?: string, extra?: Record<string, unknown>): void;
    };
};

export type ProjectIndexMetricsContracts = {
    recording: ProjectIndexMetricsRecording;
    reporting: ProjectIndexMetricsReporting;
};

function hasMetricGroup(candidate, groupName, methodNames) {
    const group = candidate?.[groupName];
    return Core.isObjectLike(group) && methodNames.every((method) => typeof group[method] === "function");
}

function isMetricsRecordingSuite(candidate: unknown): candidate is ProjectIndexMetricsRecording {
    if (!Core.isObjectLike(candidate)) {
        return false;
    }

    const candidateObject = candidate as Record<string, unknown>;
    if (typeof candidateObject.category !== "string") {
        return false;
    }

    return Object.entries(REQUIRED_RECORDING_GROUPS).every(([groupName, methods]) =>
        hasMetricGroup(candidateObject, groupName, methods)
    );
}

function isMetricsReportingSuite(candidate: unknown): candidate is ProjectIndexMetricsReporting {
    if (!Core.isObjectLike(candidate)) {
        return false;
    }

    const candidateObject = candidate as Record<string, unknown>;

    return Object.entries(REQUIRED_REPORTING_GROUPS).every(([groupName, methods]) =>
        hasMetricGroup(candidateObject, groupName, methods)
    );
}

function isMetricsContracts(candidate: unknown): candidate is ProjectIndexMetricsContracts {
    if (!Core.isObjectLike(candidate)) {
        return false;
    }

    const candidateObject = candidate as Record<string, unknown>;

    return isMetricsRecordingSuite(candidateObject.recording) && isMetricsReportingSuite(candidateObject.reporting);
}

function createMetricsSnapshot(extra: Record<string, unknown> | undefined = {}): MetricsSnapshot {
    return {
        category: PROJECT_INDEX_METRICS_CATEGORY,
        totalTimeMs: 0,
        timings: {},
        counters: {},
        caches: {},
        metadata: {},
        ...extra
    };
}

// The project-index builder, rename planner, and CLI performance harness all
// assume that a metrics tracker exposes timing helpers returning cleanup
// handles plus structured snapshot/finalize data.
// Those flows treat the tracker as an interchangeable dependency injection
// seam: external hosts can provide their own metric recorder, but every caller
// still `await`s the timer cleanup callbacks and persists the final snapshot to
// disk. If a host passes a truthy-but-incomplete tracker we cannot simply bail
// out. Dropping the callbacks or returning nullish sentinels would short-circuit
// the timing wrappers and hang cache invalidation waits, while omitting
// `snapshot`/`finalize` would crash cache writers that persist the metrics
// summary. Keeping these fallbacks wired like the real implementation protects
// both the CLI (which logs metrics after each run) and long-lived integrations
// that rely on the tracker contract remaining stable even when misconfigured.
const noopTimer = () => {};
const startNoopTimer = () => noopTimer;

const NOOP_METRIC_RECORDING_GROUPS = Object.freeze({
    timers: Object.freeze({
        startTimer: startNoopTimer,
        timeAsync: async (_label, callback) => await callback(),
        timeSync: (_label, callback) => callback()
    }),
    counters: Object.freeze({
        increment: Core.noop
    }),
    caches: Object.freeze({
        recordHit: Core.noop,
        recordMiss: Core.noop,
        recordStale: Core.noop,
        recordMetric: Core.noop
    })
});

const NOOP_METRIC_REPORTING_GROUPS = Object.freeze({
    summary: Object.freeze({
        snapshot: createMetricsSnapshot,
        finalize: createMetricsSnapshot
    }),
    caches: Object.freeze({
        cachesSnapshot: () => ({}),
        cacheSnapshot: () => ({})
    }),
    logger: Object.freeze({
        logSummary: Core.noop
    })
});

function createNoopProjectIndexMetrics(): ProjectIndexMetricsContracts {
    return Object.freeze({
        recording: Object.freeze({
            category: PROJECT_INDEX_METRICS_CATEGORY,
            ...NOOP_METRIC_RECORDING_GROUPS,
            metadata: Object.freeze({
                setMetadata: Core.noop
            })
        }),
        reporting: Object.freeze({
            ...NOOP_METRIC_REPORTING_GROUPS
        })
    });
}

export function createProjectIndexMetrics(
    options: {
        metrics?: unknown;
        logger?: {
            debug?: (message?: string, payload?: unknown) => void;
        } | null;
        logMetrics?: boolean;
    } = {}
): ProjectIndexMetricsContracts {
    const { metrics, logger = null, logMetrics = false } = options;

    if (isMetricsContracts(metrics)) {
        return metrics;
    }

    if (metrics !== undefined) {
        return createNoopProjectIndexMetrics();
    }

    return Core.createMetricsTracker({
        category: PROJECT_INDEX_METRICS_CATEGORY,
        logger,
        autoLog: logMetrics === true
    });
}

export function finalizeProjectIndexMetrics(reporting: unknown) {
    if (!isMetricsReportingSuite(reporting)) {
        return null;
    }

    return reporting.summary.finalize();
}
