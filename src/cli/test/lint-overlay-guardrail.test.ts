import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { __lintCommandTest__, runLintCommand } from "../src/commands/lint.js";
import { withTemporaryProperty } from "./test-helpers/temporary-property.js";

const { Lint } = LintWorkspace;
const GML_LANGUAGE = Lint.plugin.languages?.gml;
assert.ok(GML_LANGUAGE, "Expected canonical GML language wiring in lint plugin tests.");

void test("wiring requires both plugin identity and language", () => {
    assert.equal(
        __lintCommandTest__.isCanonicalGmlWiring({
            plugins: { gml: LintWorkspace.Lint.plugin },
            language: GML_LANGUAGE
        }),
        true
    );

    assert.equal(
        __lintCommandTest__.isCanonicalGmlWiring({
            plugins: { gml: {} },
            language: GML_LANGUAGE
        }),
        false
    );

    assert.equal(
        __lintCommandTest__.isCanonicalGmlWiring({
            plugins: { gml: LintWorkspace.Lint.plugin },
            language: "not-gml"
        }),
        false
    );
});

void test("severity normalization handles canonical and conservative cases", () => {
    assert.equal(__lintCommandTest__.isAppliedRuleValue("off"), false);
    assert.equal(__lintCommandTest__.isAppliedRuleValue(" OFF "), false);
    assert.equal(__lintCommandTest__.isAppliedRuleValue(0), false);
    assert.equal(__lintCommandTest__.isAppliedRuleValue(["off", {}]), false);
    assert.equal(__lintCommandTest__.isAppliedRuleValue([0, {}]), false);

    assert.equal(__lintCommandTest__.isAppliedRuleValue("warn"), true);
    assert.equal(__lintCommandTest__.isAppliedRuleValue(" Warn "), true);
    assert.equal(__lintCommandTest__.isAppliedRuleValue("error"), true);
    assert.equal(__lintCommandTest__.isAppliedRuleValue(1), true);
    assert.equal(__lintCommandTest__.isAppliedRuleValue(2), true);
    assert.equal(__lintCommandTest__.isAppliedRuleValue(["warn", {}]), true);
    assert.equal(__lintCommandTest__.isAppliedRuleValue([2, {}]), true);

    assert.equal(__lintCommandTest__.isAppliedRuleValue([]), true);
    assert.equal(__lintCommandTest__.isAppliedRuleValue([null, {}]), true);
    assert.equal(__lintCommandTest__.isAppliedRuleValue([true, {}]), true);
    assert.equal(__lintCommandTest__.isAppliedRuleValue([{ bad: true }, {}]), true);
});

void test("missing rules means no overlay rules applied", () => {
    assert.equal(__lintCommandTest__.hasOverlayRuleApplied({}), false);
    assert.equal(__lintCommandTest__.hasOverlayRuleApplied({ rules: undefined }), false);
    assert.equal(__lintCommandTest__.hasOverlayRuleApplied({ rules: null }), false);
});

void test("overlay matching uses exact canonical full rule IDs", () => {
    const performanceId = LintWorkspace.Lint.services.performanceOverrideRuleIds[0];

    assert.equal(
        __lintCommandTest__.hasOverlayRuleApplied({
            rules: {
                [performanceId]: "warn"
            }
        }),
        true
    );

    assert.equal(
        __lintCommandTest__.hasOverlayRuleApplied({
            rules: {
                [performanceId.toUpperCase()]: "warn"
            }
        }),
        false
    );

    assert.equal(
        __lintCommandTest__.hasOverlayRuleApplied({
            rules: {
                feather: "warn"
            }
        }),
        false
    );
});

void test("overlay warning output is deduped per invocation and bounded", () => {
    const paths = Array.from({ length: 25 }, (_, index) => `/tmp/${index}.gml`);
    const rendered = __lintCommandTest__.formatOverlayWarning(paths);

    assert.match(rendered, /^GML_OVERLAY_WITHOUT_LANGUAGE_WIRING:/);
    assert.match(rendered, /Add `plugins: \{ gml: Lint\.plugin \}` and `language: "gml\/gml"`/);
    assert.match(rendered, /Affected files:/);
    assert.match(rendered, /\/tmp\/0\.gml/);
    assert.match(rendered, /\/tmp\/19\.gml/);
    assert.doesNotMatch(rendered, /\/tmp\/20\.gml/);
    assert.match(rendered, /and 5 more\.\.\./);
});

