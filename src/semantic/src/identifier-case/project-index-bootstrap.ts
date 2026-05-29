import path from "node:path";

import { Core } from "@gmloop/core";

import {
    clampConcurrency,
    createProjectIndexBuildOptions,
    createProjectIndexCoordinator,
    createProjectIndexDescriptor,
    findProjectRoot
} from "../project-index/index.js";
import { IDENTIFIER_CASE_PROJECT_INDEX_CACHE_MAX_BYTES_OPTION_NAME } from "./options.js";

const PROJECT_INDEX_CACHE_MAX_BYTES_INTERNAL_OPTION_NAME = "__identifierCaseProjectIndexCacheMaxBytes";
const PROJECT_INDEX_CONCURRENCY_INTERNAL_OPTION_NAME = "__identifierCaseProjectIndexConcurrency";
const PROJECT_INDEX_CONCURRENCY_OPTION_NAME = "gmlIdentifierCaseProjectIndexConcurrency";

function resolveOptionWithOverride(options, config: any = {}) {
    const { onValue, onMissing, internalKey, externalKey } = config;

    Core.assertFunction(onValue, "onValue");

    const getMissingValue = () => (typeof onMissing === "function" ? onMissing() : onMissing);

    if (!Core.isObjectLike(options)) {
        return getMissingValue();
    }

    if (internalKey != null && options[internalKey] !== undefined) {
        return onValue({ value: options[internalKey], source: "internal" });
    }

    if (externalKey != null && options[externalKey] !== undefined) {
        return onValue({ value: options[externalKey], source: "external" });
    }

    return getMissingValue();
}

function getFsFacade(options) {
    return Core.coalesceOption(options, ["__identifierCaseFs", "identifierCaseFs"], {
        fallback: null
    });
}

function getFormatterVersion(options) {
    return Core.coalesceOption(
        options,
        ["identifierCaseFormatterVersion", "__identifierCaseFormatterVersion", "prettierVersion", "__prettierVersion"],
        { fallback: null }
    );
}

function getPluginVersion(options) {
    return Core.coalesceOption(
        options,
        ["identifierCasePluginVersion", "__identifierCasePluginVersion", "pluginVersion"],
        { fallback: null }
    );
}

function createSkipResult(reason) {
    return {
        status: "skipped",
        reason,
        projectRoot: null,
        projectIndex: null,
        source: null,
        cache: null,
        dispose: Core.noop
    };
}

function createFailureResult({ reason, projectRoot, coordinator = null, dispose = Core.noop, error = null }) {
    const result: any = {
        status: "failed",
        reason,
        projectRoot,
        projectIndex: null,
        source: "error",
        cache: null,
        coordinator,
        dispose
    };

    if (error !== null) {
        result.error = error;
    }

    return result;
}

const DEFAULT_OPTION_WRITER = (options, key, value) => {
    if (Core.isObjectLike(options)) {
        options[key] = value;
    }
};

function getOptionWriter(storeOption) {
    return typeof storeOption === "function" ? storeOption : DEFAULT_OPTION_WRITER;
}

function storeBootstrapResult(options, result, writeOption = DEFAULT_OPTION_WRITER) {
    writeOption(options, "__identifierCaseProjectIndexBootstrap", result);
    return result;
}

function formatCacheMaxSizeTypeError(optionName, type) {
    return `${optionName} must be provided as a non-negative integer (received type '${type}').`;
}

function formatCacheMaxSizeValueError(optionName, received) {
    return `${optionName} must be provided as a non-negative integer (received ${received}). Set to 0 to disable the size limit.`;
}

function formatConcurrencyTypeError(optionName, type) {
    return `${optionName} must be provided as a positive integer (received type '${type}').`;
}

function formatConcurrencyValueError(optionName, received) {
    return `${optionName} must be provided as a positive integer (received ${received}).`;
}

function coerceCacheMaxSize(numericValue: any, context: any) {
    const { optionName, received, isString, rawType } = context || {};
    if (Number.isFinite(numericValue)) {
        const truncated = Math.trunc(numericValue);

        if (truncated < 0) {
            throw new Error(formatCacheMaxSizeValueError(optionName, received));
        }
    }

    if (!Number.isFinite(numericValue) && !isString) {
        throw new TypeError(formatCacheMaxSizeTypeError(optionName, rawType));
    }

    const normalized = Core.coerceNonNegativeInteger(numericValue, {
        received,
        createErrorMessage: (value) => formatCacheMaxSizeValueError(optionName, value)
    });

    return normalized === 0 ? null : normalized;
}

function coerceProjectIndexConcurrency(numericValue: any, context: any) {
    const { optionName, received } = context || {};
    const positiveInteger = Core.coercePositiveInteger(numericValue, {
        received,
        createErrorMessage: (value) => formatConcurrencyValueError(optionName, value)
    });

    return clampConcurrency(positiveInteger);
}

