import assert from "node:assert/strict";
import test from "node:test";

import {
    type ParserBridge,
    type PartialSemanticAnalyzer,
    Refactor,
    type RefactorEngine,
    type RenameRequest,
    type WorkspaceEdit,
    type WorkspaceReadFile,
    type WorkspaceWriteFile
} from "../index.js";

const { RefactorEngine: RefactorEngineClass, WorkspaceEdit: WorkspaceEditFactory, createRefactorEngine } = Refactor;

void test("createRefactorEngine returns a RefactorEngine", () => {
    const engine = createRefactorEngine();
    assert.ok(engine instanceof RefactorEngineClass);
});

void test("createRefactorEngine accepts dependencies", () => {
    const mockParser: ParserBridge = {
        parse: async () => ({ start: 0, end: 0, type: "root" })
    };
    const mockSemantic: PartialSemanticAnalyzer = {};
    const engine = createRefactorEngine({
        parser: mockParser,
        semantic: mockSemantic
    });
    assert.equal(engine.parser, mockParser);
    assert.equal(engine.semantic, mockSemantic);
});

void test("WorkspaceEdit starts empty", () => {
    const ws = new WorkspaceEditFactory();
    assert.equal(ws.edits.length, 0);
    assert.equal(ws.metadataEdits.length, 0);
});

void test("WorkspaceEdit can add edits", () => {
    const ws = new WorkspaceEditFactory();
    ws.addEdit("file.gml", 0, 10, "newText");
    assert.equal(ws.edits.length, 1);
    assert.equal(ws.edits[0].path, "file.gml");
    assert.equal(ws.edits[0].start, 0);
    assert.equal(ws.edits[0].end, 10);
    assert.equal(ws.edits[0].newText, "newText");
});

void test("WorkspaceEdit can add metadata edits", () => {
    const ws = new WorkspaceEditFactory();
    ws.addMetadataEdit("objects/o_player/o_player.yy", '{"name":"o_player"}');

    assert.equal(ws.metadataEdits.length, 1);
    assert.equal(ws.metadataEdits[0].path, "objects/o_player/o_player.yy");
});

void test("WorkspaceEdit groups edits by file", () => {
    const ws = new WorkspaceEditFactory();
    ws.addEdit("file1.gml", 0, 10, "text1");
    ws.addEdit("file2.gml", 20, 30, "text2");
    ws.addEdit("file1.gml", 40, 50, "text3");

    const grouped = ws.groupByFile();
    assert.equal(grouped.size, 2);
    assert.equal(grouped.get("file1.gml").length, 2);
    assert.equal(grouped.get("file2.gml").length, 1);
});

void test("WorkspaceEdit sorts edits descending by start position", () => {
    const ws = new WorkspaceEditFactory();
    ws.addEdit("file.gml", 10, 20, "a");
    ws.addEdit("file.gml", 50, 60, "b");
    ws.addEdit("file.gml", 30, 40, "c");

    const grouped = ws.groupByFile();
    const edits = grouped.get("file.gml");
    assert.equal(edits[0].start, 50); // Highest first
    assert.equal(edits[1].start, 30);
    assert.equal(edits[2].start, 10); // Lowest last
});

void test("planRename validates missing symbolId", async () => {
    const engine = new RefactorEngineClass();
    await assert.rejects(
        () =>
            engine.planRename({
                newName: "bar"
            } as unknown as RenameRequest),
        {
            name: "TypeError",
            message: "planRename requires symbolId and newName"
        }
    );
});

void test("planRename validates missing newName", async () => {
    const engine = new RefactorEngineClass();
    await assert.rejects(
        () =>
            engine.planRename({
                symbolId: "gml/script/foo"
            } as unknown as RenameRequest),
        {
            name: "TypeError",
            message: "planRename requires symbolId and newName"
        }
    );
});

void test("planRename validates symbolId type", async () => {
    const engine = new RefactorEngineClass();
    await assert.rejects(
        () =>
            engine.planRename({
                symbolId: 123,
                newName: "bar"
            } as unknown as RenameRequest),
        {
            name: "TypeError",
            message: /symbolId must be a string/
        }
    );
});

void test("planRename validates newName type", async () => {
    const engine = new RefactorEngineClass();
    await assert.rejects(
        () =>
            engine.planRename({
                symbolId: "gml/script/foo",
                newName: 456
            } as unknown as RenameRequest),
        {
            name: "TypeError",
            message: /Identifier names must be strings/
        }
    );
});

