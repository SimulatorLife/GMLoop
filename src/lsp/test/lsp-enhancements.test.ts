import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { type GmlLanguageServerConnectionContract, Lsp } from "@gmloop/lsp";
import { type CodeAction, type Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node.js";

const TEST_REQUEST_SIGNAL = new AbortController().signal;

function bindTestRequestSignal<Arguments extends unknown[], Result>(
    request: (...arguments_: [...Arguments, AbortSignal]) => Promise<Result>
): (...arguments_: Arguments) => Promise<Result> {
    return (...arguments_) => request(...arguments_, TEST_REQUEST_SIGNAL);
}

function createTestSemanticIndex(...parameters: Parameters<typeof Lsp.createGmlSemanticIndex>) {
    const semanticIndex = Lsp.createGmlSemanticIndex(...parameters);
    return Object.freeze({
        ...semanticIndex,
        findDefinition: bindTestRequestSignal(semanticIndex.findDefinition),
        findDocumentReferences: bindTestRequestSignal(semanticIndex.findDocumentReferences),
        findReferences: bindTestRequestSignal(semanticIndex.findReferences),
        hover: bindTestRequestSignal(semanticIndex.hover),
        listDocumentSymbols: bindTestRequestSignal(semanticIndex.listDocumentSymbols),
        listSemanticHighlights: bindTestRequestSignal(semanticIndex.listSemanticHighlights),
        planRename: bindTestRequestSignal(semanticIndex.planRename),
        prepareRename: bindTestRequestSignal(semanticIndex.prepareRename),
        searchCompletions: bindTestRequestSignal(semanticIndex.searchCompletions),
        searchWorkspaceSymbols: bindTestRequestSignal(semanticIndex.searchWorkspaceSymbols)
    });
}

async function createProject(
    projectName: string,
    scriptName = "main"
): Promise<{
    cleanup(): Promise<void>;
    projectRoot: string;
    scriptPath: string;
}> {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), `gmloop-lsp-test-${projectName}-`));
    const scriptPath = path.join(projectRoot, `scripts/${scriptName}/${scriptName}.gml`);
    const scriptText = "function main() {\n    return 0;\n}";

    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(
        path.join(projectRoot, `${projectName}.yyp`),
        JSON.stringify({ name: projectName, resourceType: "GMProject" })
    );
    await fs.writeFile(
        path.join(projectRoot, `scripts/${scriptName}/${scriptName}.yy`),
        JSON.stringify({ name: scriptName, resourceType: "GMScript" })
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

        const semanticIndex = createTestSemanticIndex(store);

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

void test("LSP: runtime built-ins hover while language keywords do not", async () => {
    const proj = await createProject("BuiltInsTest");
    try {
        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(proj.scriptPath),
            languageId: "gml",
            version: 1,
            text: [
                "enum eAIState { idle = 0, attack_target }",
                "enum eFallbackState { idle = 99 }",
                "function BuiltInHoverTest() constructor {",
                "    var instanceSprite = sprite_index;",
                "    var missingValue = undefined;",
                "    var currentState = eAIState.attack_target;",
                "    if (visible) { repeat (1) {} } else {}",
                "}",
                "show_debug_message('hello');",
                "ds_priority_create();"
            ].join("\n")
        });

        const semanticIndex = createTestSemanticIndex(store);
        await semanticIndex.buildForDocument(document);

        // Completions
        const completions = await semanticIndex.searchCompletions(document, "show_debug");
        assert.ok(
            completions.some((c) => c.label === "show_debug_message"),
            "Should find show_debug_message in completions"
        );

        // Hover
        const showDebugOffset = document.sourceText.indexOf("show_debug_message");
        const hover = await semanticIndex.hover(document, showDebugOffset, "show_debug_message");
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

        for (const [offset, identifierName] of [
            [document.sourceText.indexOf("eAIState"), "eAIState"],
            [document.sourceText.indexOf("idle"), "idle"],
            [document.sourceText.lastIndexOf("attack_target"), "attack_target"]
        ] as const) {
            const enumHover = await semanticIndex.hover(document, offset, identifierName);
            const enumHoverText =
                typeof enumHover?.contents === "object" && "value" in enumHover.contents
                    ? enumHover.contents.value
                    : "";

            assert.match(enumHoverText, /enum eAIState \{/u);
            assert.match(enumHoverText, /idle = 0/u);
            assert.match(enumHoverText, /attack_target = 1/u);
            assert.doesNotMatch(enumHoverText, /enum eFallbackState/u);
            assert.doesNotMatch(enumHoverText, /idle = 99/u);
        }

        const priorityCreateOffset = document.sourceText.indexOf("ds_priority_create");
        const priorityCreateHover = await semanticIndex.hover(document, priorityCreateOffset, "ds_priority_create");
        const priorityCreateHoverText =
            typeof priorityCreateHover?.contents === "object" && "value" in priorityCreateHover.contents
                ? priorityCreateHover.contents.value
                : "";
        assert.match(priorityCreateHoverText, /ds_priority_create\(\)/u);
        assert.match(priorityCreateHoverText, /Built-in function/u);
        assert.match(priorityCreateHoverText, /creates a new priority queue/u);
        assert.match(priorityCreateHoverText, /Returns.*DS Priority/su);

        const hoverUndefined = await semanticIndex.hover(
            document,
            document.sourceText.indexOf("undefined"),
            "undefined"
        );
        assert.ok(hoverUndefined);
        const undefinedHoverText =
            typeof hoverUndefined?.contents === "object" && "value" in hoverUndefined.contents
                ? hoverUndefined.contents.value
                : "";
        assert.match(undefinedHoverText, /Built-in literal/);

        for (const keyword of ["function", "var", "constructor", "if", "else", "repeat"]) {
            const keywordOffset = document.sourceText.indexOf(keyword);
            assert.notEqual(keywordOffset, -1);
            assert.equal(await semanticIndex.hover(document, keywordOffset, keyword), null);
        }

        for (const property of ["sprite_index", "visible"]) {
            const propertyOffset = document.sourceText.indexOf(property);
            const propertyHover = await semanticIndex.hover(document, propertyOffset, property);
            const propertyHoverText =
                typeof propertyHover?.contents === "object" && "value" in propertyHover.contents
                    ? propertyHover.contents.value
                    : "";
            assert.match(propertyHoverText, /Built-in symbol/u);
            assert.match(propertyHoverText, /Open GameMaker Manual Page/u);
        }
    } finally {
        await proj.cleanup();
    }
});