function normalizeCacheMaxSizeBytes(rawValue, { optionName }) {
    return Core.normalizeNumericOption(rawValue, {
        optionName,
        coerce: coerceCacheMaxSize,
        formatTypeError: formatCacheMaxSizeTypeError
    });
}

function resolveCacheMaxSizeBytes(options) {
    return resolveOptionWithOverride(options, {
        internalKey: PROJECT_INDEX_CACHE_MAX_BYTES_INTERNAL_OPTION_NAME,
        externalKey: IDENTIFIER_CASE_PROJECT_INDEX_CACHE_MAX_BYTES_OPTION_NAME,
        onValue(entry) {
            if (entry.source === "internal" && entry.value === null) {
                return null;
            }

            return normalizeCacheMaxSizeBytes(entry.value, {
                optionName: IDENTIFIER_CASE_PROJECT_INDEX_CACHE_MAX_BYTES_OPTION_NAME
            });
        }
    });
}

function normalizeProjectIndexConcurrency(rawValue, { optionName }) {
    return Core.normalizeNumericOption(rawValue, {
        optionName,
        coerce: coerceProjectIndexConcurrency,
        formatTypeError: formatConcurrencyTypeError
    });
}

function resolveProjectIndexConcurrency(options) {
    return resolveOptionWithOverride(options, {
        internalKey: PROJECT_INDEX_CONCURRENCY_INTERNAL_OPTION_NAME,
        externalKey: PROJECT_INDEX_CONCURRENCY_OPTION_NAME,
        onValue(entry) {
            return normalizeProjectIndexConcurrency(entry.value, {
                optionName: PROJECT_INDEX_CONCURRENCY_OPTION_NAME
            });
        }
    });
}

function resolveProjectRoot(options) {
    return resolveOptionWithOverride(options, {
        internalKey: "__identifierCaseProjectRoot",
        externalKey: "gmlIdentifierCaseProjectRoot",
        onMissing: null,
        onValue(entry) {
            if (!Core.isNonEmptyTrimmedString(entry.value)) {
                return null;
            }

            const projectRoot = entry.source === "external" ? entry.value.trim() : entry.value;

            return path.resolve(projectRoot);
        }
    });
}

function getCachedBootstrapResult(options) {
    const bootstrapResult = options.__identifierCaseProjectIndexBootstrap;
    return bootstrapResult?.status ? bootstrapResult : null;
}

function resolveProvidedProjectIndex(options, { projectRoot, writeOption }) {
    if (!options.__identifierCaseProjectIndex) {
        return null;
    }

    const resolvedProjectRoot = projectRoot ?? resolveProjectRoot(options);

    return storeBootstrapResult(
        options,
        {
            status: "ready",
            reason: "provided",
            projectRoot: resolvedProjectRoot,
            projectIndex: options.__identifierCaseProjectIndex,
            source: "provided",
            cache: null,
            dispose() {}
        },
        writeOption
    );
}

function shouldSkipProjectDiscovery(options) {
    return options.gmlIdentifierCaseDiscoverProject === false;
}

function resolveCoordinatorInputs(options, writeOption: any) {
    const fsFacade = getFsFacade(options);

    const cacheMaxSizeBytes = resolveCacheMaxSizeBytes(options);
    Core.withDefinedValue(
        cacheMaxSizeBytes,
        (value) => {
            writeOption(options, PROJECT_INDEX_CACHE_MAX_BYTES_INTERNAL_OPTION_NAME, value);
        },
        () => {}
    );

    const projectIndexConcurrency = resolveProjectIndexConcurrency(options);
    Core.withDefinedValue(
        projectIndexConcurrency,
        (value) => {
            writeOption(options, PROJECT_INDEX_CONCURRENCY_INTERNAL_OPTION_NAME, value);
        },
        () => {}
    );

    return { fsFacade, cacheMaxSizeBytes, projectIndexConcurrency };
}

async function resolveProjectRootContext(options, { fsFacade, initialProjectRoot }) {
    if (initialProjectRoot) {
        return {
            projectRoot: initialProjectRoot,
            rootResolution: "configured",
            skipResult: null
        };
    }

    const filepath = options?.filepath ?? null;
    if (!Core.isNonEmptyTrimmedString(filepath)) {
        return {
            projectRoot: null,
            rootResolution: null,
            skipResult: createSkipResult("missing-filepath")
        };
    }

    const projectRoot = await findProjectRoot({ filepath }, fsFacade ?? undefined);

    if (!projectRoot) {
        return {
            projectRoot: null,
            rootResolution: null,
            skipResult: createSkipResult("project-root-not-found")
        };
    }

    return {
        projectRoot,
        rootResolution: "discovered",
        skipResult: null
    };
}

