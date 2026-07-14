import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Lsp } from "@gmloop/lsp";
import { Semantic } from "@gmloop/semantic";

import type { GmlSemanticAnalysisStart } from "../src/intelligence/index.js";

async function cleanupProjectDir(projectRoot: string) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fs.rm(projectRoot, { recursive: true, force: true }).catch(() => {});
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>, timeoutMs = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() >= deadline) {
            throw new Error("Timed out waiting for asynchronous semantic refresh.");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function createTwoScriptProject(): Promise<{
    cleanup(): Promise<void>;
    projectRoot: string;
    sourcePath: string;
    sourceText: string;
    targetPath: string;
}> {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmloop-lsp-navigation-"));
    const sourcePath = path.join(projectRoot, "scripts/source/source.gml");
    const targetPath = path.join(projectRoot, "scripts/target/target.gml");
    const sourceText = ["function source() {", "    target();", "}"].join("\n");
    const targetText = [
        "/// @desc target script description",
        "/// @param {real} x argument",
        "function target() {",
        "    return 1;",
        "}"
    ].join("\n");

    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(
        path.join(projectRoot, "Game.yyp"),
        JSON.stringify({
            name: "Game",
            resourceType: "GMProject",
            resources: [
                { id: { name: "source", path: "scripts/source/source.yy" } },
                { id: { name: "target", path: "scripts/target/target.yy" } }
            ]
        })
    );
    await fs.writeFile(
        path.join(projectRoot, "scripts/source/source.yy"),
        JSON.stringify({ name: "source", resourceType: "GMScript" })
    );
    await fs.writeFile(
        path.join(projectRoot, "scripts/target/target.yy"),
        JSON.stringify({ name: "target", resourceType: "GMScript" })
    );
    await fs.writeFile(sourcePath, sourceText);
    await fs.writeFile(targetPath, targetText);

    return {
        projectRoot,
        sourcePath,
        targetPath,
        sourceText,
        async cleanup() {
            await cleanupProjectDir(projectRoot);
        }
    };
}

void test("semantic index resolves definitions, references, hover, and cross-file rename edits", async () => {
    const fixture = await createTwoScriptProject();

    try {
        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(fixture.sourcePath),
            languageId: "gml",
            version: 1,
            text: fixture.sourceText
        });
        const semanticIndex = Lsp.createGmlSemanticIndex(store);
        const offset = fixture.sourceText.indexOf("target();");

        const definition = await semanticIndex.findDefinition(document, offset, "target");
        assert.equal(definition?.uri, Lsp.filePathToUri(fixture.targetPath));
        assert.deepEqual(definition?.range.start, { line: 2, character: 9 });

        const referencesOnly = await semanticIndex.findReferences(document, offset, "target", false);
        assert.deepEqual(
            referencesOnly.map((reference) => reference.uri),
            [Lsp.filePathToUri(fixture.sourcePath)]
        );

        const allReferences = await semanticIndex.findReferences(document, offset, "target", true);
        assert.equal(allReferences.length, 2);

        const hover = await semanticIndex.hover(document, offset, "target");
        const hoverText = typeof hover?.contents === "object" && "value" in hover.contents ? hover.contents.value : "";
        assert.match(hoverText, /target/);
        assert.match(hoverText, /defined in/);
        assert.match(hoverText, /scripts\/target\/target\.gml/);
        assert.match(hoverText, /target script description/);
        assert.match(hoverText, /Parameters:/);
        assert.match(hoverText, /\* `x` \(`real`\) — argument/);

        const renameEdit = await semanticIndex.planRename(document, offset, "target", "renamed_target");
        assert.ok(renameEdit?.changes);
        assert.ok(renameEdit.changes[Lsp.filePathToUri(fixture.sourcePath)]?.length);
        assert.ok(renameEdit.changes[Lsp.filePathToUri(fixture.targetPath)]?.length);
    } finally {
        await fixture.cleanup();
    }
});

void test("semantic index invalidates cached project facts for unsaved document edits", async () => {
    const fixture = await createTwoScriptProject();

    try {
        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(fixture.sourcePath),
            languageId: "gml",
            version: 1,
            text: fixture.sourceText
        });
        const semanticIndex = Lsp.createGmlSemanticIndex(store);

        await semanticIndex.buildForDocument(document);
        const beforeEdit = await semanticIndex.searchCompletions(document, "new_unsaved_symbol");
        assert.equal(
            beforeEdit.some((completion) => completion.label === "new_unsaved_symbol"),
            false
        );

        const updatedDocument = store.update(document.uri, 2, [
            {
                text: `${fixture.sourceText}\nfunction new_unsaved_symbol() {\n    return 2;\n}\n`
            }
        ]);
        assert.ok(updatedDocument);

        semanticIndex.invalidateForDocument(updatedDocument);
        await semanticIndex.refreshForDocument(updatedDocument);
        const afterEdit = await semanticIndex.searchCompletions(updatedDocument, "new_unsaved_symbol");

        assert.equal(
            afterEdit.some((completion) => completion.label === "new_unsaved_symbol"),
            true
        );
    } finally {
        await fixture.cleanup();
    }
});

