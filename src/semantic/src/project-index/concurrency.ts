import { Core } from "@gmloop/core";

import { PROJECT_INDEX_GML_CONCURRENCY_BASELINE, PROJECT_INDEX_GML_MAX_CONCURRENCY_BASELINE } from "./constants.js";

const PROJECT_INDEX_GML_CONCURRENCY_ENV_VAR = "GML_PROJECT_INDEX_CONCURRENCY";
const PROJECT_INDEX_GML_MAX_CONCURRENCY_ENV_VAR = "GML_PROJECT_INDEX_MAX_CONCURRENCY";
const MIN_CONCURRENCY = 1;

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
    clampConcurrency,
    DEFAULT_PROJECT_INDEX_GML_CONCURRENCY,
    DEFAULT_PROJECT_INDEX_GML_CONCURRENCY_LIMIT,
    getDefaultProjectIndexGmlConcurrency,
    getDefaultProjectIndexGmlConcurrencyLimit,
    PROJECT_INDEX_GML_CONCURRENCY_ENV_VAR,
    PROJECT_INDEX_GML_MAX_CONCURRENCY_ENV_VAR,
    setDefaultProjectIndexGmlConcurrency,
    setDefaultProjectIndexGmlConcurrencyLimit
};

export { PROJECT_INDEX_GML_CONCURRENCY_BASELINE, PROJECT_INDEX_GML_MAX_CONCURRENCY_BASELINE } from "./constants.js";
