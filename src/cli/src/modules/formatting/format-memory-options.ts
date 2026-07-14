/**
 * Consolidated runtime options for format-command memory management.
 *
 * Replaces the previous pair of near-identical modules
 * (`format-memory-snapshots.ts` and `format-memory-cache.ts`) with a single
 * factory plus the two concrete options it produces. Both legacy files
 * implemented the same pattern: an env-configured integer state container
 * exposed via `getDefault`/`setDefault`/`applyEnvOverride` accessors. The
 * duplication has been collapsed into `createFormatMemoryRuntimeOption`,
 * which the two configurations instantiate with their own constant values
 * and human-readable subject labels.
 *
 * The default and env-var constants continue to live in
 * `format-memory-constants.ts`; this module only owns the runtime state and
 * accessor surface.
 */

import { Core } from "@gmloop/core";

import { createIntegerEnvConfiguredValue } from "../../shared/env-configured-integer.js";
import {
    DEFAULT_MAX_FORMATTING_CACHE_ENTRIES,
    DEFAULT_MAX_IN_MEMORY_SNAPSHOTS,
    MAX_FORMATTING_CACHE_ENTRIES_ENV_VAR,
    MAX_IN_MEMORY_SNAPSHOTS_ENV_VAR
} from "./format-memory-constants.js";

const { callWithFallback, coerceNonNegativeInteger, createNumericTypeErrorFormatter, describeValueForError } = Core;

interface FormatMemoryRuntimeOptionConfig {
    defaultValue: number;
    envVar: string;
    subjectLabel: string;
}

interface FormatMemoryRuntimeOption {
    getDefault: () => number;
    setDefault: (value?: unknown) => number;
    applyEnvOverride: (env?: NodeJS.ProcessEnv) => number;
}

/**
 * Build the environment-backed integer state container for one format-memory
 * runtime option. Centralises the boilerplate that used to be repeated for
 * each individual option (coercion closure, typed error message, env override
 * wrapper) so the concrete configurations only have to declare their
 * subject-specific constants.
 *
 * @param config Subject-specific default value, environment variable, and
 *               human-readable label used in validation error messages.
 * @returns A frozen accessor bundle with the same shape as the legacy
 *          `getDefault*`/`setDefault*`/`apply*EnvOverride` exports.
 */
function createFormatMemoryRuntimeOption(config: FormatMemoryRuntimeOptionConfig): FormatMemoryRuntimeOption {
    const { defaultValue, envVar, subjectLabel } = config;

    const createErrorMessage = (received: unknown) =>
        `${subjectLabel} must be a non-negative integer (received ${describeValueForError(
            received
        )}). Provide 0 to disable the limit.`;

    const typeErrorMessage = createNumericTypeErrorFormatter(subjectLabel);

    const coerce = (value: unknown, context: Record<string, unknown> = {}) => {
        return coerceNonNegativeInteger(value, { ...context, createErrorMessage });
    };

    const state = createIntegerEnvConfiguredValue({
        defaultValue,
        envVar,
        coerce,
        typeErrorMessage
    });

    return Object.freeze({
        getDefault: () => state.get() ?? defaultValue,
        setDefault: (value?: unknown) => state.set(value) ?? defaultValue,
        applyEnvOverride: (env?: NodeJS.ProcessEnv) =>
            callWithFallback(() => state.applyEnvOverride(env) ?? defaultValue, {
                fallback: () => defaultValue
            })
    });
}

/**
 * Runtime option controlling the maximum number of in-memory revert snapshots
 * retained for `format --on-parse-error=revert`. Replaces the legacy
 * `getDefaultMaxInMemorySnapshots` / `setDefaultMaxInMemorySnapshots` /
 * `applyMaxInMemorySnapshotsEnvOverride` exports from
 * `format-memory-snapshots.ts`.
 */
const inMemorySnapshots = createFormatMemoryRuntimeOption({
    defaultValue: DEFAULT_MAX_IN_MEMORY_SNAPSHOTS,
    envVar: MAX_IN_MEMORY_SNAPSHOTS_ENV_VAR,
    subjectLabel: "Maximum in-memory revert snapshots"
});

/**
 * Runtime option controlling the maximum number of formatting-cache entries
 * retained in memory. Replaces the legacy `getDefaultMaxFormattingCacheEntries`
 * / `setDefaultMaxFormattingCacheEntries` /
 * `applyMaxFormattingCacheEntriesEnvOverride` exports from
 * `format-memory-cache.ts`.
 */
const formattingCacheEntries = createFormatMemoryRuntimeOption({
    defaultValue: DEFAULT_MAX_FORMATTING_CACHE_ENTRIES,
    envVar: MAX_FORMATTING_CACHE_ENTRIES_ENV_VAR,
    subjectLabel: "Maximum formatting cache entries"
});

export const getDefaultMaxInMemorySnapshots = inMemorySnapshots.getDefault;
export const setDefaultMaxInMemorySnapshots = inMemorySnapshots.setDefault;
export const applyMaxInMemorySnapshotsEnvOverride = inMemorySnapshots.applyEnvOverride;

export const getDefaultMaxFormattingCacheEntries = formattingCacheEntries.getDefault;
export const setDefaultMaxFormattingCacheEntries = formattingCacheEntries.setDefault;
export const applyMaxFormattingCacheEntriesEnvOverride = formattingCacheEntries.applyEnvOverride;

applyMaxInMemorySnapshotsEnvOverride();
applyMaxFormattingCacheEntriesEnvOverride();