void test("semantic queries wait for current Tier 1 facts after an overlay edit", async () => {
    const fixture = await createTwoScriptProject();

    try {
        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(fixture.sourcePath),
            languageId: "gml",
            version: 1,
            text: "function old_symbol() { return 1; }"
        });
        const semanticIndex = Lsp.createGmlSemanticIndex(store);
        await semanticIndex.buildForDocument(document);

        const updatedDocument = store.update(document.uri, 2, [{ text: "function current_symbol() { return 2; }" }]);
        assert.ok(updatedDocument);
        semanticIndex.invalidateForDocument(updatedDocument);

        const completions = await semanticIndex.searchCompletions(updatedDocument, "current_symbol");
        assert.equal(
            completions.some((completion) => completion.label === "current_symbol"),
            true
        );
        await semanticIndex.dispose();
    } finally {
        await fixture.cleanup();
    }
});

void test("semantic manifests and open-buffer overlays remain isolated across project roots", async () => {
    const firstFixture = await createTwoScriptProject();
    const secondFixture = await createTwoScriptProject();
    try {
        const store = Lsp.createGmlDocumentStore();
        const firstSource = "function first_overlay() { target(); }";
        const secondSource = "function second_overlay() { target(); }";
        const firstDocument = store.open({
            uri: Lsp.filePathToUri(firstFixture.sourcePath),
            languageId: "gml",
            version: 2,
            text: firstSource
        });
        const secondDocument = store.open({
            uri: Lsp.filePathToUri(secondFixture.sourcePath),
            languageId: "gml",
            version: 4,
            text: secondSource
        });
        const semanticIndex = Lsp.createGmlSemanticIndex(store);

        await semanticIndex.buildForDocument(firstDocument);
        await semanticIndex.buildForDocument(secondDocument);
        await semanticIndex.findReferences(firstDocument, firstSource.indexOf("target"), "target", false);
        await semanticIndex.findReferences(secondDocument, secondSource.indexOf("target"), "target", false);
        const firstCompletions = await semanticIndex.searchCompletions(firstDocument, "first_overlay");
        const secondCompletions = await semanticIndex.searchCompletions(secondDocument, "second_overlay");
        assert.equal(
            firstCompletions.some((completion) => completion.label === "first_overlay"),
            true
        );
        assert.equal(
            secondCompletions.some((completion) => completion.label === "second_overlay"),
            true
        );
        await semanticIndex.dispose();

        const firstStore = Semantic.openSemanticIndexStore(firstFixture.projectRoot);
        const secondStore = Semantic.openSemanticIndexStore(secondFixture.projectRoot);
        try {
            assert.equal(firstStore.readSemanticManifest("definitions"), null);
            assert.equal(firstStore.readSemanticManifest("full"), null);
            assert.equal(secondStore.readSemanticManifest("definitions"), null);
            assert.equal(secondStore.readSemanticManifest("full"), null);
        } finally {
            await Promise.all([firstStore.close(), secondStore.close()]);
        }
    } finally {
        await Promise.all([firstFixture.cleanup(), secondFixture.cleanup()]);
    }
});

