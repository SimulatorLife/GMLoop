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
    const targetText = ["function target() {", "    return 1;", "}"].join("\n");

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
        const document = Lsp.createGmlDocumentStore().open({
            uri: Lsp.filePathToUri(fixture.sourcePath),
            languageId: "gml",
            version: 1,
            text: fixture.sourceText
        });
        const semanticIndex = Lsp.createGmlSemanticIndex();
        const offset = fixture.sourceText.indexOf("target();");

        const definition = await semanticIndex.findDefinition(document, offset, "target");
        assert.equal(definition?.uri, Lsp.filePathToUri(fixture.targetPath));
        assert.deepEqual(definition?.range.start, { line: 0, character: 9 });

        const referencesOnly = await semanticIndex.findReferences(document, offset, "target", false);
        assert.deepEqual(
            referencesOnly.map((reference) => reference.uri),
            [Lsp.filePathToUri(fixture.sourcePath)]
        );

        const allReferences = await semanticIndex.findReferences(document, offset, "target", true);
        assert.equal(allReferences.length, 2);

        const hover = await semanticIndex.hover(document, offset, "target");
        assert.match(
            typeof hover?.contents === "object" && "value" in hover.contents ? hover.contents.value : "",
            /target/
        );

        const renameEdit = await semanticIndex.planRename(document, offset, "target", "renamed_target");
        assert.ok(renameEdit?.changes);
        assert.ok(renameEdit.changes[Lsp.filePathToUri(fixture.sourcePath)]?.length);
        assert.ok(renameEdit.changes[Lsp.filePathToUri(fixture.targetPath)]?.length);
    } finally {
        await fixture.cleanup();
    }
});
