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
            "scripts/a.yy": {},
            "animcurves/curve_elastic_norm/curve_elastic_norm.yy": {},
            "MyGame.yyp": {}
        }
    };

    assert.deepEqual(resolveIndexedRootTargetGmlFiles(projectRoot, [projectRoot], projectIndex), ["scripts/a.gml"]);
    assert.equal(resolveIndexedRootTargetGmlFiles(projectRoot, ["/project/scripts"], projectIndex), null);
});

void test("collectTargetGmlFiles ignores cache, .gmcache, and GameMaker metadata files", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-refactor-ignore-"));

    try {
        const sourcePath = path.join(temporaryDirectory, "scripts", "a.gml");
        const scriptMetadataPath = path.join(temporaryDirectory, "scripts", "a.yy");
        const animationCurveMetadataPath = path.join(
            temporaryDirectory,
            "animcurves",
            "curve_elastic_norm",
            "curve_elastic_norm.yy"
        );
        const projectMetadataPath = path.join(temporaryDirectory, "MyGame.yyp");
        const gmcacheSourcePath = path.join(temporaryDirectory, ".gmcache", "nested", "b.gml");
        const cacheSourcePath = path.join(temporaryDirectory, "cache", "nested", "c.gml");

        await mkdir(path.dirname(sourcePath), { recursive: true });
        await mkdir(path.dirname(animationCurveMetadataPath), { recursive: true });
        await mkdir(path.dirname(gmcacheSourcePath), { recursive: true });
        await mkdir(path.dirname(cacheSourcePath), { recursive: true });

        await writeFile(sourcePath, "var x = 1;\n", "utf8");
        await writeFile(scriptMetadataPath, '{"resourceType":"GMScript","value":1E-07,}\n', "utf8");
        await writeFile(animationCurveMetadataPath, '{"resourceType":"GMAnimCurve","tv1":-1.4575198E-07,}\n', "utf8");
        await writeFile(projectMetadataPath, '{"resourceType":"GMProject","value":1E-07,}\n', "utf8");
        await writeFile(gmcacheSourcePath, "var y = 2;\n", "utf8");
        await writeFile(cacheSourcePath, "var z = 3;\n", "utf8");

        const collected = await collectTargetGmlFiles(temporaryDirectory, [temporaryDirectory]);

        assert.deepEqual(collected, ["scripts/a.gml"]);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});