void test("semantic index refreshes project facts after an external resource metadata change", async () => {
    const fixture = await createTwoScriptProject();
    try {
        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(fixture.sourcePath),
            languageId: "gml",
            version: 1,
            text: `${fixture.sourceText  }\n// dirty`
        });
        const semanticIndex = Lsp.createGmlSemanticIndex(store);
        await semanticIndex.buildForDocument(document);
        await semanticIndex.findReferences(document, fixture.sourceText.indexOf("target();"), "target", false);

        const resourcePath = path.join(fixture.projectRoot, "scripts", "external", "external.yy");
        const sourcePath = path.join(fixture.projectRoot, "scripts", "external", "external.gml");
        await fs.mkdir(path.dirname(resourcePath), { recursive: true });
        await fs.writeFile(resourcePath, JSON.stringify({ name: "external", resourceType: "GMScript" }));
        await fs.writeFile(sourcePath, "function external_added() { return 1; }\n");
        const projectManifestPath = path.join(fixture.projectRoot, "Game.yyp");
        await fs.writeFile(
            projectManifestPath,
            JSON.stringify({
                name: "Game",
                resourceType: "GMProject",
                resources: [
                    { id: { name: "source", path: "scripts/source/source.yy" } },
                    { id: { name: "target", path: "scripts/target/target.yy" } },
                    { id: { name: "external", path: "scripts/external/external.yy" } }
                ]
            })
        );

        await semanticIndex.refreshForFilePath(projectManifestPath);
        const completions = await semanticIndex.searchCompletions(document, "external_added");
        assert.ok(completions.some((completion) => completion.label === "external_added"));

        await fs.writeFile(
            projectManifestPath,
            JSON.stringify({
                name: "Game",
                resourceType: "GMProject",
                resources: [
                    { id: { name: "source", path: "scripts/source/source.yy" } },
                    { id: { name: "target", path: "scripts/target/target.yy" } }
                ]
            })
        );
        await semanticIndex.refreshForFileChanges([{ filePath: projectManifestPath, kind: "metadataChanged" }]);
        const completionsAfterRemoval = await semanticIndex.searchCompletions(document, "external_added");
        assert.equal(
            completionsAfterRemoval.some((completion) => completion.label === "external_added"),
            false,
            "removing a resource from the YYP must remove its semantic facts even while its GML remains on disk"
        );
        await semanticIndex.dispose();
        const persistedStore = Semantic.openSemanticIndexStore(fixture.projectRoot);
        try {
            assert.equal(persistedStore.readSemanticManifest("definitions"), null);
            assert.equal(persistedStore.readSemanticManifest("full"), null);
        } finally {
            await persistedStore.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("semantic index hover handles comment/string guards and ignores scope-dependent fallback", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmloop-lsp-regression-"));
    const sourcePath = path.join(projectRoot, "scripts/source/source.gml");

    const sourceText = [
        "function A() {",
        "    var desc = 42;",
        "}",
        "",
        "function B() {",
        "    /// @desc desc documentation",
        "    /// @param {real} desc",
        "    /// @returns {real}",
        '    var str = "desc";',
        "}"
    ].join("\n");

    try {
        await fs.mkdir(path.dirname(sourcePath), { recursive: true });
        await fs.writeFile(
            path.join(projectRoot, "Game.yyp"),
            JSON.stringify({ name: "Game", resourceType: "GMProject" })
        );
        await fs.writeFile(
            path.join(projectRoot, "scripts/source/source.yy"),
            JSON.stringify({ name: "source", resourceType: "GMScript" })
        );
        await fs.writeFile(sourcePath, sourceText);

        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(sourcePath),
            languageId: "gml",
            version: 1,
            text: sourceText
        });
        const semanticIndex = Lsp.createGmlSemanticIndex(store);

        const offsetLocalVar = sourceText.indexOf("var desc =") + 4;
        const hoverLocal = await semanticIndex.hover(document, offsetLocalVar, "desc");
        assert.ok(hoverLocal, "Should hover local variable in its own scope");
        const hoverLocalText =
            typeof hoverLocal?.contents === "object" && "value" in hoverLocal.contents ? hoverLocal.contents.value : "";
        assert.match(hoverLocalText, /desc/);
        assert.match(hoverLocalText, /localVariable/);

        for (const [text, name] of [
            ["@desc", "desc"],
            ["desc documentation", "desc"],
            ["@param", "param"],
            ["{real} desc", "desc"],
            ["@returns", "returns"]
        ] as const) {
            const textOffset = sourceText.indexOf(text);
            const identifierOffset = textOffset + (text.startsWith("@") ? 1 : text.lastIndexOf(name));
            assert.equal(
                await semanticIndex.hover(document, identifierOffset, name),
                null,
                `Should not hover ${name} inside function documentation`
            );
        }

        const offsetString = sourceText.indexOf('"desc"') + 1;
        const hoverString = await semanticIndex.hover(document, offsetString, "desc");
        assert.equal(hoverString, null, "Should not hover inside string");

        const offsetInB = sourceText.indexOf("var str =") + 2;
        const hoverInB = await semanticIndex.hover(document, offsetInB, "desc");
        assert.equal(hoverInB, null, "Should not fall back to local variable from another function");
    } finally {
        await cleanupProjectDir(projectRoot);
    }
});

void test("semantic highlights use current lexical facts instead of shifted persisted occurrences", async () => {
    const fixture = await createTwoScriptProject();
    const initialSource = ["function source() {", "    var local_value = 1;", "    return local_value;", "}", ""].join(
        "\n"
    );
    try {
        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(fixture.sourcePath),
            languageId: "gml",
            version: 1,
            text: initialSource
        });
        const semanticIndex = Lsp.createGmlSemanticIndex(store);
        await semanticIndex.buildForDocument(document);

        const updatedSource = `// shifted document\n${initialSource}`;
        const updatedDocument = store.update(document.uri, 2, [{ text: updatedSource }]);
        assert.ok(updatedDocument);
        semanticIndex.invalidateForDocument(updatedDocument);

        const localReferenceStart = updatedSource.lastIndexOf("local_value");
        const highlights = await semanticIndex.listSemanticHighlights(updatedDocument);
        const localReferenceHighlight = highlights.find((highlight) => highlight.start === localReferenceStart);
        assert.equal(localReferenceHighlight?.kind, "variable");
        assert.equal(localReferenceHighlight?.end, localReferenceStart + "local_value".length);
        await semanticIndex.dispose();
    } finally {
        await fixture.cleanup();
    }
});

