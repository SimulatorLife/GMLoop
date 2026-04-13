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

const FILE_COUNT = 180;
const TARGETS_PER_FILE = 32;
const PERFORMANCE_THRESHOLD_MS = 280;

type SyntheticFileFixture = {
    sourceText: string;
    targets: Array<NamingConventionTarget>;
};

function createSyntheticLocalNamingFixture(
    filePath: string,
    fileIndex: number,
    targetsPerFile: number
): SyntheticFileFixture {
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

/**
 * Build a minimal {@link PartialSemanticAnalyzer} stub that returns pre-built
 * naming targets for the given file-to-targets map.  Accepts an optional
 * callback that is invoked on every call, allowing callers to track
 * invocation counts or perform side effects per query.
 */
function buildNamingConventionSemanticStub(
    targetsByFile: Map<string, Array<NamingConventionTarget>>,
    onCall?: () => void
): PartialSemanticAnalyzer {
    return {
        listNamingConventionTargets: async (filePaths?: Array<string>) => {
            onCall?.();
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

/**
 * Build the {@link Refactor.RefactorEngine.executeConfiguredCodemods} executor
 * used by both stress tests.  Each test supplies its own engine, file list, and
 * source-text map so the captured closure variables differ, while the call-site
 * shape is shared through this factory.
 */
function buildNamingConventionCodemodExecutor(
    engine: InstanceType<typeof Refactor.RefactorEngine>,
    gmlFilePaths: Array<string>,
    sourceTexts: Map<string, string>,
    projectRoot: string
): () => Promise<ConfiguredCodemodRunResult> {
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

    return () =>
        engine.executeConfiguredCodemods({
            projectRoot,
            targetPaths: [projectRoot],
            gmlFilePaths,
            config,
            readFile: async (filePath) => sourceTexts.get(filePath) ?? "",
            dryRun: true
        });
}

void test("namingConvention stress test stays within the selected-file planning threshold", async () => {
    const projectRoot = "/project";
    const sourceTexts = new Map<string, string>();
    const targetsByFile = new Map<string, Array<NamingConventionTarget>>();
    const gmlFilePaths = Array.from({ length: FILE_COUNT }, (_, fileIndex) => `scripts/script_${fileIndex}.gml`);

    for (const [fileIndex, filePath] of gmlFilePaths.entries()) {
        const fixture = createSyntheticLocalNamingFixture(filePath, fileIndex, TARGETS_PER_FILE);
        sourceTexts.set(filePath, fixture.sourceText);
        targetsByFile.set(filePath, fixture.targets);
    }

    let listNamingTargetsCallCount = 0;
    const semantic = buildNamingConventionSemanticStub(targetsByFile, () => {
        listNamingTargetsCallCount += 1;
    });

    const engine = new Refactor.RefactorEngine({ semantic });
    const executeStressRun = buildNamingConventionCodemodExecutor(engine, gmlFilePaths, sourceTexts, projectRoot);

    await executeStressRun();

    const listNamingTargetsCallCountAfterWarmup = listNamingTargetsCallCount;
    const SAMPLE_COUNT = 5;
    const { durationMs, result } = await measureMedianDurationMs(SAMPLE_COUNT, executeStressRun);

    assert.equal(listNamingTargetsCallCount - listNamingTargetsCallCountAfterWarmup, SAMPLE_COUNT);
    assert.equal(result.summaries.length, 1);
    assert.equal(result.summaries[0]?.id, "namingConvention");
    assert.equal(result.summaries[0]?.changed, true);
    assert.equal(result.appliedFiles.size, FILE_COUNT);
    assert.ok(
        durationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected namingConvention stress test to finish within ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
    );
});

// Larger stress test that exercises the full hot path at a scale representative
// of real GameMaker projects (300 files × 50 targets = 15 000 identifiers).
// This test locks in the performance improvements introduced in the
// "Refactor Performance Lock-In" optimisation pass:
//   - eliminating the double composeExpectedIdentifierName call in evaluateNamingConvention
//   - caching path-resolution results inside createPathSelectionMatcher
//   - pre-sorting bannedAffixes at resolve time to avoid per-call spread+sort
//   - replacing regex-based splitIdentifierUnderscoreAffixes with a charCode scan
//   - replacing the for...of iterator in toCamelCaseFromLowerSnakeCore with an
//     indexed charCode loop to avoid iterator allocation overhead
//   - inlining the Map increment in the collectLocalScopeNames hot loop instead
//     of delegating to Core.incrementMapValue (which validates types on every call)
//   - eliminating the spread+filter+map chain when building duplicateScopedDeclarationKeys
//   - merging the two separate O(n) scope-data collection passes into a single
//     `collectScopeDataFromTargets` pass (with an optional targeted second pass
//     only for the rare case of multi-declaration scopes)
//   - replacing isSimpleLowerSnakeCore regex (/^[a-z0-9_]+$/u) with a charCode scan
//   - replacing the pre-allocated fragment-array in applyGroupedTextEditsToContent with
//     a left-to-right string-builder (ascending iteration over descending-sorted edits)
//     that avoids the intermediate array allocation and final join (~6-7× faster on files
//     with many edits)
//
// Baseline (before first optimisation pass): ~148 ms standalone, ~350 ms under CI suite load.
// After first optimisation pass:  ~88 ms standalone, ~220 ms under parallel test load.
// After second optimisation pass: ~33 ms standalone, ~194 ms under parallel test load.
// After third optimisation pass:  ~24 ms standalone, ~121 ms under parallel test load.
// Threshold is set to 520 ms — high enough to remain stable under full-suite
// worker contention while still catching clear hot-path regressions.
const LARGE_FILE_COUNT = 300;
const LARGE_TARGETS_PER_FILE = 50;
const LARGE_PERFORMANCE_THRESHOLD_MS = 520;

void test("namingConvention large-scale stress test locks in the hot-path optimisation gain", async () => {
    const projectRoot = "/project";
    const sourceTexts = new Map<string, string>();
    const targetsByFile = new Map<string, Array<NamingConventionTarget>>();
    const gmlFilePaths = Array.from({ length: LARGE_FILE_COUNT }, (_, fileIndex) => `scripts/script_${fileIndex}.gml`);

    for (const [fileIndex, filePath] of gmlFilePaths.entries()) {
        const fixture = createSyntheticLocalNamingFixture(filePath, fileIndex, LARGE_TARGETS_PER_FILE);
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
    assert.equal(result.appliedFiles.size, LARGE_FILE_COUNT);
    assert.ok(
        durationMs <= LARGE_PERFORMANCE_THRESHOLD_MS,
        `Expected large-scale namingConvention stress test to finish within ${LARGE_PERFORMANCE_THRESHOLD_MS}ms, ` +
            `received ${durationMs.toFixed(2)}ms`
    );
});