void test("LSP: enum hover renders commented members on declarations and qualified uses", async () => {
    const proj = await createProject("CommentedEnumHoverTest");
    try {
        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(proj.scriptPath),
            languageId: "gml",
            version: 1,
            text: [
                "function ActorSoundManager() constructor {",
                "    enum eSoundAction {",
                "        interacting, // interacting with something",
                "        damage, // took damage",
                "        death, // dying",
                "        num // should always be last",
                "    }",
                "    var currentAction = eSoundAction.interacting;",
                "}"
            ].join("\n")
        });
        const semanticIndex = createTestSemanticIndex(store);
        await semanticIndex.buildForDocument(document);

        for (const [offset, identifierName] of [
            [document.sourceText.indexOf("eSoundAction"), "eSoundAction"],
            [document.sourceText.indexOf("interacting"), "interacting"],
            [document.sourceText.lastIndexOf("interacting"), "interacting"]
        ] as const) {
            const hover = await semanticIndex.hover(document, offset, identifierName);
            const hoverText =
                typeof hover?.contents === "object" && "value" in hover.contents ? hover.contents.value : "";

            assert.match(hoverText, /enum eSoundAction \{/u);
            assert.match(hoverText, /interacting = 0/u);
            assert.match(hoverText, /damage = 1/u);
            assert.match(hoverText, /death = 2/u);
            assert.match(hoverText, /num = 3/u);
        }
    } finally {
        await proj.cleanup();
    }
});

