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
const PERFORMANCE_THRESHOLD_MS = 6000;

void test("refactor codemod --write stays within the end-to-end CLI runtime threshold", async () => {
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

    try {
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
        const durationMs = performance.now() - startTime;

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /\[namingConvention\] changed/);
        await access(path.join(projectRoot, "scripts/demoScript0/demoScript0.gml"));
        assert.ok(
            durationMs <= PERFORMANCE_THRESHOLD_MS,
            `Expected refactor codemod --write runtime under ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
        );
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});
