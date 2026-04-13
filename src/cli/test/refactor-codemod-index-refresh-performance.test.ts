import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import {
    createSyntheticRefactorProject,
    writeScriptResource
} from "./test-helpers/refactor-codemod-command-fixture.js";

const SCRIPT_COUNT = 220;
// Runtime variance on shared CI runners can be significant, so this threshold
// guards against major regressions while the semantic-index build-count check
// below enforces the structural optimization introduced for mixed codemod runs.
const PERFORMANCE_THRESHOLD_MS = 3200;

void test("refactor codemod --write refreshes semantic index once for a multi-codemod batch", async () => {
    const projectRoot = await createSyntheticRefactorProject({
        refactor: {
            codemods: {
                globalvarToGlobal: {},
                loopLengthHoisting: {},
                namingConvention: {
                    rules: {
                        localVariable: {
                            caseStyle: "camel"
                        }
                    }
                }
            }
        }
    });

    try {
        for (let index = 0; index < SCRIPT_COUNT; index += 1) {
            const sourceText = [
                `function demo_script_${index}(items) {`,
                `    globalvar legacy_${index};`,
                `    var bad_name_${index} = 0;`,
                "    for (var i = 0; i < array_length(items); i++) {",
                `        bad_name_${index} += items[i] + legacy_${index};`,
                "    }",
                `    return bad_name_${index};`,
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
        const rebuildLines = result.stdout.match(/Rebuilding project index after codemod /g) ?? [];
        assert.equal(rebuildLines.length, 1, `Expected one semantic index refresh, saw ${rebuildLines.length}`);
        const semanticIndexBuildLines = result.stdout.match(/DEBUG: Starting buildProjectIndex/g) ?? [];
        assert.equal(
            semanticIndexBuildLines.length,
            1,
            `Expected one semantic index build for a mixed codemod batch, saw ${semanticIndexBuildLines.length}`
        );
        assert.ok(
            durationMs <= PERFORMANCE_THRESHOLD_MS,
            `Expected refactor codemod --write runtime under ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
        );
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});
