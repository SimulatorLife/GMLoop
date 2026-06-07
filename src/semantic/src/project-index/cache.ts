import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { Core } from "@gmloop/core";

import { evaluateCacheHitDecision, ProjectIndexCacheMissReason } from "./cache-validation-policy.js";
import { evaluateProjectIndexCacheSizePolicy, normalizeProjectIndexCacheMaxSizeBytes } from "./cache-write-policy.js";
import { isProjectManifestPath, PROJECT_INDEX_CACHE_MAX_SIZE_BASELINE } from "./constants.js";
import { type ProjectIndexFsFacade, runWithMissingPathFallback } from "./fs-facade.js";

export const PROJECT_INDEX_CACHE_SCHEMA_VERSION = 2;
export const PROJECT_INDEX_CACHE_DIRECTORY = ".gmloop";
export const PROJECT_INDEX_CACHE_FILENAME = "project-index-cache.json";
export const PROJECT_INDEX_CACHE_MAX_SIZE_ENV_VAR = "GML_PROJECT_INDEX_CACHE_MAX_SIZE";
// The identifier-case rollout docs promise an 8 MiB default cache ceiling so
// teams can size disk allowances ahead of enabling the project index.
// Exceeding that limit risks unbounded cache growth on large projects, while
// Keep this baseline in sync with the published guidance so operational
// runbooks stay trustworthy.

const projectIndexCacheSizeConfig = Core.createEnvConfiguredValueWithFallback({
    defaultValue: PROJECT_INDEX_CACHE_MAX_SIZE_BASELINE,
    envVar: PROJECT_INDEX_CACHE_MAX_SIZE_ENV_VAR,
    resolve: (value, { fallback }) => {
        const normalized = normalizeProjectIndexCacheMaxSizeBytes(value);
        if (normalized !== null) {
            return normalized;
        }

        const trimmed = Core.getNonEmptyTrimmedString(value);

        if (trimmed !== null) {
            const numeric = Core.toFiniteNumber(trimmed);

            // We inline the >= 0 check here instead of calling normalizeProjectIndexCacheMaxSizeBytes(numeric)
            // to avoid unnecessary function call depth, since numeric is already validated
            // by toFiniteNumber.
            if (numeric !== null && numeric >= 0) {
                return numeric;
            }
        }

        return fallback;
    },
    computeFallback: ({ defaultValue }) => defaultValue
});

export const ProjectIndexCacheStatus = Object.freeze({
    MISS: "miss",
    HIT: "hit",
    SKIPPED: "skipped",
    WRITTEN: "written"
});

const PROJECT_INDEX_CACHE_STATUS_VALUES = new Set(Object.values(ProjectIndexCacheStatus));

const PROJECT_INDEX_CACHE_STATUS_LIST = [...PROJECT_INDEX_CACHE_STATUS_VALUES]
    .map((status) => `'${status}'`)
    .join(", ");

export function assertProjectIndexCacheStatus(value) {
    if (PROJECT_INDEX_CACHE_STATUS_VALUES.has(value)) {
        return value;
    }

    const received = Core.describeValueForError(value, {
        stringifyUnknown: false
    });
    throw new TypeError(
        `Project index cache status must be one of: ${PROJECT_INDEX_CACHE_STATUS_LIST}. Received: ${received}.`
    );
}

/**
 * Normalize the project index payload extracted from a cache hit.
 *
 * After a successful cache hit decision, the parsed payload's `projectIndex`
 * field has already passed structural validation (via
 * `validateCachePayloadStructure`) — specifically, it was confirmed to be an
 * object. However, a valid object is not necessarily a usable project index.
 * We additionally guard that the value is a plain object (not a proxy, Map, or
 * other exotic object) and fall back to an empty index when it is not, so that
 * callers downstream receive a consistent, index-shaped value rather than
 * `undefined` or a primitive.
 *
 * @param rawProjectIndex - The raw value from the cache payload.
 * @returns A plain-object project index, or a minimal empty index.
 */
function normalizeProjectIndexPayload(rawProjectIndex: unknown): Record<string, unknown> {
    if (Core.isPlainObject(rawProjectIndex)) {
        return rawProjectIndex as Record<string, unknown>;
    }

    return Object.create(null);
}

function createCacheResult(status, details) {
    return {
        status: assertProjectIndexCacheStatus(status),
        ...details
    };
}

function createCacheMiss(cacheFilePath, type, details = {}) {
    return createCacheResult(ProjectIndexCacheStatus.MISS, {
        cacheFilePath,
        reason: {
            type,
            ...details
        }
    });
}

function getDefaultProjectIndexCacheMaxSize() {
    return projectIndexCacheSizeConfig.get();
}

function setDefaultProjectIndexCacheMaxSize(size) {
    return projectIndexCacheSizeConfig.set(size);
}

function applyProjectIndexCacheEnvOverride(env = {}) {
    Core.applyConfiguredValueEnvOverride(projectIndexCacheSizeConfig, env);
}

