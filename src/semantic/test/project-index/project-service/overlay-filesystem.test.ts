import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createSemanticOverlayFilesystem } from "../../../src/project-index/project-service/overlay-filesystem.js";

type OverlayStat = {
    isDirectory: () => boolean;
    isFile: () => boolean;
    mtimeMs?: number;
};

void test("overlay stats use the synthetic timestamp while disk stats remain unchanged", async () => {
    const overlayFilePath = path.resolve("/semantic-overlay", "scripts", "main.gml");
    const diskMtimeMs = 42;
    const filesystem = createSemanticOverlayFilesystem(
        {
            readFile: async () => "disk source",
            readDir: async () => [],
            stat: async () => ({ mtimeMs: diskMtimeMs })
        },
        [
            {
                absolutePath: overlayFilePath,
                contentHash: "overlay-hash",
                documentVersion: 1,
                sourceText: "overlay source"
            }
        ]
    );

    const overlayFileStat = await filesystem.stat?.(overlayFilePath);
    const overlayDirectoryStat = await filesystem.stat?.(path.dirname(overlayFilePath));
    const diskStat = await filesystem.stat?.(path.resolve("/semantic-overlay", "scripts", "other.gml"));

    if (overlayFileStat === null || overlayFileStat === undefined) {
        throw new Error("Expected an overlay file stat.");
    }
    if (overlayDirectoryStat === null || overlayDirectoryStat === undefined) {
        throw new Error("Expected an overlay directory stat.");
    }

    const overlayFile = overlayFileStat as OverlayStat;
    const overlayDirectory = overlayDirectoryStat as OverlayStat;
    assert.equal(overlayFile.isFile(), true);
    assert.equal(overlayFile.isDirectory(), false);
    assert.equal(overlayDirectory.isFile(), false);
    assert.equal(overlayDirectory.isDirectory(), true);
    assert.equal(overlayFile.mtimeMs, 0);
    assert.equal(overlayDirectory.mtimeMs, 0);
    assert.equal(Object.isFrozen(overlayFileStat), true);
    assert.equal(diskStat?.mtimeMs, diskMtimeMs);
});
