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
import { performance } from "node:perf_hooks";
import test from "node:test";

import { Refactor } from "../index.js";
import type {
    ConfiguredCodemodRunResult,
    NamingConventionTarget,
    PartialSemanticAnalyzer,
    RefactorProjectConfig
} from "../src/types.js";

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

type SyntheticFileFixture = {
    sourceText: string;
    targets: Array<NamingConventionTarget>;
};

function createSyntheticFixture(filePath: string, fileIndex: number, targetsPerFile: number): SyntheticFileFixture {
    const lines: Array<string> = [];
    const targets: Array<NamingConventionTarget> = [];
    let offset = 0;

    for (let targetIndex = 0; targetIndex < targetsPerFile; targetIndex += 1) {
        const currentName = `bad_name_${fileIndex}_${targetIndex}`;
        const declarationLine = `var ${currentName} = ${targetIndex};\n`;
        const referenceLine = `show_debug_message(${currentName});\n`;
        const declarationStart = offset + declarationLine.indexOf(currentName);
        const referenceStart = offset + declarationLine.length + referenceLine.indexOf(currentName);

        lines.push(declarationLine, referenceLine);
        targets.push({
            name: currentName,
            category: "localVariable",
            path: filePath,
            scopeId: `scope:${fileIndex}:${targetIndex}`,
            symbolId: null,
            occurrences: [
                {
                    path: filePath,
                    start: declarationStart,
                    end: declarationStart + currentName.length,
                    kind: Refactor.OccurrenceKind.DEFINITION,
                    scopeId: `scope:${fileIndex}:${targetIndex}`
                },
                {
                    path: filePath,
                    start: referenceStart,
                    end: referenceStart + currentName.length,
                    kind: Refactor.OccurrenceKind.REFERENCE,
                    scopeId: `scope:${fileIndex}:${targetIndex}`
                }
            ]
        });

        offset += declarationLine.length + referenceLine.length;
    }

    return {
        sourceText: lines.join(""),
        targets
    };
}

function buildSemanticStub(targetsByFile: Map<string, Array<NamingConventionTarget>>): PartialSemanticAnalyzer {
    return {
        listNamingConventionTargets: async (filePaths?: Array<string>) => {
            const selectedPaths = filePaths === undefined ? null : new Set(filePaths);
            const matchingTargets: Array<NamingConventionTarget> = [];

            for (const [filePath, targets] of targetsByFile.entries()) {
                const resourcePath = filePath.replace(/\.gml$/i, ".yy");
                if (selectedPaths !== null && !selectedPaths.has(filePath) && !selectedPaths.has(resourcePath)) {
                    continue;
                }

                matchingTargets.push(...targets);
            }

            return matchingTargets;
        },
        validateEdits: async () => ({
            errors: [],
            warnings: []
        })
    };
}

async function measureMedianDurationMs<T>(
    sampleCount: number,
    execute: () => Promise<T>
): Promise<{
    durationMs: number;
    result: T;
}> {
    const samples = await Promise.all(
        Array.from({ length: sampleCount }, async () => {
            const startTime = performance.now();
            const result = await execute();
            return {
                durationMs: performance.now() - startTime,
                result
            };
        })
    );

    const sortedDurations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
    const medianSampleIndex = Math.floor(sortedDurations.length / 2);
    const medianDuration = sortedDurations[medianSampleIndex];
    const latestSample = samples.at(-1);

    if (latestSample === undefined || medianDuration === undefined) {
        throw new Error("measureMedianDurationMs requires at least one sample");
    }

    return {
        durationMs: medianDuration,
        result: latestSample.result
    };
}

void test(`end-to-end codemod execution stays within regression threshold (${FILE_COUNT} files × ${TARGETS_PER_FILE} targets = ${TOTAL_EDITS} edits)`, async () => {
    const projectRoot = "/project";
    const sourceTexts = new Map<string, string>();
    const targetsByFile = new Map<string, Array<NamingConventionTarget>>();
    const gmlFilePaths = Array.from({ length: FILE_COUNT }, (_, fileIndex) => `scripts/script_${fileIndex}.gml`);

    for (const [fileIndex, filePath] of gmlFilePaths.entries()) {
        const fixture = createSyntheticFixture(filePath, fileIndex, TARGETS_PER_FILE);
        sourceTexts.set(filePath, fixture.sourceText);
        targetsByFile.set(filePath, fixture.targets);
    }

    const semantic = buildSemanticStub(targetsByFile);
    const engine = new Refactor.RefactorEngine({ semantic });

    const config: RefactorProjectConfig = {
        codemods: {
            namingConvention: {
                rules: {
                    localVariable: {
                        caseStyle: "camel"
                    }
                }
            }
        }
    };

    const executeCodemod = (): Promise<ConfiguredCodemodRunResult> =>
        engine.executeConfiguredCodemods({
            projectRoot,
            targetPaths: [projectRoot],
            gmlFilePaths,
            config,
            readFile: async (filePath) => sourceTexts.get(filePath) ?? "",
            dryRun: true
        });

    // Warm up JIT and module caches before measuring.
    await executeCodemod();

    const SAMPLE_COUNT = 5;
    const { durationMs, result } = await measureMedianDurationMs(SAMPLE_COUNT, executeCodemod);

    // Verify correctness of the codemod execution.
    assert.equal(result.summaries.length, 1, "Expected exactly one codemod summary");
    assert.equal(result.summaries[0]?.id, "namingConvention", "Expected namingConvention codemod");
    assert.equal(result.summaries[0]?.changed, true, "Expected codemod to produce changes");
    assert.equal(result.appliedFiles.size, FILE_COUNT, `Expected ${FILE_COUNT} changed files`);

    // Verify that the applied content contains the expected camelCase renames.
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
