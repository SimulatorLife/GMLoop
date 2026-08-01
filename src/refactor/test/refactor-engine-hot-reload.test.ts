import assert from "node:assert/strict";
import test from "node:test";

import { Refactor, type RenameRequest } from "../index.js";

const { RefactorEngine: RefactorEngineClass, WorkspaceEdit: WorkspaceEditFactory } = Refactor;

// Hot reload validation tests.
void test("validateHotReloadCompatibility requires a WorkspaceEdit", async () => {
    const engine = new RefactorEngineClass();
    const result = await engine.validateHotReloadCompatibility(null);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Invalid workspace")));
});

void test("validateHotReloadCompatibility warns for empty workspace", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    const result = await engine.validateHotReloadCompatibility(ws);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => w.includes("no changes")));
});

void test("validateHotReloadCompatibility warns about non-GML files", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.txt", 0, 5, "new");
    const result = await engine.validateHotReloadCompatibility(ws);
    assert.ok(result.warnings.some((w) => w.includes("not a GML script")));
});

void test("validateHotReloadCompatibility reports metadata-only edits as non-hot-reload changes", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addMetadataEdit("objects/o_player/o_player.yy", '{"name":"o_hero"}');

    const result = await engine.validateHotReloadCompatibility(ws);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((warning) => warning.includes("metadata-only")));
});

void test("validateHotReloadCompatibility detects globalvar changes", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 5, "globalvar myvar;");
    const result = await engine.validateHotReloadCompatibility(ws);
    assert.ok(result.warnings.some((w) => w.includes("globalvar")));
});

void test("validateHotReloadCompatibility detects macro changes", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 5, "#macro MAX_HP 100");
    const result = await engine.validateHotReloadCompatibility(ws);
    assert.ok(result.warnings.some((w) => w.includes("#macro")));
});

void test("validateHotReloadCompatibility detects enum changes", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 5, "enum State { Idle, Running }");
    const result = await engine.validateHotReloadCompatibility(ws);
    assert.ok(result.warnings.some((w) => w.includes("enum")));
});

void test("validateHotReloadCompatibility warns about large edits", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    const largeText = "x".repeat(6000);
    ws.addEdit("test.gml", 0, 5, largeText);
    const result = await engine.validateHotReloadCompatibility(ws);
    assert.ok(result.warnings.some((w) => w.includes("Large edit")));
});

void test("validateHotReloadCompatibility handles transpiler check option", async () => {
    const mockTranspiler = {
        transpileScript: async () => ({ kind: "script", js_body: "ok" })
    };
    const engine = new RefactorEngineClass({ formatter: mockTranspiler });
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 5, "new code");

    const result = await engine.validateHotReloadCompatibility(ws, {
        checkTranspiler: true
    });
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => w.includes("Transpiler compatibility")));
});

void test("validateHotReloadCompatibility applies edits over file content for transpiler checks", async () => {
    let observedSourceText = "";
    const mockTranspiler = {
        transpileScript: async ({ sourceText }: { sourceText: string }) => {
            observedSourceText = sourceText;
            return { kind: "script", js_body: "ok" };
        }
    };
    const engine = new RefactorEngineClass({ formatter: mockTranspiler });
    const ws = new WorkspaceEditFactory();
    const originalContent = "let foo = bar;";
    ws.addEdit("test.gml", 10, 13, "baz");

    const result = await engine.validateHotReloadCompatibility(ws, {
        checkTranspiler: true,
        readFile: async () => originalContent
    });

    assert.equal(result.valid, true);
    assert.equal(observedSourceText, "let foo = baz;");
});

void test("validateHotReloadCompatibility passes for simple renames", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 5, "newName");
    ws.addEdit("test.gml", 50, 55, "newName");

    const result = await engine.validateHotReloadCompatibility(ws);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
});

void test("validateHotReloadCompatibility detects transpilation failures", async () => {
    const mockTranspiler = {
        transpileScript: async ({ symbolId }: { symbolId: string }) => {
            throw new Error(`Syntax error in ${symbolId}`);
        }
    };
    const engine = new RefactorEngineClass({ formatter: mockTranspiler });
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 5, "invalid GML syntax @#$");

    const result = await engine.validateHotReloadCompatibility(ws, {
        checkTranspiler: true
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((e) => e.includes("Transpilation failed")));
    assert.ok(result.errors.some((e) => e.includes("Syntax error")));
});