void test("planRename rejects whitespace-padded names", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    await assert.rejects(
        () =>
            engine.planRename({
                symbolId: "gml/script/scr_test",
                newName: " scr_new "
            }),
        {
            message: /must not include leading or trailing whitespace/
        }
    );
});

void test("planRename rejects invalid identifier characters", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => []
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    await assert.rejects(
        () =>
            engine.planRename({
                symbolId: "gml/script/scr_test",
                newName: "scr-new"
            }),
        {
            message: /not a valid GML identifier/
        }
    );
});

void test("planRename rejects renaming to the existing name", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [{ path: "test.gml", start: 0, end: 5, scopeId: "scope-1" }]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    await assert.rejects(
        () =>
            engine.planRename({
                symbolId: "gml/script/scr_test",
                newName: "scr_test"
            }),
        {
            message: /matches the existing identifier/
        }
    );
});

void test("planRename checks symbol existence with semantic analyzer", async () => {
    const mockSemantic = {
        hasSymbol: (id) => id === "gml/script/exists"
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    await assert.rejects(
        () =>
            engine.planRename({
                symbolId: "gml/script/missing",
                newName: "bar"
            }),
        {
            message: /Symbol 'gml\/script\/missing' not found/
        }
    );
});

void test("planRename detects reserved keyword conflicts", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [{ path: "test.gml", start: 0, end: 10, scopeId: "scope-1" }]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    await assert.rejects(
        () =>
            engine.planRename({
                symbolId: "gml/script/scr_test",
                newName: "if"
            }),
        {
            message: /reserved keyword/
        }
    );
});

void test("planRename creates workspace edit with occurrences", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [
            { path: "test.gml", start: 0, end: 10, scopeId: "scope-1" },
            { path: "test.gml", start: 50, end: 60, scopeId: "scope-1" }
        ]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const workspace = await engine.planRename({
        symbolId: "gml/script/scr_old",
        newName: "scr_new"
    });

    assert.ok(typeof workspace.addEdit === "function");
    assert.ok(typeof workspace.groupByFile === "function");
    assert.ok(Array.isArray(workspace.edits));
    assert.equal(workspace.edits.length, 2);
    assert.equal(workspace.edits[0].newText, "scr_new");
    assert.equal(workspace.edits[1].newText, "scr_new");
});

void test("planRename drops metadata-file text edits when a full metadata rewrite is staged", async () => {
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [
            {
                path: "objects/oCamera/oCamera.yy",
                start: 10,
                end: 17,
                scopeId: "scope:resource:oCamera"
            },
            {
                path: "objects/oSystem/Other_2.gml",
                start: 28,
                end: 35,
                scopeId: "scope:object:oSystem"
            }
        ],
        getAdditionalSymbolEdits: () => {
            const workspace = new WorkspaceEditFactory();
            workspace.addMetadataEdit(
                "objects/oCamera/oCamera.yy",
                '{"name":"o_camera","resourcePath":"objects/o_camera/o_camera.yy"}'
            );
            workspace.addFileRename("objects/oCamera/oCamera.yy", "objects/oCamera/o_camera.yy");
            workspace.addFileRename("objects/oCamera", "objects/o_camera");
            return workspace;
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const workspace = await engine.planRename({
        symbolId: "gml/objects/oCamera",
        newName: "o_camera"
    });

    assert.equal(workspace.edits.length, 1);
    assert.equal(workspace.edits[0]?.path, "objects/oSystem/Other_2.gml");
    assert.equal(workspace.metadataEdits.length, 1);
    assert.equal(workspace.metadataEdits[0]?.path, "objects/oCamera/oCamera.yy");

    const validation = await engine.validateRename(workspace);
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.errors, []);
});