void test("flat config discovery searches cwd ancestors in candidate order", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gml-lint-discovery-"));
    const nestedDirectory = path.join(tempRoot, "a", "b");
    await fs.mkdir(nestedDirectory, { recursive: true });

    const expectedConfig = path.join(tempRoot, "eslint.config.mjs");
    await fs.writeFile(expectedConfig, "export default [];\n", "utf8");

    const discovery = __lintCommandTest__.discoverFlatConfig(nestedDirectory);

    assert.equal(discovery.selectedConfigPath, expectedConfig);
    assert.ok(discovery.searchedPaths.length > 0);
    assert.deepEqual(
        discovery.searchedPaths.slice(0, __lintCommandTest__.FLAT_CONFIG_CANDIDATES.length),
        __lintCommandTest__.FLAT_CONFIG_CANDIDATES.map((candidate) => path.join(nestedDirectory, candidate))
    );
});

void test("formatter normalization preserves unknown names for explicit validation", () => {
    assert.equal(__lintCommandTest__.normalizeFormatterName(undefined), "stylish");
    assert.equal(__lintCommandTest__.normalizeFormatterName("JSON"), "json");
    assert.equal(__lintCommandTest__.normalizeFormatterName("custom"), "custom");
    assert.equal(__lintCommandTest__.isSupportedFormatter("stylish"), true);
    assert.equal(__lintCommandTest__.isSupportedFormatter("json"), true);
    assert.equal(__lintCommandTest__.isSupportedFormatter("checkstyle"), true);
    assert.equal(__lintCommandTest__.isSupportedFormatter("custom"), false);
});

void test("eslint constructor options suppress ignored-file warnings by default", () => {
    assert.deepEqual(__lintCommandTest__.createEslintConstructorOptions("/tmp/workspace", false, false), {
        cwd: "/tmp/workspace",
        fix: false,
        warnIgnored: false
    });

    assert.deepEqual(__lintCommandTest__.createEslintConstructorOptions("/tmp/workspace", true, true), {
        cwd: "/tmp/workspace",
        fix: true,
        warnIgnored: true
    });
});

void test("explicit config validation fails on missing file", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gml-lint-config-"));
    const missingPath = path.join(tempRoot, "missing.config.js");

    await assert.rejects(() => __lintCommandTest__.validateExplicitConfigPath(missingPath));
});

void test("configureLintConfig defers discovered config selection to ESLint", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gml-lint-config-discovery-"));
    await fs.writeFile(path.join(tempRoot, "eslint.config.js"), "export default [];\n", "utf8");

    const eslintConstructorOptions: { overrideConfigFile?: string; overrideConfig?: unknown } = {};
    const exitCode = await __lintCommandTest__.configureLintConfig({
        eslintConstructorOptions,
        cwd: tempRoot,
        targets: ["."],
        configPath: null,
        noDefaultConfig: false,
        quiet: true
    });

    assert.equal(exitCode, 0);
    assert.equal(eslintConstructorOptions.overrideConfigFile, undefined);
    assert.equal(eslintConstructorOptions.overrideConfig, undefined);
});

void test("configureLintConfig applies bundled fallback when discovery finds no config", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gml-lint-config-fallback-"));
    const eslintConstructorOptions: { overrideConfigFile?: string; overrideConfig?: unknown } = {};

    const exitCode = await __lintCommandTest__.configureLintConfig({
        eslintConstructorOptions,
        cwd: tempRoot,
        targets: ["."],
        configPath: null,
        noDefaultConfig: false,
        quiet: true
    });

    assert.equal(exitCode, 0);
    assert.equal(eslintConstructorOptions.overrideConfigFile, true);
    assert.equal(Array.isArray(eslintConstructorOptions.overrideConfig), true);
});

void test("configureLintConfig disables config-file lookup when defaults are disabled and discovery finds no config", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gml-lint-config-nodefault-"));
    const eslintConstructorOptions: { overrideConfigFile?: string | true; overrideConfig?: unknown } = {};

    const exitCode = await __lintCommandTest__.configureLintConfig({
        eslintConstructorOptions,
        cwd: tempRoot,
        targets: ["."],
        configPath: null,
        noDefaultConfig: true,
        quiet: true
    });

    assert.equal(exitCode, 0);
    assert.equal(eslintConstructorOptions.overrideConfigFile, true);
    assert.equal(eslintConstructorOptions.overrideConfig, undefined);
});

