import assert from "node:assert/strict";
import test from "node:test";

import {
    type HotReloadSafetySummary,
    type ParserBridge,
    type PartialSemanticAnalyzer,
    Refactor,
    type RenameRequest,
    type WorkspaceEdit
} from "../index.js";

const { RefactorEngine: RefactorEngineClass, WorkspaceEdit: WorkspaceEditFactory, OccurrenceKind } = Refactor;

interface VerifyPostEditIntegrityFixture {
    readonly filePath: string;
    readonly fileContent: string;
    readonly oldName: string;
    readonly newName: string;
    readonly editStart: number;
    readonly editEnd: number;
    readonly replacementText: string;
}

function createSingleEditWorkspace(fixture: VerifyPostEditIntegrityFixture): WorkspaceEdit {
    const workspace = new WorkspaceEditFactory();
    workspace.addEdit(fixture.filePath, fixture.editStart, fixture.editEnd, fixture.replacementText);
    return workspace;
}

function createMinimalRenameImpactGraph(symbolId: string, symbolName: string) {
    return {
        nodes: new Map([
            [symbolId, { symbolId, symbolName, distance: 0, isDirectlyAffected: true, dependents: [], dependsOn: [] }]
        ]),
        rootSymbol: symbolId,
        totalAffectedSymbols: 1,
        maxDepth: 0,
        criticalPath: [],
        estimatedTotalReloadTime: 0
    };
}

function createHotReloadCoordinatorForValidation(
    symbolId: string,
    symbolName: string,
    checkHotReloadSafety: () => Promise<HotReloadSafetySummary>
) {
    return {
        computeHotReloadCascade: async () => ({
            cascade: [],
            order: [],
            circular: [],
            metadata: { totalSymbols: 0, maxDistance: 0, hasCircular: false }
        }),
        computeRenameImpactGraph: async () => createMinimalRenameImpactGraph(symbolId, symbolName),
        checkHotReloadSafety
    };
}

async function verifyPostEditIntegrityForSingleEdit(
    engine: InstanceType<typeof RefactorEngineClass>,
    fixture: VerifyPostEditIntegrityFixture
) {
    return engine.verifyPostEditIntegrity({
        symbolId: "gml/script/test",
        oldName: fixture.oldName,
        newName: fixture.newName,
        workspace: createSingleEditWorkspace(fixture),
        readFile: async () => fixture.fileContent
    });
}

// verifyPostEditIntegrity tests.
void test("verifyPostEditIntegrity validates input parameters", async () => {
    const engine = new RefactorEngineClass();

    // Missing symbolId
    const result0 = await engine.verifyPostEditIntegrity({
        symbolId: "",
        oldName: "old",
        newName: "new",
        workspace: new WorkspaceEditFactory(),
        readFile: async () => ""
    });
    assert.equal(result0.valid, false);
    assert.ok(result0.errors.some((e) => e.includes("Invalid symbolId")));

    // Missing oldName
    const result1 = await engine.verifyPostEditIntegrity({
        symbolId: "gml/script/test",
        oldName: "",
        newName: "new",
        workspace: new WorkspaceEditFactory(),
        readFile: async () => ""
    });
    assert.equal(result1.valid, false);
    assert.ok(result1.errors.some((e) => e.includes("Invalid oldName")));

    // Missing newName
    const result2 = await engine.verifyPostEditIntegrity({
        symbolId: "gml/script/test",
        oldName: "old",
        newName: "",
        workspace: new WorkspaceEditFactory(),
        readFile: async () => ""
    });
    assert.equal(result2.valid, false);
    assert.ok(result2.errors.some((e) => e.includes("Invalid newName")));

    // Invalid workspace
    const result3 = await engine.verifyPostEditIntegrity({
        symbolId: "gml/script/test",
        oldName: "old",
        newName: "new",
        workspace: null,
        readFile: async () => ""
    });
    assert.equal(result3.valid, false);
    assert.ok(result3.errors.some((e) => e.includes("Invalid workspace")));

    // Invalid readFile
    const result4 = await engine.verifyPostEditIntegrity({
        symbolId: "gml/script/test",
        oldName: "old",
        newName: "new",
        workspace: new WorkspaceEditFactory(),
        readFile: null
    });
    assert.equal(result4.valid, false);
    assert.ok(result4.errors.some((e) => e.includes("Invalid readFile")));
});

