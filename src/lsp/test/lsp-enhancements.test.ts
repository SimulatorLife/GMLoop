import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Lsp } from "@gmloop/lsp";

async function createProject(projectName: string): Promise<{
    cleanup(): Promise<void>;
    projectRoot: string;
    scriptPath: string;
}> {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), `gmloop-lsp-test-${projectName}-`));
    const scriptPath = path.join(projectRoot, "scripts/main/main.gml");
    const scriptText = "function main() {\n    return 0;\n}";

    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(
        path.join(projectRoot, `${projectName}.yyp`),
        JSON.stringify({ name: projectName, resourceType: "GMProject" })
    );
    await fs.writeFile(
        path.join(projectRoot, "scripts/main/main.yy"),
        JSON.stringify({ name: "main", resourceType: "GMScript" })
    );
    await fs.writeFile(scriptPath, scriptText);

    return {
        projectRoot,
        scriptPath,
        async cleanup() {
            await new Promise((resolve) => setTimeout(resolve, 50));
            await fs.rm(projectRoot, { recursive: true, force: true }).catch(() => {});
        }
    };
}

void test("LSP: custom FsFacade resolves unsaved document edits for semantic query", async () => {
    const proj = await createProject("FsFacadeTest");
    try {
        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(proj.scriptPath),
            languageId: "gml",
            version: 1,
            text: "function main() {\n    return 0;\n}\nfunction newly_added_unsaved_func() {}\n"
        });

        const semanticIndex = Lsp.createGmlSemanticIndex(store);

        // Build the index initially
        await semanticIndex.buildForDocument(document);

        // Try to query completions for the unsaved function "newly_added_unsaved_func"
        const completions = await semanticIndex.searchCompletions(document, "newly_added_unsaved_func");
        assert.ok(
            completions.some((c) => c.label === "newly_added_unsaved_func"),
            "Should find the unsaved function in completions"
        );
    } finally {
        await proj.cleanup();
    }
});

void test("LSP: built-in functions appear in completions and hover", async () => {
    const proj = await createProject("BuiltInsTest");
    try {
        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(proj.scriptPath),
            languageId: "gml",
            version: 1,
            text: "show_debug_message('hello');"
        });

        const semanticIndex = Lsp.createGmlSemanticIndex(store);
        await semanticIndex.buildForDocument(document);

        // Completions
        const completions = await semanticIndex.searchCompletions(document, "show_debug");
        assert.ok(
            completions.some((c) => c.label === "show_debug_message"),
            "Should find show_debug_message in completions"
        );

        // Hover
        const hover = await semanticIndex.hover(document, 0, "show_debug_message");
        assert.ok(hover, "Should return hover result for show_debug_message");
        assert.match(
            typeof hover?.contents === "object" && "value" in hover.contents ? hover.contents.value : "",
            /show_debug_message/
        );
        assert.match(
            typeof hover?.contents === "object" && "value" in hover.contents ? hover.contents.value : "",
            /gamemaker\.io/
        );
        assert.match(
            typeof hover?.contents === "object" && "value" in hover.contents ? hover.contents.value : "",
            /monthly\/en\/#t=/
        );

        // Hover Case-insensitive
        const hoverUpper = await semanticIndex.hover(document, 0, "SHOW_DEBUG_MESSAGE");
        assert.ok(hoverUpper, "Should return hover result for SHOW_DEBUG_MESSAGE case-insensitively");

        // Built-in literal type regression test
        const hoverUndefined = await semanticIndex.hover(document, 0, "undefined");
        assert.ok(hoverUndefined);
        const undefinedHoverText =
            typeof hoverUndefined?.contents === "object" && "value" in hoverUndefined.contents
                ? hoverUndefined.contents.value
                : "";
        assert.match(undefinedHoverText, /Built-in literal/);

        // Built-in keyword type regression test
        const hoverVar = await semanticIndex.hover(document, 0, "var");
        assert.ok(hoverVar);
        const varHoverText =
            typeof hoverVar?.contents === "object" && "value" in hoverVar.contents ? hoverVar.contents.value : "";
        assert.match(varHoverText, /Built-in keyword/);
    } finally {
        await proj.cleanup();
    }
});

void test("LSP: custom FsFacade resolves open document when physical file is missing from disk", async () => {
    const proj = await createProject("MissingDiskFileTest");
    try {
        const store = Lsp.createGmlDocumentStore();
        const missingDiskScriptPath = path.join(proj.projectRoot, "scripts/missing/missing.gml");
        const document = store.open({
            uri: Lsp.filePathToUri(missingDiskScriptPath),
            languageId: "gml",
            version: 1,
            text: "function missing_physical_file_func() {}"
        });

        const semanticIndex = Lsp.createGmlSemanticIndex(store);
        const state = await semanticIndex.buildForDocument(document);
        assert.ok(state, "Should resolve navigation state even if file is missing on disk");
    } finally {
        await proj.cleanup();
    }
});

