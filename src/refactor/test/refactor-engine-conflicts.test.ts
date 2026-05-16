import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

const { RefactorEngine: RefactorEngineClass } = Refactor;

// detectRenameConflicts tests.
void test("detectRenameConflicts validates oldName parameter", async () => {
    const engine = new RefactorEngineClass();
    await assert.rejects(
        () =>
            engine.detectRenameConflicts({
                oldName: null,
                newName: "newVar",
                occurrences: []
            }),
        {
            name: "TypeError",
            message: /oldName as a non-empty string/
        }
    );
});

void test("detectRenameConflicts validates newName parameter", async () => {
    const engine = new RefactorEngineClass();
    await assert.rejects(
        () =>
            engine.detectRenameConflicts({
                oldName: "oldVar",
                newName: 123 as unknown as string,
                occurrences: []
            }),
        {
            name: "TypeError",
            message: /newName as a non-empty string/
        }
    );
});

void test("detectRenameConflicts validates occurrences parameter", async () => {
    const engine = new RefactorEngineClass();
    await assert.rejects(
        () =>
            engine.detectRenameConflicts({
                oldName: "oldVar",
                newName: "newVar",
                occurrences: "not an array" as unknown as Array<{
                    path: string;
                    start: number;
                    end: number;
                }>
            }),
        {
            name: "TypeError",
            message: /occurrences as an array/
        }
    );
});

void test("detectRenameConflicts returns empty array for valid rename", async () => {
    const engine = new RefactorEngineClass();
    const conflicts = await engine.detectRenameConflicts({
        oldName: "oldVar",
        newName: "newVar",
        occurrences: [
            { path: "test.gml", start: 10, end: 16 },
            { path: "test.gml", start: 50, end: 56 }
        ]
    });

    assert.ok(Array.isArray(conflicts));
    assert.equal(conflicts.length, 0);
});

void test("detectRenameConflicts detects invalid identifier names", async () => {
    const engine = new RefactorEngineClass();
    const conflicts = await engine.detectRenameConflicts({
        oldName: "oldVar",
        newName: "123invalid",
        occurrences: [{ path: "test.gml", start: 10, end: 16 }]
    });

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, "invalid_identifier");
    assert.ok(conflicts[0].message.includes("not a valid GML identifier"));
});

void test("detectRenameConflicts detects reserved keyword conflicts", async () => {
    const engine = new RefactorEngineClass();
    const conflicts = await engine.detectRenameConflicts({
        oldName: "myVar",
        newName: "function",
        occurrences: [{ path: "test.gml", start: 10, end: 15 }]
    });

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, "reserved");
    assert.ok(conflicts[0].message.includes("reserved keyword"));
});

void test("detectRenameConflicts detects shadowing with semantic analyzer", async () => {
    const mockSemantic = {
        lookup: async (name: string, scopeId?: string) => {
            if (name === "existingVar" && scopeId === "scope1") {
                return { name: "existingVar" };
            }
            return null;
        }
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    const conflicts = await engine.detectRenameConflicts({
        oldName: "myVar",
        newName: "existingVar",
        occurrences: [{ path: "test.gml", start: 10, end: 15, scopeId: "scope1" }]
    });

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, "shadow");
    assert.ok(conflicts[0].message.includes("would shadow"));
    assert.equal(conflicts[0].path, "test.gml");
});

