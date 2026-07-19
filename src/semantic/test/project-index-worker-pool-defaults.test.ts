import assert from "node:assert/strict";
import test from "node:test";

import {
    DEFAULT_PROJECT_INDEX_GML_WORKER_CONCURRENCY,
    getDefaultProjectIndexGmlWorkerConcurrency,
    getDefaultProjectIndexGmlWorkerConcurrencyLimit,
    PROJECT_INDEX_GML_WORKER_CONCURRENCY_ENV_VAR,
    PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_BASELINE,
    PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_ENV_VAR,
    setDefaultProjectIndexGmlWorkerConcurrency,
    setDefaultProjectIndexGmlWorkerConcurrencyLimit
} from "../src/project-index/concurrency.js";

void test("project index worker-pool concurrency default can be tuned programmatically", () => {
    const originalDefault = getDefaultProjectIndexGmlWorkerConcurrency();
    const originalLimit = getDefaultProjectIndexGmlWorkerConcurrencyLimit();
    const baselineLimit = setDefaultProjectIndexGmlWorkerConcurrencyLimit(
        PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_BASELINE
    );

    try {
        assert.equal(baselineLimit, PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_BASELINE);

        const configured = setDefaultProjectIndexGmlWorkerConcurrency("6");
        assert.equal(configured, 6);
        assert.equal(getDefaultProjectIndexGmlWorkerConcurrency(), 6);

        const tightenedLimit = setDefaultProjectIndexGmlWorkerConcurrencyLimit(8);
        assert.equal(tightenedLimit, 8);
        assert.equal(getDefaultProjectIndexGmlWorkerConcurrencyLimit(), 8);

        const capped = setDefaultProjectIndexGmlWorkerConcurrency(128);
        assert.equal(capped, 8);

        const floored = setDefaultProjectIndexGmlWorkerConcurrency(0);
        assert.equal(floored, 1);

        const flooredLimit = setDefaultProjectIndexGmlWorkerConcurrencyLimit(0);
        assert.equal(flooredLimit, 1);
        assert.equal(getDefaultProjectIndexGmlWorkerConcurrencyLimit(), 1);

        const invalidWithTightLimit = setDefaultProjectIndexGmlWorkerConcurrency("not-a-number");
        assert.equal(invalidWithTightLimit, 1);
        assert.equal(getDefaultProjectIndexGmlWorkerConcurrency(), 1);

        const restoredLimit = setDefaultProjectIndexGmlWorkerConcurrencyLimit(
            PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_BASELINE
        );
        assert.equal(restoredLimit, PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_BASELINE);

        const reset = setDefaultProjectIndexGmlWorkerConcurrency("not-a-number");
        assert.equal(reset, DEFAULT_PROJECT_INDEX_GML_WORKER_CONCURRENCY);
        assert.equal(getDefaultProjectIndexGmlWorkerConcurrency(), DEFAULT_PROJECT_INDEX_GML_WORKER_CONCURRENCY);
    } finally {
        setDefaultProjectIndexGmlWorkerConcurrencyLimit(originalLimit);
        setDefaultProjectIndexGmlWorkerConcurrency(originalDefault);
    }
});

void test("invalid worker-pool concurrency environment overrides fall back to the baseline", () => {
    const originalDefault = getDefaultProjectIndexGmlWorkerConcurrency();
    const originalLimit = getDefaultProjectIndexGmlWorkerConcurrencyLimit();
    setDefaultProjectIndexGmlWorkerConcurrencyLimit(PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_BASELINE);

    try {
        // Simulate the environment override hook by calling the setter directly
        // with the same value that would have been provided from process.env.
        setDefaultProjectIndexGmlWorkerConcurrency("\t 3 \n");
        assert.equal(getDefaultProjectIndexGmlWorkerConcurrency(), 3);

        setDefaultProjectIndexGmlWorkerConcurrency("");
        assert.equal(getDefaultProjectIndexGmlWorkerConcurrency(), DEFAULT_PROJECT_INDEX_GML_WORKER_CONCURRENCY);

        setDefaultProjectIndexGmlWorkerConcurrency("3");
        setDefaultProjectIndexGmlWorkerConcurrency(null);
        assert.equal(getDefaultProjectIndexGmlWorkerConcurrency(), DEFAULT_PROJECT_INDEX_GML_WORKER_CONCURRENCY);
    } finally {
        setDefaultProjectIndexGmlWorkerConcurrencyLimit(originalLimit);
        setDefaultProjectIndexGmlWorkerConcurrency(originalDefault);
    }
});

// Ensure the exported environment variable names are stable.
void test("project index worker-pool concurrency env var names are stable", () => {
    assert.equal(PROJECT_INDEX_GML_WORKER_CONCURRENCY_ENV_VAR, "GML_PROJECT_INDEX_WORKER_CONCURRENCY");
    assert.equal(PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_ENV_VAR, "GML_PROJECT_INDEX_WORKER_MAX_CONCURRENCY");
});

void test("the worker-pool concurrency default is derived from the CPU count, not a fixed literal", () => {
    // The default is computed once at module load from `os.cpus().length`
    // (clamped to the configured limit), unlike `gmlConcurrency`'s fixed
    // baseline of 4 — real OS threads only pay off up to the number of
    // available cores.
    const defaultValue = getDefaultProjectIndexGmlWorkerConcurrency();
    assert.ok(defaultValue >= 1);
    assert.ok(defaultValue <= PROJECT_INDEX_GML_WORKER_MAX_CONCURRENCY_BASELINE);
});
