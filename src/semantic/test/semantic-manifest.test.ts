import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Core } from "@gmloop/core";

import {
    buildSemanticFileManifest,
    createSemanticContentHash,
    reconcileSemanticManifests,
    updateSemanticFileManifest
} from "../src/project-index/semantic-manifest.js";

void test("semantic manifest hashes GML, resources, and the project manifest deterministically", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-manifest-"));
    await mkdir(path.join(projectRoot, "scripts", "main"), { recursive: true });
    await mkdir(path.join(projectRoot, "objects", "obj_player"), { recursive: true });
    await writeFile(path.join(projectRoot, "game.yyp"), '{"resources":[]}', "utf8");
    await writeFile(path.join(projectRoot, "scripts", "main", "main.gml"), "return 1;", "utf8");
    await writeFile(
        path.join(projectRoot, "objects", "obj_player", "obj_player.yy"),
        '{"resourceType":"GMObject"}',
        "utf8"
    );

    const first = await buildSemanticFileManifest(projectRoot, Core.defaultFsFacade);
    const second = await buildSemanticFileManifest(projectRoot, Core.defaultFsFacade);

    assert.equal(first.sourceRevision, second.sourceRevision);
    assert.deepEqual(
        [...first.entries.keys()],
        ["game.yyp", "objects/obj_player/obj_player.yy", "scripts/main/main.gml"]
    );
    assert.equal(first.entries.get("game.yyp")?.fileKind, "projectManifest");
    assert.equal(first.entries.get("objects/obj_player/obj_player.yy")?.fileKind, "resourceMetadata");
    assert.equal(first.entries.get("scripts/main/main.gml")?.fileKind, "gml");
});

void test("semantic manifest gives an open buffer precedence over disk contents", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-manifest-overlay-"));
    const sourcePath = path.join(projectRoot, "main.gml");
    await writeFile(sourcePath, "return 1;", "utf8");

    const manifest = await buildSemanticFileManifest(projectRoot, Core.defaultFsFacade, [
        {
            absolutePath: sourcePath,
            contentHash: createSemanticContentHash("return 2;"),
            documentVersion: 9,
            sourceText: "return 2;"
        }
    ]);

    assert.deepEqual(manifest.entries.get("main.gml"), {
        contentHash: createSemanticContentHash("return 2;"),
        fileKind: "gml",
        mtimeMs: manifest.entries.get("main.gml")?.mtimeMs ?? null,
        relativePath: "main.gml",
        sizeBytes: Buffer.byteLength("return 2;", "utf8"),
        sourceOrigin: "openBuffer",
        sourceVersion: 9
    });
});

void test("semantic manifest reconciliation identifies scoped source and metadata changes", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-manifest-reconcile-"));
    await mkdir(path.join(projectRoot, "scripts", "main"), { recursive: true });
    await writeFile(path.join(projectRoot, "game.yyp"), "{}", "utf8");
    await writeFile(path.join(projectRoot, "scripts", "main", "main.gml"), "return 1;", "utf8");
    const previous = await buildSemanticFileManifest(projectRoot, Core.defaultFsFacade);

    await writeFile(path.join(projectRoot, "game.yyp"), '{"resources":[]}', "utf8");
    await writeFile(path.join(projectRoot, "scripts", "main", "main.gml"), "return 2;", "utf8");
    await writeFile(path.join(projectRoot, "scripts", "added.gml"), "return 3;", "utf8");
    const current = await buildSemanticFileManifest(projectRoot, Core.defaultFsFacade);
    const reconciliation = reconcileSemanticManifests(previous, current);

    assert.equal(reconciliation.requiresBuild, true);
    assert.deepEqual(
        reconciliation.changedFiles.map((change) => [change.relativePath, change.kind]),
        [
            ["game.yyp", "metadataChanged"],
            ["scripts/added.gml", "added"],
            ["scripts/main/main.gml", "modified"]
        ]
    );
});

void test("semantic manifest updates known file entries without rediscovering unrelated files", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-manifest-increment-"));
    const firstPath = path.join(projectRoot, "first.gml");
    const secondPath = path.join(projectRoot, "second.gml");
    await writeFile(firstPath, "return 1;", "utf8");
    await writeFile(secondPath, "return 2;", "utf8");
    const previous = await buildSemanticFileManifest(projectRoot, Core.defaultFsFacade);

    await writeFile(firstPath, "return 3;", "utf8");
    const updated = await updateSemanticFileManifest(projectRoot, previous, Core.defaultFsFacade, [], [firstPath]);

    assert.notEqual(updated.sourceRevision, previous.sourceRevision);
    assert.equal(updated.entries.get("first.gml")?.contentHash, createSemanticContentHash("return 3;"));
    assert.deepEqual(updated.entries.get("second.gml"), previous.entries.get("second.gml"));
});

void test("buildSemanticFileManifest avoids reading unchanged files when previousManifest is provided", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-manifest-cache-"));
    const sourcePath = path.join(projectRoot, "main.gml");
    await writeFile(sourcePath, "return 1;", "utf8");

    // 1. First build (cold start, must read file)
    const initialManifest = await buildSemanticFileManifest(projectRoot, Core.defaultFsFacade);

    // 2. Second build with previousManifest (cache hit on mtime)
    let readCount = 0;
    const spyFsFacade = {
        ...Core.defaultFsFacade,
        async readFile(filePath: string, encoding: any) {
            readCount += 1;
            return Core.defaultFsFacade.readFile(filePath, encoding);
        }
    };

    const cachedManifest = await buildSemanticFileManifest(projectRoot, spyFsFacade, [], initialManifest);

    assert.equal(readCount, 0, "Should not read the file from disk if mtime has not changed");
    assert.deepEqual(cachedManifest.sourceRevision, initialManifest.sourceRevision);
    assert.deepEqual(
        cachedManifest.entries.get("main.gml")?.contentHash,
        initialManifest.entries.get("main.gml")?.contentHash
    );
});
