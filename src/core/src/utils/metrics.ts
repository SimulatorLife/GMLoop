import { toArrayFromIterable } from "./array.js";
import { getOrCreateMapEntry, incrementMapValue } from "./object.js";
import { getNonEmptyString, normalizeStringList } from "./string.js";

const hasHrtime = typeof process?.hrtime?.bigint === "function";

const DEFAULT_CACHE_KEYS = Object.freeze(["hits", "misses", "stale"]);
const SUMMARY_SECTIONS = Object.freeze(["timings", "counters", "caches", "metadata"]);

function nowMs() {
    if (hasHrtime) {
        const ns = process.hrtime.bigint();
        return Number(ns / 1_000_000n);
    }
    return Date.now();
}

/**
 * Normalize a label string by trimming whitespace and replacing
 * consecutive spaces with a single space.
 * @param {string} label - The label to normalize.
 * @returns {string} The normalized label.
 */
function normalizeLabel(label) {
    return getNonEmptyString(label) ?? "unknown";
}

/**
 * @typedef {object} MetricsSnapshot
 * @property {string} category
 * @property {number} totalTimeMs
 * @property {Record<string, number>} timings
 * @property {Record<string, number>} counters
 * @property {Record<string, Record<string, number>>} caches
 * @property {Record<string, unknown>} metadata
 */

/**
 * @typedef {object} MetricsTimingTools
 * @property {(label: string) => () => void} startTimer
 * @property {(label: string, callback: () => any) => any} timeSync
 * @property {(label: string, callback: () => Promise<any>) => Promise<any>} timeAsync
 */

/**
 * @typedef {object} MetricsCounterTools
 * @property {(label: string, amount?: number) => void} increment
 */

/**
 * @typedef {object} MetricsCacheTools
 * @property {(cacheName: string) => void} recordHit
 * @property {(cacheName: string) => void} recordMiss
 * @property {(cacheName: string) => void} recordStale
 * @property {(cacheName: string, key: string, amount?: number) => void} recordMetric
 */

/**
 * Earlier iterations exposed a single `MetricsSummaryReporter` surface that
 * coupled summary lifecycle helpers with cache inspection. That wide contract
 * forced callers that only needed the high-level snapshot tools to depend on
 * the cache reporters (and vice versa). Splitting the collaborators lets
 * dependents import only the behaviour they exercise.
 */

/**
 * @typedef {object} MetricsSummaryLifecycle
 * @property {(extra?: object) => MetricsSnapshot} snapshot
 * @property {(extra?: object) => MetricsSnapshot} finalize
 */

/**
 * @typedef {object} MetricsCacheReporter
 * @property {(extra?: object) => Record<string, Record<string, number>>} cachesSnapshot
 * @property {(
 *   cacheName: string,
 *   extra?: object
 * ) => Record<string, number> | undefined} cacheSnapshot
 */

/**
 * @typedef {object} MetricsSummaryLogger
 * @property {(message?: string, extra?: object) => void} logSummary
 */

/**
 * @typedef {object} MetricsMetadataWriter
 * @property {(key: string, value: unknown) => void} setMetadata
 */

/**
 * @typedef {object} MetricsRecordingSuite
 * @property {string} category
 * @property {MetricsTimingTools} timers
 * @property {MetricsCounterTools} counters
 * @property {MetricsCacheTools} caches
 * @property {MetricsMetadataWriter} metadata
 */

/**
 * @typedef {object} MetricsReportingSuite
 * @property {MetricsSummaryLifecycle} summary
 * @property {MetricsCacheReporter} caches
 * @property {MetricsSummaryLogger} logger
 */

/**
 * @typedef {object} MetricsContracts
 * @property {MetricsRecordingSuite} recording
 * @property {MetricsReportingSuite} reporting
 */

function collectCacheKeyCandidates(keys) {
    if (keys == null) {
        return null;
    }

    if (typeof keys === "string" || Array.isArray(keys)) {
        return keys;
    }

    if (typeof keys?.[Symbol.iterator] === "function") {
        return toArrayFromIterable(keys);
    }

    return null;
}

