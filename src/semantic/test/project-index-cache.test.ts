import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AbortSignalLike } from "@gmloop/core";

import {
    evaluateProjectIndexCacheSizePolicy,
    normalizeProjectIndexCacheMaxSizeBytes
} from "../src/project-index/cache-write-policy.js";
import {
    applyProjectIndexCacheEnvOverride,
    assertProjectIndexCacheStatus,
    createProjectIndexCoordinator,
    getDefaultProjectIndexCacheMaxSize,
    loadProjectIndexCache,
    PROJECT_INDEX_CACHE_DIRECTORY,
    PROJECT_INDEX_CACHE_FILENAME,
    PROJECT_INDEX_CACHE_MAX_SIZE_BASELINE,
    PROJECT_INDEX_CACHE_MAX_SIZE_ENV_VAR,
    PROJECT_INDEX_CACHE_SCHEMA_VERSION,
    ProjectIndexCacheMissReason,
    ProjectIndexCacheStatus,
    saveProjectIndexCache,
    setDefaultProjectIndexCacheMaxSize
} from "../src/project-index/index.js";

function createProjectIndex(projectRoot, metrics = null) {
    return {
        projectRoot,
        resources: {},
        scopes: {},
        files: {},
        relationships: {},
        identifiers: {},
        metrics
    };
}

function createDeferred() {
    let resolve;
    const promise = new Promise((_resolve) => {
        resolve = _resolve;
    });
    return { promise, resolve };
}

void test("assertProjectIndexCacheStatus validates status strings", () => {
    assert.equal(assertProjectIndexCacheStatus(ProjectIndexCacheStatus.HIT), ProjectIndexCacheStatus.HIT);

    assert.throws(
        () => assertProjectIndexCacheStatus("invalid-status"),
        (error) => {
            assert.equal(error instanceof TypeError, true);
            assert.match((error as any).message, /Project index cache status must be one of:/);
            return true;
        }
    );
});

async function withTempDir(run) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gml-cache-"));
    try {
        return await run(tempRoot);
    } finally {
        await rm(tempRoot, { recursive: true, force: true });
    }
}

void test("saveProjectIndexCache writes payload and loadProjectIndexCache returns hit", async () => {
    await withTempDir(async (projectRoot) => {
        const manifestMtimes = { "project.yyp": 100 };
        const sourceMtimes = { "scripts/main.gml": 200 };
        const metrics = { counters: { total: 1 } };
        const projectIndex = createProjectIndex(projectRoot, metrics);

        const saveResult = await saveProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes,
            sourceMtimes,
            projectIndex
        });

        assert.equal(saveResult.status, ProjectIndexCacheStatus.WRITTEN);

        const serializedCache = await readFile(saveResult.cacheFilePath, "utf8");
        assert.equal(serializedCache.endsWith("\n"), false);

        const loadResult = await loadProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes,
            sourceMtimes
        });

        assert.equal(loadResult.status, ProjectIndexCacheStatus.HIT);
        assert.deepEqual(loadResult.projectIndex.metrics, metrics);
    });
});

void test("saveProjectIndexCache normalizes mtime maps to finite numbers", async () => {
    await withTempDir(async (projectRoot) => {
        const manifestMtimes = {
            "project.yyp": "101",
            "project-alt.yyp": 0,
            "ignore-nan": "NaN",
            "ignore-infinity": Number.POSITIVE_INFINITY
        };
        const sourceMtimes = {
            "scripts/a.gml": 200,
            "scripts/b.gml": "300",
            "scripts/c.gml": "-42.5",
            "scripts/ignored.gml": undefined
        };

        const saveResult = await saveProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes,
            sourceMtimes,
            projectIndex: createProjectIndex(projectRoot)
        });

        assert.equal(saveResult.status, ProjectIndexCacheStatus.WRITTEN);

        const loadResult = await loadProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0"
        });

        assert.equal(loadResult.status, ProjectIndexCacheStatus.HIT);
        assert.deepEqual(loadResult.payload.manifestMtimes, {
            "project.yyp": 101,
            "project-alt.yyp": 0
        });
        assert.deepEqual(loadResult.payload.sourceMtimes, {
            "scripts/a.gml": 200,
            "scripts/b.gml": 300,
            "scripts/c.gml": -42.5
        });
    });
});

