import { Core } from "@gmloop/core";

import { createIntegerEnvConfiguredValue } from "../shared/env-configured-integer.js";
import {
    DEFAULT_MAX_FORMATTING_CACHE_ENTRIES,
    MAX_FORMATTING_CACHE_ENTRIES_ENV_VAR
} from "./format-memory-constants.js";

const { callWithFallback, coerceNonNegativeInteger, createNumericTypeErrorFormatter, describeValueForError } = Core;

const createCacheLimitErrorMessage = (received: unknown) =>
    `Maximum formatting cache entries must be a non-negative integer (received ${describeValueForError(received)}). Provide 0 to disable formatting cache retention.`;

const createCacheLimitTypeErrorMessage = createNumericTypeErrorFormatter("Maximum formatting cache entries");

const coerceCacheLimit = (value: unknown, context = {}) => {
    const opts = { ...context, createErrorMessage: createCacheLimitErrorMessage };
    return coerceNonNegativeInteger(value, opts);
};

const state = createIntegerEnvConfiguredValue({
    defaultValue: DEFAULT_MAX_FORMATTING_CACHE_ENTRIES,
    envVar: MAX_FORMATTING_CACHE_ENTRIES_ENV_VAR,
    coerce: coerceCacheLimit,
    typeErrorMessage: createCacheLimitTypeErrorMessage
});

/**
 * Reads the default cap for in-memory formatting-cache entries.
 */
export function getDefaultMaxFormattingCacheEntries(): number {
    return state.get() ?? DEFAULT_MAX_FORMATTING_CACHE_ENTRIES;
}

/**
 * Overrides the default cap for in-memory formatting-cache entries.
 */
export function setDefaultMaxFormattingCacheEntries(value?: unknown): number {
    return state.set(value) ?? DEFAULT_MAX_FORMATTING_CACHE_ENTRIES;
}

/**
 * Applies environment overrides for the formatting-cache entry cap.
 */
export function applyMaxFormattingCacheEntriesEnvOverride(env?: NodeJS.ProcessEnv): number {
    const applied = callWithFallback(() => state.applyEnvOverride(env), {
        fallback: () => getDefaultMaxFormattingCacheEntries()
    });

    return applied ?? DEFAULT_MAX_FORMATTING_CACHE_ENTRIES;
}

applyMaxFormattingCacheEntriesEnvOverride();
