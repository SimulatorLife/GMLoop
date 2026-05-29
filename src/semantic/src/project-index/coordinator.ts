import path from "node:path";

import { Core } from "@gmloop/core";

import { ProjectIndexCacheStatus } from "./cache.js";
import type { ProjectIndexFsFacade } from "./fs-facade.js";

/** Descriptor passed to {@link ProjectIndexCoordinatorInstance.ensureReady}. */
type EnsureReadyDescriptor = {
    projectRoot: string;
    cacheMaxSizeBytes?: number | null;
    buildOptions?: Record<string, unknown>;
    [key: string]: unknown;
};

/** Project index data returned from a build or cache hit. */
type ProjectIndexData = {
    metrics?: unknown;
    [key: string]: unknown;
};

/** Result returned by a cache save operation. Always has a `status` field. */
type CacheSaveResult = {
    status: string;
    [key: string]: unknown;
};

/** Result returned by a cache load operation. */
type CacheLoadResult = {
    status: string;
    projectIndex?: ProjectIndexData;
    cacheFilePath: string;
    [key: string]: unknown;
};

/** Result returned by {@link ProjectIndexCoordinatorInstance.ensureReady}. */
export type EnsureReadyResult = {
    source: "cache" | "build";
    projectIndex: ProjectIndexData;
    cache: {
        saveResult?: CacheSaveResult;
        [key: string]: unknown;
    };
};

/** Loads the project index from cache. Mirrors the shape of `loadProjectIndexCache`. */
type LoadCacheFunction = (
    descriptor: { projectRoot: string; [key: string]: unknown },
    fsFacade: ProjectIndexFsFacade,
    options: { signal: AbortSignal }
) => Promise<CacheLoadResult>;

/** Persists the project index to cache. Mirrors the shape of `saveProjectIndexCache`. */
type SaveCacheFunction = (
    descriptor: {
        projectRoot: string;
        projectIndex: ProjectIndexData;
        metricsSummary?: unknown;
        maxSizeBytes: number | null;
        [key: string]: unknown;
    },
    fsFacade: ProjectIndexFsFacade,
    options: { signal: AbortSignal }
) => Promise<CacheSaveResult>;

/** Builds a project index from scratch by scanning project sources. */
type BuildIndexFunction = (
    projectRoot: string,
    fsFacade: ProjectIndexFsFacade,
    options?: Record<string, unknown>
) => Promise<ProjectIndexData>;

/** Returns the default maximum cache size in bytes. */
type GetDefaultCacheSizeFunction = () => number;

/**
 * Options for the core project index coordinator.
 *
 * All function dependencies are required here; callers that want optional
 * parameters with sensible defaults should use the typed wrapper in
 * `./builder.ts` (`createProjectIndexCoordinator`).
 */
export type CoordinatorCoreOptions = {
    /** Filesystem facade used by load/save operations. Defaults to `Core.defaultFsFacade`. */
    fsFacade?: ProjectIndexFsFacade;
    loadCache: LoadCacheFunction;
    saveCache: SaveCacheFunction;
    buildIndex: BuildIndexFunction;
    /** Override the maximum cache size in bytes. Defaults to `getDefaultCacheMaxSize()`. */
    cacheMaxSizeBytes?: number | null;
    getDefaultCacheMaxSize: GetDefaultCacheSizeFunction;
};

/** Public API of the project index coordinator returned by `createProjectIndexCoordinator`. */
export type ProjectIndexCoordinatorInstance = {
    /**
     * Ensures the project index is ready for the given project root.
     * Returns a cached result when available, otherwise builds and caches a
     * fresh index. Concurrent calls for the same project root are deduplicated.
     */
    ensureReady(descriptor: EnsureReadyDescriptor): Promise<EnsureReadyResult>;
    /** Disposes the coordinator, aborting any in-flight operations. */
    dispose(): void;
};

function assertCoordinatorFunction<T extends (...args: unknown[]) => unknown>(value: unknown, name: string): T {
    const normalizedName = Core.toTrimmedString(name) || "dependency";
    const errorMessage = `Project index coordinators require a ${normalizedName} function.`;
    return Core.assertFunction<T>(value, normalizedName, { errorMessage });
}

function normalizeEnsureReadyDescriptor(descriptor: EnsureReadyDescriptor | null | undefined): {
    descriptor: EnsureReadyDescriptor;
    resolvedRoot: string;
} {
    const projectRoot = descriptor?.projectRoot;
    if (!projectRoot) {
        throw new Error("projectRoot must be provided to ensureReady");
    }

    return {
        descriptor,
        resolvedRoot: path.resolve(projectRoot)
    };
}

type EnsureReadyContext = {
    descriptor: EnsureReadyDescriptor;
    resolvedRoot: string;
    key: string;
    signal: AbortSignal;
};

function resolveEnsureReadyContext({
    descriptor,
    abortController,
    disposedMessage
}: {
    descriptor: EnsureReadyDescriptor | null | undefined;
    abortController: AbortController;
    disposedMessage: string;
}): EnsureReadyContext {
    const { resolvedRoot } = normalizeEnsureReadyDescriptor(descriptor);
    const signal = abortController.signal;
    Core.throwIfAborted(signal, disposedMessage);

    return {
        descriptor,
        resolvedRoot,
        key: resolvedRoot,
        signal
    };
}