void test("saveProjectIndexCache respects maxSizeBytes overrides", async () => {
    await withTempDir(async (projectRoot) => {
        const saveResult = await saveProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes: {},
            sourceMtimes: {},
            projectIndex: createProjectIndex(projectRoot),
            maxSizeBytes: 1
        });

        assert.equal(saveResult.status, ProjectIndexCacheStatus.SKIPPED);
        assert.equal(saveResult.reason, "payload-too-large");
        assert.ok(saveResult.size > 1);
    });
});

void test("saveProjectIndexCache allows unlimited size when maxSizeBytes is 0", async () => {
    await withTempDir(async (projectRoot) => {
        const projectIndex = createProjectIndex(projectRoot);

        const saveResult = await saveProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes: {},
            sourceMtimes: {},
            projectIndex,
            maxSizeBytes: 0
        });

        assert.equal(saveResult.status, ProjectIndexCacheStatus.WRITTEN);

        const loadResult = await loadProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0"
        });

        assert.equal(loadResult.status, ProjectIndexCacheStatus.HIT);
        assert.deepEqual(loadResult.projectIndex, projectIndex);
    });
});

void test("project index cache size policy evaluates size ceilings", () => {
    assert.equal(normalizeProjectIndexCacheMaxSizeBytes(null), null);
    assert.equal(normalizeProjectIndexCacheMaxSizeBytes("42"), 42);
    assert.equal(normalizeProjectIndexCacheMaxSizeBytes(-1), null);

    const skipDecision = evaluateProjectIndexCacheSizePolicy({
        maxSizeBytes: 1,
        payloadSizeBytes: 10
    });
    assert.equal(skipDecision.shouldWrite, false);
    assert.equal(skipDecision.reason, "payload-too-large");
    assert.equal(skipDecision.effectiveMaxSizeBytes, 1);

    const writeDecision = evaluateProjectIndexCacheSizePolicy({
        maxSizeBytes: 0,
        payloadSizeBytes: 10_000
    });
    assert.equal(writeDecision.shouldWrite, true);
    assert.equal(writeDecision.reason, null);
    assert.equal(writeDecision.effectiveMaxSizeBytes, 0);
});

void test("loadProjectIndexCache reports version mismatches", async () => {
    await withTempDir(async (projectRoot) => {
        const manifestMtimes = { "project.yyp": 100 };
        const sourceMtimes = { "scripts/main.gml": 200 };

        await saveProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes,
            sourceMtimes,
            projectIndex: createProjectIndex(projectRoot)
        });

        const formatterMiss = await loadProjectIndexCache({
            projectRoot,
            formatterVersion: "2.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes,
            sourceMtimes
        });

        assert.equal(formatterMiss.status, ProjectIndexCacheStatus.MISS);
        assert.equal(formatterMiss.reason.type, ProjectIndexCacheMissReason.FORMATTER_VERSION_MISMATCH);

        const pluginMiss = await loadProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.2.0",
            manifestMtimes,
            sourceMtimes
        });

        assert.equal(pluginMiss.status, ProjectIndexCacheStatus.MISS);
        assert.equal(pluginMiss.reason.type, ProjectIndexCacheMissReason.PLUGIN_VERSION_MISMATCH);
    });
});

void test("loadProjectIndexCache reports mtime invalidations", async () => {
    await withTempDir(async (projectRoot) => {
        await saveProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes: { "project.yyp": 100 },
            sourceMtimes: { "scripts/main.gml": 200 },
            projectIndex: createProjectIndex(projectRoot)
        });

        const manifestMiss = await loadProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes: { "project.yyp": 150 },
            sourceMtimes: { "scripts/main.gml": 200 }
        });

        assert.equal(manifestMiss.status, ProjectIndexCacheStatus.MISS);
        assert.equal(manifestMiss.reason.type, ProjectIndexCacheMissReason.MANIFEST_MTIME_MISMATCH);

        const sourceMiss = await loadProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes: { "project.yyp": 100 },
            sourceMtimes: { "scripts/main.gml": 250 }
        });

        assert.equal(sourceMiss.status, ProjectIndexCacheStatus.MISS);
        assert.equal(sourceMiss.reason.type, ProjectIndexCacheMissReason.SOURCE_MTIME_MISMATCH);
    });
});