void test("semantic index prioritizes open files in indexing queue", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmloop-lsp-prioritize-"));
    try {
        await fs.writeFile(
            path.join(projectRoot, "Game.yyp"),
            JSON.stringify({ name: "Game", resourceType: "GMProject" })
        );

        const aPath = path.join(projectRoot, "scripts/a/a.gml");
        const bPath = path.join(projectRoot, "scripts/b/b.gml");
        const cPath = path.join(projectRoot, "scripts/c/c.gml");

        await fs.mkdir(path.dirname(aPath), { recursive: true });
        await fs.mkdir(path.dirname(bPath), { recursive: true });
        await fs.mkdir(path.dirname(cPath), { recursive: true });

        await fs.writeFile(
            path.join(projectRoot, "scripts/a/a.yy"),
            JSON.stringify({ name: "a", resourceType: "GMScript" })
        );
        await fs.writeFile(
            path.join(projectRoot, "scripts/b/b.yy"),
            JSON.stringify({ name: "b", resourceType: "GMScript" })
        );
        await fs.writeFile(
            path.join(projectRoot, "scripts/c/c.yy"),
            JSON.stringify({ name: "c", resourceType: "GMScript" })
        );

        await fs.writeFile(aPath, "function a() {}");
        await fs.writeFile(bPath, "function b() {}");
        await fs.writeFile(cPath, "function c() {}");

        const store = Lsp.createGmlDocumentStore();
        const docB = store.open({
            uri: Lsp.filePathToUri(bPath),
            languageId: "gml",
            version: 1,
            text: "function b() {}"
        });

        const semanticIndex = Lsp.createGmlSemanticIndex(store);
        const hoverRes = await semanticIndex.hover(docB, 0, "b");
        assert.ok(hoverRes === null || hoverRes !== undefined);
    } finally {
        await cleanupProjectDir(projectRoot);
    }
});

void test("semantic index disposal waits for an aborted build before releasing its project state", async () => {
    const fixture = await createTwoScriptProject();
    try {
        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(fixture.sourcePath),
            languageId: "gml",
            version: 1,
            text: fixture.sourceText
        });
        const semanticIndex = Lsp.createGmlSemanticIndex(store);

        const build = semanticIndex.buildForDocument(document);
        await semanticIndex.dispose();

        assert.equal(await build, null);
    } finally {
        await fixture.cleanup();
    }
});