void test("external lint targets prefer bundled defaults over cwd config lookup", async () => {
    assert.equal(
        __lintCommandTest__.shouldPreferBundledDefaultsForExternalTargets({
            cwd: "/Users/usr/gamemaker-language-parser",
            targets: ["/Users/usr/GameMakerStudio2/MyGame"]
        }),
        true
    );

    assert.equal(
        __lintCommandTest__.shouldPreferBundledDefaultsForExternalTargets({
            cwd: "/Users/usr/gamemaker-language-parser",
            targets: ["./src"]
        }),
        false
    );
});

void test("resolveEslintCwd anchors external targets to their shared directory", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gml-lint-resolve-cwd-"));
    const workspaceRoot = path.join(tempRoot, "workspace");
    const externalProjectRoot = path.join(tempRoot, "external", "MyGame");
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.mkdir(externalProjectRoot, { recursive: true });

    assert.equal(
        __lintCommandTest__.resolveEslintCwd({
            cwd: workspaceRoot,
            targets: [externalProjectRoot]
        }),
        externalProjectRoot
    );

    assert.equal(
        __lintCommandTest__.resolveEslintCwd({
            cwd: workspaceRoot,
            targets: ["./src"]
        }),
        workspaceRoot
    );
});

void test("extractLintRuntimeFailureLocation parses file path with line and column", () => {
    const parsed = __lintCommandTest__.extractLintRuntimeFailureLocation(
        'Cannot read properties of undefined (reading "0")\nOccurred while linting /tmp/example.gml:42:7\nRule: "gml/some-rule"'
    );

    assert.equal(parsed.filePath, "/tmp/example.gml");
    assert.equal(parsed.line, 42);
    assert.equal(parsed.column, 7);
});

void test("extractLintRuntimeFailureLocation falls back when location is unavailable", () => {
    const parsed = __lintCommandTest__.extractLintRuntimeFailureLocation("Unexpected lint runtime failure.");

    assert.equal(parsed.filePath, null);
    assert.equal(parsed.line, 1);
    assert.equal(parsed.column, 1);
});

void test("createRecoverableLintTargets prioritizes expanded file targets before passthrough targets", () => {
    const orderedTargets = __lintCommandTest__.createRecoverableLintTargets({
        cwd: "/tmp/workspace",
        expandedTargets: {
            fileTargets: ["/tmp/workspace/alpha.gml", "/tmp/workspace/beta.gml"],
            passthroughTargets: ["scripts", "missing.gml"]
        }
    });

    assert.deepEqual(orderedTargets, [
        Object.freeze({
            target: "/tmp/workspace/alpha.gml",
            fallbackFilePath: "/tmp/workspace/alpha.gml"
        }),
        Object.freeze({
            target: "/tmp/workspace/beta.gml",
            fallbackFilePath: "/tmp/workspace/beta.gml"
        }),
        Object.freeze({
            target: "scripts",
            fallbackFilePath: "/tmp/workspace/scripts"
        }),
        Object.freeze({
            target: "missing.gml",
            fallbackFilePath: "/tmp/workspace/missing.gml"
        })
    ]);
});

void test("appendRetainedLintResults strips autofix payloads before aggregation", () => {
    const aggregatedResults: Parameters<typeof __lintCommandTest__.appendRetainedLintResults>[0] = [];

    __lintCommandTest__.appendRetainedLintResults(aggregatedResults, [
        {
            filePath: "/tmp/workspace/example.gml",
            messages: [
                {
                    ruleId: "gml/example-rule",
                    severity: 1,
                    message: "Example warning",
                    line: 1,
                    column: 1,
                    nodeType: "Identifier",
                    fix: { range: [0, 3], text: "foo" },
                    suggestions: [{ desc: "Apply suggestion", fix: { range: [0, 3], text: "bar" } }]
                }
            ],
            suppressedMessages: [],
            errorCount: 0,
            fatalErrorCount: 0,
            warningCount: 1,
            fixableErrorCount: 0,
            fixableWarningCount: 1,
            usedDeprecatedRules: []
        }
    ]);

    assert.deepEqual(aggregatedResults, [
        {
            filePath: "/tmp/workspace/example.gml",
            messages: [
                {
                    ruleId: "gml/example-rule",
                    severity: 1,
                    message: "Example warning",
                    line: 1,
                    column: 1,
                    nodeType: "Identifier"
                }
            ],
            suppressedMessages: [],
            errorCount: 0,
            fatalErrorCount: 0,
            warningCount: 1,
            fixableErrorCount: 0,
            fixableWarningCount: 1,
            usedDeprecatedRules: []
        }
    ]);
});

