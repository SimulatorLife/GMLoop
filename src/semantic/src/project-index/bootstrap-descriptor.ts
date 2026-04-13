import { Core } from "@gmloop/core";

type ProjectIndexConcurrencySettings = {
    gml: number;
    gmlParsing: number;
};

type ProjectIndexBuildOptions = {
    logger?: { debug?: (message?: string, payload?: unknown) => void } | null;
    logMetrics?: boolean;
    // Historical option names accepted by some callers. Keep both names so we
    // can accept either legacy or current option shapes passed by callers.
    concurrency?: ProjectIndexConcurrencySettings | null;
    projectIndexConcurrency?: number | ProjectIndexConcurrencySettings | null;
    parserOverride?: {
        parse?: (text: string, filePath?: string) => unknown;
    } | null;
    parseGml?: (text: string, filePath?: string) => unknown;
};

export function createProjectIndexBuildOptions({
    logger = null,
    logMetrics = false,
    projectIndexConcurrency,
    parserOverride = null
}: ProjectIndexBuildOptions = {}) {
    const buildOptions: ProjectIndexBuildOptions = {
        logger,
        logMetrics
    };

    Core.withDefinedValue(
        projectIndexConcurrency,
        (value) => {
            if (value === null) {
                return;
            }

            if (typeof value === "number") {
                buildOptions.concurrency = {
                    gml: value,
                    gmlParsing: value
                };
                return;
            }

            buildOptions.concurrency = {
                gml: value.gml,
                gmlParsing: value.gmlParsing
            };
        },
        () => {}
    );

    if (!parserOverride) {
        return buildOptions;
    }

    const { parse } = parserOverride;

    buildOptions.parseGml = parse as ((text: string, filePath?: string) => unknown) | null;

    return buildOptions;
}

type ProjectIndexDescriptor = {
    projectRoot?: string | null;
    cacheMaxSizeBytes?: number | null;
    cacheFilePath?: string | null;
    formatterVersion?: string | null;
    pluginVersion?: string | null;
    buildOptions?: ProjectIndexBuildOptions | null;
    // `maxSizeBytes` is the runtime name used in a few places while
    // `cacheMaxSizeBytes` is the config object property - keep both so
    // consumers can read the same property regardless of the name used.
    maxSizeBytes?: number | null;
};

export function createProjectIndexDescriptor({
    projectRoot,
    cacheMaxSizeBytes,
    cacheFilePath = null,
    formatterVersion,
    pluginVersion,
    buildOptions
}: ProjectIndexDescriptor = {}) {
    const descriptor: ProjectIndexDescriptor = {
        projectRoot,
        cacheFilePath,
        formatterVersion,
        pluginVersion,
        buildOptions
    };

    Core.withDefinedValue(
        cacheMaxSizeBytes,
        (value) => {
            descriptor.maxSizeBytes = value;
        },
        () => {}
    );

    return descriptor;
}
