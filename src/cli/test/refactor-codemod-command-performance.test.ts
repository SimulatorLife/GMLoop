import assert from "node:assert/strict";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import {
    createSyntheticRefactorProject,
    writeScriptResource
} from "./test-helpers/refactor-codemod-command-fixture.js";

const SCRIPT_COUNT = 320;
const PERFORMANCE_THRESHOLD_MS = 5200;

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
        const previousName = index === 0 ? null : `demo_script_${index - 1}`;
        const sourceText =
            previousName === null
                ? `function ${scriptName}() {\n    return ${index};\n}\n`
                : `function ${scriptName}() {\n    return ${previousName}() + ${index};\n}\n`;
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
