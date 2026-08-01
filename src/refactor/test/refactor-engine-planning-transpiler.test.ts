import assert from "node:assert/strict";
import test from "node:test";

import { type HotReloadUpdate, Refactor, type WorkspaceReadFile } from "../index.js";

const { RefactorEngine: RefactorEngineClass, ConflictType, OccurrenceKind } = Refactor;

void test("prepareRenamePlan aggregates planning, validation, and analysis", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [
            {
                path: "scripts/player.gml",
                start: 0,
                end: 6,
                scopeId: "scope-1",
                kind: OccurrenceKind.DEFINITION
            },
            {
                path: "scripts/player.gml",
                start: 20,
                end: 26,
                scopeId: "scope-1",
                kind: OccurrenceKind.REFERENCE
            }
        ],
        validateEdits: async () => ({
            errors: [],
            warnings: ["semantic warning"]
        }),
        getDependents: async () => [
            {
                symbolId: "gml/script/scr_helper",
                filePath: "scripts/helper.gml"
            }
        ]
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.prepareRenamePlan({
        symbolId: "gml/script/scr_player",
        newName: "scr_player_new"
    });

    assert.ok(typeof result.workspace.addEdit === "function");
    assert.ok(typeof result.workspace.groupByFile === "function");
    assert.ok(Array.isArray(result.workspace.edits));
    assert.equal(result.validation.valid, true);
    assert.ok(result.validation.warnings.includes("semantic warning"));
    assert.equal(result.hotReload, null);
    assert.equal(result.analysis.valid, true);
    assert.equal(result.analysis.summary.newName, "scr_player_new");
    assert.ok(result.analysis.summary.dependentSymbols.includes("gml/script/scr_helper"));
});

void test("prepareRenamePlan optionally validates hot reload compatibility", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [
            {
                path: "scripts/player.gml",
                start: 0,
                end: 6,
                scopeId: "scope-1",
                kind: OccurrenceKind.DEFINITION
            }
        ]
    };

    const mockFormatter = {
        transpileScript: async () => ({ kind: "script" })
    };

    const engine = new RefactorEngineClass({
        semantic: mockSemantic,
        formatter: mockFormatter
    });

    const result = await engine.prepareRenamePlan(
        {
            symbolId: "gml/script/scr_player",
            newName: "scr_player_new"
        },
        { validateHotReload: true, hotReloadOptions: { checkTranspiler: true } }
    );

    assert.equal(result.validation.valid, true);
    assert.ok(result.hotReload);
    assert.equal(result.hotReload.valid, true);
    assert.ok(result.hotReload.warnings.some((warning) => warning.includes("Transpiler compatibility validated")));
});

void test("prepareRenamePlan surfaces hot reload safety for macro renames", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [
            {
                path: "scripts/macros.gml",
                start: 0,
                end: 7,
                scopeId: "scope-1",
                kind: OccurrenceKind.DEFINITION
            }
        ]
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.prepareRenamePlan(
        {
            symbolId: "gml/macro/MAX_HP",
            newName: "MAX_HEALTH"
        },
        { validateHotReload: true }
    );

    assert.ok(result.hotReload);
    assert.equal(result.hotReload.valid, false);
    assert.ok(
        result.hotReload.warnings.some((warning) =>
            warning.includes("Macro/enum renames require dependent script recompilation")
        )
    );
    assert.ok(result.hotReload.hotReload);
    assert.equal(result.hotReload.hotReload.safe, false);
});

void test("prepareBatchRenamePlan aggregates batch planning and validation", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: (name: string) => [
            {
                path: `scripts/${name}.gml`,
                start: 0,
                end: name.length,
                scopeId: "scope-1",
                kind: OccurrenceKind.DEFINITION
            }
        ]
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.prepareBatchRenamePlan([
        { symbolId: "gml/script/scr_old_a", newName: "scr_new_a" },
        { symbolId: "gml/script/scr_old_b", newName: "scr_new_b" }
    ]);

    assert.ok(result.workspace);
    assert.ok(result.validation);
    assert.equal(result.validation.valid, true);
    assert.ok(result.batchValidation);
    assert.equal(result.batchValidation.valid, true);
    assert.ok(result.impactAnalyses);
    assert.equal(result.impactAnalyses.size, 2);
});

