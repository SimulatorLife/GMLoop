import assert from "node:assert/strict";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import {
    createSyntheticRefactorProject,
    registerProjectResource,
    writeScriptResource
} from "./test-helpers/refactor-codemod-command-fixture.js";

const SCRIPT_COUNT = 320;
// Threshold tightened after eliminating per-resource structuredClone calls in
// the metadata sidecar planning path. Local median on Apr 25, 2026 for this
// fixture improved from ~2077ms to ~1873ms (5-sample median, --write path).
const PERFORMANCE_THRESHOLD_MS = 5200;
const CASE_INSENSITIVE_MANIFEST_SCRIPT_COUNT = 300;
// Shared runner contention in the recovery workflow executes this suite after
// a full repository build/lint/test surface. Recent base/head/merge snapshots
// in auto-merge ran this case around ~9.3s median, so keep this bound high
// enough to avoid workflow noise while still catching major regressions.
const CASE_INSENSITIVE_MANIFEST_THRESHOLD_MS = 9800;

async function measureMedianDurationMs<T>(
    sampleCount: number,
    execute: () => Promise<T>
): Promise<{
    durationMs: number;
    result: T;
}> {
    const samples: Array<{ durationMs: number; result: T }> = [];

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const startTime = performance.now();
        const result = await execute();
        samples.push({
            durationMs: performance.now() - startTime,
            result
        });
    }

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

async function runRefactorCodemodWriteScenario(): Promise<{
    durationMs: number;
    result: Awaited<ReturnType<typeof runCliTestCommand>>;
    projectRoot: string;
}> {
    const projectRoot = await createSyntheticRefactorProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        scriptResourceName: {
                            caseStyle: "camel"
                        }
                    }
                }
            }
        }
    });

    for (let index = 0; index < SCRIPT_COUNT; index += 1) {
        const scriptName = `demo_script_${index}`;
        const sourceText = `function ${scriptName}() {\n    return ${index};\n}\n`;
        await writeScriptResource(projectRoot, scriptName, sourceText);
    }

    const startTime = performance.now();
    const result = await runCliTestCommand({
        argv: ["refactor", "codemod", "--write"],
        cwd: projectRoot
    });

    return {
        durationMs: performance.now() - startTime,
        result,
        projectRoot
    };
}

void test("refactor codemod --write stays within the end-to-end CLI runtime threshold", async () => {
    const SAMPLE_COUNT = 3;
    const projectRoots = new Set<string>();

    try {
        const { durationMs, result } = await measureMedianDurationMs(SAMPLE_COUNT, async () => {
            const run = await runRefactorCodemodWriteScenario();
            projectRoots.add(run.projectRoot);
            assert.equal(run.result.exitCode, 0);
            assert.match(run.result.stdout, /\[namingConvention\] changed/);
            await access(path.join(run.projectRoot, "scripts/demoScript0/demoScript0.gml"));
            return run;
        });

        assert.ok(
            durationMs <= PERFORMANCE_THRESHOLD_MS,
            `Expected median refactor codemod --write runtime under ${PERFORMANCE_THRESHOLD_MS}ms across ${SAMPLE_COUNT} samples, received ${durationMs.toFixed(2)}ms`
        );
        assert.equal(result.result.exitCode, 0);
    } finally {
        for (const projectRoot of projectRoots) {
            await rm(projectRoot, { recursive: true, force: true });
        }
    }
});

void test("refactor codemod --write keeps mixed-case manifest path rewrites within the runtime threshold", async () => {
    const SAMPLE_COUNT = 3;
    const projectRoots = new Set<string>();

    try {
        const { durationMs, result } = await measureMedianDurationMs(SAMPLE_COUNT, async () => {
            const projectRoot = await createSyntheticRefactorProject({
                refactor: {
                    codemods: {
                        namingConvention: {
                            rules: {
                                scriptResourceName: {
                                    caseStyle: "camel"
                                }
                            }
                        }
                    }
                }
            });
            projectRoots.add(projectRoot);

            for (let index = 0; index < CASE_INSENSITIVE_MANIFEST_SCRIPT_COUNT; index += 1) {
                const scriptName = `demo_script_${index}`;
                await writeScriptResource(
                    projectRoot,
                    scriptName,
                    `function ${scriptName}() {\n    return ${index};\n}\n`
                );
                await registerProjectResource(
                    projectRoot,
                    `UPPER_${index}`,
                    `SCRIPTS/DEMO_SCRIPT_${index}/DEMO_SCRIPT_${index}.YY`
                );
            }

            const projectManifestPath = path.join(projectRoot, "MyGame.yyp");
            const projectManifest = JSON.parse(await readFile(projectManifestPath, "utf8")) as {
                resources: Array<{ id: { name: string; path: string } }>;
            };
            projectManifest.resources = projectManifest.resources.map((entry) => ({
                id: {
                    name: entry.id.name,
                    path: entry.id.path.replace("scripts/", "SCRIPTS/").replace(".yy", ".YY")
                }
            }));
            await writeFile(projectManifestPath, `${JSON.stringify(projectManifest, null, 4)}\n`, "utf8");

            const startTime = performance.now();
            const runResult = await runCliTestCommand({
                argv: ["refactor", "codemod", "--write"],
                cwd: projectRoot
            });

            return {
                durationMs: performance.now() - startTime,
                result: runResult
            };
        });

        assert.equal(result.result.exitCode, 0);
        assert.match(result.result.stdout, /\[namingConvention\] changed/);
        assert.ok(
            durationMs <= CASE_INSENSITIVE_MANIFEST_THRESHOLD_MS,
            `Expected median mixed-case manifest codemod runtime under ${CASE_INSENSITIVE_MANIFEST_THRESHOLD_MS}ms across ${SAMPLE_COUNT} samples, received ${durationMs.toFixed(2)}ms`
        );
    } finally {
        for (const projectRoot of projectRoots) {
            await rm(projectRoot, { recursive: true, force: true });
        }
    }
});
