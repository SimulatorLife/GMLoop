import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import {
    createSyntheticRefactorProject,
    writeScriptResource
} from "./test-helpers/refactor-codemod-command-fixture.js";

const SCRIPT_COUNT = 900;
const PERFORMANCE_THRESHOLD_MS = 1700;

void test("refactor codemod --write loop-length hoisting skips parse-heavy work on sparse accessor projects", async () => {
    const projectRoot = await createSyntheticRefactorProject({
        refactor: {
            codemods: {
                loopLengthHoisting: {}
            }
        }
    });

    try {
        for (let index = 0; index < SCRIPT_COUNT; index += 1) {
            const sourceText = [
                `function sparse_script_${index}(values) {`,
                "    var total = 0;",
                "    for (var i = 0; i < values.length; i++) {",
                "        total += values[i];",
                "    }",
                "    return total;",
                "}",
                ""
            ].join("\n");
            await writeScriptResource(projectRoot, `sparse_script_${index}`, sourceText);
        }

        const startTime = performance.now();
        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });
        const durationMs = performance.now() - startTime;

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /\[loopLengthHoisting\] no changes/);
        assert.ok(
            durationMs <= PERFORMANCE_THRESHOLD_MS,
            `Expected sparse loop-length hoisting runtime under ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
        );
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});