function normalizeCacheKeys(keys) {
    const fallback = [...DEFAULT_CACHE_KEYS];
    const candidates = collectCacheKeyCandidates(keys);

    if (!candidates) {
        return fallback;
    }

    const normalized = normalizeStringList(candidates, {
        allowInvalidType: true
    });

    return normalized.length > 0 ? normalized : fallback;
}

function normalizeIncrementAmount(amount, fallback = 1) {
    if (amount === undefined) {
        return fallback;
    }

    const numeric = Number(amount);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function ensureCacheStats(caches, cacheKeys, cacheName) {
    const normalized = normalizeLabel(cacheName);
    return getOrCreateMapEntry(caches, normalized, () => new Map(cacheKeys.map((key) => [key, 0])));
}

function incrementCacheMetric(caches, cacheKeys, cacheName, key, amount = 1) {
    const stats = ensureCacheStats(caches, cacheKeys, cacheName);
    const normalizedKey = normalizeLabel(key);

    getOrCreateMapEntry(stats, normalizedKey, () => 0);

    const increment = normalizeIncrementAmount(amount, amount === undefined ? 1 : 0);

    if (increment === 0) {
        return;
    }

    incrementMapValue(stats, normalizedKey, increment, { fallback: 0 });
}

function mergeSummarySections(summary, extra) {
    for (const key of SUMMARY_SECTIONS) {
        const additions = extra[key];
        if (additions && typeof additions === "object") {
            Object.assign(summary[key], additions);
        }
    }
}

function createSummaryLogger({ logger, category, snapshot }) {
    if (!logger || typeof logger.debug !== "function") {
        return () => {};
    }

    return (message = "summary", extra = {}) => {
        logger.debug(`[${category}] ${message}`, snapshot(extra));
    };
}

function createFinalizer({ autoLog, logger, category, snapshot, timings, counters, caches, metadata }) {
    const hasDebug = typeof logger?.debug === "function";
    let hasLoggedSummary = false;

    return (extra = {}) => {
        const report = snapshot(extra);
        if (autoLog && hasDebug && !hasLoggedSummary) {
            logger.debug(`[${category}] summary`, report);
            hasLoggedSummary = true;
        }

        timings.clear();
        counters.clear();
        caches.clear();
        for (const key of Object.keys(metadata)) {
            delete metadata[key];
        }

        return report;
    };
}

/**
 * Construct a metrics tracker that records timing, counter, cache, and metadata
 * information for a formatter run.
 *
 * The tracker intentionally embraces loose inputs so callers can feed
 * user-supplied configuration without pre-validating everything. Cache keys can
 * arrive as iterables, timers tolerate synchronous or asynchronous callbacks,
 * and metadata gracefully ignores blank labels. All numeric inputs are coerced
 * through {@link Number} to avoid `NaN` pollution while still accepting string
 * representations from environment variables.
 *
 * @param {{
 *   category?: string,
 *   logger?: { debug?: (message: string, payload: unknown) => void } | null,
 *   autoLog?: boolean,
 *   cacheKeys?: Iterable<string> | ArrayLike<string>
 * }} [options]
 * @returns {MetricsContracts}
 */
type MetricsLogger = {
    debug?: (message: string, payload: unknown) => void;
};

type MetricsTrackerOptions = {
    category?: string;
    logger?: MetricsLogger | null;
    autoLog?: boolean;
    cacheKeys?: Iterable<string> | ArrayLike<string>;
};

export function createMetricsTracker({
    category = "metrics",
    logger = null,
    autoLog = false,
    cacheKeys: cacheKeyOption
}: MetricsTrackerOptions = {}) {
    const timings = new Map();
    const counters = new Map();
    const caches = new Map();
    const metadata = Object.create(null);
    const cacheKeys = normalizeCacheKeys(cacheKeyOption);

    const incrementTiming = (label, amount = 1) => {
        const normalized = normalizeLabel(label);
        incrementMapValue(timings, normalized, amount);
    };
    const incrementCounterBy = (label, amount = 1) => {
        const normalized = normalizeLabel(label);
        incrementMapValue(counters, normalized, amount);
    };
    const snapshot = (extra = {}) => {
        const timingsSnapshot = Object.fromEntries(timings) as Record<string, number>;
        const countersSnapshot = Object.fromEntries(counters) as Record<string, number>;
        const cachesSnapshot = Object.fromEntries(
            Array.from(caches, ([name, stats]) => [name, Object.fromEntries(stats)])
        );
        const totalTimeMs = Object.values(timingsSnapshot).reduce((total, value) => total + value, 0);
        const summary = {
            category,
            totalTimeMs,
            timings: timingsSnapshot,
            counters: countersSnapshot,
            caches: cachesSnapshot,
            metadata: { ...metadata }
        };

        if (!extra || typeof extra !== "object") {
            return summary;
        }

        mergeSummarySections(summary, extra);
        return summary;
    };
    const logSummary = createSummaryLogger({ logger, category, snapshot });
    const finalize = createFinalizer({
        autoLog,
        logger,
        category,
        snapshot,
        timings,
        counters,
        caches,
        metadata
    });

    function recordTiming(label, durationMs) {
        incrementTiming(label, Math.max(0, durationMs));
    }

    function startTimer(label) {
        const startedAt = nowMs();
        return () => {
            recordTiming(label, nowMs() - startedAt);
        };
    }

    function timeSync(label, callback) {
        const stop = startTimer(label);
        try {
            return callback();
        } finally {
            stop();
        }
    }

    async function timeAsync(label, callback) {
        const stop = startTimer(label);
        try {
            return await callback();
        } finally {
            stop();
        }
    }

    function incrementCounter(label, amount = 1) {
        incrementCounterBy(label, amount);
    }

    function setMetadata(key, value) {
        const normalizedKey = getNonEmptyString(key);
        if (!normalizedKey) {
            return;
        }
        metadata[normalizedKey] = value;
    }

    function recordCacheEvent(cacheName, key, amount = 1) {
        incrementCacheMetric(caches, cacheKeys, cacheName, key, amount);
    }

    const timingTools = Object.freeze({
        startTimer,
        timeSync,
        timeAsync
    });

    const counterTools = Object.freeze({
        increment: incrementCounter
    });

    const cacheTools = Object.freeze({
        recordHit(cacheName) {
            recordCacheEvent(cacheName, "hits");
        },
        recordMiss(cacheName) {
            recordCacheEvent(cacheName, "misses");
        },
        recordStale(cacheName) {
            recordCacheEvent(cacheName, "stale");
        },
        recordMetric(cacheName, key, amount = 1) {
            recordCacheEvent(cacheName, key, amount);
        }
    });

    const cachesSnapshot = (extra?: unknown) => snapshot(extra).caches;

    function cacheSnapshot(cacheName?: unknown, extra?: unknown) {
        if (cacheName === undefined) {
            return cachesSnapshot(extra);
        }

        const snapshotCaches = cachesSnapshot(extra);
        const normalized = normalizeLabel(cacheName);
        return snapshotCaches[normalized];
    }

    const summaryLifecycle = Object.freeze({
        snapshot,
        finalize
    });

    const cacheReporter = Object.freeze({
        cachesSnapshot,
        cacheSnapshot
    });

    const loggerTools = Object.freeze({
        logSummary
    });

    const metadataTools = Object.freeze({
        setMetadata
    });

    const recording = Object.freeze({
        category,
        timers: timingTools,
        counters: counterTools,
        caches: cacheTools,
        metadata: metadataTools
    });

    const reporting = Object.freeze({
        summary: summaryLifecycle,
        caches: cacheReporter,
        logger: loggerTools
    });

    return Object.freeze({
        recording,
        reporting
    });
}
