import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = path.dirname(CURRENT_FILE);
const PRINTER_SOURCE_PATH = path.resolve(CURRENT_DIR, "../../src/printer/print.ts");
const FORMAT_SOURCE_ROOT = path.resolve(CURRENT_DIR, "../../src");

async function collectTypeScriptSourcePaths(rootPath: string): Promise<string[]> {
    const entries = await readdir(rootPath, { withFileTypes: true });
    const paths = await Promise.all(
        entries.map(async (entry) => {
            const entryPath = path.join(rootPath, entry.name);
            if (entry.isDirectory()) {
                return collectTypeScriptSourcePaths(entryPath);
            }

            if (entry.isFile() && entry.name.endsWith(".ts")) {
                return [entryPath];
            }

            return [];
        })
    );

    return paths.flat();
}

void it("does not depend on lint-owned synthetic doc comment fields", async () => {
    const source = await readFile(PRINTER_SOURCE_PATH, "utf8");

    assert.doesNotMatch(
        source,
        /_syntheticDocLines/,
        "Formatter must not branch on lint-owned synthetic doc fields; semantic/doc synthesis belongs to lint."
    );
});

void it("does not reference lint-owned synthetic doc text metadata in formatter source", async () => {
    const sourcePaths = await collectTypeScriptSourcePaths(FORMAT_SOURCE_ROOT);
    const sourceEntries = await Promise.all(
        sourcePaths.map(async (sourcePath) => [sourcePath, await readFile(sourcePath, "utf8")] as const)
    );

    for (const [sourcePath, source] of sourceEntries) {
        assert.doesNotMatch(
            source,
            /_gmlDocText/,
            `Formatter source must not consume lint-owned synthetic doc metadata (${sourcePath}).`
        );
    }
});