void test("loadProjectIndexCache tolerates sub-millisecond mtime noise", async () => {
    await withTempDir(async (projectRoot) => {
        const manifestBase = 1_700_000_000_000;
        const manifestMtimes = {
            "project.yyp": manifestBase + 0.1234
        };
        const sourceBase = 1_700_000_000_500;
        const sourceMtimes = {
            "scripts/main.gml": sourceBase + 0.5678
        };

        await saveProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes,
            sourceMtimes,
            projectIndex: createProjectIndex(projectRoot)
        });

        const loadResult = await loadProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes: {
                "project.yyp": manifestMtimes["project.yyp"] + 0.0004
            },
            sourceMtimes: {
                "scripts/main.gml": sourceMtimes["scripts/main.gml"] - 0.0003
            }
        });

        assert.equal(loadResult.status, ProjectIndexCacheStatus.HIT);
    });
});

void test("loadProjectIndexCache treats differently ordered mtime maps as equal", async () => {
    await withTempDir(async (projectRoot) => {
        await saveProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes: {
                "project.yyp": 100,
                "assets/project_extra.yyp": 200
            },
            sourceMtimes: {
                "scripts/main.gml": 300,
                "scripts/secondary.gml": 400
            },
            projectIndex: createProjectIndex(projectRoot)
        });

        const loadResult = await loadProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes: {
                "assets/project_extra.yyp": 200,
                "project.yyp": 100
            },
            sourceMtimes: {
                "scripts/secondary.gml": 400,
                "scripts/main.gml": 300
            }
        });

        assert.equal(loadResult.status, ProjectIndexCacheStatus.HIT);
    });
});

void test("loadProjectIndexCache handles corrupted cache payloads", async () => {
    await withTempDir(async (projectRoot) => {
        const cacheDir = path.join(projectRoot, PROJECT_INDEX_CACHE_DIRECTORY);
        await mkdir(cacheDir, { recursive: true });
        const cacheFilePath = path.join(cacheDir, PROJECT_INDEX_CACHE_FILENAME);

        await writeFile(cacheFilePath, "{ invalid", "utf8");

        const result = await loadProjectIndexCache({
            projectRoot,
            formatterVersion: "1.0.0",
            pluginVersion: "0.1.0",
            manifestMtimes: { "project.yyp": 100 },
            sourceMtimes: { "scripts/main.gml": 200 }
        });

        assert.equal(result.status, ProjectIndexCacheStatus.MISS);
        assert.equal(result.reason.type, ProjectIndexCacheMissReason.INVALID_JSON);
        assert.ok(result.reason.error instanceof SyntaxError);
        assert.equal(result.reason.error.name, "JsonParseError");
        assert.match(result.reason.error.message, /Failed to parse project index cache/);
    });
});