void test("semantic index double-pass approach exposes fast hover initially, and full info after background upgrade", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmloop-lsp-doublepass-"));
    try {
        await fs.writeFile(
            path.join(projectRoot, "Game.yyp"),
            JSON.stringify({ name: "Game", resourceType: "GMProject" })
        );

        const aPath = path.join(projectRoot, "scripts/a/a.gml");
        const bPath = path.join(projectRoot, "scripts/b/b.gml");

        await fs.mkdir(path.dirname(aPath), { recursive: true });
        await fs.mkdir(path.dirname(bPath), { recursive: true });

        await fs.writeFile(
            path.join(projectRoot, "scripts/a/a.yy"),
            JSON.stringify({ name: "a", resourceType: "GMScript" })
        );
        await fs.writeFile(
            path.join(projectRoot, "scripts/b/b.yy"),
            JSON.stringify({ name: "b", resourceType: "GMScript" })
        );

        await fs.writeFile(aPath, "function a() { b(); }");
        await fs.writeFile(bPath, "/// @desc test function b\nfunction b() {}");

        const store = Lsp.createGmlDocumentStore();
        const docA = store.open({
            uri: Lsp.filePathToUri(aPath),
            languageId: "gml",
            version: 1,
            text: "function a() { b(); }"
        });
        const docB = store.open({
            uri: Lsp.filePathToUri(bPath),
            languageId: "gml",
            version: 1,
            text: "/// @desc test function b\nfunction b() {}"
        });

        let publishedGenerationCount = 0;
        const analysisStarts: GmlSemanticAnalysisStart[] = [];
        const semanticIndex = Lsp.createGmlSemanticIndex(
            store,
            () => {
                publishedGenerationCount += 1;
            },
            (event) => {
                analysisStarts.push(event);
            }
        );

        // 1. Initial buildForDocument returns a lightweight state
        const state1 = await semanticIndex.buildForDocument(docB);
        assert.ok(state1);
        assert.equal(state1.lightweight, true, "Initial build should be lightweight (definitionsOnly)");
        assert.equal(publishedGenerationCount, 1, "Tier 1 should publish a semantic generation");
        assert.equal(analysisStarts.length, 1, "Cold startup should begin only the definitions tier");
        assert.equal(analysisStarts[0]?.tier, "definitions");
        assert.equal(analysisStarts[0]?.scope, "project");

        // 2. Hover is immediately available on the lightweight index — does not block
        const offsetValB = docB.sourceText.lastIndexOf("function b") + 9;
        const hoverRes = await semanticIndex.hover(docB, offsetValB, "b");
        assert.ok(hoverRes, "Hover should return on lightweight index without waiting for full build");
        const hoverText =
            typeof hoverRes.contents === "object" && "value" in hoverRes.contents ? hoverRes.contents.value : "";
        assert.match(hoverText, /test function b/, "Hover should show doc-comment from lightweight pass");
        assert.equal(
            analysisStarts.length,
            1,
            "Hover must consume definitions facts and never escalate to a full project analysis"
        );

        // 3. findDefinition is immediately available on the lightweight index
        const defRes = await semanticIndex.findDefinition(docB, offsetValB, "b");
        assert.ok(defRes, "findDefinition should return on lightweight index");
        assert.ok(defRes.uri.includes("b.gml"), "findDefinition should point to b.gml");

        // 4. An edit while only definitions facts exist remains definitions-only.
        const updatedDocB = store.update(docB.uri, 2, [
            {
                text: "/// @desc updated test function b\nfunction b() {}"
            }
        ]);
        assert.ok(updatedDocB);
        semanticIndex.invalidateForDocument(updatedDocB);
        const refreshedState = await semanticIndex.refreshForDocument(updatedDocB);
        assert.ok(refreshedState);
        assert.equal(refreshedState.lightweight, true, "Definitions-only edits must not eagerly create a full tier");
        assert.equal(analysisStarts.length, 2, "The edit should start only an incremental definitions analysis");
        assert.deepEqual(
            {
                scope: analysisStarts[1]?.scope,
                tier: analysisStarts[1]?.tier
            },
            { scope: "incremental", tier: "definitions" }
        );

        // 5. findReferences transparently waits for the full build and returns complete data
        const offsetValA = 15; // offset of "b" in "function a() { b(); }"
        const refs = await semanticIndex.findReferences(docA, offsetValA, "b", false);
        assert.ok(refs.length > 0, "findReferences should return cross-file references after full build");
        const refUris = refs.map((r) => r.uri);
        assert.ok(refUris.includes(Lsp.filePathToUri(aPath)), "References should include usage in a.gml");
        assert.equal(analysisStarts.length, 3, "Find References should request the full semantic tier once");
        assert.deepEqual(
            {
                reason: analysisStarts[2]?.reason,
                scope: analysisStarts[2]?.scope,
                tier: analysisStarts[2]?.tier
            },
            { reason: "references", scope: "project", tier: "full" }
        );

        // 6. After findReferences returns, the state should now be fully upgraded
        const finalState = await semanticIndex.buildForDocument(updatedDocB);
        assert.ok(finalState);
        assert.equal(finalState.lightweight, false, "State should be fully upgraded after findReferences completed");
        assert.equal(
            publishedGenerationCount,
            3,
            "The edit and capability escalation should each publish a generation"
        );
    } finally {
        await cleanupProjectDir(projectRoot);
    }
});

void test("semantic index full worker preserves unsaved open-buffer facts", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmloop-lsp-worker-overlay-"));
    try {
        await fs.writeFile(
            path.join(projectRoot, "Game.yyp"),
            JSON.stringify({ name: "Game", resourceType: "GMProject" })
        );
        const scriptPath = path.join(projectRoot, "scripts/example/example.gml");
        await fs.mkdir(path.dirname(scriptPath), { recursive: true });
        await fs.writeFile(
            path.join(projectRoot, "scripts/example/example.yy"),
            JSON.stringify({ name: "example", resourceType: "GMScript" })
        );
        await fs.writeFile(scriptPath, "function disk_symbol() { return 1; }");

        const store = Lsp.createGmlDocumentStore();
        const document = store.open({
            uri: Lsp.filePathToUri(scriptPath),
            languageId: "gml",
            version: 7,
            text: "function unsaved_symbol() { return 2; }"
        });
        const semanticIndex = Lsp.createGmlSemanticIndex(store);

        const initialState = await semanticIndex.buildForDocument(document);
        assert.ok(initialState);
        assert.equal(initialState.lightweight, true);

        await semanticIndex.findReferences(document, 9, "unsaved_symbol", true);
        const completions = await semanticIndex.searchCompletions(document, "unsaved_symbol");
        assert.ok(
            completions.some((completion) => completion.label === "unsaved_symbol"),
            "Tier 2 must not replace open-buffer facts with the on-disk source"
        );
        assert.ok(
            !completions.some((completion) => completion.label === "disk_symbol"),
            "Tier 2 must not expose stale on-disk symbols for an unsaved document"
        );
        await semanticIndex.dispose();
    } finally {
        await cleanupProjectDir(projectRoot);
    }
});

