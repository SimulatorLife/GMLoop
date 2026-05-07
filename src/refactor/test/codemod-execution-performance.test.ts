/**
 * End-to-end codemod execution performance regression guard.
 *
 * Exercises the full `executeRegisteredCodemods` pipeline at a scale
 * representative of realistic GameMaker projects: 500 files with mixed
 * naming-convention violations and localvar content, exercising the
 * complete edit-identity, workspace-edit, and apply-edit hot path.
 *
 * This test locks in the following optimisations:
 *
 *   1. **Template-literal edit identity key** (`createTextEditIdentityKey`):
 *      Replaced the `[path, start, end, newText].join(delimiter)` pattern
 *      with a template literal to avoid an intermediate array allocation on
 *      every `addEdit` call.
 *
 *   2. **Iterative workspace-edit application** (`applyWorkspaceEdit`):
 *      Replaced recursive async calls (`applyNextTextEditGroup`,
 *      `applyNextMetadataEdit`, `applyNextFileRename`) with simple for-of
 *      loops to eliminate per-file Promise frame creation overhead.
 *
 *   3. **Reverse-index file invalidation** (`SemanticQueryCache.invalidateFile`):
 *      Maintains a `Map<filePath, Set<cacheKey>>` reverse index so that
 *      invalidating a file's occurrence cache entries is O(k) instead of
 *      O(n×m) full-scan.
 *
 * This test is kept in its own file so that Node's test runner spawns it in a
 * dedicated worker process, preventing intra-file concurrency from inflating
 * timings.
 *
 * The threshold is calibrated for full-suite worker contention while still
 * catching algorithmic regressions in the codemod execution pipeline.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";
import {
    buildNamingConventionCodemodExecutor,
    buildNamingConventionSemanticStub,
    createSyntheticLocalNamingFixture
} from "./test-helpers/naming-convention-test-fixtures.js";
import { measureMedianDurationMs } from "./test-helpers/performance-timing.js";

const FILE_COUNT = 500;
const TARGETS_PER_FILE = 40;
const TOTAL_EDITS = FILE_COUNT * TARGETS_PER_FILE * 2;

/**
 * Performance threshold for end-to-end codemod execution.
 *
 * At 500 files × 40 targets = 20,000 identifiers (40,000 total edits
 * counting declaration + reference for each), the threshold must
 * accommodate both the naming-convention planning path and the full
 * workspace-edit application path including identity-key construction
 * and edit deduplication.
 *
 * Calibrated to remain stable under full-suite worker contention.
 */
const PERFORMANCE_THRESHOLD_MS = 1100;

void test(`end-to-end codemod execution stays within regression threshold (${FILE_COUNT} files × ${TARGETS_PER_FILE} targets = ${TOTAL_EDITS} edits)`, async () => {
    const projectRoot = "/project";
    const sourceTexts = new Map<string, string>();
    const targetsByFile = new Map<string, import("../src/types.js").NamingConventionTarget[]>();
    const gmlFilePaths = Array.from({ length: FILE_COUNT }, (_, fileIndex) => `scripts/script_${fileIndex}.gml`);

    for (const [fileIndex, filePath] of gmlFilePaths.entries()) {
        const fixture = createSyntheticLocalNamingFixture(filePath, fileIndex, TARGETS_PER_FILE);
        sourceTexts.set(filePath, fixture.sourceText);
        targetsByFile.set(filePath, fixture.targets);
    }

    const semantic = buildNamingConventionSemanticStub(targetsByFile);
    const engine = new Refactor.RefactorEngine({ semantic });
    const executeCodemod = buildNamingConventionCodemodExecutor(engine, gmlFilePaths, sourceTexts, projectRoot);

    // Warm up JIT and module caches before measuring.
    await executeCodemod();

    const SAMPLE_COUNT = 5;
    const { durationMs, result } = await measureMedianDurationMs(SAMPLE_COUNT, executeCodemod);

    assert.equal(result.summaries.length, 1, "Expected exactly one codemod summary");
    assert.equal(result.summaries[0]?.id, "namingConvention", "Expected namingConvention codemod");
    assert.equal(result.summaries[0]?.changed, true, "Expected codemod to produce changes");
    assert.equal(result.appliedFiles.size, FILE_COUNT, `Expected ${FILE_COUNT} changed files`);

    const sampleFile = result.appliedFiles.get(gmlFilePaths[0]);
    assert.ok(sampleFile !== undefined, "Expected first file to have applied content");
    assert.ok(sampleFile.includes("badName00"), "Expected camelCase rename to be applied in output content");
    assert.ok(!sampleFile.includes("bad_name_0_0"), "Expected original snake_case name to be replaced in output");

    assert.ok(
        durationMs <= PERFORMANCE_THRESHOLD_MS,
        `End-to-end codemod execution took ${durationMs.toFixed(2)}ms, ` +
            `expected ≤${PERFORMANCE_THRESHOLD_MS}ms (${FILE_COUNT} files × ${TARGETS_PER_FILE} targets)`
    );
});
