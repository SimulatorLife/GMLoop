import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { __test__, runCliTestCommand } from "../src/cli.js";
import { withSyntheticRefactorProject, writeScriptResource } from "./test-helpers/refactor-codemod-command-fixture.js";

const IS_TEST_ENV =
    process.env.CI ||
    process.env.NODE_ENV === "test" ||
    process.env.GMLOOP_TEST === "1" ||
    process.execArgv.some((a) => a.includes("test")) ||
    process.argv.some((a) => a.includes("test"));
const PERFORMANCE_THRESHOLD_MS = 5000 * (IS_TEST_ENV ? 5 : 1);
const SCRIPT_COUNT = 220;

void test("refactor codemod --write refreshes semantic index once for a multi-codemod batch", async () => {
    await withSyntheticRefactorProject(
        {
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
        },
        async (projectRoot) => {
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
                argv: ["refactor", "codemod", "--write"],
                cwd: projectRoot
            });
            const durationMs = performance.now() - startTime;

            assert.equal(result.exitCode, 0);

            const bridge = __test__.consumeLastRefactorSemanticBridge();
            assert.ok(bridge, "Expected the refactor orchestrator to construct a semantic bridge");
            assert.equal(
                bridge.getProjectIndexUpdateCount(),
                1,
                "Expected one semantic index refresh after the non-semantic codemods finished, before the semantic codemod ran"
            );

            assert.ok(
                durationMs <= PERFORMANCE_THRESHOLD_MS,
                `Expected refactor codemod --write runtime under ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
            );
        }
    );
});
