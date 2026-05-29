import { Core } from "@gmloop/core";

type ProjectIndexConcurrencySettings = {
    gml: number;
    gmlParsing: number;
};

export type { ProjectIndexConcurrencySettings };

type ProjectIndexBuildOptions = {
    logger?: { debug?: (message?: string, payload?: unknown) => void } | null;
    logMetrics?: boolean;
    concurrency?: ProjectIndexConcurrencySettings | null;
    parseGml?: (text: string, filePath?: string) => unknown;
};

export type { ProjectIndexBuildOptions };

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}

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

            if (!Core.isObjectLike(value)) {
                return;
            }

            const rawGml = (value as Record<string, unknown>).gml;
            const rawGmlParsing = (value as Record<string, unknown>).gmlParsing;

            if (!isPositiveInteger(rawGml) || !isPositiveInteger(rawGmlParsing)) {
                return;
            }

            buildOptions.concurrency = {
                gml: rawGml,
                gmlParsing: rawGmlParsing
            };
        },
        () => {}
    );

    Core.withDefinedValue(parseGml, (fn) => {
        if (typeof fn !== "function") {
            return;
        }
        buildOptions.parseGml = fn;
    });

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
        buildOptions: Core.isObjectLike(buildOptions) ? buildOptions : undefined
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