void test("planRename drops metadata-file text edits when metadata rewrite path uses windows separators", async () => {
    const metadataPath = String.raw`objects\oCamera\oCamera.yy`;
    const mockSemantic = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [
            {
                path: "objects/oCamera/oCamera.yy",
                start: 10,
                end: 17,
                scopeId: "scope:resource:oCamera"
            },
            {
                path: "objects/oSystem/Other_2.gml",
                start: 28,
                end: 35,
                scopeId: "scope:object:oSystem"
            }
        ],
        getAdditionalSymbolEdits: () => {
            const workspace = new WorkspaceEditFactory();
            workspace.addMetadataEdit(
                metadataPath,
                '{"name":"o_camera","resourcePath":"objects/o_camera/o_camera.yy"}'
            );
            return workspace;
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const workspace = await engine.planRename({
        symbolId: "gml/objects/oCamera",
        newName: "o_camera"
    });

    assert.equal(workspace.edits.length, 1);
    assert.equal(workspace.edits[0]?.path, "objects/oSystem/Other_2.gml");
    assert.equal(workspace.metadataEdits.length, 1);
    assert.equal(workspace.metadataEdits[0]?.path, metadataPath);
});

void test("validateRename rejects text edits plus metadata rewrites for separator-only path variants", async () => {
    const metadataPath = String.raw`objects\oCamera\oCamera.yy`;
    const engine = new RefactorEngineClass();
    const workspace = new WorkspaceEditFactory();
    workspace.addEdit("objects/oCamera/oCamera.yy", 0, 7, "o_camera");
    workspace.addMetadataEdit(metadataPath, '{"name":"o_camera"}');

    const validation = await engine.validateRename(workspace);

    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((error) => error.includes("Cannot combine text and metadata edits")));
});

void test("validateSymbolExists requires semantic analyzer", async () => {
    const engine = new RefactorEngineClass();
    await assert.rejects(() => engine.validateSymbolExists("gml/script/foo"), {
        message: /RefactorEngine requires a semantic analyzer/
    });
});

void test("validateSymbolExists returns true when semantic lacks hasSymbol", async () => {
    const mockSemantic = {}; // No hasSymbol method
    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    const result = await engine.validateSymbolExists("gml/script/foo");
    assert.equal(result, true);
});

void test("validateRename detects invalid workspace", async () => {
    const engine = new RefactorEngineClass();
    const result = await engine.validateRename(null);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
});

void test("validateRename detects empty workspace", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    const result = await engine.validateRename(ws);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("no changes")));
});

void test("validateRename detects overlapping edits", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 10, "a");
    ws.addEdit("test.gml", 5, 15, "b"); // Overlaps with previous
    const result = await engine.validateRename(ws);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Overlapping")));
});

void test("validateRename rejects malformed text edit ranges", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("", 0, 1, "missingPath");
    ws.addEdit("scripts/example.gml", -1, 1, "negativeStart");
    ws.addEdit("scripts/example.gml", 8, 4, "reversedRange");

    const result = await engine.validateRename(ws);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("Text edit path must be a non-empty string")));
    assert.ok(result.errors.some((error) => error.includes("non-negative integer start offset")));
    assert.ok(result.errors.some((error) => error.includes("must not end before it starts")));
});

void test("validateRename warns about large refactorings", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    // Add many edits
    for (let i = 0; i < 60; i++) {
        ws.addEdit("test.gml", i * 100, i * 100 + 10, "x");
    }
    const result = await engine.validateRename(ws);
    assert.ok(result.warnings.some((w) => w.includes("Large number")));
});

void test("validateRename passes with valid non-overlapping edits", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 10, "a");
    ws.addEdit("test.gml", 20, 30, "b");
    ws.addEdit("test.gml", 40, 50, "c");
    const result = await engine.validateRename(ws);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
});

void test("validateRename accepts metadata-only workspace edits", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addMetadataEdit("objects/o_player/o_player.yy", '{"name":"o_player"}');

    const result = await engine.validateRename(ws);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
});

void test("validateRename rejects ambiguous file rename graphs", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addFileRename("scripts/a.gml", "scripts/b.gml");
    ws.addFileRename("scripts/b.gml", "scripts/c.gml");
    ws.addFileRename("scripts/d.gml", "scripts/c.gml");

    const result = await engine.validateRename(ws);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("rename chains are not supported")));
    assert.ok(result.errors.some((error) => error.includes("Duplicate file rename destination detected")));
});

void test("gatherSymbolOccurrences returns empty array without semantic", async () => {
    const engine = new RefactorEngineClass();
    const occurrences = await engine.gatherSymbolOccurrences("test");
    assert.deepEqual(occurrences, []);
});

