import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProjectIndexCoordinator } from "../src/project-index/builder.js";

void test("project coordinator restores only an exact canonical manifest revision", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-project-coordinator-cache-"));
    const scriptPath = path.join(projectRoot, "scripts/example/example.gml");
    try {
        await mkdir(path.dirname(scriptPath), { recursive: true });
        await writeFile(
            path.join(projectRoot, "Game.yyp"),
            JSON.stringify({ name: "Game", resourceType: "GMProject" })
        );
        await writeFile(
            path.join(projectRoot, "scripts/example/example.yy"),
            JSON.stringify({ name: "example", resourceType: "GMScript" })
        );
        await writeFile(scriptPath, "function first() { return 1; }");

        const coldCoordinator = createProjectIndexCoordinator();
        const cold = await coldCoordinator.ensureReady({ projectRoot });
        assert.equal(cold.source, "build");
        coldCoordinator.dispose();

        const warmCoordinator = createProjectIndexCoordinator();
        const warm = await warmCoordinator.ensureReady({ projectRoot });
        assert.equal(warm.source, "store");
        warmCoordinator.dispose();

        await writeFile(scriptPath, "function other() { return 1; }");
        const changedCoordinator = createProjectIndexCoordinator();
        const changed = await changedCoordinator.ensureReady({ projectRoot });
        assert.equal(changed.source, "build", "same-size source edits must invalidate the persisted full revision");
        changedCoordinator.dispose();
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});
