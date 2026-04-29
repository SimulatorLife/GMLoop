import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import { type CachedValidationResult, RenameValidationCache } from "../src/rename-validation-cache.js";

// Helper to create a simple valid result
const createValidResult = async (): Promise<CachedValidationResult> => ({
    valid: true,
    errors: [],
    warnings: []
});

void describe("RenameValidationCache", () => {
    void describe("constructor", () => {
        void it("initializes with default config", () => {
            const cache = new RenameValidationCache();
            const stats = cache.getStats();

            assert.equal(stats.hits, 0);
            assert.equal(stats.misses, 0);
            assert.equal(stats.evictions, 0);
            assert.equal(stats.size, 0);
        });

        void it("accepts custom config", () => {
            const cache = new RenameValidationCache({
                maxSize: 100,
                ttlMs: 60_000,
                enabled: false
            });

            const stats = cache.getStats();
            assert.equal(stats.size, 0);
        });
    });

    void describe("getOrCompute", () => {
        void it("caches validation results", async () => {
            const cache = new RenameValidationCache();
            let computeCount = 0;

            const compute = async (): Promise<CachedValidationResult> => {
                computeCount++;
                return createValidResult();
            };

            await cache.getOrCompute("gml/script/scr_test", "scr_new", compute);
            await cache.getOrCompute("gml/script/scr_test", "scr_new", compute);

            assert.equal(computeCount, 1, "Compute should only be called once");
            assert.equal(cache.getStats().hits, 1);
            assert.equal(cache.getStats().misses, 1);
        });

        void it("treats different symbol-name pairs as distinct", async () => {
            const cache = new RenameValidationCache();
            let computeCount = 0;

            const compute = async (): Promise<CachedValidationResult> => {
                computeCount++;
                return createValidResult();
            };

            await cache.getOrCompute("gml/script/scr_a", "scr_x", compute);
            await cache.getOrCompute("gml/script/scr_a", "scr_y", compute);
            await cache.getOrCompute("gml/script/scr_b", "scr_x", compute);

            assert.equal(computeCount, 3);
            assert.equal(cache.getStats().size, 3);
        });

        void it("bypasses cache when disabled", async () => {
            const cache = new RenameValidationCache({ enabled: false });
            let computeCount = 0;

            const compute = async (): Promise<CachedValidationResult> => {
                computeCount++;
                return createValidResult();
            };

            await cache.getOrCompute("gml/script/scr_test", "scr_new", compute);
            await cache.getOrCompute("gml/script/scr_test", "scr_new", compute);

            assert.equal(computeCount, 2);
            assert.equal(cache.getStats().size, 0);
        });

        void it("evicts oldest entry when maxSize reached", async () => {
            const cache = new RenameValidationCache({ maxSize: 2 });

            await cache.getOrCompute("gml/script/scr_a", "scr_1", createValidResult);
            await cache.getOrCompute("gml/script/scr_b", "scr_2", createValidResult);

            assert.equal(cache.getStats().size, 2);
            assert.equal(cache.getStats().evictions, 0);

            await cache.getOrCompute("gml/script/scr_c", "scr_3", createValidResult);

            assert.equal(cache.getStats().size, 2);
            assert.equal(cache.getStats().evictions, 1);
        });

        void it("retains the most recently used entry when eviction is required", async () => {
            const cache = new RenameValidationCache({ maxSize: 2 });
            let computeCount = 0;

            const compute = async (): Promise<CachedValidationResult> => {
                computeCount += 1;
                return createValidResult();
            };

            await cache.getOrCompute("gml/script/scr_a", "scr_1", compute);
            await cache.getOrCompute("gml/script/scr_b", "scr_2", compute);

            await cache.getOrCompute("gml/script/scr_a", "scr_1", compute);
            await cache.getOrCompute("gml/script/scr_c", "scr_3", compute);
            await cache.getOrCompute("gml/script/scr_a", "scr_1", compute);
            await cache.getOrCompute("gml/script/scr_b", "scr_2", compute);

            assert.equal(computeCount, 4);
            assert.equal(cache.getStats().evictions, 2);
        });

        void it("respects TTL expiration", async (context: TestContext) => {
            const cache = new RenameValidationCache({ ttlMs: 100 });
            let computeCount = 0;
            context.mock.timers.enable({ apis: ["Date"], now: new Date("2020-01-01T00:00:00.000Z") });

            const compute = async (): Promise<CachedValidationResult> => {
                computeCount++;
                return createValidResult();
            };

            await cache.getOrCompute("gml/script/scr_test", "scr_new", compute);

            context.mock.timers.tick(150);

            await cache.getOrCompute("gml/script/scr_test", "scr_new", compute);

            assert.equal(computeCount, 2);
        });

        void it("tracks evictions when entries expire", async (context: TestContext) => {
            const cache = new RenameValidationCache({ ttlMs: 50, maxSize: 5 });
            context.mock.timers.enable({ apis: ["Date"], now: new Date("2020-01-01T00:00:00.000Z") });

            await cache.getOrCompute("gml/script/scr_test", "scr_new", createValidResult);

            context.mock.timers.tick(75);

            await cache.getOrCompute("gml/script/scr_test", "scr_new", createValidResult);

            const stats = cache.getStats();
            assert.equal(stats.evictions, 1);
            assert.equal(stats.size, 1);
        });

        void it("deduplicates concurrent validation requests for the same key", async () => {
            const cache = new RenameValidationCache();
            let computeCount = 0;
            let resolveCompute: (() => void) | null = null;
            const computeCompletion = new Promise<void>((resolve) => {
                resolveCompute = resolve;
            });

            const compute = async (): Promise<CachedValidationResult> => {
                computeCount += 1;
                await computeCompletion;
                return createValidResult();
            };

            const firstRequest = cache.getOrCompute("gml/script/scr_test", "scr_new", compute);
            const secondRequest = cache.getOrCompute("gml/script/scr_test", "scr_new", compute);
            assert.ok(resolveCompute !== null);
            resolveCompute();

            const [resultA, resultB] = await Promise.all([firstRequest, secondRequest]);

            assert.equal(computeCount, 1);
            assert.deepEqual(resultA, resultB);
            assert.equal(cache.getStats().hits, 1);
            assert.equal(cache.getStats().misses, 1);
        });

        void it("cleans up in-flight requests when computation fails", async () => {
            const cache = new RenameValidationCache();
            let computeCount = 0;

            await assert.rejects(async () => {
                await cache.getOrCompute("gml/script/scr_test", "scr_new", async () => {
                    computeCount += 1;
                    throw new Error("Validation failed");
                });
            });

            await assert.rejects(async () => {
                await cache.getOrCompute("gml/script/scr_test", "scr_new", async () => {
                    computeCount += 1;
                    throw new Error("Validation failed");
                });
            });

            assert.equal(computeCount, 2);
            assert.equal(cache.getStats().hits, 0);
            assert.equal(cache.getStats().misses, 2);
        });

        void it("preserves all validation result fields", async () => {
            const cache = new RenameValidationCache();

            const expectedResult: CachedValidationResult = {
                valid: false,
                errors: ["Error 1", "Error 2"],
                warnings: ["Warning 1"],
                symbolName: "scr_test",
                occurrenceCount: 10,
                hotReload: {
                    safe: true,
                    reason: "Scripts are hot-reload-safe",
                    requiresRestart: false,
                    canAutoFix: false,
                    suggestions: []
                }
            };

            const result = await cache.getOrCompute("gml/script/scr_test", "scr_new", async () => expectedResult);

            assert.equal(result.valid, false);
            assert.deepEqual(result.errors, ["Error 1", "Error 2"]);
            assert.deepEqual(result.warnings, ["Warning 1"]);
            assert.equal(result.symbolName, "scr_test");
            assert.equal(result.occurrenceCount, 10);
            assert.equal(result.hotReload?.safe, true);
        });
    });

    void describe("invalidate", () => {
        void it("removes specific cache entry", async () => {
            const cache = new RenameValidationCache();

            await cache.getOrCompute("gml/script/scr_test", "scr_new", createValidResult);
            assert.equal(cache.getStats().size, 1);

            cache.invalidate("gml/script/scr_test", "scr_new");
            assert.equal(cache.getStats().size, 0);
        });

        void it("only removes matching entry", async () => {
            const cache = new RenameValidationCache();

            await cache.getOrCompute("gml/script/scr_a", "scr_x", createValidResult);
            await cache.getOrCompute("gml/script/scr_a", "scr_y", createValidResult);
            await cache.getOrCompute("gml/script/scr_b", "scr_x", createValidResult);

            cache.invalidate("gml/script/scr_a", "scr_x");
            assert.equal(cache.getStats().size, 2);
        });
    });

    void describe("invalidateSymbol", () => {
        void it("removes all cache entries for a symbol", async () => {
            const cache = new RenameValidationCache();

            await cache.getOrCompute("gml/script/scr_test", "scr_new1", createValidResult);
            await cache.getOrCompute("gml/script/scr_test", "scr_new2", createValidResult);
            await cache.getOrCompute("gml/script/scr_test", "scr_new3", createValidResult);
            await cache.getOrCompute("gml/script/scr_other", "scr_new", createValidResult);

            assert.equal(cache.getStats().size, 4);

            cache.invalidateSymbol("gml/script/scr_test");
            assert.equal(cache.getStats().size, 1);
        });
    });

    void describe("invalidateAll", () => {
        void it("clears all cache entries", async () => {
            const cache = new RenameValidationCache();

            await cache.getOrCompute("gml/script/scr_a", "scr_1", createValidResult);
            await cache.getOrCompute("gml/script/scr_b", "scr_2", createValidResult);
            await cache.getOrCompute("gml/script/scr_c", "scr_3", createValidResult);

            assert.equal(cache.getStats().size, 3);

            cache.invalidateAll();
            assert.equal(cache.getStats().size, 0);
        });
    });

    void describe("getStats", () => {
        void it("returns current statistics", async () => {
            const cache = new RenameValidationCache();

            await cache.getOrCompute("gml/script/scr_a", "scr_1", createValidResult);
            await cache.getOrCompute("gml/script/scr_a", "scr_1", createValidResult); // Hit
            await cache.getOrCompute("gml/script/scr_b", "scr_2", createValidResult);

            const stats = cache.getStats();
            assert.equal(stats.hits, 1);
            assert.equal(stats.misses, 2);
            assert.equal(stats.size, 2);
        });

        void it("returns frozen stats object", () => {
            const cache = new RenameValidationCache();
            const stats = cache.getStats();

            assert.throws(() => {
                (stats as { hits: number }).hits = 999;
            });
        });
    });

    void describe("resetStats", () => {
        void it("resets performance counters but preserves cache", async () => {
            const cache = new RenameValidationCache();

            await cache.getOrCompute("gml/script/scr_a", "scr_1", createValidResult);
            await cache.getOrCompute("gml/script/scr_a", "scr_1", createValidResult); // Hit

            const beforeReset = cache.getStats();
            assert.equal(beforeReset.hits, 1);
            assert.equal(beforeReset.misses, 1);
            assert.equal(beforeReset.size, 1);

            cache.resetStats();

            const afterReset = cache.getStats();
            assert.equal(afterReset.hits, 0);
            assert.equal(afterReset.misses, 0);
            assert.equal(afterReset.size, 1);
        });
    });

    void describe("edge cases", () => {
        void it("handles zero maxSize", async () => {
            const cache = new RenameValidationCache({ maxSize: 0 });

            await cache.getOrCompute("gml/script/scr_test", "scr_new", createValidResult);
            assert.equal(cache.getStats().size, 0);
            assert.equal(cache.getStats().evictions, 1);
        });

        void it("handles maxSize of 1", async () => {
            const cache = new RenameValidationCache({ maxSize: 1 });

            await cache.getOrCompute("gml/script/scr_a", "scr_1", createValidResult);
            assert.equal(cache.getStats().size, 1);

            await cache.getOrCompute("gml/script/scr_b", "scr_2", createValidResult);
            assert.equal(cache.getStats().size, 1);
            assert.equal(cache.getStats().evictions, 1);
        });
    });
});