void test("prepareBatchRenamePlan includes hot reload cascade when requested", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: (name: string) => [
            {
                path: `scripts/${name}.gml`,
                start: 0,
                end: name.length,
                scopeId: "scope-1",
                kind: OccurrenceKind.DEFINITION
            }
        ],
        getDependents: (symbolIds: Array<string>) => {
            // Only return dependents for the original symbols, not for the _dependent symbols
            return symbolIds
                .filter((id) => !id.includes("_dependent"))
                .map((id) => ({
                    symbolId: `${id}_dependent`,
                    filePath: `scripts/${id.split("/").pop()}_dependent.gml`
                }));
        }
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.prepareBatchRenamePlan(
        [
            { symbolId: "gml/script/scr_base", newName: "scr_base_new" },
            { symbolId: "gml/script/scr_helper", newName: "scr_helper_new" }
        ],
        { validateHotReload: true }
    );

    assert.ok(result.cascadeResult, "Cascade result should exist when hot reload is validated");
    assert.ok(result.cascadeResult.cascade.length > 0);
    assert.ok(result.cascadeResult.order.length > 0);
    assert.ok(result.cascadeResult.metadata);
});

void test("prepareBatchRenamePlan detects batch conflicts", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    // Try to rename two different symbols to the same name
    const result = await engine.prepareBatchRenamePlan([
        { symbolId: "gml/script/scr_a", newName: "scr_conflict" },
        { symbolId: "gml/script/scr_b", newName: "scr_conflict" }
    ]);

    assert.equal(result.batchValidation.valid, false);
    assert.ok(result.batchValidation.errors.length > 0);
    assert.ok(result.batchValidation.conflictingSets.length > 0);
    assert.ok(result.batchValidation.errors.some((err) => err.includes("Multiple symbols cannot be renamed to")));
});

void test("prepareBatchRenamePlan includes per-symbol impact analysis", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: (name: string) => {
            const count = name === "scr_many" ? 51 : 5;
            return Array.from({ length: count }, (_, i) => ({
                path: `scripts/${name}_file${i}.gml`,
                start: i * 10,
                end: i * 10 + name.length,
                scopeId: `scope-${i}`,
                kind: i === 0 ? OccurrenceKind.DEFINITION : OccurrenceKind.REFERENCE
            }));
        }
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.prepareBatchRenamePlan([
        { symbolId: "gml/script/scr_many", newName: "scr_many_new" },
        { symbolId: "gml/script/scr_few", newName: "scr_few_new" }
    ]);

    assert.equal(result.impactAnalyses.size, 2);

    const manyAnalysis = result.impactAnalyses.get("gml/script/scr_many");
    assert.ok(manyAnalysis);
    assert.equal(manyAnalysis.summary.totalOccurrences, 51);
    assert.ok(manyAnalysis.warnings.some((w) => w.type === ConflictType.LARGE_RENAME));

    const fewAnalysis = result.impactAnalyses.get("gml/script/scr_few");
    assert.ok(fewAnalysis);
    assert.equal(fewAnalysis.summary.totalOccurrences, 5);
});

void test("prepareBatchRenamePlan handles individual analysis failures gracefully", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: (name: string) => {
            // Return empty occurrences for scr_missing to simulate analysis issues
            if (name === "scr_missing") {
                return [];
            }
            return [
                {
                    path: `scripts/${name}.gml`,
                    start: 0,
                    end: name.length,
                    scopeId: "scope-1",
                    kind: OccurrenceKind.DEFINITION
                }
            ];
        }
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.prepareBatchRenamePlan([
        { symbolId: "gml/script/scr_exists", newName: "scr_exists_new" },
        { symbolId: "gml/script/scr_missing", newName: "scr_missing_new" }
    ]);

    assert.equal(result.impactAnalyses.size, 2);

    const existsAnalysis = result.impactAnalyses.get("gml/script/scr_exists");
    assert.ok(existsAnalysis);
    assert.equal(existsAnalysis.valid, true);

    const missingAnalysis = result.impactAnalyses.get("gml/script/scr_missing");
    assert.ok(missingAnalysis);
    // With 0 occurrences, the workspace will be empty which causes validation to fail
    // The batch planning will catch this and report it
    assert.ok(result.validation.errors.length > 0 || missingAnalysis.summary.totalOccurrences === 0);
});

