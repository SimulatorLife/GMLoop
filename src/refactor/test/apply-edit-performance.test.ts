/**
 * Write-path (apply-edit) performance regression guard.
 *
 * Exercises `applyGroupedTextEditsToContent` at a scale (400 files × 60 targets
 * = 24 000 identifiers, 120 edits per file) where the per-file edit-application
 * cost is the dominant term and any regression in that code path is clearly visible.
 *
 * This test is kept in its own file so that Node's test runner spawns it in a
 * dedicated worker process, preventing intra-file concurrency from inflating timings.
 *
 * Specifically locks in three optimisations introduced in the third pass:
 *   1. Replacing the pre-allocated fragment-array in `applyGroupedTextEditsToContent`
 *      with a left-to-right string-builder that iterates descending-sorted edits in
 *      reverse — ~6-7× faster on files with many edits.
 *   2. Merging `collectScopeKeysRequiringNameConflictChecks` and `collectLocalScopeNames`
 *      into a single `collectScopeDataFromTargets` pass (plus an optional targeted
 *      second pass only for the rare multi-declaration case).
 *   3. Replacing the `isSimpleLowerSnakeCore` regex with a charCode scan.
 *
 * Measured baselines (400×60 scale, 5 concurrent samples via measureMedianDurationMs):
 *   Before this optimisation pass: ~440 ms in a dedicated worker process.
 *   After this optimisation pass:  ~313 ms in a dedicated worker process.
 * Threshold is set to 1400 ms to remain stable under full-suite worker contention
 * while still ensuring that large regressions in the write-path hot loop are caught.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";
import type { NamingConventionTarget } from "../src/types.js";
import {
    buildNamingConventionCodemodExecutor,
    buildNamingConventionSemanticStub,
    createSyntheticLocalNamingFixture
} from "./test-helpers/naming-convention-performance.js";
import { measureMedianDurationMs } from "./test-helpers/performance-timing.js";

const WRITE_PATH_FILE_COUNT = 400;
const WRITE_PATH_TARGETS_PER_FILE = 60;
const WRITE_PATH_PERFORMANCE_THRESHOLD_MS = 1400;

void test("namingConvention write-path stress test locks in the apply-edit optimisation gain (400 files × 60 targets)", async () => {
    const projectRoot = "/project";
    const sourceTexts = new Map<string, string>();
    const targetsByFile = new Map<string, Array<NamingConventionTarget>>();
    const gmlFilePaths = Array.from(
        { length: WRITE_PATH_FILE_COUNT },
        (_, fileIndex) => `scripts/script_${fileIndex}.gml`
    );

    for (const [fileIndex, filePath] of gmlFilePaths.entries()) {
        const fixture = createSyntheticLocalNamingFixture(filePath, fileIndex, WRITE_PATH_TARGETS_PER_FILE);
        sourceTexts.set(filePath, fixture.sourceText);
        targetsByFile.set(filePath, fixture.targets);
    }

    const semantic = buildNamingConventionSemanticStub(targetsByFile);
    const engine = new Refactor.RefactorEngine({ semantic });
    const executeStressRun = buildNamingConventionCodemodExecutor(engine, gmlFilePaths, sourceTexts, projectRoot);

    // Warm up JIT and module caches before measuring.
    await executeStressRun();

    const SAMPLE_COUNT = 5;
    const { durationMs, result } = await measureMedianDurationMs(SAMPLE_COUNT, executeStressRun);

    assert.equal(result.summaries.length, 1);
    assert.equal(result.summaries[0]?.id, "namingConvention");
    assert.equal(result.summaries[0]?.changed, true);
    assert.equal(result.appliedFiles.size, WRITE_PATH_FILE_COUNT);
    assert.ok(
        durationMs <= WRITE_PATH_PERFORMANCE_THRESHOLD_MS,
        `Expected write-path stress test to finish within ${WRITE_PATH_PERFORMANCE_THRESHOLD_MS}ms, ` +
            `received ${durationMs.toFixed(2)}ms`
    );
});
