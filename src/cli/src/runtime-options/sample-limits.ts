import { Core } from "@gmloop/core";

const { coerceNonNegativeInteger, describeValueForError, resolveIntegerOption } = Core;

interface SampleLimitOptionParams {
    defaultValue?: number;
    envVar?: string;
    subjectLabel?: string;
}

/**
 * Mutable runtime state for one CLI sample-limit setting.
 *
 * The CLI uses this contract to share consistent default handling,
 * programmatic overrides, and environment-driven overrides across the
 * different reporting sample-limit knobs.
 */
export interface SampleLimitRuntimeOption {
    defaultValue?: number;
    envVar?: string;
    getDefault: () => number | undefined;
    setDefault: (value?: unknown) => number | undefined;
    resolve: (value?: unknown, options?: { defaultLimit?: number }) => number | null | undefined;
    applyEnvOverride: (env?: NodeJS.ProcessEnv) => number | undefined;
}

/**
 * Creates the runtime state machine for a CLI sample limit.
 *
 * Consolidating the factory with the exported sample-limit configurations keeps
 * the entire sample-limit concept discoverable from one domain file instead of
 * splitting it across a config module and a trivial single-function toolkit
 * module.
 */
export function createSampleLimitRuntimeOption(
    params: SampleLimitOptionParams,
    { env }: { env?: NodeJS.ProcessEnv } = {}
): SampleLimitRuntimeOption {
    const { defaultValue, envVar, subjectLabel = "Sample" } = params;

    let currentDefault = defaultValue;

    const coerce = (val: unknown) =>
        coerceNonNegativeInteger(val, {
            createErrorMessage: (received: unknown) =>
                `${subjectLabel} sample limit must be a non-negative integer (received ${describeValueForError(received)}). Provide 0 to suppress the sample list.`
        });

    const typeErrorMessage = (type: string) =>
        `${subjectLabel} sample limit must be provided as a number (received type '${type}').`;

    const getDefault = () => currentDefault;

    const resolveValue = (value: unknown, options: { defaultValue?: number } = {}) =>
        resolveIntegerOption(value, {
            defaultValue: options.defaultValue ?? currentDefault,
            coerce,
            typeErrorMessage
        });

    const setDefault = (value?: unknown) => {
        currentDefault = value === undefined ? defaultValue : resolveValue(value, { defaultValue });
        return currentDefault;
    };

    const applyEnvOverride = (overrideEnv?: NodeJS.ProcessEnv) => {
        const targetEnv = overrideEnv ?? env;
        if (envVar && targetEnv?.[envVar]) {
            currentDefault = resolveValue(targetEnv[envVar], { defaultValue });
        }
        return currentDefault;
    };

    const resolve = (value?: unknown, options: { defaultLimit?: number } = {}) =>
        resolveValue(value, {
            defaultValue: options.defaultLimit ?? currentDefault
        });

    applyEnvOverride();

    return Object.freeze({
        defaultValue,
        envVar,
        getDefault,
        setDefault,
        resolve,
        applyEnvOverride
    });
}

/**
 * Consolidated sample limit configurations for CLI reporting.
 *
 * Previously fragmented across three separate modules (ignored-file-sample-limit,
 * skipped-directory-sample-limit, unsupported-extension-sample-limit), each
 * duplicating the same factory pattern with different parameters. This
 * consolidation groups related configuration together, reducing module
 * proliferation while maintaining the same public API.
 *
 * Each configuration is frozen and exported under its original name to ensure
 * drop-in compatibility with existing consumers.
 */
export const ignoredFileSampleLimit = createSampleLimitRuntimeOption({
    defaultValue: 5,
    envVar: "PRETTIER_PLUGIN_GML_IGNORED_FILE_SAMPLE_LIMIT",
    subjectLabel: "Ignored file"
});

export const {
    defaultValue: DEFAULT_IGNORED_FILE_SAMPLE_LIMIT,
    envVar: IGNORED_FILE_SAMPLE_LIMIT_ENV_VAR,
    getDefault: getDefaultIgnoredFileSampleLimit,
    setDefault: setDefaultIgnoredFileSampleLimit,
    resolve: resolveIgnoredFileSampleLimit,
    applyEnvOverride: applyIgnoredFileSampleLimitEnvOverride
} = ignoredFileSampleLimit;

export const skippedDirectorySampleLimit = createSampleLimitRuntimeOption({
    defaultValue: 5,
    envVar: "PRETTIER_PLUGIN_GML_SKIPPED_DIRECTORY_SAMPLE_LIMIT",
    subjectLabel: "Skipped directory"
});

export const {
    defaultValue: DEFAULT_SKIPPED_DIRECTORY_SAMPLE_LIMIT,
    envVar: SKIPPED_DIRECTORY_SAMPLE_LIMIT_ENV_VAR,
    getDefault: getDefaultSkippedDirectorySampleLimit,
    setDefault: setDefaultSkippedDirectorySampleLimit,
    resolve: resolveSkippedDirectorySampleLimit,
    applyEnvOverride: applySkippedDirectorySampleLimitEnvOverride
} = skippedDirectorySampleLimit;

export const unsupportedExtensionSampleLimit = createSampleLimitRuntimeOption({
    defaultValue: 5,
    envVar: "PRETTIER_PLUGIN_GML_UNSUPPORTED_EXTENSION_SAMPLE_LIMIT",
    subjectLabel: "Unsupported extension"
});

export const {
    defaultValue: DEFAULT_UNSUPPORTED_EXTENSION_SAMPLE_LIMIT,
    envVar: UNSUPPORTED_EXTENSION_SAMPLE_LIMIT_ENV_VAR,
    getDefault: getDefaultUnsupportedExtensionSampleLimit,
    setDefault: setDefaultUnsupportedExtensionSampleLimit,
    resolve: resolveUnsupportedExtensionSampleLimit,
    applyEnvOverride: applyUnsupportedExtensionSampleLimitEnvOverride
} = unsupportedExtensionSampleLimit;