void test("prepareBatchRenamePlan validates hot reload compatibility when requested", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [
            {
                path: "scripts/test.gml",
                start: 0,
                end: 10,
                scopeId: "scope-1",
                kind: OccurrenceKind.DEFINITION
            }
        ]
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.prepareBatchRenamePlan([{ symbolId: "gml/script/scr_test", newName: "scr_test_new" }], {
        validateHotReload: true,
        hotReloadOptions: { checkTranspiler: true }
    });

    assert.ok(result.hotReload);
    assert.ok(typeof result.hotReload.valid === "boolean");
    assert.ok(Array.isArray(result.hotReload.errors));
    assert.ok(Array.isArray(result.hotReload.warnings));
});

void test("prepareBatchRenamePlan handles cascade computation failures gracefully", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: (name: string) => [
            {
                path: `scripts/${name}.gml`,
                start: 0,
                end: name.length,
                scopeId: "scope-1",
                kind: OccurrenceKind.DEFINITION
            }
        ],
        getDependents: () => {
            throw new Error("Cascade computation failed");
        }
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.prepareBatchRenamePlan([{ symbolId: "gml/script/scr_test", newName: "scr_test_new" }], {
        validateHotReload: true
    });

    assert.equal(result.cascadeResult, null);
    assert.ok(result.hotReload);
    assert.ok(result.hotReload.warnings.some((w) => w.includes("Failed to compute hot reload cascade")));
});

void test("prepareBatchRenamePlan includes circular dependency detection", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: (name: string) => [
            {
                path: `scripts/${name}.gml`,
                start: 0,
                end: name.length,
                scopeId: "scope-1",
                kind: OccurrenceKind.DEFINITION
            }
        ],
        getDependents: (symbolIds: Array<string>) => {
            // Create a circular dependency: A depends on B, B depends on A
            return symbolIds.map((id) => {
                return id === "gml/script/scr_a"
                    ? { symbolId: "gml/script/scr_b", filePath: "scripts/scr_b.gml" }
                    : { symbolId: "gml/script/scr_a", filePath: "scripts/scr_a.gml" };
            });
        }
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.prepareBatchRenamePlan([{ symbolId: "gml/script/scr_a", newName: "scr_a_new" }], {
        validateHotReload: true
    });

    assert.ok(result.cascadeResult);
    assert.equal(result.cascadeResult.metadata.hasCircular, true);
    assert.ok(result.cascadeResult.circular.length > 0);
});

void test("prepareBatchRenamePlan works without hot reload validation", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: (name: string) => [
            {
                path: `scripts/${name}.gml`,
                start: 0,
                end: name.length,
                scopeId: "scope-1",
                kind: OccurrenceKind.DEFINITION
            }
        ]
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.prepareBatchRenamePlan([{ symbolId: "gml/script/scr_test", newName: "scr_test_new" }]);

    assert.equal(result.hotReload, null);
    assert.equal(result.cascadeResult, null);
    assert.ok(result.workspace);
    assert.ok(result.validation);
    assert.ok(result.batchValidation);
});

void test("prepareBatchRenamePlan skips per-symbol impact analyses when disabled", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: (name: string) => [
            {
                path: `scripts/${name}.gml`,
                start: 0,
                end: name.length,
                scopeId: "scope-1",
                kind: OccurrenceKind.DEFINITION
            }
        ]
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    let analysisCalls = 0;
    Object.assign(engine, {
        async analyzeRenameImpact() {
            analysisCalls += 1;
            throw new Error("analyzeRenameImpact should not be called when impact analyses are disabled");
        }
    });

    const result = await engine.prepareBatchRenamePlan(
        [
            { symbolId: "gml/script/scr_test_a", newName: "scr_test_a_new" },
            { symbolId: "gml/script/scr_test_b", newName: "scr_test_b_new" }
        ],
        { includeImpactAnalyses: false }
    );

    assert.equal(analysisCalls, 0);
    assert.equal(result.impactAnalyses.size, 0);
    assert.equal(result.validation.valid, true);
});

