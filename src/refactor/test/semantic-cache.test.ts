import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SemanticQueryCache } from "../src/semantic-cache.js";
import type { DependentSymbol, FileSymbol, PartialSemanticAnalyzer, SymbolOccurrence } from "../src/types.js";

void describe("SemanticQueryCache", () => {
    void describe("getSymbolOccurrences", () => {
        void it("caches symbol occurrence queries", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async (_name: string) => {
                    callCount++;
                    return [{ path: "test.gml", start: 0, end: 10 }] as Array<SymbolOccurrence>;
                }
            };

            const cache = new SemanticQueryCache(semantic);
            const result1 = await cache.getSymbolOccurrences("player_hp");
            const result2 = await cache.getSymbolOccurrences("player_hp");

            assert.equal(callCount, 1, "Semantic analyzer should only be called once");
            assert.deepEqual(result1, result2, "Cached result should match first result");
        });

        void it("returns different results for different symbols", async () => {
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async (name: string) => {
                    if (name === "player_hp") {
                        return [{ path: "player.gml", start: 0, end: 10 }] as Array<SymbolOccurrence>;
                    }
                    return [{ path: "enemy.gml", start: 0, end: 10 }] as Array<SymbolOccurrence>;
                }
            };

            const cache = new SemanticQueryCache(semantic);
            const result1 = await cache.getSymbolOccurrences("player_hp");
            const result2 = await cache.getSymbolOccurrences("enemy_hp");

            assert.equal(result1[0].path, "player.gml");
            assert.equal(result2[0].path, "enemy.gml");
        });

        void it("treats same-name queries with different symbol IDs as distinct cache entries", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async (_name: string, symbolId?: string | null) => {
                    callCount++;
                    return [
                        {
                            path: symbolId === "gml/scripts/DemoLibrary" ? "resource.gml" : "callable.gml",
                            start: 0,
                            end: 10
                        }
                    ] as Array<SymbolOccurrence>;
                }
            };

            const cache = new SemanticQueryCache(semantic);
            const resourceResult = await cache.getSymbolOccurrences("DemoLibrary", "gml/scripts/DemoLibrary");
            const callableResult = await cache.getSymbolOccurrences("DemoLibrary", "gml/script/DemoLibrary");
            const repeatedResourceResult = await cache.getSymbolOccurrences("DemoLibrary", "gml/scripts/DemoLibrary");

            assert.equal(callCount, 2, "Distinct symbol IDs should not share the same occurrence cache entry");
            assert.equal(resourceResult[0].path, "resource.gml");
            assert.equal(callableResult[0].path, "callable.gml");
            assert.deepEqual(repeatedResourceResult, resourceResult);
        });

        void it("bypasses cache when disabled", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async () => {
                    callCount++;
                    return [];
                }
            };

            const cache = new SemanticQueryCache(semantic, { enabled: false });
            await cache.getSymbolOccurrences("test");
            await cache.getSymbolOccurrences("test");

            assert.equal(callCount, 2, "Cache should be bypassed");
        });

        void it("returns empty array when semantic analyzer lacks method", async () => {
            const semantic: PartialSemanticAnalyzer = {};
            const cache = new SemanticQueryCache(semantic);
            const result = await cache.getSymbolOccurrences("test");

            assert.deepEqual(result, []);
        });

        void it("respects TTL expiration", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async () => {
                    callCount++;
                    return [{ path: "test.gml", start: 0, end: 10 }] as Array<SymbolOccurrence>;
                }
            };

            const cache = new SemanticQueryCache(semantic, { ttlMs: 100 });
            await cache.getSymbolOccurrences("test");

            // Wait for TTL to expire
            await new Promise((resolve) => setTimeout(resolve, 150));

            await cache.getSymbolOccurrences("test");

            assert.equal(callCount, 2, "Expired entry should trigger new query");
        });

        void it("does not retain oversized occurrence arrays in cache", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async () => {
                    callCount++;
                    return Array.from({ length: 4 }, (_, index) => ({
                        path: `file-${index}.gml`,
                        start: index,
                        end: index + 1,
                        kind: "reference"
                    })) as Array<SymbolOccurrence>;
                }
            };

            const cache = new SemanticQueryCache(semantic, {
                maxOccurrenceCacheEntries: 3
            });

            await cache.getSymbolOccurrences("oversized_symbol");
            await cache.getSymbolOccurrences("oversized_symbol");

            assert.equal(callCount, 2, "Oversized occurrence sets should be fetched each time");
        });
    });

    void describe("getFileSymbols", () => {
        void it("caches file symbol queries", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getFileSymbols: async (_path: string) => {
                    callCount++;
                    return [{ id: "gml/script/test" }] as Array<FileSymbol>;
                }
            };

            const cache = new SemanticQueryCache(semantic);
            const result1 = await cache.getFileSymbols("test.gml");
            const result2 = await cache.getFileSymbols("test.gml");

            assert.equal(callCount, 1, "Semantic analyzer should only be called once");
            assert.deepEqual(result1, result2);
        });

        void it("handles null results from semantic analyzer", async () => {
            const semantic: PartialSemanticAnalyzer = {
                getFileSymbols: async () => null as unknown as Array<FileSymbol>
            };

            const cache = new SemanticQueryCache(semantic);
            const result = await cache.getFileSymbols("test.gml");

            assert.deepEqual(result, []);
        });

        void it("returns empty array when semantic analyzer lacks method", async () => {
            const semantic: PartialSemanticAnalyzer = {};
            const cache = new SemanticQueryCache(semantic);
            const result = await cache.getFileSymbols("test.gml");

            assert.deepEqual(result, []);
        });
    });

    void describe("getDependents", () => {
        void it("caches dependent symbol queries", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getDependents: async (_ids: Array<string>) => {
                    callCount++;
                    return [{ symbolId: "gml/script/dependent", filePath: "dep.gml" }] as Array<DependentSymbol>;
                }
            };

            const cache = new SemanticQueryCache(semantic);
            const result1 = await cache.getDependents(["gml/script/test"]);
            const result2 = await cache.getDependents(["gml/script/test"]);

            assert.equal(callCount, 1, "Semantic analyzer should only be called once");
            assert.deepEqual(result1, result2);
        });

        void it("normalizes symbol ID order for cache key", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getDependents: async () => {
                    callCount++;
                    return [];
                }
            };

            const cache = new SemanticQueryCache(semantic);
            await cache.getDependents(["a", "b", "c"]);
            await cache.getDependents(["c", "b", "a"]);

            assert.equal(callCount, 1, "Order-independent cache key should match");
        });

        void it("returns empty array for empty input", async () => {
            const semantic: PartialSemanticAnalyzer = {
                getDependents: async () => {
                    throw new Error("Should not be called");
                }
            };

            const cache = new SemanticQueryCache(semantic);
            const result = await cache.getDependents([]);

            assert.deepEqual(result, []);
        });

        void it("handles null results from semantic analyzer", async () => {
            const semantic: PartialSemanticAnalyzer = {
                getDependents: async () => null as unknown as Array<DependentSymbol>
            };

            const cache = new SemanticQueryCache(semantic);
            const result = await cache.getDependents(["test"]);

            assert.deepEqual(result, []);
        });
    });

    void describe("hasSymbol", () => {
        void it("caches symbol existence queries", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                hasSymbol: async (_id: string) => {
                    callCount++;
                    return true;
                }
            };

            const cache = new SemanticQueryCache(semantic);
            const result1 = await cache.hasSymbol("gml/script/test");
            const result2 = await cache.hasSymbol("gml/script/test");

            assert.equal(callCount, 1);
            assert.equal(result1, result2);
        });

        void it("returns true when semantic analyzer lacks method", async () => {
            const semantic: PartialSemanticAnalyzer = {};
            const cache = new SemanticQueryCache(semantic);
            const result = await cache.hasSymbol("test");

            assert.equal(result, true);
        });
    });

    void describe("invalidation", () => {
        void it("invalidateAll clears all caches", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async () => {
                    callCount++;
                    return [];
                }
            };

            const cache = new SemanticQueryCache(semantic);
            await cache.getSymbolOccurrences("test");
            cache.invalidateAll();
            await cache.getSymbolOccurrences("test");

            assert.equal(callCount, 2, "Invalidation should force new query");
        });

        void it("invalidateFile clears file-specific cache", async () => {
            let fileCallCount = 0;
            let occCallCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getFileSymbols: async (_path: string) => {
                    fileCallCount++;
                    return [{ id: "gml/script/test" }] as Array<FileSymbol>;
                },
                getSymbolOccurrences: async () => {
                    occCallCount++;
                    return [{ path: "test.gml", start: 0, end: 10 }] as Array<SymbolOccurrence>;
                }
            };

            const cache = new SemanticQueryCache(semantic);
            await cache.getFileSymbols("test.gml");
            await cache.getSymbolOccurrences("player_hp");

            cache.invalidateFile("test.gml");

            await cache.getFileSymbols("test.gml");
            await cache.getSymbolOccurrences("player_hp");

            assert.equal(fileCallCount, 2, "File symbols should be re-queried");
            assert.equal(occCallCount, 2, "Occurrences referencing the file should be re-queried");
        });

        void it("invalidateFile clears dependent and existence caches for file symbols", async () => {
            let fileCallCount = 0;
            let dependentCallCount = 0;
            let existenceCallCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getFileSymbols: async (_path: string) => {
                    fileCallCount++;
                    return [{ id: "gml/script/alpha" }, { id: "gml/script/beta" }] as Array<FileSymbol>;
                },
                getDependents: async (_ids: Array<string>) => {
                    dependentCallCount++;
                    return [{ symbolId: "gml/script/dependent", filePath: "dep.gml" }] as Array<DependentSymbol>;
                },
                hasSymbol: async (_id: string) => {
                    existenceCallCount++;
                    return true;
                }
            };

            const cache = new SemanticQueryCache(semantic);
            await cache.getFileSymbols("test.gml");
            await cache.getDependents(["gml/script/alpha"]);
            await cache.hasSymbol("gml/script/alpha");

            cache.invalidateFile("test.gml");

            await cache.getDependents(["gml/script/alpha"]);
            await cache.hasSymbol("gml/script/alpha");

            assert.equal(fileCallCount, 1, "File symbols query should remain cached until invalidated");
            assert.equal(dependentCallCount, 2, "Dependents should be re-queried after invalidation");
            assert.equal(existenceCallCount, 2, "Symbol existence should be re-queried after invalidation");
        });

        void it("invalidateFile does not clear unrelated occurrences", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async () => {
                    callCount++;
                    return [{ path: "other.gml", start: 0, end: 10 }] as Array<SymbolOccurrence>;
                }
            };

            const cache = new SemanticQueryCache(semantic);
            await cache.getSymbolOccurrences("test");
            cache.invalidateFile("different.gml");
            await cache.getSymbolOccurrences("test");

            assert.equal(callCount, 1, "Unrelated occurrences should remain cached");
        });
    });

    void describe("statistics", () => {
        void it("tracks cache hits and misses", async () => {
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async () => []
            };

            const cache = new SemanticQueryCache(semantic);
            await cache.getSymbolOccurrences("test");
            await cache.getSymbolOccurrences("test");
            await cache.getSymbolOccurrences("other");

            const stats = cache.getStats();
            assert.equal(stats.hits, 1, "One cache hit");
            assert.equal(stats.misses, 2, "Two cache misses");
        });

        void it("tracks evictions when cache is full", async () => {
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async () => []
            };

            const cache = new SemanticQueryCache(semantic, { maxSize: 2 });
            await cache.getSymbolOccurrences("a");
            await cache.getSymbolOccurrences("b");
            await cache.getSymbolOccurrences("c");

            const stats = cache.getStats();
            assert.equal(stats.evictions, 1, "One entry should be evicted");
        });

        void it("reports total cache size across all cache types", async () => {
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async () => [],
                getFileSymbols: async () => [],
                hasSymbol: async () => true
            };

            const cache = new SemanticQueryCache(semantic);
            await cache.getSymbolOccurrences("test");
            await cache.getFileSymbols("test.gml");
            await cache.hasSymbol("gml/script/test");

            const stats = cache.getStats();
            assert.equal(stats.size, 3, "Size should include all cache types");
        });

        void it("resetStats clears statistics", async () => {
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async () => []
            };

            const cache = new SemanticQueryCache(semantic);
            await cache.getSymbolOccurrences("test");
            await cache.getSymbolOccurrences("test");

            cache.resetStats();
            const stats = cache.getStats();

            assert.equal(stats.hits, 0);
            assert.equal(stats.misses, 0);
        });
    });

    void describe("configuration", () => {
        void it("evicts the least-recently-used entry when cache reaches maxSize", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async () => {
                    callCount++;
                    return [];
                }
            };

            const cache = new SemanticQueryCache(semantic, { maxSize: 2 });
            await cache.getSymbolOccurrences("a");
            await cache.getSymbolOccurrences("b");

            // Touch "a" so "b" becomes the least recently used entry.
            await cache.getSymbolOccurrences("a");
            await cache.getSymbolOccurrences("c");

            await cache.getSymbolOccurrences("a");
            await cache.getSymbolOccurrences("b");

            assert.equal(callCount, 4, "Entry 'b' should be evicted while recently-used entries stay cached");
        });

        void it("respects maxSize limit", async () => {
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async () => []
            };

            const cache = new SemanticQueryCache(semantic, { maxSize: 2 });
            await cache.getSymbolOccurrences("a");
            await cache.getSymbolOccurrences("b");
            await cache.getSymbolOccurrences("c");

            const stats = cache.getStats();
            assert.equal(stats.size, 2, "Cache should not exceed maxSize");
        });
        void it("treats maxSize of 0 as a zero-capacity cache", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getSymbolOccurrences: async () => {
                    callCount++;
                    return [];
                }
            };

            const cache = new SemanticQueryCache(semantic, { maxSize: 0 });
            await cache.getSymbolOccurrences("a");
            await cache.getSymbolOccurrences("a");

            const stats = cache.getStats();
            assert.equal(callCount, 2, "A zero-capacity cache should refetch every time");
            assert.equal(stats.size, 0, "A zero-capacity cache should not retain entries");
            assert.equal(stats.evictions, 2, "Skipped stores should still count as immediate evictions");
        });

        void it("uses default configuration values", () => {
            const semantic: PartialSemanticAnalyzer = {};
            const cache = new SemanticQueryCache(semantic);

            const stats = cache.getStats();
            assert.equal(stats.hits, 0);
            assert.equal(stats.misses, 0);
            assert.equal(stats.evictions, 0);
        });

        void it("works with null semantic analyzer", async () => {
            const cache = new SemanticQueryCache(null);
            const occurrences = await cache.getSymbolOccurrences("test");
            const fileSymbols = await cache.getFileSymbols("test.gml");
            const dependents = await cache.getDependents(["test"]);
            const exists = await cache.hasSymbol("test");

            assert.deepEqual(occurrences, []);
            assert.deepEqual(fileSymbols, []);
            assert.deepEqual(dependents, []);
            assert.equal(exists, true);
        });
    });

    void describe("getFileSymbolsBatch", () => {
        void it("returns empty map for empty input", async () => {
            const semantic: PartialSemanticAnalyzer = {
                getFileSymbols: async () => {
                    throw new Error("Should not be called");
                }
            };

            const cache = new SemanticQueryCache(semantic);
            const results = await cache.getFileSymbolsBatch([]);

            assert.equal(results.size, 0);
        });

        void it("queries multiple files efficiently", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getFileSymbols: async (filePath: string) => {
                    callCount++;
                    return [{ id: `symbol_in_${filePath}` }] as Array<FileSymbol>;
                }
            };

            const cache = new SemanticQueryCache(semantic);
            const results = await cache.getFileSymbolsBatch(["file1.gml", "file2.gml", "file3.gml"]);

            assert.equal(callCount, 3, "Should query each file once");
            assert.equal(results.size, 3, "Should return results for all three files");
            assert.deepEqual(results.get("file1.gml"), [{ id: "symbol_in_file1.gml" }]);
            assert.deepEqual(results.get("file2.gml"), [{ id: "symbol_in_file2.gml" }]);
            assert.deepEqual(results.get("file3.gml"), [{ id: "symbol_in_file3.gml" }]);
        });

        void it("uses cache for previously queried files", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getFileSymbols: async (filePath: string) => {
                    callCount++;
                    return [{ id: `symbol_in_${filePath}` }] as Array<FileSymbol>;
                }
            };

            const cache = new SemanticQueryCache(semantic);

            await cache.getFileSymbols("file1.gml");
            assert.equal(callCount, 1, "First call should query semantic");

            const results = await cache.getFileSymbolsBatch(["file1.gml", "file2.gml"]);

            assert.equal(callCount, 2, "Batch should only query file2.gml (file1 cached)");
            assert.equal(results.size, 2);
            assert.deepEqual(results.get("file1.gml"), [{ id: "symbol_in_file1.gml" }]);
            assert.deepEqual(results.get("file2.gml"), [{ id: "symbol_in_file2.gml" }]);
        });

        void it("bypasses cache when disabled", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getFileSymbols: async () => {
                    callCount++;
                    return [];
                }
            };

            const cache = new SemanticQueryCache(semantic, { enabled: false });
            const results1 = await cache.getFileSymbolsBatch(["file1.gml"]);
            const results2 = await cache.getFileSymbolsBatch(["file1.gml"]);

            assert.equal(callCount, 2, "Should query semantic both times when cache disabled");
            assert.equal(results1.size, 1);
            assert.equal(results2.size, 1);
        });

        void it("tracks cache hits and misses correctly", async () => {
            const semantic: PartialSemanticAnalyzer = {
                getFileSymbols: async () => []
            };

            const cache = new SemanticQueryCache(semantic);

            await cache.getFileSymbolsBatch(["file1.gml", "file2.gml"]);
            const stats1 = cache.getStats();
            assert.equal(stats1.hits, 0, "First batch should have no hits");
            assert.equal(stats1.misses, 2, "First batch should have two misses");

            await cache.getFileSymbolsBatch(["file1.gml", "file2.gml", "file3.gml"]);
            const stats2 = cache.getStats();
            assert.equal(stats2.hits, 2, "Second batch should have two hits (file1, file2)");
            assert.equal(stats2.misses, 3, "Second batch should have three total misses (file3 added)");
        });

        void it("handles mixed cached and uncached files", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getFileSymbols: async (filePath: string) => {
                    callCount++;
                    return [{ id: filePath }] as Array<FileSymbol>;
                }
            };

            const cache = new SemanticQueryCache(semantic);

            await cache.getFileSymbols("a.gml");
            await cache.getFileSymbols("c.gml");
            assert.equal(callCount, 2);

            const results = await cache.getFileSymbolsBatch(["a.gml", "b.gml", "c.gml", "d.gml"]);

            assert.equal(callCount, 4, "Should only query b.gml and d.gml");
            assert.equal(results.size, 4);
            assert.deepEqual(results.get("a.gml"), [{ id: "a.gml" }]);
            assert.deepEqual(results.get("b.gml"), [{ id: "b.gml" }]);
            assert.deepEqual(results.get("c.gml"), [{ id: "c.gml" }]);
            assert.deepEqual(results.get("d.gml"), [{ id: "d.gml" }]);
        });

        void it("respects TTL for cached entries", async () => {
            let callCount = 0;
            const semantic: PartialSemanticAnalyzer = {
                getFileSymbols: async () => {
                    callCount++;
                    return [];
                }
            };

            const cache = new SemanticQueryCache(semantic, { ttlMs: 50 });

            await cache.getFileSymbols("file1.gml");
            assert.equal(callCount, 1);

            await new Promise((resolve) => setTimeout(resolve, 60));

            const results = await cache.getFileSymbolsBatch(["file1.gml"]);

            assert.equal(callCount, 2, "Expired entry should be re-fetched");
            assert.equal(results.size, 1);
        });

        void it("works with null semantic analyzer", async () => {
            const cache = new SemanticQueryCache(null);
            const results = await cache.getFileSymbolsBatch(["file1.gml", "file2.gml"]);

            assert.equal(results.size, 2);
            assert.deepEqual(results.get("file1.gml"), []);
            assert.deepEqual(results.get("file2.gml"), []);
        });
    });
});