void test("verifyPostEditIntegrity works without semantic analyzer", async () => {
    const engine = new RefactorEngineClass();
    const result = await verifyPostEditIntegrityForSingleEdit(engine, {
        filePath: "test.gml",
        fileContent: "function new() { return 42; }",
        oldName: "old",
        newName: "new",
        editStart: 0,
        editEnd: 3,
        replacementText: "new"
    });

    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => w.includes("No semantic analyzer")));
});

void test("verifyPostEditIntegrity detects lingering old names", async () => {
    const engine = new RefactorEngineClass();
    const result = await verifyPostEditIntegrityForSingleEdit(engine, {
        filePath: "test.gml",
        fileContent: "function new() { var old = 1; return old; }",
        oldName: "old",
        newName: "new",
        editStart: 0,
        editEnd: 3,
        replacementText: "new"
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Old name") && e.includes("still exists")));
});

void test("verifyPostEditIntegrity detects old names in comments", async () => {
    const engine = new RefactorEngineClass();
    const result = await verifyPostEditIntegrityForSingleEdit(engine, {
        filePath: "test.gml",
        fileContent: "function new() { // TODO: update old references\n return 42; }",
        oldName: "old",
        newName: "new",
        editStart: 0,
        editEnd: 3,
        replacementText: "new"
    });

    // Comments should generate warnings, not errors
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => w.includes("Old name") && w.includes("comments")));
});

void test("verifyPostEditIntegrity warns if new name not found", async () => {
    const engine = new RefactorEngineClass();
    const result = await verifyPostEditIntegrityForSingleEdit(engine, {
        filePath: "test.gml",
        fileContent: "function foo() { return 42; }",
        oldName: "old",
        newName: "new",
        editStart: 0,
        editEnd: 3,
        replacementText: "new"
    });

    assert.ok(result.warnings.some((w) => w.includes("New name") && w.includes("does not appear")));
});

void test("verifyPostEditIntegrity detects conflicts with existing symbols", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        getSymbolOccurrences: async (name: string) => {
            if (name === "new") {
                return [
                    {
                        path: "other.gml",
                        start: 10,
                        end: 13,
                        kind: OccurrenceKind.DEFINITION
                    }
                ];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    const result = await verifyPostEditIntegrityForSingleEdit(engine, {
        filePath: "test.gml",
        fileContent: "function new() { return 42; }",
        oldName: "old",
        newName: "new",
        editStart: 0,
        editEnd: 3,
        replacementText: "new"
    });

    assert.ok(result.warnings.some((w) => w.includes("already exists") && w.includes("other.gml")));
});

void test("verifyPostEditIntegrity detects reserved keyword conflicts", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        getReservedKeywords: async () => ["if", "else", "for", "while"]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    const result = await verifyPostEditIntegrityForSingleEdit(engine, {
        filePath: "test.gml",
        fileContent: "function if() { return 42; }",
        oldName: "old",
        newName: "if",
        editStart: 0,
        editEnd: 3,
        replacementText: "if"
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("reserved keyword") && e.includes("if")));
});