void test("createProjectIndexCoordinator serialises builds for the same project", async () => {
    const storedPayloads = new Map();
    let buildCount = 0;
    const cacheFilePath = path.join(os.tmpdir(), "virtual-cache.json");
    // The test previously relied on real timers to keep the first build pending
    // long enough for a concurrent ensureReady call to observe the shared
    // in-flight promise. That approach was prone to races when event loop
    // scheduling varied, so explicit deferred promises keep the orchestration
    // deterministic.
    const buildHasStarted = createDeferred();
    const releaseBuild = createDeferred();

    const coordinator = createProjectIndexCoordinator({
        loadCache: async (descriptor) => {
            const key = path.resolve(descriptor.projectRoot);
            const payload = storedPayloads.get(key);
            if (!payload) {
                return {
                    status: ProjectIndexCacheStatus.MISS,
                    cacheFilePath,
                    reason: { type: ProjectIndexCacheMissReason.NOT_FOUND }
                };
            }

            const projectIndex = {
                ...payload.projectIndex
            };
            if (payload.metricsSummary !== undefined) {
                projectIndex.metrics = payload.metricsSummary;
            }

            return {
                status: ProjectIndexCacheStatus.HIT,
                cacheFilePath,
                payload,
                projectIndex
            };
        },
        saveCache: async (descriptor) => {
            const key = path.resolve(descriptor.projectRoot);
            storedPayloads.set(key, {
                schemaVersion: PROJECT_INDEX_CACHE_SCHEMA_VERSION,
                projectRoot: key,
                formatterVersion: descriptor.formatterVersion,
                pluginVersion: descriptor.pluginVersion,
                manifestMtimes: { ...descriptor.manifestMtimes },
                sourceMtimes: { ...descriptor.sourceMtimes },
                metricsSummary: descriptor.projectIndex.metrics ?? null,
                projectIndex: { ...descriptor.projectIndex }
            });
            return {
                status: ProjectIndexCacheStatus.WRITTEN,
                cacheFilePath,
                size: 10
            };
        },
        buildIndex: async (root) => {
            buildCount += 1;
            buildHasStarted.resolve();
            await releaseBuild.promise;
            return createProjectIndex(root, { buildCount });
        }
    });

    const descriptor = {
        projectRoot: path.join(os.tmpdir(), "shared-project"),
        formatterVersion: "1.0.0",
        pluginVersion: "0.1.0",
        manifestMtimes: { "project.yyp": 100 },
        sourceMtimes: { "scripts/main.gml": 200 }
    };

    try {
        const firstPromise = coordinator.ensureReady(descriptor);
        await buildHasStarted.promise;
        const secondPromise = coordinator.ensureReady(descriptor);

        releaseBuild.resolve();

        const [first, second] = await Promise.all([firstPromise, secondPromise]);

        assert.equal(buildCount, 1);
        assert.equal(first.source, "build");
        assert.strictEqual(first.projectIndex, second.projectIndex);
        assert.equal(first.cache.saveResult.status, ProjectIndexCacheStatus.WRITTEN);

        const cacheHit = await coordinator.ensureReady(descriptor);
        assert.equal(cacheHit.source, "cache");
        assert.equal(buildCount, 1);
    } finally {
        coordinator.dispose();
    }

    assert.throws(() => coordinator.ensureReady(descriptor), /disposed/i);
});

void test("createProjectIndexCoordinator aborts in-flight builds on dispose", async () => {
    const cacheFilePath = path.join(os.tmpdir(), "virtual-cache.json");
    const buildStarted = createDeferred();
    let saveCalls = 0;

    const coordinator = createProjectIndexCoordinator({
        loadCache: async () => ({
            status: ProjectIndexCacheStatus.MISS,
            cacheFilePath,
            reason: { type: ProjectIndexCacheMissReason.NOT_FOUND }
        }),
        saveCache: async () => {
            saveCalls += 1;
            return {
                status: ProjectIndexCacheStatus.WRITTEN,
                cacheFilePath,
                size: 1
            };
        },
        buildIndex: async (
            root,
            fsFacade,
            options: {
                signal?: AbortSignalLike | null;
            } = {}
        ) => {
            buildStarted.resolve(options.signal ?? null);

            await new Promise((_resolve, reject) => {
                const { signal } = options;
                if (!signal) {
                    reject(new Error("Expected abort signal"));
                    return;
                }

                if (signal.aborted) {
                    const reason = signal.reason instanceof Error ? signal.reason : new Error("aborted");
                    reject(reason);
                    return;
                }

                const onAbort = () => {
                    signal.removeEventListener("abort", onAbort);
                    const reason = signal.reason instanceof Error ? signal.reason : new Error("aborted");
                    reject(reason);
                };
                signal.addEventListener("abort", onAbort, { once: true });
            });

            return createProjectIndex(root);
        }
    });

    const descriptor = {
        projectRoot: path.join(os.tmpdir(), "dispose-project"),
        formatterVersion: "1.0.0",
        pluginVersion: "0.1.0",
        manifestMtimes: { "project.yyp": 100 },
        sourceMtimes: { "scripts/main.gml": 200 }
    };

    const ensurePromise = coordinator.ensureReady(descriptor);
    const signal = await buildStarted.promise;
    assert.ok(signal, "Expected buildIndex to receive an abort signal");

    coordinator.dispose();

    await assert.rejects(ensurePromise, /disposed/i);
    assert.equal(saveCalls, 0, "Cache writes should not occur after dispose");
});

