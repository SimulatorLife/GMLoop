import os from "node:os";

import { Core } from "@gmloop/core";

import {
    PROJECT_INDEX_GML_CONCURRENCY_BASELINE,
    PROJECT_INDEX_GML_MAX_CONCURRENCY_BASELINE,
    PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_BASELINE
} from "./constants.js";

const PROJECT_INDEX_GML_CONCURRENCY_ENV_VAR = "GML_PROJECT_INDEX_CONCURRENCY";
const PROJECT_INDEX_GML_MAX_CONCURRENCY_ENV_VAR = "GML_PROJECT_INDEX_MAX_CONCURRENCY";
const PROJECT_INDEX_GML_WORKER_CONCURRENCY_ENV_VAR = "GML_PROJECT_INDEX_WORKER_CONCURRENCY";
const PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_ENV_VAR = "GML_PROJECT_INDEX_WORKER_MAX_CONCURRENCY";
const MIN_CONCURRENCY = 1;

/**
 * Baseline worker-thread pool size before any env override or explicit
 * per-build configuration is applied. Real CPU parallelism only pays off up
 * to the number of physical/logical cores available, so the baseline tracks
 * `os.cpus().length` (evaluated once at module load) rather than a fixed
 * literal like the promise-based `gmlConcurrency` default.
 */
function computeDefaultProjectIndexGmlWorkerConcurrencyBaseline(): number {
    const cpuCount = Core.toFiniteNumber(os.cpus().length);
    return Core.clamp(cpuCount ?? MIN_CONCURRENCY, MIN_CONCURRENCY, PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_BASELINE);
}

const PROJECT_INDEX_GML_WORKER_CONCURRENCY_BASELINE = computeDefaultProjectIndexGmlWorkerConcurrencyBaseline();

const projectIndexConcurrencyLimitConfig = Core.createEnvConfiguredValueWithFallback({
    defaultValue: PROJECT_INDEX_GML_MAX_CONCURRENCY_BASELINE,
    envVar: PROJECT_INDEX_GML_MAX_CONCURRENCY_ENV_VAR,
    resolve: (value, { fallback }) =>
        normalizeConcurrencyValue(value, {
            min: MIN_CONCURRENCY,
            max: Number.MAX_SAFE_INTEGER,
            fallback,
            onInvalid: fallback
        }),
    computeFallback: ({ defaultValue }) => defaultValue
});

const projectIndexConcurrencyConfig = Core.createEnvConfiguredValueWithFallback({
    defaultValue: PROJECT_INDEX_GML_CONCURRENCY_BASELINE,
    envVar: PROJECT_INDEX_GML_CONCURRENCY_ENV_VAR,
    resolve: (value, { fallback }) => {
        const limit = Math.max(MIN_CONCURRENCY, getDefaultProjectIndexGmlConcurrencyLimit());
        const normalizedFallback = normalizeConcurrencyValue(fallback, {
            min: MIN_CONCURRENCY,
            max: limit,
            fallback: limit,
            onInvalid: limit
        });

        return normalizeConcurrencyValue(value, {
            min: MIN_CONCURRENCY,
            max: limit,
            fallback: normalizedFallback,
            onInvalid: normalizedFallback
        });
    },
    computeFallback: ({ defaultValue }) => defaultValue
});

function getDefaultProjectIndexGmlConcurrency(): number {
    return projectIndexConcurrencyConfig.get();
}

function getDefaultProjectIndexGmlConcurrencyLimit(): number {
    return projectIndexConcurrencyLimitConfig.get();
}

function clampConcurrency(
    value: unknown,
    {
        min = MIN_CONCURRENCY,
        max = getDefaultProjectIndexGmlConcurrencyLimit(),
        fallback = getDefaultProjectIndexGmlConcurrency()
    }: { min?: number; max?: number; fallback?: unknown } = {}
) {
    const limit = Math.max(min, max);
    const normalizedFallback = normalizeConcurrencyValue(fallback, {
        min,
        max: limit,
        fallback: limit,
        onInvalid: limit
    });

    return normalizeConcurrencyValue(value, {
        min,
        max: limit,
        fallback: normalizedFallback,
        onInvalid: normalizedFallback
    });
}