void test("lintTargetsWithRuntimeRecovery records recoverable crashes and continues", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gml-lint-recovery-targets-"));
    const firstFile = path.join(tempRoot, "alpha.gml");
    const secondFile = path.join(tempRoot, "beta.gml");
    await fs.writeFile(firstFile, "var alpha = 1;\n", "utf8");
    await fs.writeFile(secondFile, "var beta = 2;\n", "utf8");

    const lintedTargets: Array<string> = [];
    const fakeEslint = {
        async lintFiles(filePatterns: string | Array<string>) {
            if (typeof filePatterns === "string") {
                return [];
            }
            const [filePath] = filePatterns;
            if (typeof filePath !== "string") {
                return [];
            }

            lintedTargets.push(filePath);
            if (filePath === secondFile) {
                throw new Error(`Synthetic failure\nOccurred while linting ${secondFile}:13`);
            }

            return [
                {
                    filePath,
                    messages: [],
                    suppressedMessages: [],
                    errorCount: 0,
                    fatalErrorCount: 0,
                    warningCount: 0,
                    fixableErrorCount: 0,
                    fixableWarningCount: 0,
                    usedDeprecatedRules: []
                }
            ];
        }
    };

    const results = await __lintCommandTest__.lintTargetsWithRuntimeRecovery({
        eslint: fakeEslint,
        cwd: tempRoot,
        targets: [tempRoot],
        onTargetCompleted: async () => {}
    });

    assert.equal(results.length, 2);
    assert.deepEqual(lintedTargets.sort(), [firstFile, secondFile].sort());

    const fatalResult = results.find((result) => result.filePath === secondFile);
    assert.equal(fatalResult?.fatalErrorCount, 1);
    assert.equal(fatalResult?.messages[0]?.line, 13);
});

void test("lintTargetsWithRuntimeRecovery runs targets sequentially", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gml-lint-recovery-sequential-"));
    const firstFile = path.join(tempRoot, "alpha.gml");
    const secondFile = path.join(tempRoot, "beta.gml");
    await fs.writeFile(firstFile, "var alpha = 1;\n", "utf8");
    await fs.writeFile(secondFile, "var beta = 2;\n", "utf8");

    let activeLints = 0;
    let maxConcurrentLints = 0;
    const completionOrder: Array<string> = [];
    const elapsedTimings: Array<bigint> = [];
    const lintStartOrder: Array<string> = [];

    const fakeEslint = {
        async lintFiles(filePatterns: string | Array<string>) {
            if (typeof filePatterns === "string") {
                return [];
            }

            const [filePath] = filePatterns;
            if (typeof filePath !== "string") {
                return [];
            }

            lintStartOrder.push(filePath);
            activeLints += 1;
            maxConcurrentLints = Math.max(maxConcurrentLints, activeLints);
            await new Promise((resolve) => {
                setTimeout(resolve, 5);
            });
            activeLints -= 1;

            return [
                {
                    filePath,
                    messages: [],
                    suppressedMessages: [],
                    errorCount: 0,
                    fatalErrorCount: 0,
                    warningCount: 0,
                    fixableErrorCount: 0,
                    fixableWarningCount: 0,
                    usedDeprecatedRules: []
                }
            ];
        }
    };

    await __lintCommandTest__.lintTargetsWithRuntimeRecovery({
        eslint: fakeEslint,
        cwd: tempRoot,
        targets: [tempRoot],
        onTargetCompleted: async ({ targetResults, elapsedNanoseconds }) => {
            completionOrder.push(targetResults[0]?.filePath ?? "");
            elapsedTimings.push(elapsedNanoseconds);
        }
    });

    assert.equal(maxConcurrentLints, 1);
    assert.deepEqual(lintStartOrder, [firstFile, secondFile]);
    assert.deepEqual(completionOrder, [firstFile, secondFile]);
    assert.equal(elapsedTimings.length, 2);
    assert.ok(elapsedTimings.every((value) => value >= 0n));
});

