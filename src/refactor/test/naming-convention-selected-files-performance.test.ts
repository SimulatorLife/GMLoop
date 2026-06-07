import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { Refactor } from "../index.js";
import type { NamingConventionTarget, PartialSemanticAnalyzer, RefactorProjectConfig } from "../src/types.js";

const FILE_COUNT = 4000;
const TARGETS_PER_FILE = 8;
const PERFORMANCE_THRESHOLD_MS = 700;

function createTargets(filePath: string, fileIndex: number): Array<NamingConventionTarget> {
    const targets: Array<NamingConventionTarget> = [];
    for (let index = 0; index < TARGETS_PER_FILE; index += 1) {
        const name = `bad_name_${fileIndex}_${index}`;
        targets.push({
            name,
            category: "localVariable",
            path: filePath,
            scopeId: `scope:${fileIndex}:${index}`,
            symbolId: null,
            occurrences: [
                {
                    path: filePath,
                    start: index * 40,
                    end: index * 40 + name.length,
                    kind: Refactor.OccurrenceKind.DEFINITION,
                    scopeId: `scope:${fileIndex}:${index}`
                }
            ]
        });
    }

    return targets;
}

function createSemanticStub(targetsByFile: Map<string, Array<NamingConventionTarget>>): PartialSemanticAnalyzer {
    return {
        listNamingConventionTargets: async (filePaths) => {
            const selectedPaths = filePaths === undefined ? null : new Set(filePaths);
            const matches: Array<NamingConventionTarget> = [];
            for (const [filePath, targets] of targetsByFile.entries()) {
                if (selectedPaths !== null && !selectedPaths.has(filePath)) {
                    continue;
                }

                matches.push(...targets);
            }

            return matches;
        },
        validateEdits: async () => ({ errors: [], warnings: [] })
    };
}

void test("namingConvention codemod planning stays within selected-file threshold", async () => {
    const projectRoot = "/project";
    const gmlFilePaths = Array.from({ length: FILE_COUNT }, (_, index) => `scripts/s_${index}.gml`);
    const targetsByFile = new Map<string, Array<NamingConventionTarget>>();
    const sourceTextByFile = new Map<string, string>();

    for (const [fileIndex, filePath] of gmlFilePaths.entries()) {
        targetsByFile.set(filePath, createTargets(filePath, fileIndex));
        sourceTextByFile.set(filePath, "var bad_name = 0;\nshow_debug_message(bad_name);\n");
    }

    const engine = new Refactor.RefactorEngine({ semantic: createSemanticStub(targetsByFile) });
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

    const execute = () =>
        engine.executeConfiguredCodemods({
            projectRoot,
            targetPaths: gmlFilePaths.slice(0, 100),
            gmlFilePaths,
            config,
            readFile: async (filePath) => sourceTextByFile.get(filePath) ?? "",
            dryRun: true
        });

    await execute();
    const start = performance.now();
    const result = await execute();
    const durationMs = performance.now() - start;

    assert.equal(result.summaries[0]?.id, "namingConvention");
    assert.equal(result.appliedFiles.size, FILE_COUNT);
    assert.ok(
        durationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected namingConvention planning to complete within ${PERFORMANCE_THRESHOLD_MS}ms, observed ${durationMs.toFixed(2)}ms`
    );
});