function resolveProjectIndexCoordinator(options, { fsFacade, cacheMaxSizeBytes }) {
    const coordinatorOverride = options.__identifierCaseProjectIndexCoordinator ?? null;

    const coordinatorOptions: any = { fsFacade: fsFacade ?? undefined };
    Core.withDefinedValue(
        cacheMaxSizeBytes,
        (value) => {
            coordinatorOptions.cacheMaxSizeBytes = value;
        },
        () => {}
    );

    const coordinator = coordinatorOverride ?? createProjectIndexCoordinator(coordinatorOptions);

    const dispose = coordinatorOverride
        ? () => {}
        : () => {
              coordinator.dispose();
          };

    return { coordinator, dispose };
}

function finalizeBootstrapSuccess(options, ready, { projectRoot, rootResolution, coordinator, dispose }, writeOption) {
    const result = storeBootstrapResult(
        options,
        {
            status: ready?.projectIndex ? "ready" : "skipped",
            reason: ready?.projectIndex ? rootResolution : "no-project-index",
            projectRoot,
            projectIndex: ready?.projectIndex ?? null,
            source: ready?.source ?? rootResolution,
            cache: ready?.cache ?? null,
            coordinator,
            dispose
        },
        writeOption
    );

    if (result.projectIndex) {
        writeOption(options, "__identifierCaseProjectIndex", result.projectIndex);
        writeOption(options, "__identifierCaseProjectRoot", projectRoot);
    }

    return result;
}

export async function bootstrapProjectIndex(options, storeOption) {
    if (options == null) {
        options = {};
    }

    if (!Core.isObjectLike(options)) {
        return createSkipResult("invalid-options");
    }

    const cachedBootstrap = getCachedBootstrapResult(options);
    if (cachedBootstrap) {
        return cachedBootstrap;
    }

    const writeOption = getOptionWriter(storeOption);
    const initialProjectRoot = resolveProjectRoot(options);

    const providedProjectIndexResult = resolveProvidedProjectIndex(options, {
        projectRoot: initialProjectRoot,
        writeOption
    });
    if (providedProjectIndexResult) {
        return providedProjectIndexResult;
    }

    if (shouldSkipProjectDiscovery(options)) {
        return storeBootstrapResult(options, createSkipResult("discovery-disabled"), writeOption);
    }

    const { fsFacade, cacheMaxSizeBytes, projectIndexConcurrency } = resolveCoordinatorInputs(options, writeOption);

    const { projectRoot, rootResolution, skipResult } = await resolveProjectRootContext(options, {
        fsFacade,
        initialProjectRoot
    });

    if (skipResult) {
        return storeBootstrapResult(options, skipResult, writeOption);
    }

    const { coordinator, dispose } = resolveProjectIndexCoordinator(options, {
        fsFacade,
        cacheMaxSizeBytes
    });

    const parseGml = typeof options?.parseGml === "function" ? options.parseGml : undefined;
    const buildOptions = createProjectIndexBuildOptions({
        logger: options?.logger ?? null,
        logMetrics: options?.logIdentifierCaseMetrics === true,
        concurrency: projectIndexConcurrency
            ? {
                  gml: projectIndexConcurrency,
                  gmlParsing: projectIndexConcurrency
              }
            : undefined,
        parseGml
    } as any);

    const descriptor = createProjectIndexDescriptor({
        projectRoot,
        cacheMaxSizeBytes,
        cacheFilePath: options?.identifierCaseProjectIndexCachePath ?? null,
        formatterVersion: getFormatterVersion(options) ?? undefined,
        pluginVersion: getPluginVersion(options) ?? undefined,
        buildOptions
    } as any);

    let ready;
    try {
        ready = await coordinator.ensureReady(descriptor);
    } catch (error) {
        const failureResult = createFailureResult({
            reason: "build-error",
            projectRoot,
            coordinator,
            dispose,
            error
        });

        return storeBootstrapResult(options, failureResult, writeOption);
    }

    return finalizeBootstrapSuccess(
        options,
        ready,
        {
            projectRoot,
            rootResolution,
            coordinator,
            dispose
        },
        writeOption
    );
}

export function applyBootstrappedProjectIndex(options, storeOption) {
    if (!Core.isObjectLike(options)) {
        return null;
    }

    const writeOption = getOptionWriter(storeOption);

    const bootstrapResult = options.__identifierCaseProjectIndexBootstrap;
    if (bootstrapResult?.projectIndex && !options.__identifierCaseProjectIndex) {
        writeOption(options, "__identifierCaseProjectIndex", bootstrapResult.projectIndex);
        if (bootstrapResult.projectRoot && !options.__identifierCaseProjectRoot) {
            writeOption(options, "__identifierCaseProjectRoot", bootstrapResult.projectRoot);
        }
    }

    return options.__identifierCaseProjectIndex ?? null;
}
