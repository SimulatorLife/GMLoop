import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const REPOSITORY_ROOT = path.resolve(new URL("../../../../", import.meta.url).pathname);

void test("LSP semantic orchestration never runs project indexing on the server event loop", async () => {
    const identifierIndexSource = await readFile(
        path.join(REPOSITORY_ROOT, "src/lsp/src/intelligence/identifier-index.ts"),
        "utf8"
    );

    assert.doesNotMatch(identifierIndexSource, /Semantic\.buildProjectNavigationIndex\(/u);
    assert.doesNotMatch(identifierIndexSource, /createProjectNavigationIndexFromSemanticSnapshot/u);
    assert.doesNotMatch(identifierIndexSource, /readSemanticSnapshot\(/u);
    assert.match(identifierIndexSource, /buildSemanticIndexInWorker/u);
    assert.match(identifierIndexSource, /withPinnedSemanticQueries/u);
});

void test("semantic worker requests and results carry generation and source boundaries", async () => {
    const workerSource = await readFile(
        path.join(REPOSITORY_ROOT, "src/lsp/src/intelligence/project-index-worker.ts"),
        "utf8"
    );

    for (const boundaryField of [
        "baseGeneration",
        "definitionsGeneration",
        "definitionsSourceRevision",
        "projectHeadGeneration",
        "projectVersion"
    ]) {
        assert.match(workerSource, new RegExp(String.raw`\b${boundaryField}\b`, "u"));
    }
    assert.match(workerSource, /buildBoundary: request\.buildBoundary/u);
});
