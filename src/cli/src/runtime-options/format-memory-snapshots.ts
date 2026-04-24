import { Core } from "@gmloop/core";

import { createIntegerEnvConfiguredValue } from "../shared/env-configured-integer.js";
import { DEFAULT_MAX_IN_MEMORY_SNAPSHOTS, MAX_IN_MEMORY_SNAPSHOTS_ENV_VAR } from "./format-memory-constants.js";

const { callWithFallback, coerceNonNegativeInteger, createNumericTypeErrorFormatter, describeValueForError } = Core;

const createSnapshotLimitErrorMessage = (received: unknown) =>
    `Maximum in-memory revert snapshots must be a non-negative integer (received ${describeValueForError(received)}). Provide 0 to disable in-memory snapshot retention.`;

const createSnapshotLimitTypeErrorMessage = createNumericTypeErrorFormatter("Maximum in-memory revert snapshots");

const coerceSnapshotLimit = (value: unknown, context = {}) => {
    const opts = { ...context, createErrorMessage: createSnapshotLimitErrorMessage };
    return coerceNonNegativeInteger(value, opts);
};

const state = createIntegerEnvConfiguredValue({
    defaultValue: DEFAULT_MAX_IN_MEMORY_SNAPSHOTS,
    envVar: MAX_IN_MEMORY_SNAPSHOTS_ENV_VAR,
    coerce: coerceSnapshotLimit,
    typeErrorMessage: createSnapshotLimitTypeErrorMessage
});

/**
 * Reads the default cap for in-memory revert snapshots.
 */
export function getDefaultMaxInMemorySnapshots(): number {
    return state.get() ?? DEFAULT_MAX_IN_MEMORY_SNAPSHOTS;
}

/**
 * Overrides the default cap for in-memory revert snapshots.
 */
export function setDefaultMaxInMemorySnapshots(value?: unknown): number {
    return state.set(value) ?? DEFAULT_MAX_IN_MEMORY_SNAPSHOTS;
}

/**
 * Applies environment overrides for the in-memory snapshot cap.
 */
export function applyMaxInMemorySnapshotsEnvOverride(env?: NodeJS.ProcessEnv): number {
    const applied = callWithFallback(() => state.applyEnvOverride(env), {
        fallback: () => getDefaultMaxInMemorySnapshots()
    });

    return applied ?? DEFAULT_MAX_IN_MEMORY_SNAPSHOTS;
}

applyMaxInMemorySnapshotsEnvOverride();