function trackInFlightOperation(
    map: Map<string, Promise<EnsureReadyResult>>,
    key: string,
    createOperation: () => Promise<EnsureReadyResult>
): Promise<EnsureReadyResult> {
    // Use Core.getOrCreateMapEntry instead of the manual has/get/set pattern.
    // The initializer returns the cached promise when one is already in flight,
    // avoiding the double-lookup that the manual pattern required.
    return Core.getOrCreateMapEntry(map, key, () =>
        (async () => {
            try {
                return await createOperation();
            } finally {
                map.delete(key);
            }
        })()
    );
}

type ExecuteOperationOptions = {
    descriptor: EnsureReadyDescriptor;
    resolvedRoot: string;
    signal: AbortSignal;
    fsFacade: ProjectIndexFsFacade;
    loadCache: LoadCacheFunction;
    saveCache: SaveCacheFunction;
    buildIndex: BuildIndexFunction;
    cacheMaxSizeBytes: number | null;
    disposedMessage: string;
};

async function executeEnsureReadyOperation({
    descriptor,
    resolvedRoot,
    signal,
    fsFacade,
    loadCache,
    saveCache,
    buildIndex,
    cacheMaxSizeBytes,
    disposedMessage
}: ExecuteOperationOptions): Promise<EnsureReadyResult> {
    const loadResult = await loadCache({ ...descriptor, projectRoot: resolvedRoot }, fsFacade, { signal });
    Core.throwIfAborted(signal, disposedMessage);

    if (loadResult.status === ProjectIndexCacheStatus.HIT) {
        Core.throwIfAborted(signal, disposedMessage);
        return {
            source: "cache",
            projectIndex: loadResult.projectIndex,
            cache: loadResult
        };
    }

    const projectIndex = await buildIndex(resolvedRoot, fsFacade, {
        ...descriptor.buildOptions,
        signal
    });
    Core.throwIfAborted(signal, disposedMessage);

    const descriptorCacheMaxSizeBytes =
        descriptor.cacheMaxSizeBytes === undefined ? cacheMaxSizeBytes : descriptor.cacheMaxSizeBytes;

    const saveResult = await saveCache(
        {
            ...descriptor,
            projectRoot: resolvedRoot,
            projectIndex,
            metricsSummary: projectIndex.metrics,
            maxSizeBytes: descriptorCacheMaxSizeBytes
        },
        fsFacade,
        { signal }
    ).catch((error: unknown) => {
        return {
            status: "failed",
            error,
            cacheFilePath: loadResult.cacheFilePath
        };
    });
    Core.throwIfAborted(signal, disposedMessage);

    return {
        source: "build",
        projectIndex,
        cache: {
            ...loadResult,
            saveResult
        }
    };
}

/**
 * Creates a project index coordinator that orchestrates cache loading, index
 * building, and result caching for a given project root.
 *
 * This is the low-level core implementation. Most callers should use the
 * typed wrapper `createProjectIndexCoordinator` from `./builder.ts`, which
 * provides convenient defaults for all required dependencies.
 */
export function createProjectIndexCoordinator({
    fsFacade = Core.defaultFsFacade,
    loadCache,
    saveCache,
    buildIndex,
    cacheMaxSizeBytes: rawCacheMaxSizeBytes,
    getDefaultCacheMaxSize
}: CoordinatorCoreOptions): ProjectIndexCoordinatorInstance {
    const normalizedLoadCache = assertCoordinatorFunction<LoadCacheFunction>(loadCache, "loadCache");
    const normalizedSaveCache = assertCoordinatorFunction<SaveCacheFunction>(saveCache, "saveCache");
    const normalizedBuildIndex = assertCoordinatorFunction<BuildIndexFunction>(buildIndex, "buildIndex");
    const normalizedGetDefaultCacheMaxSize = assertCoordinatorFunction<GetDefaultCacheSizeFunction>(
        getDefaultCacheMaxSize,
        "getDefaultCacheMaxSize"
    );

    const cacheMaxSizeBytes: number | null =
        rawCacheMaxSizeBytes === undefined ? normalizedGetDefaultCacheMaxSize() : rawCacheMaxSizeBytes;

    const inFlight = new Map<string, Promise<EnsureReadyResult>>();
    let disposed = false;
    const abortController = new AbortController();
    const DISPOSED_MESSAGE = "ProjectIndexCoordinator has been disposed";

    function createDisposedError(): Error {
        return new Error(DISPOSED_MESSAGE);
    }

    function ensureNotDisposed(): void {
        if (disposed) {
            throw createDisposedError();
        }
        Core.throwIfAborted(abortController.signal, DISPOSED_MESSAGE);
    }

    function ensureReady(descriptor: EnsureReadyDescriptor): Promise<EnsureReadyResult> {
        ensureNotDisposed();
        const context = resolveEnsureReadyContext({
            descriptor,
            abortController,
            disposedMessage: DISPOSED_MESSAGE
        });

        return trackInFlightOperation(inFlight, context.key, () =>
            executeEnsureReadyOperation({
                descriptor,
                resolvedRoot: context.resolvedRoot,
                signal: context.signal,
                fsFacade,
                loadCache: normalizedLoadCache,
                saveCache: normalizedSaveCache,
                buildIndex: normalizedBuildIndex,
                cacheMaxSizeBytes,
                disposedMessage: DISPOSED_MESSAGE
            })
        );
    }

    function dispose(): void {
        if (disposed) {
            return;
        }

        disposed = true;
        if (!abortController.signal.aborted) {
            abortController.abort(createDisposedError());
        }
        inFlight.clear();
    }

    return {
        ensureReady,
        dispose
    };
}