void test("gatherSymbolOccurrences uses semantic analyzer when available", async () => {
    const mockOccurrences = [
        { path: "test.gml", start: 0, end: 10 },
        { path: "test.gml", start: 50, end: 60 }
    ];
    const mockSemantic = {
        getSymbolOccurrences: () => mockOccurrences
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    const occurrences = await engine.gatherSymbolOccurrences("test");
    assert.deepEqual(occurrences, mockOccurrences);
});

void test("gatherSymbolOccurrences de-duplicates identical semantic occurrences", async () => {
    const duplicatedOccurrences = [
        { path: "test.gml", start: 0, end: 10, kind: Refactor.OccurrenceKind.DEFINITION },
        { path: "test.gml", start: 0, end: 11, kind: Refactor.OccurrenceKind.REFERENCE },
        { path: "test.gml", start: 50, end: 60, kind: Refactor.OccurrenceKind.REFERENCE }
    ];
    const mockSemantic = {
        getSymbolOccurrences: () => duplicatedOccurrences
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const occurrences = await engine.gatherSymbolOccurrences("test");

    assert.deepEqual(occurrences, [
        { path: "test.gml", start: 0, end: 11, kind: Refactor.OccurrenceKind.REFERENCE },
        { path: "test.gml", start: 50, end: 60, kind: Refactor.OccurrenceKind.REFERENCE }
    ]);
});

void test("prepareHotReloadUpdates returns empty for empty workspace", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    const updates = await engine.prepareHotReloadUpdates(ws);
    assert.ok(Array.isArray(updates));
    assert.equal(updates.length, 0);
});

void test("prepareHotReloadUpdates creates updates for edited files", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 10, "newcode");
    const updates = await engine.prepareHotReloadUpdates(ws);
    assert.ok(updates.length > 0);
    assert.equal(updates[0].filePath, "test.gml");
    assert.equal(updates[0].action, "recompile");
});

void test("prepareHotReloadUpdates uses semantic file symbols when available", async () => {
    const mockSemantic = {
        getFileSymbols: () => [{ id: "gml/script/scr_test" }]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 10, "newcode");
    const updates = await engine.prepareHotReloadUpdates(ws);
    assert.ok(updates.length > 0);
    assert.equal(updates[0].symbolId, "gml/script/scr_test");
});

void test("prepareHotReloadUpdates falls back to file-level updates when getFileSymbols throws", async () => {
    const mockSemantic = {
        getFileSymbols: async () => {
            throw new Error("semantic index unavailable");
        }
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    const ws = new WorkspaceEditFactory();
    ws.addEdit("scripts/test.gml", 0, 10, "newcode");

    const updates = await engine.prepareHotReloadUpdates(ws);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].symbolId, "file://scripts/test.gml");
    assert.equal(updates[0].action, "recompile");
    assert.equal(updates[0].filePath, "scripts/test.gml");
});

void test("prepareHotReloadUpdates includes transitive dependents from cascade", async () => {
    const mockSemantic = {
        getFileSymbols: () => [{ id: "gml/script/scr_root" }],
        getDependents: async (symbolIds: Array<string>) => {
            const id = symbolIds[0];
            if (id === "gml/script/scr_root") {
                return [
                    {
                        symbolId: "gml/script/scr_child",
                        filePath: "deps/child.gml"
                    }
                ];
            }
            if (id === "gml/script/scr_child") {
                return [
                    {
                        symbolId: "gml/script/scr_grandchild",
                        filePath: "deps/grandchild.gml"
                    }
                ];
            }
            return [];
        }
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    const ws = new WorkspaceEditFactory();
    ws.addEdit("scripts/root.gml", 0, 10, "updated");

    const updates = await engine.prepareHotReloadUpdates(ws);

    const childUpdate = updates.find((update) => update.symbolId === "gml/script/scr_child");
    const grandchildUpdate = updates.find((update) => update.symbolId === "gml/script/scr_grandchild");

    assert.ok(childUpdate);
    assert.equal(childUpdate?.action, "notify");
    assert.equal(childUpdate?.filePath, "deps/child.gml");
    assert.ok(grandchildUpdate);
    assert.equal(grandchildUpdate?.action, "notify");
    assert.equal(grandchildUpdate?.filePath, "deps/grandchild.gml");
});

void test("findSymbolAtLocation returns null without semantic", async () => {
    const engine = new RefactorEngineClass();
    const result = await engine.findSymbolAtLocation("test.gml", 10);
    assert.equal(result, null);
});

void test("findSymbolAtLocation uses semantic analyzer when available", async () => {
    const mockSymbol = {
        symbolId: "gml/script/scr_test",
        name: "scr_test",
        range: { start: 0, end: 10 }
    };
    const mockSemantic = {
        getSymbolAtPosition: () => mockSymbol
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });
    const result = await engine.findSymbolAtLocation("test.gml", 5);
    assert.deepEqual(result, mockSymbol);
});