function setDefaultProjectIndexGmlConcurrency(concurrency: unknown) {
    return projectIndexConcurrencyConfig.set(concurrency);
}

function setDefaultProjectIndexGmlConcurrencyLimit(limit: unknown) {
    return projectIndexConcurrencyLimitConfig.set(limit);
}

function applyProjectIndexConcurrencyEnvOverride(env?: Record<string, string> | null) {
    Core.applyConfiguredValueEnvOverride(projectIndexConcurrencyConfig, env);
}

function applyProjectIndexConcurrencyLimitEnvOverride(env?: Record<string, string> | null) {
    Core.applyConfiguredValueEnvOverride(projectIndexConcurrencyLimitConfig, env);
}

applyProjectIndexConcurrencyLimitEnvOverride();
const DEFAULT_PROJECT_INDEX_GML_CONCURRENCY_LIMIT = getDefaultProjectIndexGmlConcurrencyLimit();

applyProjectIndexConcurrencyEnvOverride();

const DEFAULT_PROJECT_INDEX_GML_CONCURRENCY = getDefaultProjectIndexGmlConcurrency();

const projectIndexWorkerConcurrencyLimitConfig = Core.createEnvConfiguredValueWithFallback({
    defaultValue: PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_BASELINE,
    envVar: PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_ENV_VAR,
    resolve: (value, { fallback }) =>
        normalizeConcurrencyValue(value, {
            min: MIN_CONCURRENCY,
            max: Number.MAX_SAFE_INTEGER,
            fallback,
            onInvalid: fallback
        }),
    computeFallback: ({ defaultValue }) => defaultValue
});

const projectIndexWorkerConcurrencyConfig = Core.createEnvConfiguredValueWithFallback({
    defaultValue: PROJECT_INDEX_GML_WORKER_CONCURRENCY_BASELINE,
    envVar: PROJECT_INDEX_GML_WORKER_CONCURRENCY_ENV_VAR,
    resolve: (value, { fallback }) => {
        const limit = Math.max(MIN_CONCURRENCY, getDefaultProjectIndexGmlWorkerConcurrencyLimit());
        const normalizedFallback = normalizeConcurrencyValue(fallback, {
            min: MIN_CONCURRENCY,
            max: limit,
            fallback: limit,
            onInvalid: limit
        });

        return normalizeConcurrencyValue(value, {
            min: MIN_CONCURRENCY,
            max: limit,
            fallback: normalizedFallback,
            onInvalid: normalizedFallback
        });
    },
    computeFallback: ({ defaultValue }) => defaultValue
});

function getDefaultProjectIndexGmlWorkerConcurrency(): number {
    return projectIndexWorkerConcurrencyConfig.get();
}

function getDefaultProjectIndexGmlWorkerConcurrencyLimit(): number {
    return projectIndexWorkerConcurrencyLimitConfig.get();
}

/**
 * Clamp a candidate worker-thread pool size the same way {@link clampConcurrency}
 * clamps the promise-based `gmlConcurrency` setting, but against the
 * worker-specific default/limit pair so the two knobs can be tuned
 * independently (real OS threads are far more expensive than promise lanes).
 */
function clampWorkerConcurrency(
    value: unknown,
    {
        min = MIN_CONCURRENCY,
        max = getDefaultProjectIndexGmlWorkerConcurrencyLimit(),
        fallback = getDefaultProjectIndexGmlWorkerConcurrency()
    }: { min?: number; max?: number; fallback?: unknown } = {}
) {
    const limit = Math.max(min, max);
    const normalizedFallback = normalizeConcurrencyValue(fallback, {
        min,
        max: limit,
        fallback: limit,
        onInvalid: limit
    });

    return normalizeConcurrencyValue(value, {
        min,
        max: limit,
        fallback: normalizedFallback,
        onInvalid: normalizedFallback
    });
}