void test("verifyPostEditIntegrity validates parse correctness", async () => {
    const mockParser: ParserBridge = {
        parse: async (filePath: string) => {
            if (filePath === "broken.gml") {
                throw new Error("Syntax error at line 5");
            }
            return { start: 0, end: 10, type: "root" };
        }
    };
    const engine = new RefactorEngineClass({ parser: mockParser });
    const result = await verifyPostEditIntegrityForSingleEdit(engine, {
        filePath: "broken.gml",
        fileContent: "function new( { return 42; }",
        oldName: "old",
        newName: "new",
        editStart: 0,
        editEnd: 3,
        replacementText: "new"
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Parse error") && e.includes("broken.gml")));
});

void test("verifyPostEditIntegrity handles file read errors", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 3, "new");

    const result = await engine.verifyPostEditIntegrity({
        symbolId: "gml/script/test",
        oldName: "old",
        newName: "new",
        workspace: ws,
        readFile: async () => {
            throw new Error("File not found");
        }
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Failed to read test.gml")));
});

void test("verifyPostEditIntegrity succeeds for valid rename", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        getSymbolOccurrences: async () => [],
        getReservedKeywords: async () => ["if", "else", "for"]
    };
    const mockParser: ParserBridge = {
        parse: async () => ({ start: 0, end: 30, type: "root" })
    };
    const engine = new RefactorEngineClass({
        semantic: mockSemantic,
        parser: mockParser
    });
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 7, "newFunc");

    const result = await engine.verifyPostEditIntegrity({
        symbolId: "gml/script/oldFunc",
        oldName: "oldFunc",
        newName: "newFunc",
        workspace: ws,
        readFile: async () => "function newFunc() { return 42; }"
    });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
});

void test("validateRenameRequest validates missing parameters", async () => {
    const engine = new RefactorEngineClass();

    const result = await engine.validateRenameRequest({
        newName: "bar"
    } as unknown as RenameRequest);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("required")));
});

void test("validateRenameRequest validates parameter types", async () => {
    const engine = new RefactorEngineClass();

    const result = await engine.validateRenameRequest({
        symbolId: 123,
        newName: "bar"
    } as unknown as RenameRequest);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("must be a string")));
});

void test("validateRenameRequest validates identifier syntax", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: async () => true
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.validateRenameRequest({
        symbolId: "gml/script/test",
        newName: "invalid-name"
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("not a valid GML identifier")));
});

void test("validateRenameRequest checks symbol existence", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: async (id) => id === "gml/script/exists"
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.validateRenameRequest({
        symbolId: "gml/script/missing",
        newName: "bar"
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("not found in semantic index")));
});

void test("validateRenameRequest detects same name", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: async () => true,
        getSymbolOccurrences: async () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.validateRenameRequest({
        symbolId: "gml/script/scr_test",
        newName: "scr_test"
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("matches the existing identifier")));
});

void test("validateRenameRequest detects reserved keywords", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: async () => true,
        getSymbolOccurrences: async () => [{ path: "test.gml", start: 0, end: 5, scopeId: "scope-1" }],
        getReservedKeywords: async () => ["if", "else", "for"]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.validateRenameRequest({
        symbolId: "gml/script/scr_test",
        newName: "if"
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("reserved keyword")));
});

void test("validateRenameRequest surfaces cross-file conflicts", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: async () => true,
        getSymbolOccurrences: async () => [{ path: "scripts/player.gml", start: 0, end: 5, scopeId: "scope-1" }],
        getFileSymbols: async (path) => {
            if (path === "scripts/player.gml") {
                return [{ id: "gml/script/scr_player" }, { id: "gml/script/scr_hero" }];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.validateRenameRequest({
        symbolId: "gml/script/scr_player",
        newName: "scr_hero"
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("already defines symbol")));
});

void test("validateRenameRequest can include hot reload safety summary", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: async () => true,
        getSymbolOccurrences: async () => [{ path: "test.gml", start: 0, end: 5, scopeId: "scope-1" }],
        getReservedKeywords: async () => []
    };

    const engine = new RefactorEngineClass({
        semantic: mockSemantic,
        hotReloadCoordinator: createHotReloadCoordinatorForValidation("gml/script/scr_test", "scr_test", async () => ({
            safe: false,
            reason: "Mock hot reload block",
            requiresRestart: true,
            canAutoFix: false,
            suggestions: []
        }))
    });

    const result = await engine.validateRenameRequest(
        {
            symbolId: "gml/script/scr_test",
            newName: "scr_new"
        },
        { includeHotReload: true }
    );

    assert.equal(result.valid, true);
    assert.ok(result.hotReload);
    assert.equal(result.hotReload?.safe, false);
    assert.ok(result.warnings.some((warning) => warning.includes("Hot reload unavailable")));
});

