import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import {
    createSyntheticRefactorProject,
    writeScriptResource
} from "./test-helpers/refactor-codemod-command-fixture.js";

const SCRIPT_COUNT = 260;
const PERFORMANCE_THRESHOLD_MS = 2400;

void test("refactor codemod --write non-semantic codemods stay under runtime threshold without semantic indexing", async () => {
    const projectRoot = await createSyntheticRefactorProject({
        refactor: {
            codemods: {
                globalvarToGlobal: {},
                loopLengthHoisting: {}
            }
        }
    });

    try {
        for (let index = 0; index < SCRIPT_COUNT; index += 1) {
            const sourceText = [
                `function demo_script_${index}(items) {`,
                `    globalvar legacy_${index};`,
                "    for (var i = 0; i < array_length(items); i++) {",
                `        legacy_${index} += items[i];`,
                "    }",
                `    return legacy_${index};`,
                "}",
                ""
            ].join("\n");
            await writeScriptResource(projectRoot, `demo_script_${index}`, sourceText);
        }

        const startTime = performance.now();
        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write", "--verbose"],
            cwd: projectRoot
        });
        const durationMs = performance.now() - startTime;

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /\[globalvarToGlobal\] changed/);
        assert.match(result.stdout, /\[loopLengthHoisting\] changed/);
        assert.doesNotMatch(result.stdout, /DEBUG: Starting buildProjectIndex/);
        assert.ok(
            durationMs <= PERFORMANCE_THRESHOLD_MS,
            `Expected non-semantic refactor codemod --write runtime under ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
        );
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});