void test("LSP: project cache uses Map-based cache to avoid eviction on multi-root projects", async () => {
    const proj1 = await createProject("MultiRootProj1");
    const proj2 = await createProject("MultiRootProj2");
    try {
        const store = Lsp.createGmlDocumentStore();
        const doc1 = store.open({
            uri: Lsp.filePathToUri(proj1.scriptPath),
            languageId: "gml",
            version: 1,
            text: "function main() {}"
        });
        const doc2 = store.open({
            uri: Lsp.filePathToUri(proj2.scriptPath),
            languageId: "gml",
            version: 1,
            text: "function main() {}"
        });

        const semanticIndex = Lsp.createGmlSemanticIndex(store);

        // Build both projects
        const state1 = await semanticIndex.buildForDocument(doc1);
        const state2 = await semanticIndex.buildForDocument(doc2);

        assert.ok(state1);
        assert.ok(state2);
        assert.notEqual(state1.projectRoot, state2.projectRoot);

        // Query again, should hit the Map cache without rebuilding
        const state1Cached = await semanticIndex.buildForDocument(doc1);
        assert.equal(state1Cached, state1, "Should reuse the cached state for project 1");
    } finally {
        await proj1.cleanup();
        await proj2.cleanup();
    }
});

void test("LSP: server handlers return correct folding ranges and selection ranges", async () => {
    const mockConnection: any = {
        onInitialize: (fn: any) => {
            mockConnection.initialize = fn;
        },
        onInitialized: () => {},
        onDidOpenTextDocument: () => {},
        onDidChangeTextDocument: () => {},
        onDidSaveTextDocument: () => {},
        onDidCloseTextDocument: () => {},
        onDocumentFormatting: () => {},
        onDefinition: () => {},
        onReferences: () => {},
        onDocumentSymbol: () => {},
        onWorkspaceSymbol: () => {},
        onHover: () => {},
        onPrepareRename: () => {},
        onRenameRequest: () => {},
        onCompletion: () => {},
        onCodeAction: (fn: any) => {
            mockConnection.codeAction = fn;
        },
        onDocumentHighlight: (fn: any) => {
            mockConnection.documentHighlight = fn;
        },
        onFoldingRanges: (fn: any) => {
            mockConnection.foldingRanges = fn;
        },
        onSelectionRanges: (fn: any) => {
            mockConnection.selectionRanges = fn;
        },
        languages: {
            semanticTokens: {
                on: (fn: any) => {
                    mockConnection.semanticTokens = fn;
                }
            }
        },
        console: { warn: () => {} },
        client: { register: async () => {} }
    };

    const server = Lsp.createGmlLanguageServer(mockConnection);
    const docStore = server.documents;

    const initializeResult = mockConnection.initialize();
    assert.deepEqual(initializeResult.capabilities.semanticTokensProvider, {
        legend: Lsp.GML_SEMANTIC_TOKEN_LEGEND,
        full: true
    });
    assert.ok(mockConnection.semanticTokens, "Should register semantic token handler");

    const uri = Lsp.filePathToUri("/tmp/test-file.gml");
    docStore.open({
        uri,
        languageId: "gml",
        version: 1,
        text: "#region main\nfunction main() {\n    return 0;\n}\n#endregion\n"
    });

    // 1. Test folding ranges
    assert.ok(mockConnection.foldingRanges, "Should register folding range handler");
    const folding = mockConnection.foldingRanges({ textDocument: { uri } });
    assert.ok(folding.length >= 2, "Should find at least region and brace folding");

    const regionFold = folding.find((f: any) => f.startLine === 0 && f.endLine === 4);
    assert.ok(regionFold);

    const braceFold = folding.find((f: any) => f.startLine === 1 && f.endLine === 3);
    assert.ok(braceFold);

    // 2. Test selection ranges
    assert.ok(mockConnection.selectionRanges, "Should register selection range handler");
    const selections = mockConnection.selectionRanges({
        textDocument: { uri },
        positions: [{ line: 2, character: 4 }]
    });
    assert.equal(selections.length, 1);
    assert.ok(selections[0].range);
    assert.deepEqual(selections[0].range.start, { line: 2, character: 4 });

    // 3. Test code actions (quick fixes)
    assert.ok(mockConnection.codeAction, "Should register code action handler");
    const diagnosticWithFix = {
        range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 10 }
        },
        message: "Normalize doc-comment markers",
        severity: 2,
        code: "normalize-doc-comment-tags",
        source: "gmloop-lint",
        data: {
            fix: {
                range: [15, 25],
                text: "fixedText"
            }
        }
    };

    const actions = await mockConnection.codeAction({
        textDocument: { uri },
        context: {
            diagnostics: [diagnosticWithFix]
        }
    });

    assert.ok(Array.isArray(actions), "Code actions response should be an array");
    const localFix = actions.find((a: any) => a.title.startsWith("Fix this:"));
    assert.ok(localFix, "Should generate a targeted local quick fix");
    assert.ok(localFix.edit, "Local fix should contain a workspace edit");
});

void test("LSP: server defaults to stdio connection transport explicitly", () => {
    const server = Lsp.createGmlLanguageServer();
    assert.ok(server.connection, "Should successfully create connection with default parameters");
});
