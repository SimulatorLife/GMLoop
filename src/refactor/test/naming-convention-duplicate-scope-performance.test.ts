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

const FILE_COUNT = 220;
const DUPLICATE_DECLARATIONS_PER_FILE = 36;
// Parallel-sample median baseline on commit 8326bc8d5955b0aa972069251b29f141dd6405b1: ~832ms.
// After duplicate-declaration keying optimization: ~682ms on the same workload.
// Threshold keeps CI headroom while guarding against regression toward baseline.
const PERFORMANCE_THRESHOLD_MS = 1400;
const MULTI_DECLARATION_SCOPE_PER_FILE = 60;
// Standalone benchmark (April 19, 2026):
//   before lazy scope-decision allocation: median ~72.98ms
//   after  lazy scope-decision allocation: median ~66.11ms
// Threshold allows CI worker contention while guarding against regressions
// that reintroduce per-target Map allocations in this hot path.
const MULTI_DECLARATION_SCOPE_THRESHOLD_MS = 600;

type SyntheticFileFixture = {
    sourceText: string;
    targets: Array<NamingConventionTarget>;
};

function createDuplicateScopeFixture(filePath: string, fileIndex: number): SyntheticFileFixture {
    const lines: Array<string> = [];
    const targets: Array<NamingConventionTarget> = [];
    let offset = 0;

    for (let duplicateIndex = 0; duplicateIndex < DUPLICATE_DECLARATIONS_PER_FILE; duplicateIndex += 1) {
        const currentName = `bad_name_${fileIndex}_${duplicateIndex}`;
        const declarationLine = `var ${currentName} = ${duplicateIndex};\n`;
        const referenceLine = `show_debug_message(${currentName});\n`;
        const declarationStart = offset + declarationLine.indexOf(currentName);
        const referenceStart = offset + declarationLine.length + referenceLine.indexOf(currentName);

        lines.push(declarationLine, referenceLine);

        const duplicateTargetOccurrences = [
            {
                path: filePath,
                start: declarationStart,
                end: declarationStart + currentName.length,
                kind: Refactor.OccurrenceKind.DEFINITION,
                scopeId: "shared_scope"
            },
            {
                path: filePath,
                start: referenceStart,
                end: referenceStart + currentName.length,
                kind: Refactor.OccurrenceKind.REFERENCE,
                scopeId: "shared_scope"
            }
        ];

        // Duplicate semantic row for the same declaration to exercise duplicate-scoped
        // declaration handling in the naming-convention planner hot path.
        targets.push(
            {
                category: "localVariable",
                name: currentName,
                path: filePath,
                scopeId: "shared_scope",
                symbolId: null,
                occurrences: duplicateTargetOccurrences
            },
            {
                category: "localVariable",
                name: currentName,
                path: filePath,
                scopeId: "shared_scope",
                symbolId: null,
                occurrences: duplicateTargetOccurrences
            }
        );

        offset += declarationLine.length + referenceLine.length;
    }

    return {
        sourceText: lines.join(""),
        targets
    };
}