applyProjectIndexCacheEnvOverride();

function resolveCacheFilePath(projectRoot, cacheFilePath) {
    if (cacheFilePath) {
        return path.resolve(cacheFilePath);
    }
    return path.join(projectRoot, PROJECT_INDEX_CACHE_DIRECTORY, PROJECT_INDEX_CACHE_FILENAME);
}

function cloneMtimeMap(source) {
    if (!Core.isObjectLike(source)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(source)
            .map(([key, value]) => [key, Core.toFiniteNumber(value)])
            .filter(([, numericValue]) => numericValue !== null)
    );
}

export { applyProjectIndexCacheEnvOverride, getDefaultProjectIndexCacheMaxSize, setDefaultProjectIndexCacheMaxSize };

export async function loadProjectIndexCache(
    descriptor,
    fsFacade: Required<Pick<ProjectIndexFsFacade, "readFile">> = Core.defaultFsFacade as Required<ProjectIndexFsFacade>,
    options = {}
) {
    const {
        projectRoot,
        cacheFilePath: explicitPath,
        formatterVersion,
        pluginVersion,
        manifestMtimes = {},
        sourceMtimes = {}
    } = descriptor ?? {};

    if (!projectRoot) {
        throw new Error("projectRoot must be provided to loadProjectIndexCache");
    }

    const abortMessage = "Project index cache load was aborted.";
    const { ensureNotAborted } = Core.createAbortGuard(options, {
        fallbackMessage: abortMessage
    });

    const resolvedRoot = path.resolve(projectRoot);
    const cacheFilePath = resolveCacheFilePath(resolvedRoot, explicitPath);

    const rawContents = await runWithMissingPathFallback(
        () => fsFacade.readFile(cacheFilePath, "utf8"),
        () => null
    );

    if (rawContents === null) {
        return createCacheMiss(cacheFilePath, ProjectIndexCacheMissReason.NOT_FOUND);
    }

    ensureNotAborted();

    let parsed;
    try {
        parsed = Core.parseJsonWithContext(rawContents, {
            source: cacheFilePath,
            description: "project index cache"
        });
    } catch (error) {
        return createCacheMiss(cacheFilePath, ProjectIndexCacheMissReason.INVALID_JSON, { error });
    }

    ensureNotAborted();

    // Delegate all hit/miss policy decisions to the pure evaluator.
    // "NOT_FOUND" and "INVALID_JSON" are the only misses handled here
    // (they reflect I/O failures, not policy outcomes).
    const hitDecision = evaluateCacheHitDecision(parsed, {
        resolvedRoot,
        schemaVersion: PROJECT_INDEX_CACHE_SCHEMA_VERSION,
        formatterVersion,
        pluginVersion,
        manifestMtimes,
        sourceMtimes
    });

    if (hitDecision.valid === false) {
        return createCacheMiss(cacheFilePath, hitDecision.missReason);
    }

    const projectIndex = normalizeProjectIndexPayload(parsed.projectIndex);
    if (parsed.metricsSummary !== undefined) {
        projectIndex.metrics = parsed.metricsSummary;
    }

    return createCacheResult(ProjectIndexCacheStatus.HIT, {
        cacheFilePath,
        payload: parsed,
        projectIndex
    });
}

