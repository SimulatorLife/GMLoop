import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { Refactor } from "../index.js";
import type { NamingConventionTarget, PartialSemanticAnalyzer, RefactorProjectConfig } from "../src/types.js";

const SMALL_FILE_COUNT = 1000;
const LARGE_FILE_COUNT = 6000;
const SAMPLE_COUNT = 3;
const LARGE_DURATION_THRESHOLD_MS = 550;
const MAX_SCALING_RATIO = 7;

type SyntheticProjectFixture = {
    sourceTexts: Map<string, string>;
    gmlFilePaths: Array<string>;
    targetsByFilePath: Map<string, Array<NamingConventionTarget>>;
};

function createSyntheticProjectFixture(fileCount: number): SyntheticProjectFixture {
    const sourceTexts = new Map<string, string>();
    const gmlFilePaths: Array<string> = [];
    const targetsByFilePath = new Map<string, Array<NamingConventionTarget>>();

    for (let fileIndex = 0; fileIndex < fileCount; fileIndex += 1) {
        const filePath = `scripts/script_${fileIndex}.gml`;
        const identifierName = `bad_name_${fileIndex}`;
        const sourceText = `var ${identifierName} = ${fileIndex};\nshow_debug_message(${identifierName});\n`;
        const declarationStart = sourceText.indexOf(identifierName);
        const referenceStart = sourceText.lastIndexOf(identifierName);

        sourceTexts.set(filePath, sourceText);
        gmlFilePaths.push(filePath);
        targetsByFilePath.set(filePath, [
            {
                name: identifierName,
                category: "localVariable",
                path: filePath,
                scopeId: `scope:${fileIndex}`,
                symbolId: null,
                occurrences: [
                    {
                        path: filePath,
                        start: declarationStart,
                        end: declarationStart + identifierName.length,
                        kind: Refactor.OccurrenceKind.DEFINITION,
                        scopeId: `scope:${fileIndex}`
                    },
                    {
                        path: filePath,
                        start: referenceStart,
                        end: referenceStart + identifierName.length,
                        kind: Refactor.OccurrenceKind.REFERENCE,
                        scopeId: `scope:${fileIndex}`
                    }
                ]
            }
        ]);
    }

    return {
        sourceTexts,
        gmlFilePaths,
        targetsByFilePath
    };
}

function createNamingConventionSemanticStub(
    targetsByFilePath: ReadonlyMap<string, Array<NamingConventionTarget>>
): PartialSemanticAnalyzer {
    return {
        listNamingConventionTargets: async (filePaths?: Array<string>) => {
            const selectedPaths = filePaths === undefined ? null : new Set(filePaths);
            const targets: Array<NamingConventionTarget> = [];

            for (const [filePath, fileTargets] of targetsByFilePath.entries()) {
                const resourcePath = filePath.replace(/\.gml$/iu, ".yy");
                if (selectedPaths !== null && !selectedPaths.has(filePath) && !selectedPaths.has(resourcePath)) {
                    continue;
                }

                targets.push(...fileTargets);
            }

            return targets;
        },
        validateEdits: async () => ({
            errors: [],
            warnings: []
        })
    };
}

const NAMING_CONVENTION_CONFIG: RefactorProjectConfig = {
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

async function measureMedianCodemodWriteDurationMs(fileCount: number): Promise<number> {
    const fixture = createSyntheticProjectFixture(fileCount);
    const semantic = createNamingConventionSemanticStub(fixture.targetsByFilePath);
    const engine = new Refactor.RefactorEngine({ semantic });

    const durations: Array<number> = [];
    for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
        const startTime = performance.now();
        const result = await engine.executeConfiguredCodemods({
            projectRoot: "/project",
            targetPaths: ["/project"],
            gmlFilePaths: fixture.gmlFilePaths,
            config: NAMING_CONVENTION_CONFIG,
            readFile: async (filePath) => fixture.sourceTexts.get(filePath) ?? "",
            writeFile: async () => {},
            dryRun: false
        });

        durations.push(performance.now() - startTime);
        assert.equal(result.summaries.length, 1);
        assert.equal(result.summaries[0]?.id, "namingConvention");
        assert.equal(result.summaries[0]?.changed, true);
        assert.equal(result.appliedFiles.size, fileCount);
    }

    const sortedDurations = durations.toSorted((left, right) => left - right);
    const medianSampleIndex = Math.floor(sortedDurations.length / 2);
    const medianDuration = sortedDurations[medianSampleIndex];

    if (medianDuration === undefined) {
        throw new Error("Expected at least one duration sample");
    }

    return medianDuration;
}

void test("executeConfiguredCodemods write-path cache scaling remains sub-quadratic under high file-cardinality pressure", async () => {
    const smallDurationMs = await measureMedianCodemodWriteDurationMs(SMALL_FILE_COUNT);
    const largeDurationMs = await measureMedianCodemodWriteDurationMs(LARGE_FILE_COUNT);
    const scalingRatio = largeDurationMs / smallDurationMs;

    assert.ok(
        largeDurationMs <= LARGE_DURATION_THRESHOLD_MS,
        `Expected ${LARGE_FILE_COUNT}-file write-path codemod run to finish within ${LARGE_DURATION_THRESHOLD_MS}ms, received ${largeDurationMs.toFixed(2)}ms`
    );
    assert.ok(
        scalingRatio <= MAX_SCALING_RATIO,
        `Expected write-path codemod cache scaling ratio <= ${MAX_SCALING_RATIO}, received ${scalingRatio.toFixed(2)} (${smallDurationMs.toFixed(2)}ms -> ${largeDurationMs.toFixed(2)}ms)`
    );
});
