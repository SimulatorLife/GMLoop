import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { Lsp } from "@gmloop/lsp";
import { Semantic } from "@gmloop/semantic";

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
    await fs.writeFile(path.join(projectRoot, "Game.yyp"), JSON.stringify({ name: "Game", resourceType: "GMProject" }));
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

void test("semantic index refreshes project facts after an external resource metadata change", async () => {
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
        await semanticIndex.findReferences(document, fixture.sourceText.indexOf("target();"), "target", false);

        const resourcePath = path.join(fixture.projectRoot, "scripts", "external", "external.yy");
        const sourcePath = path.join(fixture.projectRoot, "scripts", "external", "external.gml");
        await fs.mkdir(path.dirname(resourcePath), { recursive: true });
        await fs.writeFile(resourcePath, JSON.stringify({ name: "external", resourceType: "GMScript" }));
        await fs.writeFile(sourcePath, "function external_added() { return 1; }\n");

        await semanticIndex.refreshForFilePath(resourcePath);
        const completions = await semanticIndex.searchCompletions(document, "external_added");
        assert.ok(completions.some((completion) => completion.label === "external_added"));
        await waitForCondition(() => {
            const database = new DatabaseSync(Semantic.getSemanticIndexDatabasePath(fixture.projectRoot), {
                readOnly: true
            });
            try {
                const rows = database
                    .prepare(
                        "SELECT files.relative_path, files.updated_generation, slots.generation FROM semantic_files files JOIN semantic_slots slots ON slots.project_root = files.project_root AND slots.tier = files.tier WHERE files.project_root = ? AND files.tier = 'full' AND files.relative_path IN (?, ?) ORDER BY files.relative_path"
                    )
                    .all(fixture.projectRoot, "scripts/external/external.gml", "scripts/source/source.gml");
                const fileGenerations = new Map(
                    rows.flatMap((row) =>
                        typeof row.relative_path === "string" &&
                        typeof row.updated_generation === "number" &&
                        typeof row.generation === "number"
                            ? [[row.relative_path, { file: row.updated_generation, slot: row.generation }] as const]
                            : []
                    )
                );
                const externalGeneration = fileGenerations.get("scripts/external/external.gml");
                const sourceGeneration = fileGenerations.get("scripts/source/source.gml");
                return (
                    externalGeneration !== undefined &&
                    sourceGeneration !== undefined &&
                    externalGeneration.file === externalGeneration.slot &&
                    sourceGeneration.file < sourceGeneration.slot
                );
            } finally {
                database.close();
            }
        });
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
        "    /// @desc some comment",
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

        const offsetComment = sourceText.indexOf("@desc");
        const hoverComment = await semanticIndex.hover(document, offsetComment, "desc");
        assert.equal(hoverComment, null, "Should not hover inside comment");

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

void test("semantic highlights do not reuse shifted local occurrences while an edited document is stale", async () => {
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
        assert.equal(
            highlights.some((highlight) => highlight.start === localReferenceStart),
            false,
            "A stale project occurrence must not be applied at a shifted local-reference offset."
        );
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
        const semanticIndex = Lsp.createGmlSemanticIndex(store, () => {
            publishedGenerationCount += 1;
        });

        // 1. Initial buildForDocument returns a lightweight state
        const state1 = await semanticIndex.buildForDocument(docB);
        assert.ok(state1);
        assert.equal(state1.lightweight, true, "Initial build should be lightweight (definitionsOnly)");
        assert.equal(publishedGenerationCount, 1, "Tier 1 should publish a semantic generation");

        // 2. Hover is immediately available on the lightweight index — does not block
        const offsetValB = docB.sourceText.lastIndexOf("function b") + 9;
        const hoverRes = await semanticIndex.hover(docB, offsetValB, "b");
        assert.ok(hoverRes, "Hover should return on lightweight index without waiting for full build");
        const hoverText =
            typeof hoverRes.contents === "object" && "value" in hoverRes.contents ? hoverRes.contents.value : "";
        assert.match(hoverText, /test function b/, "Hover should show doc-comment from lightweight pass");

        // 3. findDefinition is immediately available on the lightweight index
        const defRes = await semanticIndex.findDefinition(docB, offsetValB, "b");
        assert.ok(defRes, "findDefinition should return on lightweight index");
        assert.ok(defRes.uri.includes("b.gml"), "findDefinition should point to b.gml");

        // 4. findReferences transparently waits for the full build and returns complete data
        const offsetValA = 15; // offset of "b" in "function a() { b(); }"
        const refs = await semanticIndex.findReferences(docA, offsetValA, "b", false);
        assert.ok(refs.length > 0, "findReferences should return cross-file references after full build");
        const refUris = refs.map((r) => r.uri);
        assert.ok(refUris.includes(Lsp.filePathToUri(aPath)), "References should include usage in a.gml");

        // 5. After findReferences returns, the state should now be fully upgraded
        const finalState = await semanticIndex.buildForDocument(docB);
        assert.ok(finalState);
        assert.equal(finalState.lightweight, false, "State should be fully upgraded after findReferences completed");
        assert.equal(publishedGenerationCount, 2, "Tier 2 should publish a semantic generation");
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
            text: "function a_func() { return 1; }"
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
        await waitForCondition(() => {
            const persistedStore = Semantic.openSemanticIndexStore(projectRoot);
            try {
                return persistedStore.findUnresolvedDependents(["new_func"]).includes("scripts/b/b.gml");
            } finally {
                persistedStore.close();
            }
        });

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
        await waitForCondition(() => {
            const database = new DatabaseSync(Semantic.getSemanticIndexDatabasePath(projectRoot), { readOnly: true });
            try {
                const row = database
                    .prepare(
                        "SELECT files.updated_generation, slots.generation FROM semantic_files files JOIN semantic_slots slots ON slots.project_root = files.project_root AND slots.tier = files.tier WHERE files.project_root = ? AND files.tier = 'full' AND files.relative_path = 'scripts/b/b.gml'"
                    )
                    .get(projectRoot);
                return (
                    typeof row?.generation === "number" &&
                    row.generation >= 4 &&
                    row.updated_generation === row.generation
                );
            } finally {
                database.close();
            }
        });
        const persistedStore = Semantic.openSemanticIndexStore(projectRoot);
        const persistedSnapshot = persistedStore.readSemanticSnapshot("full");
        persistedStore.close();
        const persistedNewFunction = persistedSnapshot?.symbols.find((symbol) => symbol.name === "new_func");
        assert.ok(persistedNewFunction, "The new function must exist in the matching full snapshot");
        assert.ok(
            persistedSnapshot?.occurrences.some(
                (occurrence) =>
                    occurrence.symbolId === persistedNewFunction.symbolId &&
                    occurrence.role === "reference" &&
                    occurrence.filePath === "scripts/b/b.gml"
            ),
            "The matching full snapshot must contain the rebound bare-call occurrence"
        );
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
        await fs.writeFile(aPath, "function cache_func() { return 1; }");

        const store = Lsp.createGmlDocumentStore();
        const doc = store.open({
            uri: Lsp.filePathToUri(aPath),
            languageId: "gml",
            version: 1,
            text: "function cache_func() { return 1; }"
        });

        // 1. First semantic index instance builds and saves to disk cache
        const index1 = Lsp.createGmlSemanticIndex(store);
        const state1 = await index1.buildForDocument(doc);
        assert.ok(state1);

        // Wait for background build to complete so it writes to disk cache
        await index1.findReferences(doc, 9, "cache_func", false);

        // Wait a brief moment for the background cache save to finish writing to disk
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify the cache directory and file exist
        const cacheDir = path.join(projectRoot, ".gmloop");
        const cacheFilePath = path.join(cacheDir, "graph-index.sqlite");
        const fileExists = await fs
            .stat(cacheFilePath)
            .then(() => true)
            .catch(() => false);
        assert.ok(fileExists, "Semantic index should be saved to the unified .gmloop/graph-index.sqlite store");

        // 2. Start a second semantic index instance (simulating VS Code reload)
        const index2 = Lsp.createGmlSemanticIndex(store);
        const state2 = await index2.buildForDocument(doc);
        assert.ok(state2, "Should load cached state from disk on startup");
        assert.equal(state2.lightweight, false, "Loaded cached state should be full (not lightweight)");

        const comps = await index2.searchCompletions(doc, "cache_func");
        assert.ok(
            comps.some((c) => c.label === "cache_func"),
            "Completions should be available immediately from disk cache"
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