void test("validateRenameRequest passes through safe hot reload summary", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: async () => true,
        getSymbolOccurrences: async () => [{ path: "test.gml", start: 0, end: 3, scopeId: "scope-1" }],
        getReservedKeywords: async () => []
    };

    const engine = new RefactorEngineClass({
        semantic: mockSemantic,
        hotReloadCoordinator: createHotReloadCoordinatorForValidation("gml/script/scr_test", "scr_test", async () => ({
            safe: true,
            reason: "Safe to hot reload",
            requiresRestart: false,
            canAutoFix: true,
            suggestions: ["none"]
        }))
    });

    const result = await engine.validateRenameRequest(
        {
            symbolId: "gml/script/scr_test",
            newName: "scr_new"
        },
        { includeHotReload: true }
    );

    assert.equal(result.valid, true);
    assert.ok(result.hotReload);
    assert.equal(result.hotReload?.safe, true);
    assert.equal(result.warnings.length, 0);
});

void test("validateRenameRequest warns about no occurrences", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: async () => true,
        getSymbolOccurrences: async () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.validateRenameRequest({
        symbolId: "gml/script/scr_test",
        newName: "scr_new"
    });

    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => w.includes("No occurrences found")));
    assert.equal(result.occurrenceCount, 0);
});

void test("validateRenameRequest succeeds for valid rename", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: async () => true,
        getSymbolOccurrences: async () => [
            { path: "test.gml", start: 0, end: 5, scopeId: "scope-1" },
            { path: "test2.gml", start: 10, end: 15, scopeId: "scope-2" }
        ],
        getReservedKeywords: async () => ["if", "else"]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.validateRenameRequest({
        symbolId: "gml/script/scr_test",
        newName: "scr_new"
    });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.symbolName, "scr_test");
    assert.equal(result.occurrenceCount, 2);
});

void test("validateRenameRequest works without semantic analyzer", async () => {
    const engine = new RefactorEngineClass();

    const result = await engine.validateRenameRequest({
        symbolId: "gml/script/test",
        newName: "scr_new"
    });

    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => w.includes("No semantic analyzer")));
});

void test("validateRenameRequest reuses cached result for repeated requests", async () => {
    let hasSymbolCalls = 0;
    let occurrenceCalls = 0;
    let reservedKeywordCalls = 0;
    let fileSymbolCalls = 0;

    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: async () => {
            hasSymbolCalls += 1;
            return true;
        },
        getSymbolOccurrences: async () => {
            occurrenceCalls += 1;
            return [{ path: "scripts/player.gml", start: 0, end: 8, scopeId: "scope-1" }];
        },
        getReservedKeywords: async () => {
            reservedKeywordCalls += 1;
            return ["if", "else"];
        },
        getFileSymbols: async () => {
            fileSymbolCalls += 1;
            return [];
        }
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const first = await engine.validateRenameRequest({
        symbolId: "gml/script/scr_player",
        newName: "scr_hero"
    });
    const second = await engine.validateRenameRequest({
        symbolId: "gml/script/scr_player",
        newName: "scr_hero"
    });

    assert.deepEqual(second, first);
    assert.equal(hasSymbolCalls, 1);
    assert.equal(occurrenceCalls, 1);
    assert.equal(reservedKeywordCalls, 1);
    assert.equal(fileSymbolCalls, 1);
});

