import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { resolveIndexedRootTargetGmlFiles } from "../src/commands/refactor-target-gml-files.js";

const INDEXED_GML_FILE_COUNT = 5000;
const INDEXED_NON_GML_FILE_COUNT = 5000;
const PERFORMANCE_THRESHOLD_MS = 45;

type IndexedFileRecord = {
    checksum: string;
};

function createSyntheticProjectIndex(): { files: Record<string, IndexedFileRecord> } {
    const files: Record<string, IndexedFileRecord> = {};

    for (let index = 0; index < INDEXED_GML_FILE_COUNT; index += 1) {
        files[`scripts/script_${index}.gml`] = {
            checksum: `gml-${index}`
        };
    }

    for (let index = 0; index < INDEXED_NON_GML_FILE_COUNT; index += 1) {
        files[`scripts/script_${index}.yy`] = {
            checksum: `yy-${index}`
        };
    }

    return { files };
}

void test("indexed root-target gml discovery stays within the runtime threshold", () => {
    const projectRoot = "/project";
    const targetPaths = [projectRoot];
    const projectIndex = createSyntheticProjectIndex();

    const warmup = resolveIndexedRootTargetGmlFiles(projectRoot, targetPaths, projectIndex);
    assert.equal(warmup?.length, 10_000);

    const startTime = performance.now();
    const result = resolveIndexedRootTargetGmlFiles(projectRoot, targetPaths, projectIndex);
    const durationMs = performance.now() - startTime;

    assert.equal(result?.length, 10_000);
    assert.equal(result?.[0], "scripts/script_0.gml");
    assert.ok(
        durationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected indexed root-target discovery under ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
    );
});