void test("createProjectIndexCoordinator forwards configured cacheMaxSizeBytes", async () => {
    await assertCoordinatorMaxSizeScenario({
        coordinatorOverrides: { cacheMaxSizeBytes: 42 },
        ensureArgs: { projectRoot: "/project" },
        expectedMaxSize: 42
    });
});

void test("createProjectIndexCoordinator allows descriptor cacheMaxSizeBytes overrides", async () => {
    await assertCoordinatorMaxSizeScenario({
        coordinatorOverrides: { cacheMaxSizeBytes: 42 },
        ensureArgs: { projectRoot: "/project", cacheMaxSizeBytes: 99 },
        expectedMaxSize: 99
    });
});

async function assertCoordinatorMaxSizeScenario({
    coordinatorOverrides = {},
    ensureArgs,
    expectedMaxSize
}: {
    coordinatorOverrides?: Record<string, unknown>;
    ensureArgs: { projectRoot: string; cacheMaxSizeBytes?: number };
    expectedMaxSize: number;
}) {
    const savedDescriptors: Array<{ maxSizeBytes: number }> = [];
    const coordinator = createProjectIndexCoordinator({
        loadCache: async () => ({
            status: ProjectIndexCacheStatus.MISS,
            cacheFilePath: "virtual-cache.json",
            reason: { type: ProjectIndexCacheMissReason.NOT_FOUND }
        }),
        saveCache: async (descriptor) => {
            savedDescriptors.push(descriptor);
            return {
                status: ProjectIndexCacheStatus.WRITTEN,
                cacheFilePath: descriptor.cacheFilePath ?? "virtual-cache.json",
                size: 0
            };
        },
        buildIndex: async () => createProjectIndex("/project"),
        ...coordinatorOverrides
    });

    try {
        await coordinator.ensureReady(ensureArgs);
        assert.equal(savedDescriptors.length, 1);
        assert.equal(savedDescriptors[0].maxSizeBytes, expectedMaxSize);
    } finally {
        coordinator.dispose();
    }
}

// The tests below all exercise the global default cache size. When they ran in
// parallel the shared default from one case could bleed into another, leading
// to assertions that intermittently observed a mutated baseline. Running them
// sequentially keeps the shared state deterministic without relying on timing
// quirks or the test scheduler's execution order.
void test("saveProjectIndexCache cleans up temp file when rename fails", async () => {
    const unlinkCalls: string[] = [];
    let writeFileCalled = false;

    const mockFsFacade = {
        readFile: async () => {
            throw new Error("not used");
        },
        writeFile: async () => {
            writeFileCalled = true;
        },
        rename: async () => {
            throw new Error("rename failed");
        },
        unlink: async (_filePath: string) => {
            unlinkCalls.push(_filePath);
        },
        mkdir: async () => {}
    };

    const projectIndex = createProjectIndex("/project");

    await assert.rejects(
        saveProjectIndexCache(
            {
                projectRoot: "/project",
                formatterVersion: "1.0.0",
                pluginVersion: "0.1.0",
                manifestMtimes: {},
                sourceMtimes: {},
                projectIndex
            },
            mockFsFacade as any
        ),
        /rename failed/
    );

    assert.equal(writeFileCalled, true, "writeFile should have been called before rename failed");
    assert.equal(unlinkCalls.length, 1, "unlink should have been called exactly once to clean up temp file");
    assert.match(unlinkCalls[0], /\.tmp$/, "unlink should target the temp file path");
});