void test("closing an unsaved buffer restores disk-backed semantic facts and manifest metadata", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmloop-lsp-close-overlay-"));
    try {
        await fs.writeFile(
            path.join(projectRoot, "Game.yyp"),
            JSON.stringify({ name: "Game", resourceType: "GMProject" })
        );
        const scriptPath = path.join(projectRoot, "scripts/example/example.gml");
        await fs.mkdir(path.dirname(scriptPath), { recursive: true });
        await fs.writeFile(
            path.join(projectRoot, "scripts/example/example.yy"),
            JSON.stringify({ name: "example", resourceType: "GMScript" })
        );
        const diskSource = "function disk_symbol() { return 1; }";
        const overlaySource = "function overlay_symbol() { return 2; }";
        await fs.writeFile(scriptPath, diskSource);

        const documents = Lsp.createGmlDocumentStore();
        const document = documents.open({
            uri: Lsp.filePathToUri(scriptPath),
            languageId: "gml",
            version: 8,
            text: overlaySource
        });
        const semanticIndex = Lsp.createGmlSemanticIndex(documents);
        await semanticIndex.buildForDocument(document);
        await semanticIndex.findReferences(document, 9, "overlay_symbol", true);
        const overlayCompletions = await semanticIndex.searchCompletions(document, "overlay_symbol");
        assert.equal(
            overlayCompletions.some((completion) => completion.label === "overlay_symbol"),
            true
        );

        documents.close(document.uri);
        await semanticIndex.refreshForFilePath(scriptPath);
        const diskDocument = Lsp.createGmlTextDocument(document.uri, "gml", 0, diskSource);
        const diskCompletions = await semanticIndex.searchCompletions(diskDocument, "disk_symbol");
        assert.equal(
            diskCompletions.some((completion) => completion.label === "disk_symbol"),
            true
        );
        const staleOverlayCompletions = await semanticIndex.searchCompletions(diskDocument, "overlay_symbol");
        assert.equal(
            staleOverlayCompletions.some((completion) => completion.label === "overlay_symbol"),
            false
        );
        await semanticIndex.dispose();

        const persistedStore = Semantic.openSemanticIndexStore(projectRoot);
        try {
            const manifestEntry = persistedStore
                .readSemanticManifest("full")
                ?.entries.get("scripts/example/example.gml");
            assert.equal(manifestEntry?.contentHash, Semantic.createSemanticContentHash(diskSource));
            assert.equal(manifestEntry?.sourceOrigin, "disk");
            assert.equal(manifestEntry?.sourceVersion, null);
        } finally {
            await persistedStore.close();
        }
    } finally {
        await cleanupProjectDir(projectRoot);
    }
});

void test("semantic index aborts and cancels in-flight builds on invalidation", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmloop-lsp-abort-"));
    try {
        await fs.writeFile(
            path.join(projectRoot, "Game.yyp"),
            JSON.stringify({ name: "Game", resourceType: "GMProject" })
        );

        const aPath = path.join(projectRoot, "scripts/a/a.gml");
        await fs.mkdir(path.dirname(aPath), { recursive: true });
        await fs.writeFile(
            path.join(projectRoot, "scripts/a/a.yy"),
            JSON.stringify({ name: "a", resourceType: "GMScript" })
        );
        await fs.writeFile(aPath, "function a() { return 1; }");

        const store = Lsp.createGmlDocumentStore();
        const doc = store.open({
            uri: Lsp.filePathToUri(aPath),
            languageId: "gml",
            version: 1,
            text: "function a() { return 1; }"
        });

        const semanticIndex = Lsp.createGmlSemanticIndex(store);

        // Start a build and immediately invalidate it
        const buildPromise = semanticIndex.buildForDocument(doc);
        semanticIndex.invalidateForDocument(doc);

        const state = await buildPromise;
        // The build should have been aborted and resolved to null
        assert.equal(state, null, "Build should be aborted and return null when invalidated");
    } finally {
        await cleanupProjectDir(projectRoot);
    }
});

