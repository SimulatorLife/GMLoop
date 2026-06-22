import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectTargetGmlFiles, resolveIndexedRootTargetGmlFiles } from "../src/commands/refactor.js";

void test("indexed root-target gml discovery only runs when all targets resolve to the project root", () => {
    const projectRoot = "/project";
    const projectIndex = {
        files: {
            "scripts/a.gml": {},
            "scripts/a.yy": {}
        }
    };

    assert.equal(resolveIndexedRootTargetGmlFiles(projectRoot, [projectRoot], projectIndex)?.length, 2);
    assert.equal(resolveIndexedRootTargetGmlFiles(projectRoot, ["/project/scripts"], projectIndex), null);
});

void test("collectTargetGmlFiles ignores cache and .gmcache directories", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-refactor-ignore-"));

    try {
        const sourcePath = path.join(temporaryDirectory, "scripts", "a.gml");
        const gmcacheSourcePath = path.join(temporaryDirectory, ".gmcache", "nested", "b.gml");
        const cacheSourcePath = path.join(temporaryDirectory, "cache", "nested", "c.gml");

        await mkdir(path.dirname(sourcePath), { recursive: true });
        await mkdir(path.dirname(gmcacheSourcePath), { recursive: true });
        await mkdir(path.dirname(cacheSourcePath), { recursive: true });

        await writeFile(sourcePath, "var x = 1;\n", "utf8");
        await writeFile(gmcacheSourcePath, "var y = 2;\n", "utf8");
        await writeFile(cacheSourcePath, "var z = 3;\n", "utf8");

        const collected = await collectTargetGmlFiles(temporaryDirectory, [temporaryDirectory]);

        assert.deepEqual(collected, ["scripts/a.gml"]);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});