void test("saveProjectIndexCache cleans up temp file when writeFile fails", async () => {
    const unlinkCalls: string[] = [];

    const mockFsFacade = {
        readFile: async () => {
            throw new Error("not used");
        },
        writeFile: async () => {
            throw new Error("writeFile failed");
        },
        rename: async () => {
            throw new Error("rename should not be called");
        },
        unlink: async (_filePath: string) => {
            unlinkCalls.push(_filePath);
        },
        mkdir: async () => {}
    };

    const projectIndex = createProjectIndex("/project");

    await assert.rejects(
        saveProjectIndexCache(
            {
                projectRoot: "/project",
                formatterVersion: "1.0.0",
                pluginVersion: "0.1.0",
                manifestMtimes: {},
                sourceMtimes: {},
                projectIndex
            },
            mockFsFacade as any
        ),
        /writeFile failed/
    );

    assert.equal(unlinkCalls.length, 1, "unlink should have been called even when writeFile fails");
    assert.match(unlinkCalls[0], /\.tmp$/, "unlink should target the temp file path");
});

void test.describe("project index cache default size overrides", { concurrency: false }, () => {
    void test("project index cache max size can be tuned programmatically", () => {
        const originalMax = getDefaultProjectIndexCacheMaxSize();

        try {
            const baseline = setDefaultProjectIndexCacheMaxSize(PROJECT_INDEX_CACHE_MAX_SIZE_BASELINE);
            assert.equal(baseline, PROJECT_INDEX_CACHE_MAX_SIZE_BASELINE);

            const lowered = setDefaultProjectIndexCacheMaxSize(1024);
            assert.equal(lowered, 1024);
            assert.equal(getDefaultProjectIndexCacheMaxSize(), 1024);

            const reset = setDefaultProjectIndexCacheMaxSize("not-a-number");
            assert.equal(reset, PROJECT_INDEX_CACHE_MAX_SIZE_BASELINE);
            assert.equal(getDefaultProjectIndexCacheMaxSize(), PROJECT_INDEX_CACHE_MAX_SIZE_BASELINE);

            const disabled = setDefaultProjectIndexCacheMaxSize(0);
            assert.equal(disabled, 0);
            assert.equal(getDefaultProjectIndexCacheMaxSize(), 0);
        } finally {
            setDefaultProjectIndexCacheMaxSize(originalMax);
        }
    });

    void test("environment overrides apply before using cache max size default", () => {
        const originalMax = getDefaultProjectIndexCacheMaxSize();

        try {
            applyProjectIndexCacheEnvOverride({
                [PROJECT_INDEX_CACHE_MAX_SIZE_ENV_VAR]: "2048"
            });

            assert.equal(getDefaultProjectIndexCacheMaxSize(), 2048);
        } finally {
            setDefaultProjectIndexCacheMaxSize(originalMax);
        }
    });

    void test("environment overrides can disable the cache max size", () => {
        const originalMax = getDefaultProjectIndexCacheMaxSize();

        try {
            applyProjectIndexCacheEnvOverride({
                [PROJECT_INDEX_CACHE_MAX_SIZE_ENV_VAR]: "0"
            });

            assert.equal(getDefaultProjectIndexCacheMaxSize(), 0);
        } finally {
            setDefaultProjectIndexCacheMaxSize(originalMax);
        }
    });

    void test("createProjectIndexCoordinator uses configured default cache max size", async () => {
        const originalMax = getDefaultProjectIndexCacheMaxSize();
        let coordinator = null;

        try {
            setDefaultProjectIndexCacheMaxSize(4096);

            const savedDescriptors = [];
            coordinator = createProjectIndexCoordinator({
                loadCache: async () => ({
                    status: ProjectIndexCacheStatus.MISS,
                    cacheFilePath: "virtual-cache.json",
                    reason: { type: ProjectIndexCacheMissReason.NOT_FOUND }
                }),
                saveCache: async (descriptor) => {
                    savedDescriptors.push(descriptor);
                    return {
                        status: ProjectIndexCacheStatus.WRITTEN,
                        cacheFilePath: descriptor.cacheFilePath ?? "virtual-cache.json",
                        size: 0
                    };
                },
                buildIndex: async () => createProjectIndex("/project")
            });

            await coordinator.ensureReady({ projectRoot: "/project" });

            assert.equal(savedDescriptors.length, 1);
            assert.equal(savedDescriptors[0].maxSizeBytes, 4096);
        } finally {
            setDefaultProjectIndexCacheMaxSize(originalMax);
            coordinator?.dispose();
        }
    });
});