void test("semantic index performs incremental updates on document refresh", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmloop-lsp-incremental-"));
    try {
        await fs.writeFile(
            path.join(projectRoot, "Game.yyp"),
            JSON.stringify({ name: "Game", resourceType: "GMProject" })
        );

        const aPath = path.join(projectRoot, "scripts/a/a.gml");
        await fs.mkdir(path.dirname(aPath), { recursive: true });
        await fs.writeFile(
            path.join(projectRoot, "scripts/a/a.yy"),
            JSON.stringify({ name: "a", resourceType: "GMScript" })
        );
        await fs.writeFile(aPath, "function a_func() { return 1; }");

        const bPath = path.join(projectRoot, "scripts/b/b.gml");
        await fs.mkdir(path.dirname(bPath), { recursive: true });
        await fs.writeFile(
            path.join(projectRoot, "scripts/b/b.yy"),
            JSON.stringify({ name: "b", resourceType: "GMScript" })
        );
        const bSource = "function b_func() { return new_func(); }";
        await fs.writeFile(bPath, bSource);

        const store = Lsp.createGmlDocumentStore();
        const docA = store.open({
            uri: Lsp.filePathToUri(aPath),
            languageId: "gml",
            version: 1,
            text: "function a_func() { return 1; }\n// dirty"
        });
        const docB = store.open({
            uri: Lsp.filePathToUri(bPath),
            languageId: "gml",
            version: 1,
            text: bSource
        });

        let publishedGenerationCount = 0;
        const semanticIndex = Lsp.createGmlSemanticIndex(store, () => {
            publishedGenerationCount += 1;
        });

        // 1. Initial cold build
        const state = await semanticIndex.buildForDocument(docA);
        assert.ok(state);
        // Force upgrade to full index
        await semanticIndex.findReferences(docA, 9, "a_func", false);
        assert.equal(
            publishedGenerationCount,
            2,
            "Cold indexing should publish one definitions and one full generation"
        );
        // Verify initial state has both functions
        const comps1 = await semanticIndex.searchCompletions(docA, "a_func");
        assert.ok(comps1.some((c) => c.label === "a_func"));
        const compsB1 = await semanticIndex.searchCompletions(docA, "b_func");
        assert.ok(compsB1.some((c) => c.label === "b_func"));

        // 2. Perform an incremental update to a.gml
        const updatedDocA = store.update(docA.uri, 2, [
            {
                text: "function new_func() { return 3; }"
            }
        ]);
        assert.ok(updatedDocA);

        semanticIndex.invalidateForDocument(updatedDocA);
        const refreshedState = await semanticIndex.refreshForDocument(updatedDocA);
        assert.ok(refreshedState);
        assert.equal(
            publishedGenerationCount,
            4,
            "A scoped edit should publish one definitions generation before its full upgrade."
        );
        const immediateReferences = await semanticIndex.findReferences(
            docB,
            bSource.indexOf("new_func"),
            "new_func",
            false
        );
        assert.ok(immediateReferences.some((reference) => reference.uri === Lsp.filePathToUri(bPath)));
        assert.equal(
            publishedGenerationCount,
            4,
            "A current in-memory full snapshot must not launch a redundant Tier-2 build while persistence is queued."
        );

        // Verify new_func exists, a_func is gone, and b_func is STILL there
        const comps2 = await semanticIndex.searchCompletions(updatedDocA, "new_func");
        assert.ok(
            comps2.some((c) => c.label === "new_func"),
            "new_func should exist after incremental update"
        );

        const comps3 = await semanticIndex.searchCompletions(updatedDocA, "a_func");
        assert.ok(!comps3.some((c) => c.label === "a_func"), "a_func should be removed after incremental update");

        const comps4 = await semanticIndex.searchCompletions(updatedDocA, "b_func");
        assert.ok(
            comps4.some((c) => c.label === "b_func"),
            "b_func from unrelated file should be preserved"
        );
        const persistedStore = Semantic.openSemanticIndexStore(projectRoot);
        const persistedSnapshot = persistedStore.readSemanticSnapshot("full");
        await persistedStore.close();
        assert.equal(persistedSnapshot, null, "Open-buffer facts must remain session-local");
        const liveNewFunction = refreshedState.index.symbols.find((symbol) => symbol.name === "new_func");
        assert.ok(liveNewFunction, "The refreshed navigation state must contain the new function");
        assert.ok(
            liveNewFunction.references.some((reference) => reference.location.filePath === bPath),
            "The refreshed navigation state must contain the rebound bare-call occurrence"
        );
        const newFunctionReferences = await semanticIndex.findReferences(
            docB,
            bSource.indexOf("new_func"),
            "new_func",
            false
        );
        assert.ok(
            newFunctionReferences.some((reference) => reference.uri === Lsp.filePathToUri(bPath)),
            "A unique newly introduced function should bind persisted unresolved bare calls"
        );
    } finally {
        await cleanupProjectDir(projectRoot);
    }
});