export async function saveProjectIndexCache(
    descriptor,
    fsFacade: Required<
        Pick<ProjectIndexFsFacade, "mkdir" | "writeFile" | "rename" | "unlink">
    > = Core.defaultFsFacade as Required<ProjectIndexFsFacade>,
    options = {}
) {
    const {
        projectRoot,
        cacheFilePath: explicitPath,
        formatterVersion,
        pluginVersion,
        manifestMtimes = {},
        sourceMtimes = {},
        projectIndex,
        metricsSummary,
        maxSizeBytes = getDefaultProjectIndexCacheMaxSize()
    } = descriptor ?? {};

    if (!projectRoot) {
        throw new Error("projectRoot must be provided to saveProjectIndexCache");
    }
    if (!Core.isObjectLike(projectIndex)) {
        throw new TypeError("projectIndex must be provided to saveProjectIndexCache");
    }

    const abortMessage = "Project index cache save was aborted.";
    const { ensureNotAborted } = Core.createAbortGuard(options, {
        fallbackMessage: abortMessage
    });

    const resolvedRoot = path.resolve(projectRoot);
    const cacheFilePath = resolveCacheFilePath(resolvedRoot, explicitPath);
    const cacheDir = path.dirname(cacheFilePath);

    await fsFacade.mkdir(cacheDir, { recursive: true });
    ensureNotAborted();

    const sanitizedProjectIndex = { ...projectIndex };
    const summary = metricsSummary ?? sanitizedProjectIndex.metrics ?? null;
    if (sanitizedProjectIndex.metrics) {
        delete sanitizedProjectIndex.metrics;
    }

    const payload = {
        schemaVersion: PROJECT_INDEX_CACHE_SCHEMA_VERSION,
        projectRoot: resolvedRoot,
        formatterVersion: formatterVersion ? String(formatterVersion) : "",
        pluginVersion: pluginVersion ? String(pluginVersion) : "",
        manifestMtimes: cloneMtimeMap(manifestMtimes),
        sourceMtimes: cloneMtimeMap(sourceMtimes),
        metricsSummary: summary,
        projectIndex: sanitizedProjectIndex
    };

    const serialized = Core.stringifyJsonForFile(payload, {
        includeTrailingNewline: false
    });
    const byteLength = Buffer.byteLength(serialized, "utf8");

    const sizeDecision = evaluateProjectIndexCacheSizePolicy({
        maxSizeBytes,
        payloadSizeBytes: byteLength
    });
    if (!sizeDecision.shouldWrite) {
        return createCacheResult(ProjectIndexCacheStatus.SKIPPED, {
            cacheFilePath,
            reason: sizeDecision.reason,
            size: byteLength
        });
    }

    const uniqueSuffix = randomUUID();
    const tempFilePath = `${cacheFilePath}.${uniqueSuffix}.tmp`;

    let tempFileCleanedUp = false;
    let pendingError: unknown = null;

    try {
        await fsFacade.writeFile(tempFilePath, serialized, "utf8");
        ensureNotAborted();

        await fsFacade.rename(tempFilePath, cacheFilePath);
        ensureNotAborted();
    } catch (error) {
        // Capture the error from the try block so we can re-throw it after cleanup.
        // JavaScript's finally-block-replaces-error behavior means we must capture
        // the original error here rather than relying on implicit re-throw.
        pendingError = error;
    } finally {
        // Always attempt cleanup of the temp file, even when the abort signal fires
        // during the async rename or ensureNotAborted() calls. Without the finally block,
        // an aborted abort signal between writeFile and the catch block would leave the
        // temp file orphaned — the catch block's unlink would throw (signal already
        // aborted), and the error would propagate without cleanup.
        if (!tempFileCleanedUp) {
            try {
                await fsFacade.unlink(tempFilePath);
                tempFileCleanedUp = true;
            } catch {
                // Best-effort hygiene. The primary error (writeFile failure, rename
                // failure, or abort) is the actionable one for callers and is propagated
                // below. Dropping the cleanup error here preserves the original stack
                // trace and keeps the function's error surface stable. The uniquely-named
                // temp file prevents collision with future writes even if it lingers
                // temporarily.
            }
        }
    }

    // Re-throw the captured error, if any. This must be done after the finally block
    // because in JavaScript, a `finally` block that throws replaces any error that was
    // propagating from the `try` block — we capture the original error in `pendingError`
    // and explicitly re-throw it here so the abort or write/rename error takes priority
    // over a spurious unlink failure.
    if (pendingError !== null) {
        throw pendingError;
    }

    return createCacheResult(ProjectIndexCacheStatus.WRITTEN, {
        cacheFilePath,
        size: byteLength
    });
}

export async function deriveCacheKey(
    {
        filepath,
        projectRoot,
        formatterVersion = "dev"
    }: {
        filepath?: string | null;
        projectRoot?: string | null;
        formatterVersion?: string;
    } = {},
    fsFacade: Required<
        Pick<ProjectIndexFsFacade, "readDir" | "stat">
    > = Core.defaultFsFacade as Required<ProjectIndexFsFacade>
) {
    const hash = createHash("sha256");
    hash.update(String(formatterVersion));
    hash.update("\0");

    const resolvedRoot = projectRoot ? path.resolve(projectRoot) : "";
    hash.update(resolvedRoot);
    hash.update("\0");

    if (resolvedRoot) {
        const entries = await Core.listDirectory(fsFacade, resolvedRoot);
        // Use Array.sort to produce a stable lexicographic ordering of manifest
        // names. The previous insertion-sort-via-reduce created at least one new
        // array object per entry (and up to three for mid-array insertions),
        // resulting in O(n) heap allocations that were immediately discarded.
        // Array.sort operates in-place on the filtered result, eliminating all
        // intermediate arrays and reducing complexity from O(n²) to O(n log n).
        const manifestNames = entries.filter(isProjectManifestPath).sort((a, b) => a.localeCompare(b));

        await Core.runSequentially(manifestNames, async (manifestName) => {
            const manifestPath = path.join(resolvedRoot, manifestName);
            const mtime = await Core.getFileMtime(fsFacade, manifestPath);
            if (mtime !== null) {
                hash.update(manifestName);
                hash.update("\0");
                hash.update(String(mtime));
                hash.update("\0");
            }
        });
    }

    if (filepath) {
        const resolvedFile = path.resolve(filepath);
        const mtime = await Core.getFileMtime(fsFacade, resolvedFile);
        if (mtime !== null) {
            hash.update(path.relative(resolvedRoot || path.parse(resolvedFile).root, resolvedFile));
            hash.update("\0");
            hash.update(String(mtime));
            hash.update("\0");
        }
    }

    return hash.digest("hex");
}