function createMultiDeclarationScopeFixture(filePath: string, fileIndex: number): SyntheticFileFixture {
    const lines: Array<string> = [];
    const targets: Array<NamingConventionTarget> = [];
    let offset = 0;

    for (let declarationIndex = 0; declarationIndex < MULTI_DECLARATION_SCOPE_PER_FILE; declarationIndex += 1) {
        const currentName = `bad_name_${fileIndex}_${declarationIndex}`;
        const declarationLine = `var ${currentName} = ${declarationIndex};\n`;
        const referenceLine = `show_debug_message(${currentName});\n`;
        const declarationStart = offset + declarationLine.indexOf(currentName);
        const referenceStart = offset + declarationLine.length + referenceLine.indexOf(currentName);

        lines.push(declarationLine, referenceLine);
        targets.push({
            category: "localVariable",
            name: currentName,
            path: filePath,
            scopeId: "shared_scope",
            symbolId: null,
            occurrences: [
                {
                    path: filePath,
                    start: declarationStart,
                    end: declarationStart + currentName.length,
                    kind: Refactor.OccurrenceKind.DEFINITION,
                    scopeId: "shared_scope"
                },
                {
                    path: filePath,
                    start: referenceStart,
                    end: referenceStart + currentName.length,
                    kind: Refactor.OccurrenceKind.REFERENCE,
                    scopeId: "shared_scope"
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

function createNamingConventionConfig(): RefactorProjectConfig {
    return {
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
}

function buildNamingConventionExecutor(parameters: {
    engine: InstanceType<typeof Refactor.RefactorEngine>;
    projectRoot: string;
    gmlFilePaths: Array<string>;
    sourceTexts: Map<string, string>;
}): () => Promise<ConfiguredCodemodRunResult> {
    const { engine, projectRoot, gmlFilePaths, sourceTexts } = parameters;
    const config = createNamingConventionConfig();
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

void test("namingConvention duplicate-scope stress test stays within the planner threshold", async () => {
    const projectRoot = "/project";
    const sourceTexts = new Map<string, string>();
    const targetsByFile = new Map<string, Array<NamingConventionTarget>>();
    const gmlFilePaths = Array.from({ length: FILE_COUNT }, (_, fileIndex) => `scripts/script_${fileIndex}.gml`);

    for (const [fileIndex, filePath] of gmlFilePaths.entries()) {
        const fixture = createDuplicateScopeFixture(filePath, fileIndex);
        sourceTexts.set(filePath, fixture.sourceText);
        targetsByFile.set(filePath, fixture.targets);
    }

    const semantic = buildSemanticStub(targetsByFile);
    const engine = new Refactor.RefactorEngine({ semantic });

    const executeCodemod = buildNamingConventionExecutor({
        engine,
        projectRoot,
        gmlFilePaths,
        sourceTexts
    });

    await executeCodemod();

    const SAMPLE_COUNT = 5;
    const { durationMs, result } = await measureMedianDurationMs(SAMPLE_COUNT, executeCodemod);

    assert.equal(result.summaries.length, 1);
    assert.equal(result.summaries[0]?.id, "namingConvention");
    assert.equal(result.summaries[0]?.changed, true);
    assert.equal(result.appliedFiles.size, FILE_COUNT);
    assert.ok(
        durationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected duplicate-scope namingConvention stress test to finish within ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
    );
});

void test("namingConvention multi-declaration scopes stay within allocation-regression threshold", async () => {
    const projectRoot = "/project";
    const sourceTexts = new Map<string, string>();
    const targetsByFile = new Map<string, Array<NamingConventionTarget>>();
    const gmlFilePaths = Array.from({ length: FILE_COUNT }, (_, fileIndex) => `scripts/script_${fileIndex}.gml`);

    for (const [fileIndex, filePath] of gmlFilePaths.entries()) {
        const fixture = createMultiDeclarationScopeFixture(filePath, fileIndex);
        sourceTexts.set(filePath, fixture.sourceText);
        targetsByFile.set(filePath, fixture.targets);
    }

    const semantic = buildSemanticStub(targetsByFile);
    const engine = new Refactor.RefactorEngine({ semantic });

    const executeCodemod = buildNamingConventionExecutor({
        engine,
        projectRoot,
        gmlFilePaths,
        sourceTexts
    });

    await executeCodemod();

    const SAMPLE_COUNT = 5;
    const { durationMs, result } = await measureMedianDurationMs(SAMPLE_COUNT, executeCodemod);

    assert.equal(result.summaries.length, 1);
    assert.equal(result.summaries[0]?.id, "namingConvention");
    assert.equal(result.summaries[0]?.changed, true);
    assert.equal(result.appliedFiles.size, FILE_COUNT);
    assert.ok(
        durationMs <= MULTI_DECLARATION_SCOPE_THRESHOLD_MS,
        `Expected multi-declaration namingConvention stress test to finish within ${MULTI_DECLARATION_SCOPE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
    );
});