void test("lintTargetsWithRuntimeRecovery can create a fresh executor per target", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gml-lint-recovery-fresh-executor-"));
    const targetA = path.join(tempRoot, "first.gml");
    const targetB = path.join(tempRoot, "second.gml");

    let defaultExecutorCalls = 0;
    let createdExecutors = 0;
    const lintedByFreshExecutors: Array<string> = [];

    const defaultExecutor = {
        async lintFiles() {
            defaultExecutorCalls += 1;
            return [];
        }
    };

    const results = await __lintCommandTest__.lintTargetsWithRuntimeRecovery({
        eslint: defaultExecutor,
        cwd: tempRoot,
        targets: [targetA, targetB],
        createExecutorForTarget: () => {
            createdExecutors += 1;
            return {
                async lintFiles(filePatterns: string | Array<string>) {
                    if (typeof filePatterns === "string") {
                        return [];
                    }

                    const [filePath] = filePatterns;
                    if (typeof filePath !== "string") {
                        return [];
                    }

                    lintedByFreshExecutors.push(filePath);

                    return [
                        {
                            filePath,
                            messages: [],
                            suppressedMessages: [],
                            errorCount: 0,
                            fatalErrorCount: 0,
                            warningCount: 0,
                            fixableErrorCount: 0,
                            fixableWarningCount: 0,
                            usedDeprecatedRules: []
                        }
                    ];
                }
            };
        },
        onTargetCompleted: async () => {}
    });

    assert.equal(defaultExecutorCalls, 0);
    assert.equal(createdExecutors, 2);
    assert.equal(results.length, 2);
    assert.deepEqual(lintedByFreshExecutors.sort(), [targetA, targetB].sort());
});

void test("emitLintFixProgressForResults logs de-duplicated display paths", () => {
    const cwd = "/tmp/workspace";
    const writtenLines: Array<string> = [];
    __lintCommandTest__.emitLintFixProgressForResults({
        cwd,
        results: [
            { filePath: "/tmp/workspace/scripts/alpha.gml" },
            { filePath: "/tmp/workspace/scripts/alpha.gml" },
            { filePath: "/tmp/elsewhere/beta.gml" }
        ],
        writeProgressLine: (line) => {
            writtenLines.push(line);
        }
    });

    assert.deepEqual(writtenLines, ["scripts/alpha.gml", "/tmp/elsewhere/beta.gml"]);
});

void test("toLintProgressDisplayPath prefers relative paths inside cwd", () => {
    assert.equal(
        __lintCommandTest__.toLintProgressDisplayPath({
            cwd: "/tmp/workspace",
            filePath: "/tmp/workspace/scripts/example.gml"
        }),
        "scripts/example.gml"
    );

    assert.equal(
        __lintCommandTest__.toLintProgressDisplayPath({
            cwd: "/tmp/workspace",
            filePath: "/tmp/other/example.gml"
        }),
        "/tmp/other/example.gml"
    );
});

void test("fully wired overlay does not trigger guardrail", async () => {
    const eslint = {
        async calculateConfigForFile(): Promise<unknown> {
            return {
                plugins: { gml: Lint.plugin },
                language: GML_LANGUAGE,
                rules: {
                    [Lint.services.performanceOverrideRuleIds[0]]: "warn"
                }
            };
        }
    };

    const offendingPaths = await __lintCommandTest__.collectOverlayWithoutLanguageWiringPaths({
        eslint,
        results: [{ filePath: "/tmp/fully-wired.gml" }]
    });

    assert.deepEqual(offendingPaths, []);
});