void test("detectRenameConflicts allows rename to same symbol in scope", async () => {
    const mockSemantic = {
        lookup: async (name: string) => {
            if (name === "myVar") {
                return { name: "myVar" };
            }
            return null;
        }
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    const conflicts = await engine.detectRenameConflicts({
        oldName: "myVar",
        newName: "myVar",
        occurrences: [{ path: "test.gml", start: 10, end: 15 }]
    });

    // Renaming to the same name that already exists is allowed
    // because it's the same symbol
    assert.equal(conflicts.length, 0);
});

void test("detectRenameConflicts uses semantic analyzer reserved keywords", async () => {
    const mockSemantic = {
        getReservedKeywords: async () => ["customKeyword", "anotherReserved"]
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    const conflicts = await engine.detectRenameConflicts({
        oldName: "myVar",
        newName: "customKeyword",
        occurrences: [{ path: "test.gml", start: 10, end: 15 }]
    });

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, "reserved");
    assert.ok(conflicts[0].message.includes("reserved keyword"));
});

void test("detectRenameConflicts works without semantic analyzer", async () => {
    const engine = new RefactorEngineClass();
    const conflicts = await engine.detectRenameConflicts({
        oldName: "oldVar",
        newName: "validNewName",
        occurrences: [{ path: "test.gml", start: 10, end: 16 }]
    });

    assert.ok(Array.isArray(conflicts));
    assert.equal(conflicts.length, 0);
});

void test("detectRenameConflicts handles multiple occurrences with different scopes", async () => {
    const mockSemantic = {
        lookup: async (name: string, scopeId?: string) => {
            if (name === "conflictVar" && scopeId === "scope2") {
                return { name: "conflictVar" };
            }
            return null;
        }
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    const conflicts = await engine.detectRenameConflicts({
        oldName: "myVar",
        newName: "conflictVar",
        occurrences: [
            { path: "test1.gml", start: 10, end: 15, scopeId: "scope1" },
            { path: "test2.gml", start: 20, end: 25, scopeId: "scope2" },
            { path: "test3.gml", start: 30, end: 35, scopeId: "scope3" }
        ]
    });

    // Only scope2 has a conflict
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, "shadow");
    assert.equal(conflicts[0].path, "test2.gml");
});

void test("checkHotReloadSafety rejects malformed symbolId", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const testCases = [
        { id: "gml", desc: "missing parts" },
        { id: "gml/", desc: "missing kind and name" },
        { id: "gml/script", desc: "missing name" },
        { id: "invalid_format", desc: "wrong pattern" }
    ];

    for (const testCase of testCases) {
        const result = await engine.checkHotReloadSafety({
            symbolId: testCase.id,
            newName: "new_name"
        });

        assert.equal(result.safe, false, `Expected safe=false for ${testCase.desc} (id: ${testCase.id})`);
        assert.ok(
            result.reason.includes("Malformed") || result.reason.includes("Invalid"),
            `Expected error message for ${testCase.desc}`
        );
    }
});

void test("checkHotReloadSafety rejects invalid symbol kinds", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/invalid_kind/test_symbol",
        newName: "new_symbol"
    });

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("Invalid symbol kind"));
    assert.ok(result.suggestions.some((s) => s.includes("script, var, event, macro, enum")));
});

void test("checkHotReloadSafety handles valid script symbol kind", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/script/test_script",
        newName: "new_script"
    });

    assert.equal(result.safe, true);
    assert.ok(result.reason.includes("Script renames are hot-reload-safe"));
});

void test("checkHotReloadSafety handles valid var symbol kind", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/var/test_var",
        newName: "new_var"
    });

    assert.equal(result.safe, true);
    assert.ok(result.reason.includes("Global variable renames are hot-reload-safe"));
});

void test("checkHotReloadSafety handles valid macro symbol kind", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/macro/TEST_MACRO",
        newName: "NEW_MACRO"
    });

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("Macro/enum renames require"));
});

void test("checkHotReloadSafety handles valid enum symbol kind", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/enum/TestEnum",
        newName: "NewEnum"
    });

    assert.equal(result.safe, false);
    assert.ok(result.reason.includes("Macro/enum renames require"));
});

void test("checkHotReloadSafety treats script resource symbol ids as script-safe renames", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/scripts/demo_script",
        newName: "demoScript"
    });

    assert.equal(result.safe, true);
    assert.ok(result.reason.includes("Script renames are hot-reload-safe"));
});

void test("checkHotReloadSafety reports non-script resource renames as restart-required", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/objects/obj_enemy",
        newName: "objBoss"
    });

    assert.equal(result.safe, false);
    assert.equal(result.requiresRestart, true);
    assert.ok(result.reason.includes("metadata and file updates outside hot reload"));
});

void test("checkHotReloadSafety reports enum member renames as dependent recompiles", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const result = await engine.checkHotReloadSafety({
        symbolId: "gml/enum-member/ready_state",
        newName: "readyState"
    });

    assert.equal(result.safe, false);
    assert.equal(result.requiresRestart, false);
    assert.ok(result.reason.includes("Enum member renames require dependent script recompilation"));
});