void test("validateRenameRequest bypasses cache when hot reload summary is requested", async () => {
    let hotReloadChecks = 0;

    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: async () => true,
        getSymbolOccurrences: async () => [{ path: "scripts/player.gml", start: 0, end: 8, scopeId: "scope-1" }],
        getReservedKeywords: async () => []
    };

    const engine = new RefactorEngineClass({
        semantic: mockSemantic,
        hotReloadCoordinator: createHotReloadCoordinatorForValidation(
            "gml/script/scr_player",
            "scr_player",
            async () => {
                hotReloadChecks += 1;
                return {
                    safe: true,
                    reason: "safe",
                    requiresRestart: false,
                    canAutoFix: true,
                    suggestions: []
                };
            }
        )
    });

    await engine.validateRenameRequest(
        {
            symbolId: "gml/script/scr_player",
            newName: "scr_hero"
        },
        { includeHotReload: true }
    );

    await engine.validateRenameRequest(
        {
            symbolId: "gml/script/scr_player",
            newName: "scr_hero"
        },
        { includeHotReload: true }
    );

    assert.equal(hotReloadChecks, 2);
});

void test("getFileSymbols returns empty array without semantic analyzer", async () => {
    const engine = new RefactorEngineClass();
    const symbols = await engine.getFileSymbols("test.gml");
    assert.deepStrictEqual(symbols, []);
});