void test("applyWorkspaceEdit requires a WorkspaceEdit", async () => {
    const engine = new RefactorEngineClass();
    await assert.rejects(
        () =>
            engine.applyWorkspaceEdit(null as unknown as WorkspaceEdit, {
                readFile: async () => ""
            }),
        {
            name: "TypeError",
            message: /requires a WorkspaceEdit/
        }
    );
});

void test("applyWorkspaceEdit requires readFile function", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    type ApplyWorkspaceEditParams = Parameters<RefactorEngine["applyWorkspaceEdit"]>[1];
    const invalidOptions = {} as ApplyWorkspaceEditParams;
    await assert.rejects(() => engine.applyWorkspaceEdit(ws, invalidOptions), {
        name: "TypeError",
        message: /requires a readFile function/
    });
});

void test("applyWorkspaceEdit requires writeFile when not in dry-run", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 5, "new");
    await assert.rejects(
        () =>
            engine.applyWorkspaceEdit(ws, {
                readFile: async () => "old text",
                dryRun: false
            }),
        {
            name: "TypeError",
            message: /requires a writeFile function/
        }
    );
});

void test("applyWorkspaceEdit applies edits correctly", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 3, "new");
    ws.addEdit("test.gml", 9, 13, "world");

    const readFile: WorkspaceReadFile = async () => "old text here";
    const writeFile: WorkspaceWriteFile = async () => {};

    const results = await engine.applyWorkspaceEdit(ws, {
        readFile,
        writeFile,
        dryRun: true
    });

    assert.equal(results.size, 1);
    assert.equal(results.get("test.gml"), "new text world");
});

void test("applyWorkspaceEdit preserves edit ordering when many replacements target one file", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    const originalSource = "alpha beta gamma delta epsilon";

    ws.addEdit("test.gml", 0, 5, "ALPHA");
    ws.addEdit("test.gml", 6, 10, "BETA");
    ws.addEdit("test.gml", 11, 16, "GAMMA");
    ws.addEdit("test.gml", 17, 22, "DELTA");
    ws.addEdit("test.gml", 23, 30, "EPSILON");

    const results = await engine.applyWorkspaceEdit(ws, {
        readFile: async () => originalSource,
        dryRun: true
    });

    assert.equal(results.get("test.gml"), "ALPHA BETA GAMMA DELTA EPSILON");
});

void test("applyWorkspaceEdit handles multiple files", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("file1.gml", 0, 3, "abc");
    ws.addEdit("file2.gml", 0, 3, "xyz");

    const files = {
        "file1.gml": "old content",
        "file2.gml": "old content"
    };

    const readFile: WorkspaceReadFile = async (path) => files[path];
    const results = await engine.applyWorkspaceEdit(ws, {
        readFile,
        dryRun: true
    });

    assert.equal(results.size, 2);
    assert.equal(results.get("file1.gml"), "abc content");
    assert.equal(results.get("file2.gml"), "xyz content");
});

void test("applyWorkspaceEdit applies metadata edits as full-document replacements", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addMetadataEdit("objects/o_player/o_player.yy", '{"name":"o_hero"}');

    const readFile: WorkspaceReadFile = async () => '{"name":"o_player"}';
    const writes: Record<string, string> = {};
    const writeFile: WorkspaceWriteFile = async (targetPath, content) => {
        writes[targetPath] = content;
    };

    const results = await engine.applyWorkspaceEdit(ws, {
        readFile,
        writeFile,
        dryRun: false
    });

    assert.equal(results.get("objects/o_player/o_player.yy"), '{"name":"o_hero"}');
    assert.equal(writes["objects/o_player/o_player.yy"], '{"name":"o_hero"}');
});

