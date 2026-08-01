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
import test from "node:test";

import { runNamingConventionStressTest } from "./test-helpers/naming-convention-test-runner.js";

const WRITE_PATH_FILE_COUNT = 400;
const WRITE_PATH_TARGETS_PER_FILE = 60;
const WRITE_PATH_PERFORMANCE_THRESHOLD_MS = 1400;

void test("namingConvention write-path stress test locks in the apply-edit optimisation gain (400 files × 60 targets)", async () => {
    await runNamingConventionStressTest({
        fileCount: WRITE_PATH_FILE_COUNT,
        targetsPerFile: WRITE_PATH_TARGETS_PER_FILE,
        performanceThresholdMs: WRITE_PATH_PERFORMANCE_THRESHOLD_MS,
        testDisplayName: "write-path (400 files × 60 targets)"
    });
});
