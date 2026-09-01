import { Core } from "@gmloop/core";

import type { ProjectIndexBuildOptions } from "./build-options.js";

type ProjectIndexConcurrencySettings = {
    gml: number;
    gmlParsing: number;
};

export type { ProjectIndexConcurrencySettings };

type ProjectIndexBuildOptionsInput = Readonly<{
    concurrency?: unknown;
    logger?: ProjectIndexBuildOptions["logger"];
    logMetrics?: boolean;
    parseGml?: unknown;
}>;

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isProjectIndexParser(value: unknown): value is NonNullable<ProjectIndexBuildOptions["parseGml"]> {
    return typeof value === "function";
}

export function createProjectIndexBuildOptions({
    logger = null,
    logMetrics = false,
    concurrency,
    parseGml
}: ProjectIndexBuildOptionsInput = {}): ProjectIndexBuildOptions {
    let normalizedConcurrency: ProjectIndexBuildOptions["concurrency"];
    let normalizedParser: ProjectIndexBuildOptions["parseGml"];

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

            normalizedConcurrency = {
                gml: rawGml,
                gmlParsing: rawGmlParsing
            };
        },
        () => {}
    );

    Core.withDefinedValue(parseGml, (fn) => {
        if (!isProjectIndexParser(fn)) {
            return;
        }
        normalizedParser = fn;
    });

    return {
        logger,
        logMetrics,
        ...(normalizedConcurrency === undefined ? {} : { concurrency: normalizedConcurrency }),
        ...(normalizedParser === undefined ? {} : { parseGml: normalizedParser })
    };
}

type ProjectIndexDescriptor = {
    projectRoot?: string | null;
    buildOptions?: ProjectIndexBuildOptions | null;
};

export function createProjectIndexDescriptor({ projectRoot, buildOptions }: ProjectIndexDescriptor = {}) {
    const descriptor: ProjectIndexDescriptor = {
        projectRoot,
        buildOptions: Core.isObjectLike(buildOptions) ? buildOptions : undefined
    };

    return descriptor;
}
