import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const REPOSITORY_ROOT = path.resolve(new URL("../../../../", import.meta.url).pathname);
const CONSUMER_SOURCE_ROOTS = ["src/semantic/src", "src/lsp/src", "src/vscode/src"];

async function listTypeScriptFiles(directoryPath: string): Promise<string[]> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nestedFiles = await Promise.all(
        entries.map(async (entry) => {
            const entryPath = path.join(directoryPath, entry.name);
            if (entry.isDirectory()) return await listTypeScriptFiles(entryPath);
            return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
        })
    );
    return nestedFiles.flat();
}

void test("semantic, LSP, and VSCode consumers never construct or repair GameMaker manual URLs", async () => {
    const sourceFilesByRoot = await Promise.all(
        CONSUMER_SOURCE_ROOTS.map(async (relativeRoot) => {
            return await listTypeScriptFiles(path.join(REPOSITORY_ROOT, relativeRoot));
        })
    );
    const sourceFiles = sourceFilesByRoot.flat();

    for (const sourceFile of sourceFiles) {
        const source = await readFile(sourceFile, "utf8");
        assert.doesNotMatch(source, /manual\.gamemaker\.io/u, `${sourceFile} must not construct manual URLs`);
        assert.doesNotMatch(source, /manualPath/u, `${sourceFile} must not derive links from manualPath`);
    }
});

void test("LSP hover consumes the generator-owned manualUrl field verbatim", async () => {
    const identifierIndexSource = await readFile(
        path.join(REPOSITORY_ROOT, "src/lsp/src/intelligence/identifier-index.ts"),
        "utf8"
    );
    assert.match(identifierIndexSource, /typeof info\.manualUrl === "string"/u);
    assert.match(identifierIndexSource, /\$\{info\.manualUrl\}/u);
});
