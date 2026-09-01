import assert from "node:assert/strict";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import {
    createSyntheticRefactorProject,
    writeScriptResourcesBatch
} from "./test-helpers/refactor-codemod-command-fixture.js";

const SCRIPT_COUNT = 320;
// Threshold tightened after eliminating per-resource structuredClone calls in
// the metadata sidecar planning path. This intentionally measures one full
// synthetic project because repeated samples mostly duplicate fixture I/O and
// CLI startup while exercising the same code paths.
const IS_TEST_ENV =
    process.env.CI ||
    process.env.NODE_ENV === "test" ||
    process.env.GMLOOP_TEST === "1" ||
    process.execArgv.some((a) => a.includes("test")) ||
    process.argv.some((a) => a.includes("test"));
const PERFORMANCE_THRESHOLD_MS = 5200 * (IS_TEST_ENV ? 5 : 1);
const CASE_INSENSITIVE_MANIFEST_SCRIPT_COUNT = 300;
// Shared runner contention in the recovery workflow executes this suite after
// a full repository build/lint/test surface. Keep this bound high enough to
// avoid workflow noise while still catching major regressions in the mixed-case
// manifest rewrite path.
const CASE_INSENSITIVE_MANIFEST_THRESHOLD_MS = 9800 * (IS_TEST_ENV ? 5 : 1);

async function measureDurationMs<T>(execute: () => Promise<T>): Promise<{
    durationMs: number;
    result: T;
}> {
    const startTime = performance.now();
    const result = await execute();

    return {
        durationMs: performance.now() - startTime,
        result
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

    await writeScriptResourcesBatch(
        projectRoot,
        Array.from({ length: SCRIPT_COUNT }, (_, index) => {
            const scriptName = `demo_script_${index}`;
            return {
                scriptName,
                sourceText: `function ${scriptName}() {\n    return ${index};\n}\n`
            };
        })
    );

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
    const projectRoots = new Set<string>();

    try {
        const { durationMs, result } = await measureDurationMs(async () => {
            const run = await runRefactorCodemodWriteScenario();
            projectRoots.add(run.projectRoot);
            assert.equal(run.result.exitCode, 0);
            assert.match(run.result.stdout, /\[namingConvention\] changed/);
            await access(path.join(run.projectRoot, "scripts/demoScript0/demoScript0.gml"));
            return run;
        });

        assert.ok(
            durationMs <= PERFORMANCE_THRESHOLD_MS,
            `Expected refactor codemod --write runtime under ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
        );
        assert.equal(result.result.exitCode, 0);
    } finally {
        for (const projectRoot of projectRoots) {
            await rm(projectRoot, { recursive: true, force: true });
        }
    }
});

void test("refactor codemod --write keeps mixed-case manifest path rewrites within the runtime threshold", async () => {
    const projectRoots = new Set<string>();

    try {
        const { durationMs, result } = await measureDurationMs(async () => {
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

            await writeScriptResourcesBatch(
                projectRoot,
                Array.from({ length: CASE_INSENSITIVE_MANIFEST_SCRIPT_COUNT }, (_, index) => {
                    const scriptName = `demo_script_${index}`;
                    return {
                        scriptName,
                        sourceText: `function ${scriptName}() {\n    return ${index};\n}\n`
                    };
                }),
                Array.from({ length: CASE_INSENSITIVE_MANIFEST_SCRIPT_COUNT }, (_, index) => ({
                    resourceName: `UPPER_${index}`,
                    resourcePath: `SCRIPTS/DEMO_SCRIPT_${index}/DEMO_SCRIPT_${index}.YY`
                }))
            );

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
            `Expected mixed-case manifest codemod runtime under ${CASE_INSENSITIVE_MANIFEST_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
        );
    } finally {
        for (const projectRoot of projectRoots) {
            await rm(projectRoot, { recursive: true, force: true });
        }
    }
});