function setDefaultProjectIndexGmlWorkerConcurrency(concurrency: unknown) {
    return projectIndexWorkerConcurrencyConfig.set(concurrency);
}

function setDefaultProjectIndexGmlWorkerConcurrencyLimit(limit: unknown) {
    return projectIndexWorkerConcurrencyLimitConfig.set(limit);
}

function applyProjectIndexWorkerConcurrencyEnvOverride(env?: Record<string, string> | null) {
    Core.applyConfiguredValueEnvOverride(projectIndexWorkerConcurrencyConfig, env);
}

function applyProjectIndexWorkerConcurrencyLimitEnvOverride(env?: Record<string, string> | null) {
    Core.applyConfiguredValueEnvOverride(projectIndexWorkerConcurrencyLimitConfig, env);
}

applyProjectIndexWorkerConcurrencyLimitEnvOverride();
const DEFAULT_PROJECT_INDEX_GML_WORKER_CONCURRENCY_LIMIT = getDefaultProjectIndexGmlWorkerConcurrencyLimit();

applyProjectIndexWorkerConcurrencyEnvOverride();

const DEFAULT_PROJECT_INDEX_GML_WORKER_CONCURRENCY = getDefaultProjectIndexGmlWorkerConcurrency();

function normalizeConcurrencyValue(
    value: unknown,
    {
        min = MIN_CONCURRENCY,
        max = getDefaultProjectIndexGmlConcurrencyLimit(),
        fallback,
        onInvalid = min
    }: {
        min?: number;
        max?: number;
        fallback?: unknown;
        onInvalid?: number;
    } = {}
) {
    const source = value ?? fallback;

    if (source == null) {
        return onInvalid;
    }

    const normalized = typeof source === "string" ? source.trim() : source;

    if (normalized === "") {
        return onInvalid;
    }

    const numeric = Core.toFiniteNumber(normalized);
    if (numeric === null) {
        return onInvalid;
    }

    return Core.clamp(numeric, min, max);
}

export {
    applyProjectIndexConcurrencyEnvOverride,
    applyProjectIndexConcurrencyLimitEnvOverride,
    applyProjectIndexWorkerConcurrencyEnvOverride,
    applyProjectIndexWorkerConcurrencyLimitEnvOverride,
    clampConcurrency,
    clampWorkerConcurrency,
    DEFAULT_PROJECT_INDEX_GML_CONCURRENCY,
    DEFAULT_PROJECT_INDEX_GML_CONCURRENCY_LIMIT,
    DEFAULT_PROJECT_INDEX_GML_WORKER_CONCURRENCY,
    DEFAULT_PROJECT_INDEX_GML_WORKER_CONCURRENCY_LIMIT,
    getDefaultProjectIndexGmlConcurrency,
    getDefaultProjectIndexGmlConcurrencyLimit,
    getDefaultProjectIndexGmlWorkerConcurrency,
    getDefaultProjectIndexGmlWorkerConcurrencyLimit,
    PROJECT_INDEX_GML_CONCURRENCY_ENV_VAR,
    PROJECT_INDEX_GML_MAX_CONCURRENCY_ENV_VAR,
    PROJECT_INDEX_GML_WORKER_CONCURRENCY_ENV_VAR,
    PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_ENV_VAR,
    setDefaultProjectIndexGmlConcurrency,
    setDefaultProjectIndexGmlConcurrencyLimit,
    setDefaultProjectIndexGmlWorkerConcurrency,
    setDefaultProjectIndexGmlWorkerConcurrencyLimit
};

export {
    PROJECT_INDEX_GML_CONCURRENCY_BASELINE,
    PROJECT_INDEX_GML_MAX_CONCURRENCY_BASELINE,
    PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_BASELINE,
    PROJECT_INDEX_GML_WORKER_POOL_MIN_FILES
} from "./constants.js";