void test("validateHotReloadCompatibility handles multiple files", async () => {
    const transpiledSymbols: Array<string> = [];
    const mockTranspiler = {
        transpileScript: async ({ symbolId }: { symbolId: string }) => {
            transpiledSymbols.push(symbolId);
            return { kind: "script", js_body: "ok" };
        }
    };
    const mockSemantic = {
        getFileSymbols: async (filePath: string) => {
            if (filePath === "file1.gml") {
                return [{ id: "gml/script/scr_file1" }];
            }
            if (filePath === "file2.gml") {
                return [{ id: "gml/script/scr_file2" }];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({
        formatter: mockTranspiler,
        semantic: mockSemantic
    });
    const ws = new WorkspaceEditFactory();
    ws.addEdit("file1.gml", 0, 5, "code1");
    ws.addEdit("file2.gml", 0, 5, "code2");

    const result = await engine.validateHotReloadCompatibility(ws, {
        checkTranspiler: true
    });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.warnings.some((w) => w.includes("Transpiler compatibility validated")));
    assert.ok(result.warnings.some((w) => w.includes("2 file(s)")));
    assert.ok(transpiledSymbols.includes("gml/script/scr_file1"));
    assert.ok(transpiledSymbols.includes("gml/script/scr_file2"));
});

void test("validateHotReloadCompatibility skips non-GML files", async () => {
    const transpiledSymbols: Array<string> = [];
    const mockTranspiler = {
        transpileScript: async ({ symbolId }: { symbolId: string }) => {
            transpiledSymbols.push(symbolId);
            return { kind: "script", js_body: "ok" };
        }
    };
    const engine = new RefactorEngineClass({ formatter: mockTranspiler });
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.txt", 0, 5, "text");
    ws.addEdit("test.json", 0, 5, "{}");

    const result = await engine.validateHotReloadCompatibility(ws, {
        checkTranspiler: true
    });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(transpiledSymbols.length, 0);
    assert.ok(result.warnings.some((w) => w.includes("No GML files found")));
});

// Hot reload cascade tests.
void test("computeHotReloadCascade requires array parameter", async () => {
    const engine = new RefactorEngineClass();
    await assert.rejects(() => engine.computeHotReloadCascade(null), {
        name: "TypeError",
        message: /requires an array/
    });
});

void test("computeHotReloadCascade returns empty for no changes", async () => {
    const engine = new RefactorEngineClass();
    const result = await engine.computeHotReloadCascade([]);

    assert.ok(Array.isArray(result.cascade));
    assert.equal(result.cascade.length, 0);
    assert.ok(Array.isArray(result.order));
    assert.equal(result.order.length, 0);

    // Summary counters live on the metadata bag; the result no longer
    // re-publishes them as top-level aliases.
    assert.equal(result.metadata.totalSymbols, 0);
    assert.equal(result.metadata.maxDistance, 0);
    assert.equal(result.metadata.hasCircular, false);
});

void test("computeHotReloadCascade handles single symbol with no dependents", async () => {
    const mockSemantic = {
        getDependents: async () => [] // No dependents
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.computeHotReloadCascade(["gml/script/scr_leaf"]);

    assert.equal(result.cascade.length, 1);
    assert.equal(result.cascade[0].symbolId, "gml/script/scr_leaf");
    assert.equal(result.cascade[0].distance, 0);
    assert.equal(result.cascade[0].reason, "direct change");
    assert.equal(result.metadata.totalSymbols, 1);
    assert.equal(result.metadata.maxDistance, 0);
});

void test("computeHotReloadCascade computes single-level dependencies", async () => {
    const mockSemantic = {
        getDependents: async (symbolIds) => {
            if (symbolIds[0] === "gml/script/scr_base") {
                return [
                    {
                        symbolId: "gml/script/scr_dep1",
                        filePath: "deps/dep1.gml"
                    },
                    {
                        symbolId: "gml/script/scr_dep2",
                        filePath: "deps/dep2.gml"
                    }
                ];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.computeHotReloadCascade(["gml/script/scr_base"]);

    assert.equal(result.cascade.length, 3);
    assert.equal(result.metadata.totalSymbols, 3);
    assert.equal(result.metadata.maxDistance, 1);

    // Check that dependents are at distance 1
    const deps = result.cascade.filter((c) => c.distance === 1);
    assert.equal(deps.length, 2);
    assert.ok(deps.some((d) => d.symbolId === "gml/script/scr_dep1"));
    assert.ok(deps.some((d) => d.symbolId === "gml/script/scr_dep2"));
});

void test("computeHotReloadCascade computes multi-level transitive closure", async () => {
    const mockSemantic = {
        getDependents: async (symbolIds) => {
            const id = symbolIds[0];
            if (id === "gml/script/scr_root") {
                return [
                    {
                        symbolId: "gml/script/scr_middle",
                        filePath: "deps/middle.gml"
                    }
                ];
            }
            if (id === "gml/script/scr_middle") {
                return [
                    {
                        symbolId: "gml/script/scr_leaf1",
                        filePath: "deps/leaf1.gml"
                    },
                    {
                        symbolId: "gml/script/scr_leaf2",
                        filePath: "deps/leaf2.gml"
                    }
                ];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.computeHotReloadCascade(["gml/script/scr_root"]);

    assert.equal(result.cascade.length, 4); // root + middle + 2 leaves
    assert.equal(result.metadata.maxDistance, 2);

    // Verify distances
    const root = result.cascade.find((c) => c.symbolId === "gml/script/scr_root");
    const middle = result.cascade.find((c) => c.symbolId === "gml/script/scr_middle");
    const leaf1 = result.cascade.find((c) => c.symbolId === "gml/script/scr_leaf1");
    const leaf2 = result.cascade.find((c) => c.symbolId === "gml/script/scr_leaf2");

    assert.equal(root.distance, 0);
    assert.equal(middle.distance, 1);
    assert.equal(leaf1.distance, 2);
    assert.equal(leaf2.distance, 2);
});

void test("computeHotReloadCascade orders symbols in dependency order", async () => {
    const mockSemantic = {
        getDependents: async (symbolIds) => {
            const id = symbolIds[0];
            if (id === "gml/script/scr_a") {
                return [
                    {
                        symbolId: "gml/script/scr_b",
                        filePath: "deps/b.gml"
                    }
                ];
            }
            if (id === "gml/script/scr_b") {
                return [
                    {
                        symbolId: "gml/script/scr_c",
                        filePath: "deps/c.gml"
                    }
                ];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.computeHotReloadCascade(["gml/script/scr_a"]);

    // Order should be: leaves first (c), then middle (b), then root (a)
    // Because c depends on nothing in our set, b depends on a, c depends on b
    assert.equal(result.order.length, 3);

    // Find positions in the order
    const posA = result.order.indexOf("gml/script/scr_a");
    const posB = result.order.indexOf("gml/script/scr_b");
    const posC = result.order.indexOf("gml/script/scr_c");

    // A should come before B, B should come before C (in hot reload order)
    assert.ok(posA < posB, "A should be reloaded before B");
    assert.ok(posB < posC, "B should be reloaded before C");
});

void test("computeHotReloadCascade handles multiple changed symbols", async () => {
    const mockSemantic = {
        getDependents: async (symbolIds) => {
            const id = symbolIds[0];
            if (id === "gml/script/scr_a") {
                return [
                    {
                        symbolId: "gml/script/scr_shared",
                        filePath: "deps/shared.gml"
                    }
                ];
            }
            if (id === "gml/script/scr_b") {
                return [
                    {
                        symbolId: "gml/script/scr_shared",
                        filePath: "deps/shared.gml"
                    }
                ];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.computeHotReloadCascade(["gml/script/scr_a", "gml/script/scr_b"]);

    // Should include both roots and the shared dependent (only once)
    assert.equal(result.cascade.length, 3);
    assert.ok(result.cascade.some((c) => c.symbolId === "gml/script/scr_a"));
    assert.ok(result.cascade.some((c) => c.symbolId === "gml/script/scr_b"));
    assert.ok(result.cascade.some((c) => c.symbolId === "gml/script/scr_shared"));

    // Shared dependent should be at distance 1
    const shared = result.cascade.find((c) => c.symbolId === "gml/script/scr_shared");
    assert.equal(shared.distance, 1);
});

void test("computeHotReloadCascade detects circular dependencies", async () => {
    const mockSemantic = {
        getDependents: async (symbolIds) => {
            const id = symbolIds[0];
            // Create a cycle: a -> b -> c -> a
            if (id === "gml/script/scr_a") {
                return [
                    {
                        symbolId: "gml/script/scr_b",
                        filePath: "deps/b.gml"
                    }
                ];
            }
            if (id === "gml/script/scr_b") {
                return [
                    {
                        symbolId: "gml/script/scr_c",
                        filePath: "deps/c.gml"
                    }
                ];
            }
            if (id === "gml/script/scr_c") {
                return [
                    {
                        symbolId: "gml/script/scr_a",
                        filePath: "deps/a.gml"
                    }
                ];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.computeHotReloadCascade(["gml/script/scr_a"]);

    // Should include all three symbols
    assert.equal(result.cascade.length, 3);

    // Should detect the circular dependency
    assert.equal(result.metadata.hasCircular, true);

    // All symbols should still be in the order (possibly with cycles broken)
    assert.equal(result.order.length, 3);
    assert.equal(new Set(result.order).size, result.order.length);
});

void test("computeHotReloadCascade handles diamond dependencies", async () => {
    const mockSemantic = {
        getDependents: async (symbolIds) => {
            const id = symbolIds[0];
            // Diamond: root -> left + right, left -> bottom, right -> bottom
            if (id === "gml/script/scr_root") {
                return [
                    {
                        symbolId: "gml/script/scr_left",
                        filePath: "deps/left.gml"
                    },
                    {
                        symbolId: "gml/script/scr_right",
                        filePath: "deps/right.gml"
                    }
                ];
            }
            if (id === "gml/script/scr_left" || id === "gml/script/scr_right") {
                return [
                    {
                        symbolId: "gml/script/scr_bottom",
                        filePath: "deps/bottom.gml"
                    }
                ];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.computeHotReloadCascade(["gml/script/scr_root"]);

    // Should include all 4 symbols
    assert.equal(result.cascade.length, 4);

    // Bottom should appear only once despite multiple paths
    const bottomOccurrences = result.cascade.filter((c) => c.symbolId === "gml/script/scr_bottom");
    assert.equal(bottomOccurrences.length, 1);

    // Root should come before left and right
    const posRoot = result.order.indexOf("gml/script/scr_root");
    const posLeft = result.order.indexOf("gml/script/scr_left");
    const posRight = result.order.indexOf("gml/script/scr_right");
    const posBottom = result.order.indexOf("gml/script/scr_bottom");

    assert.ok(posRoot < posLeft);
    assert.ok(posRoot < posRight);
    assert.ok(posLeft < posBottom);
    assert.ok(posRight < posBottom);
});

void test("computeHotReloadCascade provides reason metadata", async () => {
    const mockSemantic = {
        getDependents: async (symbolIds) => {
            if (symbolIds[0] === "gml/script/scr_base") {
                return [
                    {
                        symbolId: "gml/script/scr_dep",
                        filePath: "deps/dep.gml"
                    }
                ];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.computeHotReloadCascade(["gml/script/scr_base"]);

    const base = result.cascade.find((c) => c.symbolId === "gml/script/scr_base");
    const dep = result.cascade.find((c) => c.symbolId === "gml/script/scr_dep");

    assert.equal(base.reason, "direct change");
    assert.ok(dep.reason.includes("depends on"));
    assert.ok(dep.reason.includes("scr_base"));
});

void test("computeHotReloadCascade works without semantic analyzer", async () => {
    const engine = new RefactorEngineClass(); // No semantic analyzer

    const result = await engine.computeHotReloadCascade(["gml/script/scr_test"]);

    // Should only include the changed symbol, no dependents
    assert.equal(result.cascade.length, 1);
    assert.equal(result.cascade[0].symbolId, "gml/script/scr_test");
    assert.equal(result.cascade[0].distance, 0);
});

void test("computeHotReloadCascade handles wide dependency graphs with parallel processing", async () => {
    // Test that parallel processing of dependents maintains correctness
    // when a symbol has many dependents (e.g., a utility function used everywhere).
    const mockSemantic = {
        getDependents: async (symbolIds) => {
            const id = symbolIds[0];
            // Core utility has 10 dependents that can be processed in parallel
            if (id === "gml/script/scr_util") {
                return Array.from({ length: 10 }, (_, i) => ({
                    symbolId: `gml/script/scr_consumer_${i}`,
                    filePath: `consumers/consumer_${i}.gml`
                }));
            }
            // Each consumer has its own dependent
            if (id.startsWith("gml/script/scr_consumer_")) {
                const index = id.split("_").pop();
                return [
                    {
                        symbolId: `gml/script/scr_leaf_${index}`,
                        filePath: `leaves/leaf_${index}.gml`
                    }
                ];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.computeHotReloadCascade(["gml/script/scr_util"]);

    // Should include util + 10 consumers + 10 leaves = 21 symbols
    assert.equal(result.cascade.length, 21);

    // Verify all consumers are at distance 1
    for (let i = 0; i < 10; i++) {
        const consumer = result.cascade.find((c) => c.symbolId === `gml/script/scr_consumer_${i}`);
        assert.ok(consumer, `Consumer ${i} should be in cascade`);
        assert.equal(consumer.distance, 1);
    }

    // Verify all leaves are at distance 2
    for (let i = 0; i < 10; i++) {
        const leaf = result.cascade.find((c) => c.symbolId === `gml/script/scr_leaf_${i}`);
        assert.ok(leaf, `Leaf ${i} should be in cascade`);
        assert.equal(leaf.distance, 2);
    }

    // Verify topological order: util before consumers before leaves
    const posUtil = result.order.indexOf("gml/script/scr_util");
    for (let i = 0; i < 10; i++) {
        const posConsumer = result.order.indexOf(`gml/script/scr_consumer_${i}`);
        const posLeaf = result.order.indexOf(`gml/script/scr_leaf_${i}`);
        assert.ok(posUtil < posConsumer, `Util should come before consumer ${i}`);
        assert.ok(posConsumer < posLeaf, `Consumer ${i} should come before leaf ${i}`);
    }
});

// checkHotReloadSafety tests.

void test("checkHotReloadSafety rejects missing symbolId", async () => {
    const engine = new RefactorEngineClass();

    const result = await engine.checkHotReloadSafety({
        newName: "scr_new"
    } as unknown as RenameRequest);

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("missing symbolId"));
    assert.equal(result.requiresRestart, true);
    assert.equal(result.canAutoFix, false);
});

void test("checkHotReloadSafety rejects missing newName", async () => {
    const engine = new RefactorEngineClass();

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/script/scr_old"
    } as unknown as RenameRequest);

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("missing"));
    assert.equal(result.requiresRestart, true);
});

void test("checkHotReloadSafety requires semantic analyzer for safety checks", async () => {
    const engine = new RefactorEngineClass();

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/script/scr_old",
        newName: "scr_new"
    });

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("semantic analyzer"));
    assert.equal(result.requiresRestart, true);
    assert.ok(result.suggestions.length > 0);
});

void test("checkHotReloadSafety rejects invalid identifier names", async () => {
    const engine = new RefactorEngineClass();

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/script/scr_old",
        newName: "123invalid"
    });

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("Invalid identifier"));
    assert.equal(result.requiresRestart, true);
    assert.equal(result.canAutoFix, false);
});

void test("checkHotReloadSafety rejects non-existent symbols", async () => {
    const mockSemantic = {
        hasSymbol: () => false
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/script/scr_missing",
        newName: "scr_new"
    });

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("not found"));
    assert.equal(result.requiresRestart, true);
    assert.ok(result.suggestions.length > 0);
});

void test("checkHotReloadSafety rejects same-name renames", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/script/scr_test",
        newName: "scr_test"
    });

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("matches the existing identifier"));
    assert.equal(result.requiresRestart, false);
});

void test("checkHotReloadSafety rejects reserved GameMaker identifiers", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: (name) => [{ path: "test.gml", start: 0, end: name.length, scopeId: "scope-1" }],
        getReservedKeywords: () => ["if", "else", "while", "for", "function"]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/script/scr_old",
        newName: "function"
    });

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("reserved GameMaker identifier"));
    assert.equal(result.requiresRestart, true);
    assert.equal(result.canAutoFix, false);
});

void test("checkHotReloadSafety handles shadowing conflicts", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: (name) => [{ path: "test.gml", start: 0, end: name.length, scopeId: "scope-1" }],
        lookup: (name, scopeId) => {
            // Simulate existing binding for newName that isn't the symbol we're renaming
            if (name === "existing" && scopeId === "scope-1") {
                return { name: "existing" };
            }
            return null;
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/script/scr_old",
        newName: "existing"
    });

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("shadowing"));
    assert.equal(result.requiresRestart, false);
    assert.equal(result.canAutoFix, true);
    assert.ok(result.suggestions.length > 0);
});

void test("checkHotReloadSafety approves script renames", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [{ path: "test.gml", start: 0, end: 8, scopeId: "scope-1" }]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/script/scr_old",
        newName: "scr_new"
    });

    assert.equal(result.safe, true);
    assert.ok(result.reason.includes("hot-reload-safe"));
    assert.equal(result.requiresRestart, false);
    assert.equal(result.canAutoFix, true);
    assert.ok(result.suggestions.length > 0);
});

void test("checkHotReloadSafety approves instance variable renames", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [{ path: "test.gml", start: 0, end: 2, scopeId: "scope-1" }]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/var/obj_enemy::hp",
        newName: "health_points"
    });

    assert.equal(result.safe, true);
    assert.ok(result.reason.includes("Instance variable"));
    assert.ok(result.reason.includes("hot-reload-safe"));
    assert.equal(result.requiresRestart, false);
    assert.ok(result.suggestions.some((s) => s.includes("scope qualification")));
});

