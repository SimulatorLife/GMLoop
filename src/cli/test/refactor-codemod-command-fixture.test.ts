import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { withSyntheticRefactorProject, writeProjectFile } from "./test-helpers/refactor-codemod-command-fixture.js";

void test("withSyntheticRefactorProject removes the temporary project after successful completion", async () => {
    let capturedProjectRoot = "";

    const observedProjectFile = await withSyntheticRefactorProject({}, async (projectRoot) => {
        capturedProjectRoot = projectRoot;
        await writeProjectFile(projectRoot, "scripts/demo/demo.gml", "function demo() { return 1; }\n");
        return path.join(projectRoot, "scripts/demo/demo.gml");
    });

    await assert.rejects(access(capturedProjectRoot));
    await assert.rejects(access(observedProjectFile));
});

void test("withSyntheticRefactorProject removes the temporary project after callback failures", async () => {
    let capturedProjectRoot = "";

    await assert.rejects(
        withSyntheticRefactorProject({}, async (projectRoot) => {
            capturedProjectRoot = projectRoot;
            await writeProjectFile(projectRoot, "scripts/demo/demo.gml", "function demo() { return 1; }\n");
            throw new Error("expected callback failure");
        }),
        /expected callback failure/
    );

    await assert.rejects(access(capturedProjectRoot));
});
