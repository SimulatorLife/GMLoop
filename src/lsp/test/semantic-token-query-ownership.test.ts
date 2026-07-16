import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const REPOSITORY_ROOT = path.resolve(new URL("../../../../", import.meta.url).pathname);

void test("semantic tokens resolve only resource names present in the active document", async () => {
    const identifierIndexSource = await readFile(
        path.join(REPOSITORY_ROOT, "src/lsp/src/intelligence/identifier-index.ts"),
        "utf8"
    );
    const methodStart = identifierIndexSource.indexOf("async listSemanticHighlights");
    const methodEnd = identifierIndexSource.indexOf("async searchWorkspaceSymbols", methodStart);
    assert.notEqual(methodStart, -1);
    assert.notEqual(methodEnd, -1);

    const methodSource = identifierIndexSource.slice(methodStart, methodEnd);
    assert.match(methodSource, /queries\.findResourcesByNames\(identifierNames\)/u);
    assert.doesNotMatch(methodSource, /queries\.listResources\(\)/u);
});
