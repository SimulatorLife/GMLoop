import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { Core } from "@gmloop/core";

import { evaluateProjectIndexCacheSizePolicy, normalizeProjectIndexCacheMaxSizeBytes } from "./cache-write-policy.js";
import { isProjectManifestPath } from "./constants.js";
import { defaultFsFacade, type ProjectIndexFsFacade } from "./fs-facade.js";

export const PROJECT_INDEX_CACHE_SCHEMA_VERSION = 2;
export const PROJECT_INDEX_CACHE_DIRECTORY = ".prettier-plugin-gml";
export const PROJECT_INDEX_CACHE_FILENAME = "project-index-cache.json";
export const PROJECT_INDEX_CACHE_MAX_SIZE_ENV_VAR = "GML_PROJECT_INDEX_CACHE_MAX_SIZE";
// The identifier-case rollout docs promise an 8 MiB default cache ceiling so
// teams can size disk allowances ahead of enabling the project index.
// Exceeding that limit risks unbounded cache growth on large projects, while
// Keep this baseline in sync with the published guidance so operational
// runbooks stay trustworthy.
export const PROJECT_INDEX_CACHE_MAX_SIZE_BASELINE = 8 * 1024 * 1024; // 8 MiB

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

export const DEFAULT_MAX_PROJECT_INDEX_CACHE_SIZE = PROJECT_INDEX_CACHE_MAX_SIZE_BASELINE;

export const ProjectIndexCacheMissReason = Object.freeze({
    NOT_FOUND: "not-found",
    INVALID_JSON: "invalid-json",
    INVALID_SCHEMA: "invalid-schema",
    PROJECT_ROOT_MISMATCH: "project-root-mismatch",
    FORMATTER_VERSION_MISMATCH: "formatter-version-mismatch",
    PLUGIN_VERSION_MISMATCH: "plugin-version-mismatch",
    MANIFEST_MTIME_MISMATCH: "manifest-mtime-mismatch",
    SOURCE_MTIME_MISMATCH: "source-mtime-mismatch"
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

function hasEntries(record) {
    return typeof record === "object" && record !== null && Object.keys(record).length > 0;
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

function areMtimeMapsEqual(expected = {}, actual = {}) {
    if (expected === actual) {
        return true;
    }

    if (!Core.isObjectLike(expected)) {
        return false;
    }

    if (!Core.isObjectLike(actual)) {
        return false;
    }

    const expectedEntries = Object.entries(expected);
    const actualKeys = Object.keys(actual);

    if (expectedEntries.length !== actualKeys.length) {
        return false;
    }

    return expectedEntries.every(([key, value]) => {
        const actualValue = actual[key];

        if (typeof value === "number" && typeof actualValue === "number") {
            return Core.areNumbersApproximatelyEqual(value, actualValue);
        }

        return actualValue === value;
    });
}

function validateCachePayload(payload) {
    if (!Core.isObjectLike(payload)) {
        return false;
    }

    if (payload.schemaVersion !== PROJECT_INDEX_CACHE_SCHEMA_VERSION) {
        return false;
    }

    if (typeof payload.projectRoot !== "string" || payload.projectRoot.length === 0) {
        return false;
    }

    if (typeof payload.formatterVersion !== "string") {
        return false;
    }

    if (typeof payload.pluginVersion !== "string") {
        return false;
    }

    if (!Core.isObjectLike(payload.manifestMtimes)) {
        return false;
    }

    if (!Core.isObjectLike(payload.sourceMtimes)) {
        return false;
    }

    // Allow `metricsSummary` to be omitted, to be an object, or explicitly
    // `null` (null indicates no metrics were collected). Treat any other
    // non-object value as invalid.
    if (payload.metricsSummary != null && !Core.isObjectLike(payload.metricsSummary)) {
        return false;
    }

    if (!Core.isObjectLike(payload.projectIndex)) {
        return false;
    }

    return true;
}

export { applyProjectIndexCacheEnvOverride, getDefaultProjectIndexCacheMaxSize, setDefaultProjectIndexCacheMaxSize };

export async function loadProjectIndexCache(
    descriptor,
    fsFacade: Required<Pick<ProjectIndexFsFacade, "readFile">> = defaultFsFacade,
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

    let rawContents;
    try {
        rawContents = await fsFacade.readFile(cacheFilePath, "utf8");
    } catch (error) {
        if (Core.isErrorWithCode(error, "ENOENT")) {
            return createCacheMiss(cacheFilePath, ProjectIndexCacheMissReason.NOT_FOUND);
        }
        throw error;
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

    if (!validateCachePayload(parsed)) {
        return createCacheMiss(cacheFilePath, ProjectIndexCacheMissReason.INVALID_SCHEMA);
    }

    if (path.resolve(parsed.projectRoot) !== resolvedRoot) {
        return createCacheMiss(cacheFilePath, ProjectIndexCacheMissReason.PROJECT_ROOT_MISMATCH);
    }

    if (formatterVersion && parsed.formatterVersion !== String(formatterVersion)) {
        return createCacheMiss(cacheFilePath, ProjectIndexCacheMissReason.FORMATTER_VERSION_MISMATCH);
    }

    if (pluginVersion && parsed.pluginVersion !== String(pluginVersion)) {
        return createCacheMiss(cacheFilePath, ProjectIndexCacheMissReason.PLUGIN_VERSION_MISMATCH);
    }

    const hasManifestExpectations = hasEntries(manifestMtimes);
    if (hasManifestExpectations && !areMtimeMapsEqual(manifestMtimes, parsed.manifestMtimes)) {
        return createCacheMiss(cacheFilePath, ProjectIndexCacheMissReason.MANIFEST_MTIME_MISMATCH);
    }

    const hasSourceExpectations = hasEntries(sourceMtimes);
    if (hasSourceExpectations && !areMtimeMapsEqual(sourceMtimes, parsed.sourceMtimes)) {
        return createCacheMiss(cacheFilePath, ProjectIndexCacheMissReason.SOURCE_MTIME_MISMATCH);
    }

    const projectIndex = {
        ...parsed.projectIndex
    };
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
    fsFacade: Required<Pick<ProjectIndexFsFacade, "mkdir" | "writeFile" | "rename" | "unlink">> = defaultFsFacade,
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

    try {
        await fsFacade.writeFile(tempFilePath, serialized, "utf8");
        ensureNotAborted();

        await fsFacade.rename(tempFilePath, cacheFilePath);
        ensureNotAborted();
    } catch (error) {
        try {
            await fsFacade.unlink(tempFilePath);
        } catch {
            // The rename failure above is the actionable error for callers; a
            // secondary failure while deleting the uniquely named temp file is
            // best-effort hygiene. Dropping that error preserves the original
            // stack trace while still leaving a breadcrumb that the write was
            // attempted—the random suffix prevents future writes from
            // colliding even if the orphaned file lingers.
        }
        throw error;
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
    fsFacade: Required<Pick<ProjectIndexFsFacade, "readDir" | "stat">> = defaultFsFacade
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