void test("generateTranspilerPatches requires array parameter", async () => {
    const engine = new RefactorEngineClass();
    await assert.rejects(() => engine.generateTranspilerPatches(null, async () => ""), {
        name: "TypeError",
        message: /requires an array/
    });
});

void test("generateTranspilerPatches requires readFile function", async () => {
    const engine = new RefactorEngineClass();
    await assert.rejects(() => engine.generateTranspilerPatches([], null), {
        name: "TypeError",
        message: /requires a readFile function/
    });
});

void test("generateTranspilerPatches creates basic patches without transpiler", async () => {
    const engine = new RefactorEngineClass();
    const updates: Array<HotReloadUpdate> = [
        {
            symbolId: "gml/script/scr_test",
            action: "recompile",
            filePath: "test.gml",
            affectedRanges: []
        }
    ];

    const readFile: WorkspaceReadFile = async () => "function void test() { return 42; }";
    const patches = await engine.generateTranspilerPatches(updates, readFile);

    assert.equal(patches.length, 1);
    assert.equal(patches[0].symbolId, "gml/script/scr_test");
    assert.equal(patches[0].filePath, "test.gml");
    assert.ok(patches[0].patch);
    assert.equal(patches[0].patch.kind, "script");
});

void test("generateTranspilerPatches skips non-recompile actions", async () => {
    const engine = new RefactorEngineClass();
    const updates: Array<HotReloadUpdate> = [
        {
            symbolId: "gml/script/scr_test",
            action: "notify",
            filePath: "test.gml",
            affectedRanges: []
        }
    ];

    const readFile: WorkspaceReadFile = async () => "function void test() {}";
    const patches = await engine.generateTranspilerPatches(updates, readFile);

    assert.equal(patches.length, 0);
});

void test("generateTranspilerPatches uses transpiler when available", async () => {
    const mockTranspiler = {
        transpileScript: async ({ sourceText, symbolId }) => ({
            kind: "script",
            id: symbolId,
            js_body: "transpiled code",
            sourceText,
            version: 123
        })
    };
    const engine = new RefactorEngineClass({ formatter: mockTranspiler });

    const updates: Array<HotReloadUpdate> = [
        {
            symbolId: "gml/script/scr_test",
            action: "recompile",
            filePath: "test.gml",
            affectedRanges: []
        }
    ];

    const readFile: WorkspaceReadFile = async () => "function void test() { return 42; }";
    const patches = await engine.generateTranspilerPatches(updates, readFile);

    assert.equal(patches.length, 1);
    assert.equal(patches[0].patch.js_body, "transpiled code");
});

void test("generateTranspilerPatches continues on individual errors", async () => {
    const mockTranspiler = {
        transpileScript: async ({ symbolId }) => {
            if (symbolId.includes("fail")) {
                throw new Error("Transpile failed");
            }
            return { kind: "script", id: symbolId, js_body: "ok" };
        }
    };
    const engine = new RefactorEngineClass({ formatter: mockTranspiler });

    const updates: Array<HotReloadUpdate> = [
        {
            symbolId: "gml/script/scr_fail",
            action: "recompile",
            filePath: "fail.gml",
            affectedRanges: []
        },
        {
            symbolId: "gml/script/scr_ok",
            action: "recompile",
            filePath: "ok.gml",
            affectedRanges: []
        }
    ];

    const readFile: WorkspaceReadFile = async () => "function void test() {}";
    const patches = await engine.generateTranspilerPatches(updates, readFile);

    // Should have one successful patch despite one failure
    assert.equal(patches.length, 1);
    assert.equal(patches[0].symbolId, "gml/script/scr_ok");
});

// Batch rename tests.