void test("LSP: static sound helper exposes complete hover and highlighting facts", async () => {
    const proj = await createProject("SoundHelperTest", "ActorSoundManager");
    const sourceText = [
        "/// @desc Handles playing sounds associated with certain actions.",
        "function ActorSoundManager() : Object() constructor {",
        "    sounds = {};",
        "    /// @desc Add possible options for sound effects to play for the given sound action",
        "    /// @param {enum} sound_action",
        "    /// @returns {undefined}",
        "    static add_sounds = function (sound_action) {",
        "        var sound_list = struct_get(sounds, sound_action);",
        "        if (is_undefined(sound_list)) {",
        "            sound_list = new ArrayList();",
        "            struct_set(sounds, sound_action, sound_list);",
        "        }",
        "        var i = 1;",
        "        repeat (argument_count - 1) {",
        "            sound_list.push(argument[i++]);",
        "        }",
        "    };",
        "}",
        ""
    ].join("\n");
    try {
        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(proj.scriptPath),
            languageId: "gml",
            version: 1,
            text: sourceText
        });
        const semanticIndex = createTestSemanticIndex(store);
        await semanticIndex.buildForDocument(document);

        const hoverText = async (name: string) => {
            const implementationStart = sourceText.indexOf("static add_sounds");
            const hover = await semanticIndex.hover(document, sourceText.indexOf(name, implementationStart), name);
            return typeof hover?.contents === "object" && "value" in hover.contents ? hover.contents.value : "";
        };
        const addSoundsHoverText = await hoverText("add_sounds");
        assert.match(addSoundsHoverText, /Add possible options for sound effects to play for the given sound action/u);
        assert.match(addSoundsHoverText, /Parameters:.*sound_action.*enum/su);
        assert.match(addSoundsHoverText, /Returns.*undefined/su);
        assert.doesNotMatch(addSoundsHoverText, /structVariable/u);

        const constructorHover = await semanticIndex.hover(
            document,
            sourceText.indexOf("ActorSoundManager"),
            "ActorSoundManager"
        );
        const constructorHoverText =
            typeof constructorHover?.contents === "object" && "value" in constructorHover.contents
                ? constructorHover.contents.value
                : "";
        assert.ok(constructorHover, "expected constructor declaration hover");
        assert.match(constructorHoverText, /ActorSoundManager/u);
        assert.match(constructorHoverText, /struct/u);
        assert.match(constructorHoverText, /Handles playing sounds associated with certain actions/u);
        assert.match(constructorHoverText, /scripts\/ActorSoundManager\/ActorSoundManager\.gml/u);
        const soundsUseOffset = sourceText.indexOf("sounds", sourceText.indexOf("struct_set("));
        const soundsReferences = await semanticIndex.findReferences(document, soundsUseOffset, "sounds", true);
        assert.ok(soundsReferences.length >= 2, "expected constructor field definition and references");
        const soundsHover = await semanticIndex.hover(document, soundsUseOffset, "sounds");
        const soundsHoverText =
            typeof soundsHover?.contents === "object" && "value" in soundsHover.contents
                ? soundsHover.contents.value
                : "";
        const upgradedState = await semanticIndex.buildForDocument(document);
        assert.equal(upgradedState?.lightweight, false);
        const localSoundsOccurrences = await semanticIndex.findDocumentReferences(document, soundsUseOffset, "sounds");
        assert.ok(localSoundsOccurrences.length >= 2, "expected Tier 1 queries to contain local sounds occurrences");
        const soundsDefinition = await semanticIndex.findDefinition(document, soundsUseOffset, "sounds");
        assert.equal(soundsDefinition?.uri, document.uri);
        assert.deepEqual(soundsDefinition?.range.start, { line: 2, character: 4 });
        assert.match(soundsHoverText, /sounds/u);
        assert.match(soundsHoverText, /instanceVariable/u);
        assert.match(soundsHoverText, /scripts\/ActorSoundManager\/ActorSoundManager\.gml/u);
        assert.match(await hoverText("sound_action"), /parameter/u);
        assert.match(await hoverText("sound_list"), /localVariable/u);
        for (const builtIn of ["struct_get", "is_undefined"]) {
            const text = await hoverText(builtIn);
            assert.match(text, /Built-in function/u);
            assert.match(text, /Open GameMaker Manual Page/u);
        }

        const highlights = await semanticIndex.listSemanticHighlights(document);
        const kindsFor = (name: string) =>
            highlights
                .filter((highlight) => sourceText.slice(highlight.start, highlight.end) === name)
                .map((highlight) => highlight.kind);
        assert.deepEqual(kindsFor("sound_action"), ["parameter", "parameter", "parameter"]);
        assert.deepEqual(kindsFor("sound_list"), ["variable", "variable", "variable", "variable", "variable"]);
        assert.deepEqual(kindsFor("sounds"), ["property", "property", "property"]);
        assert.deepEqual(kindsFor("struct_get"), ["function"]);
        assert.deepEqual(kindsFor("is_undefined"), ["function"]);
        assert.deepEqual(kindsFor("push"), ["method"]);
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

        const semanticIndex = createTestSemanticIndex(store);
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

        const semanticIndex = createTestSemanticIndex(store);

        // Build both projects
        const state1 = await semanticIndex.buildForDocument(doc1);
        const state2 = await semanticIndex.buildForDocument(doc2);

        assert.ok(state1);
        assert.ok(state2);
        assert.equal(Object.isFrozen(state1), true, "Published semantic navigation states must be immutable");
        assert.equal(Object.isFrozen(state2), true, "Published semantic navigation states must be immutable");
        assert.notEqual(state1.projectRoot, state2.projectRoot);

        // A background Tier 2 publication replaces, rather than mutates, the
        // request-visible Tier 1 record. This keeps the first request pinned
        // to the facts it acquired even when another project finishes first.
        let state1Upgraded = state1;
        for (let attempt = 0; attempt < 20 && state1Upgraded.lightweight; attempt += 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 25));
            state1Upgraded = await semanticIndex.buildForDocument(doc1);
        }
        assert.ok(state1Upgraded);
        assert.equal(state1.lightweight, true, "The original Tier 1 record must remain unchanged");
        assert.equal(state1Upgraded.lightweight, false, "The replacement record must expose Tier 2 facts");
        assert.notEqual(state1Upgraded, state1, "Tier publication must replace the immutable cache record");
    } finally {
        await proj1.cleanup();
        await proj2.cleanup();
    }
});

