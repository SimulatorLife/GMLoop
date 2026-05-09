/**
 * Shared test runner helpers for naming-convention codemod performance tests.
 *
 * Encapsulates the common test setup and execution pattern used across all
 * naming-convention stress tests to eliminate duplicated test body code.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { Refactor } from "../../index.js";
import type { ConfiguredCodemodRunResult, NamingConventionTarget } from "../../src/types.js";
import {
    buildNamingConventionCodemodExecutor,
    buildNamingConventionSemanticStub,
    buildSingleTargetOccurrences,
    createSyntheticLocalNamingFixture,
    type SyntheticFileFixture
} from "./naming-convention-test-fixtures.js";

export type NamingConventionTestParameters = {
    /** Number of synthetic GML files to generate for the test. */
    fileCount: number;
    /** Number of naming targets per file. */
    targetsPerFile: number;
    /** Maximum median duration in ms before the test fails. */
    performanceThresholdMs: number;
    /** Display name used in error messages. */
    testDisplayName?: string;
    /**
     * Custom fixture factory. When provided, this replaces the default
     * `createSyntheticLocalNamingFixture`. Useful for tests that need
     * non-default scope or occurrence behavior.
     */
    fixtureFactory?: (filePath: string, fileIndex: number, targetsPerFile: number) => SyntheticFileFixture;
    /**
     * When provided, all generated targets share this scopeId instead of
     * receiving per-target unique scopeIds.  Intended for tests exercising
     * duplicate-scope or multi-declaration handling in the planner hot path.
     */
    sharedScopeId?: string;
    /**
     * When `true`, each declaration produces two targets with identical
     * occurrences.  This exercises the duplicate-scoped declaration handling
     * path in the naming-convention planner hot loop.
     */
    duplicateTargetsPerDeclaration?: boolean;
};

/**
 * Run a naming-convention codemod stress test with the given parameters.
 *
 * This function encapsulates the common test setup pattern:
 *   1. Generate `fileCount` synthetic GML files with `targetsPerFile` targets each.
 *   2. Build a stub semantic analyzer that returns the generated targets.
 *   3. Execute the naming-convention codemod and measure median duration.
 *   4. Assert correctness of the result and performance threshold.
 *
 * @param parameters - Test parameters including file count, targets per file,
 *                     threshold, and optional custom fixture factory.
 * @param onWarmup - Optional callback invoked after the warmup run but before
 *                   the measured samples begin. Callers can use this to capture
 *                   warmup state (e.g., call counts).
 * @param onSample - Optional callback invoked after each measured sample.
 */
export async function runNamingConventionStressTest(
    parameters: NamingConventionTestParameters,
    onWarmup?: (result: ConfiguredCodemodRunResult) => void,
    onSample?: (sampleIndex: number, result: ConfiguredCodemodRunResult) => void
): Promise<{
    durationMs: number;
    result: ConfiguredCodemodRunResult;
}> {
    const {
        fileCount,
        targetsPerFile,
        performanceThresholdMs,
        testDisplayName,
        fixtureFactory: explicitFactory,
        sharedScopeId,
        duplicateTargetsPerDeclaration
    } = parameters;

    const projectRoot = "/project";
    const sourceTexts = new Map<string, string>();
    const targetsByFile = new Map<string, Array<NamingConventionTarget>>();
    const gmlFilePaths = Array.from({ length: fileCount }, (_, fileIndex) => `scripts/script_${fileIndex}.gml`);

    for (const [fileIndex, filePath] of gmlFilePaths.entries()) {
        const fixture = explicitFactory
            ? explicitFactory(filePath, fileIndex, targetsPerFile)
            : buildTestFixture(filePath, fileIndex, targetsPerFile, sharedScopeId, duplicateTargetsPerDeclaration);
        sourceTexts.set(filePath, fixture.sourceText);
        targetsByFile.set(filePath, fixture.targets);
    }

    const semantic = buildNamingConventionSemanticStub(targetsByFile);
    const engine = new Refactor.RefactorEngine({ semantic });
    const executeStressRun = buildNamingConventionCodemodExecutor(engine, gmlFilePaths, sourceTexts, projectRoot);

    // Warm up JIT and module caches before measuring.
    const warmupResult = await executeStressRun();
    onWarmup?.(warmupResult);

    const SAMPLE_COUNT = 5;
    const samples: Array<{ durationMs: number; result: ConfiguredCodemodRunResult }> = [];
    const samplePromises: Array<Promise<{ durationMs: number; result: ConfiguredCodemodRunResult }>> = [];
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
        samplePromises.push(
            (async () => {
                const startTime = performance.now();
                const result = await executeStressRun();
                return { durationMs: performance.now() - startTime, result };
            })()
        );
    }

    const completedSamples = await Promise.all(samplePromises);
    for (const [sampleIndex, sample] of completedSamples.entries()) {
        samples.push(sample);
        onSample?.(sampleIndex, sample.result);
    }

    const sortedDurations = samples.map((s) => s.durationMs).sort((a, b) => a - b);
    const medianIndex = Math.floor(sortedDurations.length / 2);
    const durationMs = sortedDurations[medianIndex];
    const lastSample = completedSamples[SAMPLE_COUNT - 1];
    const latestResult = lastSample.result;

    const displayName = testDisplayName ?? `${fileCount} files × ${targetsPerFile} targets`;

    assert.equal(latestResult.summaries.length, 1, `Expected exactly one codemod summary in ${displayName} test`);
    assert.equal(
        latestResult.summaries[0]?.id,
        "namingConvention",
        `Expected namingConvention codemod in ${displayName} test`
    );
    assert.equal(
        latestResult.summaries[0]?.changed,
        true,
        `Expected codemod to produce changes in ${displayName} test`
    );
    assert.equal(
        latestResult.appliedFiles.size,
        fileCount,
        `Expected ${fileCount} changed files in ${displayName} test`
    );
    assert.ok(
        durationMs <= performanceThresholdMs,
        `Expected ${displayName} stress test to finish within ${performanceThresholdMs}ms, received ${durationMs.toFixed(2)}ms`
    );

    return { durationMs, result: latestResult };
}

/**
 * Internal fixture builder used when the caller does not supply an explicit
 * factory.  Supports shared-scope and duplicate-target scenarios by wrapping
 * the base fixture helper.
 */
function buildTestFixture(
    filePath: string,
    fileIndex: number,
    targetsPerFile: number,
    sharedScopeId: string | undefined,
    duplicateTargetsPerDeclaration: boolean | undefined
): SyntheticFileFixture {
    if (duplicateTargetsPerDeclaration) {
        // For the duplicate-scope scenario, build targets directly here to
        // avoid exporting the internal occurrence structure.
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

            const occurrences = buildSingleTargetOccurrences(
                filePath,
                declarationStart,
                referenceStart,
                currentName.length,
                sharedScopeId ?? "shared_scope"
            );

            targets.push(
                {
                    category: "localVariable",
                    name: currentName,
                    path: filePath,
                    scopeId: sharedScopeId ?? "shared_scope",
                    symbolId: null,
                    occurrences
                },
                {
                    category: "localVariable",
                    name: currentName,
                    path: filePath,
                    scopeId: sharedScopeId ?? "shared_scope",
                    symbolId: null,
                    occurrences
                }
            );

            offset += declarationLine.length + referenceLine.length;
        }

        return {
            sourceText: lines.join(""),
            targets
        };
    }

    return createSyntheticLocalNamingFixture(filePath, fileIndex, targetsPerFile, sharedScopeId);
}