void test("applyWorkspaceEdit can omit result content in write mode", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 3, "new");

    const readFile: WorkspaceReadFile = async () => "old text here";
    const writes: Record<string, string> = {};
    const writeFile: WorkspaceWriteFile = async (targetPath, content) => {
        writes[targetPath] = content;
    };

    const results = await engine.applyWorkspaceEdit(ws, {
        readFile,
        writeFile,
        dryRun: false,
        includeResultContent: false
    });

    assert.equal(results.get("test.gml"), "");
    assert.equal(writes["test.gml"], "new text here");
});

void test("applyWorkspaceEdit rejects invalid edits", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("test.gml", 0, 10, "new");
    ws.addEdit("test.gml", 5, 15, "conflict"); // Overlapping edit

    const readFile: WorkspaceReadFile = async () => "some text here";

    await assert.rejects(() => engine.applyWorkspaceEdit(ws, { readFile, dryRun: true }), {
        message: /Overlapping edits/
    });
});

void test("applyWorkspaceEdit rejects malformed text edit ranges before writing", async () => {
    const engine = new RefactorEngineClass();
    const ws = new WorkspaceEditFactory();
    ws.addEdit("scripts/example.gml", 12, 3, "badRange");

    let writeCount = 0;

    await assert.rejects(
        () =>
            engine.applyWorkspaceEdit(ws, {
                readFile: async () => "show_debug_message(name);",
                writeFile: async () => {
                    writeCount += 1;
                },
                dryRun: false
            }),
        {
            message: /must not end before it starts/
        }
    );

    assert.equal(writeCount, 0);
});

void test("executeRename validates required parameters", async () => {
    const engine = new RefactorEngineClass();
    type ExecuteRenameArgs = Parameters<RefactorEngine["executeRename"]>[0];
    const invalidRequest = {} as ExecuteRenameArgs;
    await assert.rejects(() => engine.executeRename(invalidRequest), {
        name: "TypeError",
        message: /requires symbolId and newName/
    });
});

void test("executeRename performs complete rename workflow", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [
            { path: "test.gml", start: 0, end: 5, scopeId: "scope-1" },
            { path: "test.gml", start: 16, end: 21, scopeId: "scope-1" }
        ]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const files = { "test.gml": "scr_a some code scr_a" };
    const readFile: WorkspaceReadFile = async (path) => files[path];
    const writeFile: WorkspaceWriteFile = async (path, content) => {
        files[path] = content;
    };

    const result = await engine.executeRename({
        symbolId: "gml/script/scr_a",
        newName: "scr_b",
        readFile,
        writeFile
    });

    assert.ok(typeof result.workspace.addEdit === "function");
    assert.ok(typeof result.workspace.groupByFile === "function");
    assert.ok(Array.isArray(result.workspace.edits));
    assert.equal(result.applied.size, 1);
    assert.equal(result.applied.get("test.gml"), "scr_b some code scr_b");
    assert.equal(files["test.gml"], "scr_b some code scr_b");
});

void test("executeRename rejects invalid planned edits", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [
            { path: "test.gml", start: 0, end: 5, scopeId: "scope-1" },
            { path: "test.gml", start: 4, end: 10, scopeId: "scope-1" } // Overlaps
        ]
    };

    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const readFile: WorkspaceReadFile = async () => "scr_old scr_old";
    let wrote = false;
    const writeFile: WorkspaceWriteFile = async () => {
        wrote = true;
    };

    await assert.rejects(
        () =>
            engine.executeRename({
                symbolId: "gml/script/scr_old",
                newName: "scr_new",
                readFile,
                writeFile
            }),
        { message: /Overlapping edits/ }
    );

    assert.equal(wrote, false);
});

void test("executeRename prepares hot reload updates when requested", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        hasSymbol: () => true,
        getSymbolOccurrences: () => [{ path: "test.gml", start: 0, end: 5, scopeId: "scope-1" }],
        getFileSymbols: () => [{ id: "gml/script/scr_test" }]
    };
    const engine = new RefactorEngineClass({ semantic: mockSemantic });

    const readFile: WorkspaceReadFile = async () => "scr_a";
    const writeFile: WorkspaceWriteFile = async () => {};

    const result = await engine.executeRename({
        symbolId: "gml/script/scr_a",
        newName: "scr_b",
        readFile,
        writeFile,
        prepareHotReload: true
    });

    assert.ok(Array.isArray(result.hotReloadUpdates));
    assert.ok(result.hotReloadUpdates.length > 0);
    assert.equal(result.hotReloadUpdates[0].action, "recompile");
});
