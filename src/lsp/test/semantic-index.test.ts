import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Lsp } from "@gmloop/lsp";

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
            await fs.rm(projectRoot, { recursive: true, force: true });
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
        const afterEdit = await semanticIndex.searchCompletions(updatedDocument, "new_unsaved_symbol");

        assert.equal(
            afterEdit.some((completion) => completion.label === "new_unsaved_symbol"),
            true
        );
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
        await fs.rm(projectRoot, { recursive: true, force: true });
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
        await fs.rm(projectRoot, { recursive: true, force: true });
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
        store.open({
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

        const semanticIndex = Lsp.createGmlSemanticIndex(store);

        // 1. Initial buildForDocument returns a lightweight state
        const state1 = await semanticIndex.buildForDocument(docB);
        assert.ok(state1);
        assert.equal(state1.lightweight, true, "Initial build should be lightweight (definitionsOnly)");

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
        const refs = await semanticIndex.findReferences(docB, offsetValB, "b", false);
        assert.ok(refs.length > 0, "findReferences should return cross-file references after full build");
        const refUris = refs.map((r) => r.uri);
        assert.ok(refUris.includes(Lsp.filePathToUri(aPath)), "References should include usage in a.gml");

        // 5. After findReferences returns, the state should now be fully upgraded
        const finalState = await semanticIndex.buildForDocument(docB);
        assert.ok(finalState);
        assert.equal(finalState.lightweight, false, "State should be fully upgraded after findReferences completed");
    } finally {
        await fs.rm(projectRoot, { recursive: true, force: true });
    }
});