void test("partially wired overlay triggers guardrail", async () => {
    const eslint = {
        async calculateConfigForFile(filePath: string): Promise<unknown> {
            if (filePath.endsWith("plugin-only.gml")) {
                return {
                    plugins: { gml: Lint.plugin },
                    language: "js/js",
                    rules: {
                        [Lint.services.performanceOverrideRuleIds[0]]: "warn"
                    }
                };
            }

            return {
                plugins: { gml: {} },
                language: GML_LANGUAGE,
                rules: {
                    [Lint.services.performanceOverrideRuleIds[0]]: [2, {}]
                }
            };
        }
    };

    const offendingPaths = await __lintCommandTest__.collectOverlayWithoutLanguageWiringPaths({
        eslint,
        results: [{ filePath: "/tmp/plugin-only.gml" }, { filePath: "/tmp/language-only.gml" }]
    });

    assert.deepEqual(offendingPaths, ["/tmp/plugin-only.gml", "/tmp/language-only.gml"]);
});

void test("configured but non-applied overlay does not trigger guardrail", async () => {
    const performanceRuleId = Lint.services.performanceOverrideRuleIds[0];
    const eslint = {
        async calculateConfigForFile(): Promise<unknown> {
            return {
                plugins: { gml: {} },
                language: "js/js",
                rules: {
                    [performanceRuleId]: ["off", { reason: "disabled" }],
                    "feather/noisy": 0
                }
            };
        }
    };

    const offendingPaths = await __lintCommandTest__.collectOverlayWithoutLanguageWiringPaths({
        eslint,
        results: [{ filePath: "/tmp/not-applied.gml" }]
    });

    assert.deepEqual(offendingPaths, []);
});

void test("overlay guardrail ignores non-object resolved configs", async () => {
    const eslint = {
        async calculateConfigForFile(): Promise<unknown> {
            return undefined;
        }
    };

    const offendingPaths = await __lintCommandTest__.collectOverlayWithoutLanguageWiringPaths({
        eslint,
        results: [{ filePath: "/tmp/non-object-config.gml" }]
    });

    assert.deepEqual(offendingPaths, []);
});

void test("overlay guardrail resolves file configs sequentially for large result sets", async () => {
    const resultPaths = Array.from({ length: 200 }, (_, index) => `/tmp/overlay-${index}.gml`);
    let activeCalls = 0;
    let maxConcurrentCalls = 0;

    const eslint = {
        async calculateConfigForFile(filePath: string): Promise<unknown> {
            activeCalls += 1;
            maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
            await new Promise((resolve) => {
                setTimeout(resolve, 1);
            });
            activeCalls -= 1;

            const numericSuffix = Number.parseInt(filePath.match(/(\d+)\.gml$/u)?.[1] ?? "0");
            if (numericSuffix % 2 === 0) {
                return {
                    plugins: { gml: {} },
                    language: "js/js",
                    rules: {
                        [Lint.services.performanceOverrideRuleIds[0]]: "warn"
                    }
                };
            }

            return {
                plugins: { gml: Lint.plugin },
                language: GML_LANGUAGE,
                rules: {
                    [Lint.services.performanceOverrideRuleIds[0]]: "warn"
                }
            };
        }
    };

    const offendingPaths = await __lintCommandTest__.collectOverlayWithoutLanguageWiringPaths({
        eslint,
        results: resultPaths.map((filePath) => ({ filePath }))
    });

    assert.equal(maxConcurrentCalls, 1);
    assert.equal(offendingPaths.length, 100);
    assert.ok(offendingPaths.every((filePath) => filePath.includes("overlay-")));
});

void test("processor normalization treats default/none sentinels as equivalent", () => {
    assert.equal(__lintCommandTest__.normalizeProcessorIdentityForEnforcement(undefined), null);
    assert.equal(__lintCommandTest__.normalizeProcessorIdentityForEnforcement(null), null);
    assert.equal(__lintCommandTest__.normalizeProcessorIdentityForEnforcement(""), null);
    assert.equal(__lintCommandTest__.normalizeProcessorIdentityForEnforcement("   "), null);
    assert.equal(__lintCommandTest__.normalizeProcessorIdentityForEnforcement("gml/processor"), "gml/processor");
});

void test("processor enforcement fails when active processor is observable and non-default", async () => {
    const evaluation = await __lintCommandTest__.enforceProcessorPolicyForGmlFiles({
        eslint: {
            async calculateConfigForFile() {
                return { processor: "markdown/markdown" };
            }
        },
        results: [{ filePath: "/tmp/processor.gml" }],
        verbose: false
    });

    assert.equal(evaluation.exitCode, 2);
    assert.match(evaluation.message ?? "", new RegExp(`^${__lintCommandTest__.PROCESSOR_UNSUPPORTED_ERROR_CODE}:`));
    assert.equal(evaluation.warning, null);
});