void test("getFileSymbols queries semantic analyzer", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        getFileSymbols: async (path) => {
            if (path === "scripts/player.gml") {
                return [{ id: "gml/script/scr_player_move" }, { id: "gml/script/scr_player_attack" }];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const symbols = await engine.getFileSymbols("scripts/player.gml");
    assert.equal(symbols.length, 2);
    assert.equal(symbols[0].id, "gml/script/scr_player_move");
    assert.equal(symbols[1].id, "gml/script/scr_player_attack");
});

void test("getFileSymbols validates file path", async () => {
    const engine = new RefactorEngineClass();
    assert.throws(() => engine.getFileSymbols(null), {
        name: "TypeError",
        message: /requires a valid file path/
    });
});

void test("getSymbolDependents returns empty array without semantic analyzer", async () => {
    const engine = new RefactorEngineClass();
    const dependents = await engine.getSymbolDependents(["gml/script/scr_test"]);
    assert.deepStrictEqual(dependents, []);
});

void test("getSymbolDependents queries semantic analyzer", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        getDependents: async (symbolIds) => {
            if (symbolIds.includes("gml/script/scr_base") || symbolIds.includes("gml/script/scr_helper")) {
                return [
                    {
                        symbolId: "gml/script/scr_dependent1",
                        filePath: "scripts/dependent1.gml"
                    },
                    {
                        symbolId: "gml/script/scr_dependent2",
                        filePath: "scripts/dependent2.gml"
                    }
                ];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const dependents = await engine.getSymbolDependents(["gml/script/scr_base", "gml/script/scr_helper"]);
    assert.equal(dependents.length, 2);
    assert.equal(dependents[0].symbolId, "gml/script/scr_dependent1");
    assert.equal(dependents[0].filePath, "scripts/dependent1.gml");
});

void test("getSymbolDependents validates input type", async () => {
    const engine = new RefactorEngineClass();
    assert.throws(() => engine.getSymbolDependents("not-an-array" as unknown as Array<string>), {
        name: "TypeError",
        message: /requires an array/
    });
});

void test("getSymbolDependents handles empty array", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        getDependents: async () => {
            throw new Error("Should not be called");
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const dependents = await engine.getSymbolDependents([]);
    assert.deepStrictEqual(dependents, []);
});

void test("computeHotReloadCascade traces full circular dependency path", async () => {
    // Create a circular dependency: A -> B -> C -> A
    const mockSemantic: PartialSemanticAnalyzer = {
        getDependents: async (symbolIds: Array<string>) => {
            const id = symbolIds[0];
            switch (id) {
                case "gml/script/scr_a": {
                    return [
                        {
                            symbolId: "gml/script/scr_b",
                            filePath: "scripts/b.gml"
                        }
                    ];
                }
                case "gml/script/scr_b": {
                    return [
                        {
                            symbolId: "gml/script/scr_c",
                            filePath: "scripts/c.gml"
                        }
                    ];
                }
                case "gml/script/scr_c": {
                    return [
                        {
                            symbolId: "gml/script/scr_a",
                            filePath: "scripts/a.gml"
                        }
                    ];
                }
                // No default
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.computeHotReloadCascade(["gml/script/scr_a"]);

    // Should detect circular dependency
    assert.ok(result.metadata.hasCircular);
    assert.equal(result.circular.length, 1);

    // The cycle path should be complete: [A, B, C, A]
    const cycle = result.circular[0];
    assert.ok(cycle.length >= 3, "Cycle should contain at least 3 nodes");
    assert.equal(cycle[0], cycle.at(-1), "Cycle should start and end with the same symbol");
    // Verify the cycle contains the expected symbols
    assert.ok(cycle.includes("gml/script/scr_a"));
    assert.ok(cycle.includes("gml/script/scr_b"));
    assert.ok(cycle.includes("gml/script/scr_c"));
});

void test("computeHotReloadCascade handles multiple separate cycles", async () => {
    // Create two separate cycles:
    // Cycle 1: A -> B -> A
    // Cycle 2: X -> Y -> X
    const mockSemantic: PartialSemanticAnalyzer = {
        getDependents: async (symbolIds: Array<string>) => {
            const id = symbolIds[0];
            switch (id) {
                case "gml/script/scr_a": {
                    return [
                        {
                            symbolId: "gml/script/scr_b",
                            filePath: "scripts/b.gml"
                        }
                    ];
                }
                case "gml/script/scr_b": {
                    return [
                        {
                            symbolId: "gml/script/scr_a",
                            filePath: "scripts/a.gml"
                        }
                    ];
                }
                case "gml/script/scr_x": {
                    return [
                        {
                            symbolId: "gml/script/scr_y",
                            filePath: "scripts/y.gml"
                        }
                    ];
                }
                case "gml/script/scr_y": {
                    return [
                        {
                            symbolId: "gml/script/scr_x",
                            filePath: "scripts/x.gml"
                        }
                    ];
                }
                // No default
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.computeHotReloadCascade(["gml/script/scr_a", "gml/script/scr_x"]);

    // Should detect both cycles
    assert.ok(result.metadata.hasCircular);
    assert.ok(result.circular.length >= 2, "Should detect at least 2 separate cycles");

    // Verify each cycle is properly traced
    for (const cycle of result.circular) {
        assert.ok(cycle.length >= 2, "Each cycle should have at least 2 nodes");
        assert.equal(cycle[0], cycle.at(-1), "Each cycle should start and end with the same symbol");
    }
});

void test("computeHotReloadCascade handles non-circular dependencies correctly", async () => {
    // Create a linear dependency chain: A -> B -> C (no cycle)
    const mockSemantic: PartialSemanticAnalyzer = {
        getDependents: async (symbolIds: Array<string>) => {
            const id = symbolIds[0];
            if (id === "gml/script/scr_a") {
                return [{ symbolId: "gml/script/scr_b", filePath: "scripts/b.gml" }];
            } else if (id === "gml/script/scr_b") {
                return [{ symbolId: "gml/script/scr_c", filePath: "scripts/c.gml" }];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.computeHotReloadCascade(["gml/script/scr_a"]);

    // Should not detect any cycles
    assert.equal(result.metadata.hasCircular, false);
    assert.equal(result.circular.length, 0);

    // Should still build proper cascade
    assert.equal(result.cascade.length, 3);
    assert.equal(result.order.length, 3);

    // Verify distance increases along the chain
    const aEntry = result.cascade.find((e) => e.symbolId === "gml/script/scr_a");
    const bEntry = result.cascade.find((e) => e.symbolId === "gml/script/scr_b");
    const cEntry = result.cascade.find((e) => e.symbolId === "gml/script/scr_c");

    assert.equal(aEntry.distance, 0);
    assert.equal(bEntry.distance, 1);
    assert.equal(cEntry.distance, 2);
    assert.equal(result.metadata.maxDistance, 2);
});

void test("validateBatchRenameRequest validates empty array", async () => {
    const engine = new RefactorEngineClass();
    const validation = await engine.validateBatchRenameRequest([]);

    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes("at least one rename request")));
});

void test("validateBatchRenameRequest validates non-array input", async () => {
    const engine = new RefactorEngineClass();
    const validation = await engine.validateBatchRenameRequest(null);

    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes("array")));
});

void test("validateBatchRenameRequest validates individual rename requests", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const validation = await engine.validateBatchRenameRequest([
        { symbolId: "gml/script/scr_a", newName: "scr_x" },
        { symbolId: "gml/script/scr_b", newName: "invalid-name" }
    ]);

    assert.equal(validation.valid, false);
    assert.equal(validation.renameValidations.size, 2);

    const validationA = validation.renameValidations.get("gml/script/scr_a");
    const validationB = validation.renameValidations.get("gml/script/scr_b");

    assert.ok(validationA);
    assert.equal(validationA.valid, true);

    assert.ok(validationB);
    assert.equal(validationB.valid, false);
});

void test("validateBatchRenameRequest detects duplicate target names", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const validation = await engine.validateBatchRenameRequest([
        { symbolId: "gml/script/scr_a", newName: "scr_same" },
        { symbolId: "gml/script/scr_b", newName: "scr_same" }
    ]);

    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes("scr_same")));
    assert.equal(validation.conflictingSets.length, 1);
    assert.equal(validation.conflictingSets[0].length, 2);
});

void test("validateBatchRenameRequest detects duplicate symbol IDs", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const validation = await engine.validateBatchRenameRequest([
        { symbolId: "gml/script/scr_a", newName: "scr_new_a" },
        { symbolId: "gml/script/scr_a", newName: "scr_new_b" }
    ]);

    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes("Duplicate rename request")));
    assert.equal(validation.conflictingSets.length, 1);
    assert.equal(validation.conflictingSets[0].length, 2);
});