void test("LSP: server handlers expose standard ranges and lint code actions", async () => {
    // The mock connection is typed against the GML language server's
    // shared connection contract, not against the concrete `Connection`
    // class returned by `vscode-languageserver`. This is the polymorphism
    // guardrail in action: a slim mock that exposes only the methods the
    // server actually invokes is structurally valid and types-check
    // without resorting to `any` or runtime feature probes scattered
    // across the server module.
    //
    // Handlers registered by the server (initialize, foldingRanges,
    // selectionRanges, codeAction, semanticTokens, documentHighlight)
    // are stored in a separate `registered` bag so the mock itself stays
    // structurally clean. The test reads them out via `registered.*`,
    // which makes the storage contract explicit instead of piggy-backing
    // on the connection object.
    type RegisteredHandlers = {
        codeAction: Parameters<GmlLanguageServerConnectionContract["onCodeAction"]>[0];
        documentHighlight: Parameters<GmlLanguageServerConnectionContract["onDocumentHighlight"]>[0];
        foldingRanges: Parameters<GmlLanguageServerConnectionContract["onFoldingRanges"]>[0];
        initialize: Parameters<GmlLanguageServerConnectionContract["onInitialize"]>[0];
        selectionRanges: Parameters<GmlLanguageServerConnectionContract["onSelectionRanges"]>[0];
        semanticTokens: Parameters<GmlLanguageServerConnectionContract["languages"]["semanticTokens"]["on"]>[0];
    };
    const registered: Partial<RegisteredHandlers> = {};
    const capture =
        <Key extends keyof RegisteredHandlers>(key: Key) =>
        (handler: RegisteredHandlers[Key]) => {
            registered[key] = handler;
        };
    const mockConnection: GmlLanguageServerConnectionContract = {
        onInitialize: capture("initialize"),
        onInitialized: () => {},
        onDidOpenTextDocument: () => {},
        onDidChangeTextDocument: () => {},
        onDidSaveTextDocument: () => {},
        onDidCloseTextDocument: () => {},
        onDidChangeWatchedFiles: () => {},
        onDocumentFormatting: () => {},
        onDefinition: () => {},
        onReferences: () => {},
        onDocumentSymbol: () => {},
        onWorkspaceSymbol: () => {},
        onHover: () => {},
        onPrepareRename: () => {},
        onRenameRequest: () => {},
        onCompletion: () => {},
        onCodeAction: capture("codeAction"),
        onDocumentHighlight: capture("documentHighlight"),
        onFoldingRanges: capture("foldingRanges"),
        onSelectionRanges: capture("selectionRanges"),
        languages: {
            semanticTokens: {
                on: capture("semanticTokens")
            }
        },
        console: { warn: () => {} },
        client: { register: async () => undefined },
        listen: () => {},
        sendDiagnostics: () => undefined,
        sendRequest: () => undefined,
        workspace: { getWorkspaceFolders: async () => null }
    };

    const server = Lsp.createGmlLanguageServer(mockConnection);
    const docStore = server.documents;

    const initializeResult = registered.initialize?.({
        processId: null,
        rootUri: null,
        capabilities: {},
        trace: "off",
        workspaceFolders: null,
        initializationOptions: undefined,
        clientInfo: undefined,
        locale: undefined
    });
    assert.ok(initializeResult);
    assert.deepEqual(initializeResult.capabilities.semanticTokensProvider, {
        legend: Lsp.GML_SEMANTIC_TOKEN_LEGEND,
        full: true
    });
    assert.deepEqual(initializeResult.capabilities.codeActionProvider, {
        codeActionKinds: ["quickfix", "source.fixAll"]
    });
    assert.ok(registered.semanticTokens, "Should register semantic token handler");

    const uri = Lsp.filePathToUri("/tmp/test-file.gml");
    docStore.open({
        uri,
        languageId: "gml",
        version: 1,
        text: "#region main\nfunction main() {\n    return 0;\n}\n#endregion\n"
    });

    // 1. Test folding ranges
    assert.ok(registered.foldingRanges, "Should register folding range handler");
    const folding = (registered.foldingRanges({ textDocument: { uri } }) ?? []) as Array<{
        endLine: number;
        startLine: number;
    }>;
    assert.ok(folding.length >= 2, "Should find at least region and brace folding");

    const regionFold = folding.find((f) => f.startLine === 0 && f.endLine === 4);
    assert.ok(regionFold);

    const braceFold = folding.find((f) => f.startLine === 1 && f.endLine === 3);
    assert.ok(braceFold);

    // 2. Test selection ranges
    assert.ok(registered.selectionRanges, "Should register selection range handler");
    const selections = (registered.selectionRanges({ textDocument: { uri }, positions: [{ line: 2, character: 4 }] }) ??
        []) as Array<{ range: { start: { character: number; line: number } } }>;
    assert.equal(selections.length, 1);
    assert.ok(selections[0].range);
    assert.deepEqual(selections[0].range.start, { line: 2, character: 4 });

    // 3. Test standard lint code actions.
    assert.ok(registered.codeAction, "Should register code action handler");
    const codeActionPath = path.resolve("tmp/lsp-code-action.gml");
    const codeActionUri = Lsp.filePathToUri(codeActionPath);
    const codeActionSource = 'var total = real("5");\n';
    docStore.open({
        uri: codeActionUri,
        languageId: "gml",
        version: 1,
        text: codeActionSource
    });
    const lintDiagnostic: Diagnostic = {
        range: {
            start: { line: 0, character: 12 },
            end: { line: 0, character: 21 }
        },
        message: "simplifyRealCalls diagnostic.",
        severity: DiagnosticSeverity.Error,
        code: "gml/simplify-real-calls",
        source: "gmloop-lint"
    };

    const actions: CodeAction[] =
        (await registered.codeAction?.(
            {
                textDocument: { uri: codeActionUri },
                range: lintDiagnostic.range,
                context: {
                    diagnostics: [lintDiagnostic],
                    only: ["quickfix"]
                }
            },
            undefined
        )) ?? [];

    assert.equal(actions.length, 1);
    const [localFix] = actions;
    assert.equal(localFix?.kind, "quickfix");
    const localChanges = localFix?.edit?.changes;
    assert.ok(localChanges, "Local fix should contain a workspace edit");
    assert.deepEqual(Object.keys(localChanges), [codeActionUri]);
    assert.deepEqual(localChanges[codeActionUri], [
        {
            range: lintDiagnostic.range,
            newText: "5"
        }
    ]);

    const fixAllActions: CodeAction[] =
        (await registered.codeAction?.(
            {
                textDocument: { uri: codeActionUri },
                range: lintDiagnostic.range,
                context: {
                    diagnostics: [],
                    only: ["source.fixAll"]
                }
            },
            undefined
        )) ?? [];
    assert.equal(fixAllActions.length, 1, "source.fixAll must work without client-supplied diagnostics");
    const [fixAll] = fixAllActions;
    assert.equal(fixAll?.kind, "source.fixAll");
    const fixAllChanges = fixAll?.edit?.changes;
    assert.ok(fixAllChanges);
    assert.deepEqual(Object.keys(fixAllChanges), [codeActionUri]);
    assert.equal(fixAllChanges[codeActionUri]?.[0]?.newText, "var total = 5;\n");

    const forgedDiagnosticActions: CodeAction[] =
        (await registered.codeAction?.(
            {
                textDocument: { uri: codeActionUri },
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 1 }
                },
                context: {
                    diagnostics: [
                        {
                            ...lintDiagnostic,
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 1 }
                            },
                            data: {
                                fix: {
                                    range: [0, codeActionSource.length],
                                    text: "unsafe_client_supplied_edit();",
                                    uri: Lsp.filePathToUri(path.resolve("tmp/other-file.gml"))
                                }
                            }
                        }
                    ],
                    only: ["quickfix"]
                }
            },
            undefined
        )) ?? [];
    assert.deepEqual(
        forgedDiagnosticActions,
        [],
        "Client-provided fix payloads and non-matching ranges must never create local or cross-file edits"
    );

    const unsafeActionPath = path.resolve("tmp/lsp-unsafe-code-action.gml");
    const unsafeActionUri = Lsp.filePathToUri(unsafeActionPath);
    const unsafeDiagnostic: Diagnostic = {
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 }
        },
        message: "noGlobalvar diagnostic.",
        severity: DiagnosticSeverity.Error,
        code: "gml/no-globalvar",
        source: "gmloop-lint"
    };
    docStore.open({
        uri: unsafeActionUri,
        languageId: "gml",
        version: 1,
        text: "globalvar score;\n"
    });
    const unsafeQuickFixes: CodeAction[] =
        (await registered.codeAction?.(
            {
                textDocument: { uri: unsafeActionUri },
                range: unsafeDiagnostic.range,
                context: {
                    diagnostics: [unsafeDiagnostic],
                    only: ["quickfix"]
                }
            },
            undefined
        )) ?? [];
    const unsafeFixAllActions: CodeAction[] =
        (await registered.codeAction?.(
            {
                textDocument: { uri: unsafeActionUri },
                range: unsafeDiagnostic.range,
                context: {
                    diagnostics: [unsafeDiagnostic],
                    only: ["source.fixAll"]
                }
            },
            undefined
        )) ?? [];
    assert.deepEqual(unsafeQuickFixes, [], "Report-only lint diagnostics must not expose a quick fix");
    assert.deepEqual(unsafeFixAllActions, [], "Report-only project-aware migrations must not enter source.fixAll");
});

void test("LSP: server defaults to stdio connection transport explicitly", () => {
    const server = Lsp.createGmlLanguageServer();
    assert.ok(server.connection, "Should successfully create connection with default parameters");
});
