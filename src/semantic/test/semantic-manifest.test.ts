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

void test("buildSemanticFileManifest treats matching overlays as disk origin to enable persistent caching", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-manifest-overlay-clean-"));
    const sourcePath = path.join(projectRoot, "main.gml");
    await writeFile(sourcePath, "return 1;", "utf8");

    // Clean overlay (matches disk content exactly)
    const overlays = [
        {
            absolutePath: sourcePath,
            contentHash: createSemanticContentHash("return 1;"),
            documentVersion: 2,
            sourceText: "return 1;"
        }
    ];

    const manifest = await buildSemanticFileManifest(projectRoot, Core.defaultFsFacade, overlays);
    const entry = manifest.entries.get("main.gml");

    assert.ok(entry);
    assert.equal(entry.sourceOrigin, "disk", "Clean overlay should resolve to disk origin");
    assert.equal(entry.sourceVersion, null, "Clean overlay should clear source version");
});

void test("buildSemanticFileManifest treats mismatched/dirty overlays as openBuffer origin to block persistent caching", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-manifest-overlay-dirty-"));
    const sourcePath = path.join(projectRoot, "main.gml");
    await writeFile(sourcePath, "return 1;", "utf8");

    // Dirty overlay (differs from disk content)
    const overlays = [
        {
            absolutePath: sourcePath,
            contentHash: createSemanticContentHash("return 2;"),
            documentVersion: 2,
            sourceText: "return 2;"
        }
    ];

    const manifest = await buildSemanticFileManifest(projectRoot, Core.defaultFsFacade, overlays);
    const entry = manifest.entries.get("main.gml");

    assert.ok(entry);
    assert.equal(entry.sourceOrigin, "openBuffer", "Dirty overlay must resolve to openBuffer origin");
    assert.equal(entry.sourceVersion, 2, "Dirty overlay must preserve source version");
});

void test("buildSemanticFileManifest reuses previous entries when mtime drifts within floating-point tolerance", async () => {
    // Regression coverage for the strict-equality `file.mtimeMs === previousEntry.mtimeMs`
    // check that previously lived in `buildSemanticFileManifest`. Real-world `fs.stat`
    // round trips — especially across filesystem precision boundaries (FAT rounding to
    // whole seconds, SMB mounts truncating sub-millisecond ticks, snapshot
    // deserialisation through JSON or SQLite) — can produce mtime values that differ
    // by a few microseconds despite pointing at the same logical file. Strict `===`
    // would mark those manifests as "changed" and force a redundant file read plus a
    // SHA-256 rehash. This test feeds a `previousManifest` whose `mtimeMs` differs
    // from the on-disk mtime by a sub-microsecond offset that is well within the
    // `Core.areNumbersApproximatelyEqual` tolerance window (~4 × EPSILON × scale, which
    // for an mtime of ~1.7e12 ms is on the order of 7 microseconds). Without the
    // epsilon-aware fix, the spy facade would observe a read on the second build;
    // with the fix, the cache hit path stays engaged and no read occurs.
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-manifest-mtime-drift-"));
    const sourcePath = path.join(projectRoot, "main.gml");
    await writeFile(sourcePath, "return 1;", "utf8");

    const initialManifest = await buildSemanticFileManifest(projectRoot, Core.defaultFsFacade);
    const initialEntry = initialManifest.entries.get("main.gml");
    assert.ok(initialEntry);
    const initialMtimeMs = initialEntry.mtimeMs;
    assert.ok(typeof initialMtimeMs === "number");

    // Construct a synthetic previousManifest whose mtimeMs drifts from the on-disk
    // value by 1 microsecond. The drift is far below the tolerance window for an
    // mtime in the 2024+ epoch range (~7 microseconds), but well above zero so a
    // strict `===` comparison would (incorrectly) treat it as a change.
    const MICROSECOND_DRIFT_MS = 1e-3;
    const driftedMtimeMs = initialMtimeMs + MICROSECOND_DRIFT_MS;
    assert.notEqual(
        driftedMtimeMs,
        initialMtimeMs,
        "Drifted mtime must differ from the on-disk value for this regression to be meaningful"
    );

    const driftedPreviousManifest = {
        entries: new Map([
            [
                "main.gml",
                {
                    ...initialEntry,
                    mtimeMs: driftedMtimeMs
                }
            ]
        ]),
        sourceRevision: initialManifest.sourceRevision
    };

    let readCount = 0;
    const spyFsFacade = {
        ...Core.defaultFsFacade,
        async readFile(filePath: string, encoding: any) {
            readCount += 1;
            return Core.defaultFsFacade.readFile(filePath, encoding);
        }
    };

    const cachedManifest = await buildSemanticFileManifest(projectRoot, spyFsFacade, [], driftedPreviousManifest);

    assert.equal(readCount, 0, "Sub-microsecond mtime drift must not force a redundant file read or rehash");
    assert.equal(cachedManifest.entries.get("main.gml")?.contentHash, initialEntry.contentHash);
});

void test("buildSemanticFileManifest invalidates the cache when mtime shifts beyond the tolerance window", async () => {
    // Companion to the mtime-drift regression above: when the gap between the cached
    // mtime and the on-disk mtime exceeds the `Core.areNumbersApproximatelyEqual`
    // tolerance window, the cache must still be invalidated so genuine content
    // changes are not silently masked. A bare `===` would also catch this case; this
    // test pins the behaviour so future tweaks to the tolerance window cannot
    // accidentally widen it to swallow real edits.
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-manifest-mtime-shifted-"));
    const sourcePath = path.join(projectRoot, "main.gml");
    await writeFile(sourcePath, "return 1;", "utf8");

    const initialManifest = await buildSemanticFileManifest(projectRoot, Core.defaultFsFacade);
    const initialEntry = initialManifest.entries.get("main.gml");
    assert.ok(initialEntry);
    const initialMtimeMs = initialEntry.mtimeMs;
    assert.ok(typeof initialMtimeMs === "number");

    // Shift the cached mtime by 1 millisecond. For an mtime of ~1.7e12 the tolerance
    // window is on the order of single-digit microseconds, so a 1ms shift is several
    // orders of magnitude beyond the epsilon band and must force a rehash.
    const MILLISECOND_SHIFT_MS = 1;
    const shiftedMtimeMs = initialMtimeMs + MILLISECOND_SHIFT_MS;
    assert.ok(Core.areNumbersApproximatelyEqual(initialMtimeMs, initialMtimeMs));
    assert.equal(
        Core.areNumbersApproximatelyEqual(initialMtimeMs, shiftedMtimeMs),
        false,
        "Sanity check: a 1ms shift must exceed the tolerance window used by the fix"
    );

    const shiftedPreviousManifest = {
        entries: new Map([
            [
                "main.gml",
                {
                    ...initialEntry,
                    mtimeMs: shiftedMtimeMs
                }
            ]
        ]),
        sourceRevision: initialManifest.sourceRevision
    };

    let readCount = 0;
    const spyFsFacade = {
        ...Core.defaultFsFacade,
        async readFile(filePath: string, encoding: any) {
            readCount += 1;
            return Core.defaultFsFacade.readFile(filePath, encoding);
        }
    };

    await buildSemanticFileManifest(projectRoot, spyFsFacade, [], shiftedPreviousManifest);

    assert.equal(readCount, 1, "A genuine mtime shift beyond the tolerance window must force a rehash");
});