void test("processor enforcement evaluates resolved configs sequentially", async () => {
    const resultPaths = Array.from({ length: 200 }, (_, index) => `/tmp/processor-${index}.gml`);
    let activeCalls = 0;
    let maxConcurrentCalls = 0;

    const evaluation = await __lintCommandTest__.enforceProcessorPolicyForGmlFiles({
        eslint: {
            async calculateConfigForFile(filePath: string): Promise<unknown> {
                activeCalls += 1;
                maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
                await new Promise((resolve) => {
                    setTimeout(resolve, 1);
                });
                activeCalls -= 1;

                const numericSuffix = Number.parseInt(filePath.match(/(\d+)\.gml$/u)?.[1] ?? "0");
                return {
                    processor: numericSuffix % 2 === 0 ? "markdown/markdown" : undefined
                };
            }
        },
        results: resultPaths.map((filePath) => ({ filePath })),
        verbose: false
    });

    assert.equal(maxConcurrentCalls, 1);
    assert.equal(evaluation.exitCode, 2);
    assert.match(evaluation.message ?? "", /^GML_PROCESSOR_UNSUPPORTED:/u);
});

void test("processor enforcement emits verbose observability warning when processor cannot be observed", async () => {
    const evaluation = await __lintCommandTest__.enforceProcessorPolicyForGmlFiles({
        eslint: {
            async calculateConfigForFile() {
                return { language: GML_LANGUAGE };
            }
        },
        results: [{ filePath: "/tmp/observability.gml" }],
        verbose: true
    });

    assert.equal(evaluation.exitCode, 0);
    assert.equal(evaluation.message, null);
    assert.match(evaluation.warning ?? "", new RegExp(`^${__lintCommandTest__.PROCESSOR_OBSERVABILITY_WARNING_CODE}:`));
});

void test("runLintCommand maps semantic provider prebuild failures to exit code 2", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gml-lint-provider-failure-"));
    const previousCwd = process.cwd();

    await withTemporaryProperty(process, "exitCode", undefined, async () => {
        await withTemporaryProperty(
            console,
            "error",
            () => {},
            async () => {
                process.chdir(tempRoot);
                try {
                    await runLintCommand({
                        args: ["."],
                        opts() {
                            return {
                                fix: false,
                                formatter: "stylish",
                                maxWarnings: "-1",
                                quiet: true,
                                noDefaultConfig: true,
                                verbose: false,
                                path: path.join(tempRoot, "missing", "missing.yyp"),
                                projectStrict: false
                            };
                        }
                    });

                    assert.equal(process.exitCode, 2);
                } finally {
                    process.chdir(previousCwd);
                }
            }
        );
    });
});

void test("runLintCommand handles large additive-call-chain sources without parser OOM", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gml-lint-large-source-"));
    const sourceFilePath = path.join(tempRoot, "large-chain.gml");
    const configFilePath = path.join(tempRoot, "gmloop.json");

    const additiveCallChain = Array.from({ length: 520 }, (_, index) => `string_format(value_${index}, 1, 10)`).join(
        " + "
    );
    const sourceText = ["function stress_trace() {", `    return ${additiveCallChain};`, "}", ""].join("\n");
    await fs.writeFile(sourceFilePath, sourceText, "utf8");

    await fs.writeFile(configFilePath, JSON.stringify({}, null, 2), "utf8");

    const previousCwd = process.cwd();
    await withTemporaryProperty(process, "exitCode", undefined, async () => {
        process.chdir(tempRoot);

        try {
            await runLintCommand({
                args: [sourceFilePath],
                opts() {
                    return {
                        fix: false,
                        formatter: "stylish",
                        maxWarnings: "-1",
                        quiet: true,
                        config: configFilePath,
                        noDefaultConfig: false,
                        verbose: false,
                        project: null,
                        projectStrict: false
                    };
                }
            });

            assert.equal(process.exitCode ?? 0, 0);
        } finally {
            process.chdir(previousCwd);
        }
    });
});
