import { Core } from "@gmloop/core";

type ProjectIndexConcurrencySettings = {
    gml: number;
    gmlParsing: number;
};

type ProjectIndexBuildOptions = {
    logger?: { debug?: (message?: string, payload?: unknown) => void } | null;
    logMetrics?: boolean;
    concurrency?: ProjectIndexConcurrencySettings | null;
    parseGml?: (text: string, filePath?: string) => unknown;
};

export function createProjectIndexBuildOptions({
    logger = null,
    logMetrics = false,
    concurrency,
    parseGml
}: ProjectIndexBuildOptions = {}) {
    const buildOptions: ProjectIndexBuildOptions = {
        logger,
        logMetrics
    };

    Core.withDefinedValue(
        concurrency,
        (value) => {
            if (value === null) {
                return;
            }

            buildOptions.concurrency = {
                gml: value.gml,
                gmlParsing: value.gmlParsing
            };
        },
        () => {}
    );

    if (parseGml) {
        buildOptions.parseGml = parseGml;
    }

    return buildOptions;
}

type ProjectIndexDescriptor = {
    projectRoot?: string | null;
    cacheMaxSizeBytes?: number | null;
    cacheFilePath?: string | null;
    formatterVersion?: string | null;
    pluginVersion?: string | null;
    buildOptions?: ProjectIndexBuildOptions | null;
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
            descriptor.cacheMaxSizeBytes = value;
        },
        () => {}
    );

    return descriptor;
}