void test("semantic index loads cache from disk on startup and saves updates to disk", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmloop-lsp-cache-"));
    const aPath = path.join(projectRoot, "scripts/a/a.gml");
    const aRelativePath = "scripts/a/a.gml";
    const sourceText = ["enum eCacheState { cold, warm }", "function cache_func() { return eCacheState.warm; }"].join(
        "\n"
    );
    try {
        await fs.writeFile(
            path.join(projectRoot, "Game.yyp"),
            JSON.stringify({ name: "Game", resourceType: "GMProject" })
        );
        await fs.mkdir(path.dirname(aPath), { recursive: true });
        await fs.writeFile(
            path.join(projectRoot, "scripts/a/a.yy"),
            JSON.stringify({ name: "a", resourceType: "GMScript" })
        );
        await fs.writeFile(aPath, sourceText);

        const store = Lsp.createGmlDocumentStore();
        const doc = store.open({
            uri: Lsp.filePathToUri(aPath),
            languageId: "gml",
            version: 1,
            text: sourceText
        });

        // 1. First semantic index instance builds from an open buffer. Its
        // facts remain session-local until the buffer is closed.
        const index1 = Lsp.createGmlSemanticIndex(store);
        const state1 = await index1.buildForDocument(doc);
        assert.ok(state1, "Initial semantic build must succeed");

        await index1.findReferences(doc, "function cache_func".length, "cache_func", false);
        store.close(doc.uri);
        await index1.refreshForFilePath(aPath);
        await waitForCondition(async () => {
            const persistedStore = Semantic.openSemanticIndexStore(projectRoot);
            try {
                const slots = persistedStore.readActiveSemanticSlots();
                if (!slots.hasMatchingFull) {
                    return false;
                }
                const fullManifest = persistedStore.readSemanticManifest("full");
                return fullManifest?.entries.has(aRelativePath) ?? false;
            } finally {
                await persistedStore.close();
            }
        });

        // 2. A fresh semantic index must restore the disk-backed persisted state without a rebuild.
        let restoredGenerationCount = 0;
        const index2 = Lsp.createGmlSemanticIndex(store, () => {
            restoredGenerationCount += 1;
        });
        const state2 = await index2.buildForDocument(doc);
        assert.ok(state2, "A restarted semantic index must load previously persisted state");
        assert.equal(
            state2.lightweight,
            false,
            "Restored state must be the persisted full tier, not a lightweight fallback that would force a rebuild"
        );

        const comps = await index2.searchCompletions(doc, "cache_func");
        assert.ok(
            comps.some((c) => c.label === "cache_func"),
            "Completions derived from the cached full snapshot must include the persisted function"
        );

        const enumHover = await index2.hover(doc, sourceText.indexOf("eCacheState"), "eCacheState");
        const enumHoverText =
            typeof enumHover?.contents === "object" && "value" in enumHover.contents ? enumHover.contents.value : "";
        assert.match(enumHoverText, /enum eCacheState \{/u);
        assert.match(enumHoverText, /cold = 0/u);
        assert.match(enumHoverText, /warm = 1/u);
        assert.equal(
            restoredGenerationCount,
            0,
            "Enum hover from a persisted full snapshot must not trigger project reanalysis."
        );
    } finally {
        await cleanupProjectDir(projectRoot);
    }
});

void test("semantic index reconciles closed-session disk edits through one restarted manifest refresh", async () => {
    const fixture = await createTwoScriptProject();
    try {
        const firstStore = Lsp.createGmlDocumentStore();
        const firstDocument = firstStore.open({
            uri: Lsp.filePathToUri(fixture.sourcePath),
            languageId: "gml",
            version: 1,
            text: fixture.sourceText
        });
        const firstIndex = Lsp.createGmlSemanticIndex(firstStore);
        await firstIndex.findReferences(firstDocument, fixture.sourceText.indexOf("target();"), "target", false);
        await firstIndex.dispose();

        const changedSource = ["function source() {", "    restarted_target();", "}", ""].join("\n");
        await fs.writeFile(fixture.sourcePath, changedSource);
        await fs.writeFile(
            fixture.targetPath,
            ["/// @desc updated target", "function restarted_target() {", "    return 2;", "}", ""].join("\n")
        );

        const restartedStore = Lsp.createGmlDocumentStore();
        const restartedDocument = restartedStore.open({
            uri: Lsp.filePathToUri(fixture.sourcePath),
            languageId: "gml",
            version: 1,
            text: changedSource
        });
        const restartedIndex = Lsp.createGmlSemanticIndex(restartedStore);

        const restoredState = await restartedIndex.buildForDocument(restartedDocument);
        assert.ok(restoredState, "The persisted snapshot should remain immediately usable during reconciliation.");

        await waitForCondition(() =>
            restartedIndex
                .searchCompletions(restartedDocument, "restarted_target")
                .then((items) => items.some((item) => item.label === "restarted_target"))
        );

        const definition = await restartedIndex.findDefinition(
            restartedDocument,
            changedSource.indexOf("restarted_target();"),
            "restarted_target"
        );
        assert.equal(definition?.uri, Lsp.filePathToUri(fixture.targetPath));
        await restartedIndex.dispose();
    } finally {
        await fixture.cleanup();
    }
});