void test("validateBatchRenameRequest detects circular rename chains", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const validation = await engine.validateBatchRenameRequest([
        { symbolId: "gml/script/scr_a", newName: "scr_b" },
        { symbolId: "gml/script/scr_b", newName: "scr_a" }
    ]);

    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes("Circular")));
    assert.ok(validation.conflictingSets.length > 0);
});

void test("validateBatchRenameRequest warns about cross-rename confusion", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const validation = await engine.validateBatchRenameRequest([
        { symbolId: "gml/script/scr_a", newName: "scr_temp" },
        { symbolId: "gml/script/scr_b", newName: "scr_a" }
    ]);

    assert.equal(validation.valid, true);
    assert.ok(validation.warnings.some((w) => w.includes("potential confusion")));
});

void test("validateBatchRenameRequest passes for valid batch", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [{ path: "test.gml", start: 0, end: 5, scopeId: "scope-1" }]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const validation = await engine.validateBatchRenameRequest([
        { symbolId: "gml/script/scr_a", newName: "scr_x" },
        { symbolId: "gml/script/scr_b", newName: "scr_y" }
    ]);

    assert.equal(validation.valid, true);
    assert.equal(validation.errors.length, 0);
    assert.equal(validation.renameValidations.size, 2);
    assert.equal(validation.conflictingSets.length, 0);
});

void test("validateBatchRenameRequest includes hot reload checks when requested", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [{ path: "test.gml", start: 0, end: 5, scopeId: "scope-1" }]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const validation = await engine.validateBatchRenameRequest([{ symbolId: "gml/script/scr_a", newName: "scr_x" }], {
        includeHotReload: true
    });

    const renameValidation = validation.renameValidations.get("gml/script/scr_a");
    assert.ok(renameValidation);
    assert.ok(renameValidation.hotReload);
});

void test("validateBatchRenameRequest handles invalid request objects", async () => {
    const engine = new RefactorEngineClass();

    const validation = await engine.validateBatchRenameRequest([
        null,
        { symbolId: "gml/script/scr_a", newName: "scr_x" }
    ]);

    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes("valid request object")));
});