void test("checkHotReloadSafety approves global variable renames", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [{ path: "test.gml", start: 0, end: 10, scopeId: "scope-1" }]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/var/global_score",
        newName: "global_points"
    });

    assert.equal(result.safe, true);
    assert.ok(result.reason.includes("Global variable"));
    assert.equal(result.requiresRestart, false);
    assert.ok(result.suggestions.some((s) => s.includes("preserved")));
});

void test("checkHotReloadSafety approves event renames", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/event/obj_enemy#Step",
        newName: "Step_Updated"
    });

    assert.equal(result.safe, true);
    assert.ok(result.reason.includes("Event"));
    assert.equal(result.requiresRestart, false);
    assert.ok(result.suggestions.some((s) => s.includes("event handlers")));
});

void test("checkHotReloadSafety flags macro renames as requiring recompilation", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [{ path: "test.gml", start: 0, end: 6, scopeId: "scope-1" }]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/macro/MAX_HP",
        newName: "MAX_HEALTH"
    });

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("recompilation"));
    assert.equal(result.requiresRestart, false);
    assert.equal(result.canAutoFix, true);
    assert.ok(result.suggestions.some((s) => s.includes("recompile")));
});

void test("checkHotReloadSafety flags enum renames as requiring recompilation", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [{ path: "test.gml", start: 0, end: 6, scopeId: "scope-1" }]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/enum/EnemyType",
        newName: "EnemyKind"
    });

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("recompilation"));
    assert.equal(result.canAutoFix, true);
});

void test("checkHotReloadSafety handles unknown symbol kinds gracefully", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/unknown/some_symbol",
        newName: "new_symbol"
    });

    // After refactoring to use typed SymbolKind enum, invalid symbol kinds
    // are now properly rejected with a clear error message instead of being
    // silently accepted. This is the correct behavior - fail fast.
    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("Invalid symbol kind"));
    assert.equal(result.requiresRestart, true);
    assert.equal(result.canAutoFix, false);
    assert.ok(result.suggestions.some((s) => s.includes("script, var, event, macro, enum")));
});
