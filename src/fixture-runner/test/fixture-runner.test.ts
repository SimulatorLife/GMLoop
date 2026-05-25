import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FixtureRunner } from "../src/index.js";

async function createTextFixtureCase(
    rootPath: string,
    caseId: string,
    config: Record<string, unknown>,
    input: string,
    expected?: string
) {
    const casePath = path.join(rootPath, caseId);
    await mkdir(casePath, { recursive: true });
    await writeFile(path.join(casePath, "gmloop.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await writeFile(path.join(casePath, "input.gml"), input, "utf8");
    if (expected !== undefined) {
        await writeFile(path.join(casePath, "expected.gml"), expected, "utf8");
    }
}

void test("loadFixtureProjectConfig validates fixture metadata", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-config-"));
    const configPath = path.join(rootPath, "gmloop.json");
    await writeFile(
        configPath,
        `${JSON.stringify({ fixture: { kind: "format", comparison: "exact", profile: { budgets: { durationMs: { total: 100 } } } } }, null, 2)}\n`,
        "utf8"
    );

    try {
        const config = await FixtureRunner.loadFixtureProjectConfig(configPath);
        assert.equal(config.fixture.kind, "format");
        assert.equal(config.fixture.comparison, "exact");
        assert.deepEqual(config.fixture.profile?.budgets?.durationMs, { total: 100 });
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("loadFixtureProjectConfig rejects invalid fixture comparison values", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-config-invalid-comparison-"));
    const configPath = path.join(rootPath, "gmloop.json");
    await writeFile(
        configPath,
        `${JSON.stringify({ fixture: { kind: "format", comparison: "unsupported" } }, null, 2)}\n`,
        "utf8"
    );

    try {
        await assert.rejects(
            FixtureRunner.loadFixtureProjectConfig(configPath),
            /gmloop\.json fixture config\.comparison must be one of exact/u
        );
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("loadFixtureProjectConfig rejects invalid fixture assertion values", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-config-invalid-assertion-"));
    const configPath = path.join(rootPath, "gmloop.json");
    await writeFile(
        configPath,
        `${JSON.stringify({ fixture: { kind: "format", assertion: "unsupported" } }, null, 2)}\n`,
        "utf8"
    );

    try {
        await assert.rejects(
            FixtureRunner.loadFixtureProjectConfig(configPath),
            /gmloop\.json fixture config\.assertion must be one of transform/u
        );
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("discoverFixtureCases normalizes directory-per-case fixtures", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-discovery-"));
    await createTextFixtureCase(
        rootPath,
        "example",
        {
            fixture: {
                kind: "format"
            }
        },
        "var value = 1;\n",
        "var value = 1;\n"
    );

    try {
        const fixtureCases = await FixtureRunner.discoverFixtureCases(rootPath);
        assert.equal(fixtureCases.length, 1);
        assert.equal(fixtureCases[0]?.caseId, "example");
        assert.equal(fixtureCases[0]?.assertion, "transform");
        assert.equal(fixtureCases[0]?.comparison, "exact");
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("discoverFixtureCases rejects unexpected files and directories", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-invalid-layout-"));
    const casePath = path.join(rootPath, "invalid");
    await mkdir(casePath, { recursive: true });
    await writeFile(
        path.join(casePath, "gmloop.json"),
        `${JSON.stringify({ fixture: { kind: "format", assertion: "transform" } }, null, 2)}\n`,
        "utf8"
    );
    await writeFile(path.join(casePath, "input.gml"), "var value = 1;\n", "utf8");
    await writeFile(path.join(casePath, "legacy.output.gml"), "var value = 1;\n", "utf8");
    await mkdir(path.join(casePath, "nested"), { recursive: true });

    try {
        await assert.rejects(
            FixtureRunner.discoverFixtureCases(rootPath),
            /unexpected file "legacy\.output\.gml".*unexpected directory "nested"/su
        );
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("discoverFixtureCases rejects text fixtures that use the project-tree assertion", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-invalid-assertion-"));
    const casePath = path.join(rootPath, "invalid-assertion");
    await mkdir(casePath, { recursive: true });
    await writeFile(
        path.join(casePath, "gmloop.json"),
        `${JSON.stringify({ fixture: { kind: "format", assertion: "project-tree" } }, null, 2)}\n`,
        "utf8"
    );
    await writeFile(path.join(casePath, "input.gml"), "var value = 1;\n", "utf8");

    try {
        await assert.rejects(
            FixtureRunner.discoverFixtureCases(rootPath),
            /project-tree assertion is only valid for refactor fixtures/su
        );
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("discoverFixtureCases assigns fixture paths by kind", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-paths-"));
    await createTextFixtureCase(
        rootPath,
        "format-idempotent",
        {
            fixture: {
                kind: "format",
                assertion: "idempotent"
            }
        },
        "var value = 1;\n"
    );

    const refactorCasePath = path.join(rootPath, "refactor-project-tree");
    await mkdir(path.join(refactorCasePath, "project"), { recursive: true });
    await mkdir(path.join(refactorCasePath, "expected"), { recursive: true });
    await writeFile(
        path.join(refactorCasePath, "gmloop.json"),
        `${JSON.stringify({ fixture: { kind: "refactor", assertion: "project-tree" } }, null, 2)}\n`,
        "utf8"
    );

    try {
        const fixtureCases = await FixtureRunner.discoverFixtureCases(rootPath);
        const textCase = fixtureCases.find((fixtureCase) => fixtureCase.caseId === "format-idempotent");
        assert.ok(textCase);
        assert.equal(textCase.inputFilePath, path.join(rootPath, "format-idempotent", "input.gml"));
        assert.equal(textCase.expectedFilePath, null);
        assert.equal(textCase.projectDirectoryPath, null);
        assert.equal(textCase.expectedDirectoryPath, null);

        const refactorCase = fixtureCases.find((fixtureCase) => fixtureCase.caseId === "refactor-project-tree");
        assert.ok(refactorCase);
        assert.equal(refactorCase.inputFilePath, null);
        assert.equal(refactorCase.expectedFilePath, null);
        assert.equal(refactorCase.projectDirectoryPath, path.join(rootPath, "refactor-project-tree", "project"));
        assert.equal(refactorCase.expectedDirectoryPath, path.join(rootPath, "refactor-project-tree", "expected"));
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("discoverFixtureCases supports external project fixture descriptors", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-external-project-discovery-"));
    const casePath = path.join(rootPath, "real-project");
    await mkdir(casePath, { recursive: true });
    await writeFile(
        path.join(casePath, "gmloop.json"),
        `${JSON.stringify(
            {
                fixture: {
                    kind: "external-project",
                    externalProject: {
                        sourcePath: "../../vendor/3DSpider",
                        excludes: {
                            directoryNames: [".gmloop"]
                        }
                    }
                }
            },
            null,
            2
        )}\n`,
        "utf8"
    );

    try {
        const fixtureCases = await FixtureRunner.discoverFixtureCases(rootPath);
        const fixtureCase = fixtureCases[0];

        assert.equal(fixtureCases.length, 1);
        assert.equal(fixtureCase?.kind, "external-project");
        assert.equal(fixtureCase?.assertion, "project-tree");
        assert.equal(fixtureCase?.projectDirectoryPath, null);
        assert.equal(fixtureCase?.config.fixture.externalProject?.sourcePath, "../../vendor/3DSpider");
        assert.deepEqual(fixtureCase?.config.fixture.externalProject?.excludes?.directoryNames, [".gmloop"]);
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("copyExternalProjectFixture copies a writable project subset with exclusions", async () => {
    const sourceRootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-external-source-"));
    await mkdir(path.join(sourceRootPath, ".git"), { recursive: true });
    await mkdir(path.join(sourceRootPath, ".gmloop"), { recursive: true });
    await mkdir(path.join(sourceRootPath, "scripts", "Demo"), { recursive: true });
    await writeFile(path.join(sourceRootPath, ".git", "config"), "ignored\n", "utf8");
    await writeFile(path.join(sourceRootPath, ".gmloop", "graph-index.sqlite"), "ignored\n", "utf8");
    await writeFile(path.join(sourceRootPath, "scripts", "Demo", "Demo.gml"), "var value = 1;\n", "utf8");
    await writeFile(path.join(sourceRootPath, "notes.tmp"), "ignored\n", "utf8");

    const copiedProject = await FixtureRunner.copyExternalProjectFixture({
        sourceProjectPath: sourceRootPath
    });

    try {
        assert.deepEqual(copiedProject.copiedRelativeFilePaths, ["scripts/Demo/Demo.gml"]);
        assert.equal(
            await readFile(path.join(copiedProject.workingProjectDirectoryPath, "scripts", "Demo", "Demo.gml"), "utf8"),
            "var value = 1;\n"
        );
        await assert.rejects(readFile(path.join(copiedProject.workingProjectDirectoryPath, ".git", "config"), "utf8"));
    } finally {
        await copiedProject.dispose();
        await rm(sourceRootPath, { recursive: true, force: true });
    }
});

void test("project fingerprints and change summaries are stable", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-project-fingerprint-"));
    await mkdir(path.join(rootPath, "scripts"), { recursive: true });
    await writeFile(path.join(rootPath, "scripts", "first.gml"), "var first = 1;\n", "utf8");
    await writeFile(path.join(rootPath, "scripts", "second.gml"), "var second = 2;\n", "utf8");

    try {
        const before = await FixtureRunner.createProjectFingerprint(rootPath);
        await writeFile(path.join(rootPath, "scripts", "first.gml"), "var first = 10;\n", "utf8");
        await writeFile(path.join(rootPath, "scripts", "third.gml"), "var third = 3;\n", "utf8");
        await rm(path.join(rootPath, "scripts", "second.gml"));
        const after = await FixtureRunner.createProjectFingerprint(rootPath);
        const summary = FixtureRunner.collectProjectChangeSummary(before, after);

        assert.notEqual(before.digest, after.digest);
        assert.deepEqual(summary.added, ["scripts/third.gml"]);
        assert.deepEqual(summary.modified, ["scripts/first.gml"]);
        assert.deepEqual(summary.removed, ["scripts/second.gml"]);
        assert.equal(
            FixtureRunner.formatProjectChangeSummary(summary),
            "added=1 [scripts/third.gml]; modified=1 [scripts/first.gml]; removed=1 [scripts/second.gml]"
        );
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("assertJsonCliPayload parses command output prefixes and rejects arrays", () => {
    const payload = FixtureRunner.assertJsonCliPayload('$ node cli\n{"ok":true,"payload":{"total":1}}\n');

    assert.deepEqual(payload, {
        ok: true,
        payload: {
            total: 1
        }
    });
    assert.throws(() => FixtureRunner.assertJsonCliPayload("[1,2,3]"), /Expected CLI JSON payload/u);
});

void test("runFixtureSuite records profiling metrics and writes reports", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-suite-"));
    const reportPath = path.join(rootPath, "fixture-profile.json");
    await createTextFixtureCase(
        rootPath,
        "example",
        {
            fixture: {
                kind: "format"
            }
        },
        "input\n",
        "output\n"
    );

    try {
        const collector = FixtureRunner.createProfileCollector();
        const result = await FixtureRunner.runFixtureSuite({
            fixtureRoot: rootPath,
            adapter: {
                workspaceName: "format",
                suiteName: "format fixtures",
                supports(kind) {
                    return kind === "format";
                },
                async run({ runProfiledStage }) {
                    return await runProfiledStage("format", async () =>
                        runProfiledStage("format", async () => ({
                            resultKind: "text",
                            outputText: "output\n",
                            changed: true
                        }))
                    );
                }
            },
            profileCollector: collector
        });

        assert.equal(result.executionResults.length, 1);
        const report = collector.createReport();
        assert.equal(report.entries.length, 1);
        assert.equal(report.workspaceAggregates.length, 1);
        assert.equal(
            report.stageAggregates.some((aggregate) => aggregate.stageName === "format"),
            true
        );
        assert.deepEqual(report.failingBudgets, []);
        assert.equal(
            report.entries[0]?.stages.some((stage) => stage.stageName === "format"),
            true
        );
        assert.equal(report.entries[0]?.stages.filter((stage) => stage.stageName === "format").length, 2);
        assert.equal(typeof report.entries[0]?.memorySummary.totalHeapUsedDeltaBytes, "number");
        assert.equal(typeof report.entries[0]?.memorySummary.totalMaxRssDeltaBytes, "number");
        assert.equal(typeof report.entries[0]?.memorySummary.peakStageHeapUsedDeltaBytes, "number");
        await FixtureRunner.writeJsonProfileReport(report, reportPath);
        const persisted = JSON.parse(await readFile(reportPath, "utf8")) as {
            entries: Array<unknown>;
            workspaceAggregates: Array<unknown>;
            stageAggregates: Array<unknown>;
        };
        assert.equal(persisted.entries.length, 1);
        const persistedEntry = persisted.entries[0] as {
            memorySummary?: {
                totalHeapUsedDeltaBytes?: unknown;
                totalMaxRssDeltaBytes?: unknown;
                peakStageHeapUsedDeltaBytes?: unknown;
            };
        };
        assert.equal(typeof persistedEntry.memorySummary?.totalHeapUsedDeltaBytes, "number");
        assert.equal(typeof persistedEntry.memorySummary?.totalMaxRssDeltaBytes, "number");
        assert.equal(typeof persistedEntry.memorySummary?.peakStageHeapUsedDeltaBytes, "number");
        assert.equal(persisted.workspaceAggregates.length, 1);
        assert.equal(persisted.stageAggregates.length > 0, true);
        assert.match(FixtureRunner.renderHumanProfileReport(report), /Slowest cases:/u);
        assert.match(FixtureRunner.renderHumanProfileReport(report), /Workspace totals:/u);
        assert.match(FixtureRunner.renderHumanProfileReport(report), /Stage totals:/u);
        assert.match(FixtureRunner.renderHumanProfileReport(report), /Highest CPU user time:/u);
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("compareDirectoryTrees bounds buffered file content to one file pair", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-directory-compare-"));
    const actualDirectory = path.join(rootPath, "actual");
    const expectedDirectory = path.join(rootPath, "expected");
    await mkdir(actualDirectory, { recursive: true });
    await mkdir(expectedDirectory, { recursive: true });

    try {
        const fileCount = 64;
        const fileContent = "x".repeat(8 * 1024);
        await Promise.all(
            Array.from({ length: fileCount }, async (_value, index) => {
                const relativePath = `nested/file-${String(index).padStart(3, "0")}.txt`;
                const actualPath = path.join(actualDirectory, relativePath);
                const expectedPath = path.join(expectedDirectory, relativePath);
                await mkdir(path.dirname(actualPath), { recursive: true });
                await mkdir(path.dirname(expectedPath), { recursive: true });
                await Promise.all([
                    writeFile(actualPath, fileContent, "utf8"),
                    writeFile(expectedPath, fileContent, "utf8")
                ]);
            })
        );

        const stats = await FixtureRunner.compareDirectoryTrees(actualDirectory, expectedDirectory);
        assert.equal(stats.totalComparedFiles, fileCount);
        assert.equal(stats.peakBufferedFileCount, 2);
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("runFixtureSuite continues collecting failures for profiling mode", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-continue-on-failure-"));
    await createTextFixtureCase(
        rootPath,
        "failing",
        {
            fixture: {
                kind: "format"
            }
        },
        "input\n",
        "expected\n"
    );
    await createTextFixtureCase(
        rootPath,
        "passing",
        {
            fixture: {
                kind: "format"
            }
        },
        "input\n",
        "output\n"
    );

    try {
        const collector = FixtureRunner.createProfileCollector();
        const result = await FixtureRunner.runFixtureSuite({
            fixtureRoot: rootPath,
            adapter: {
                workspaceName: "format",
                suiteName: "format fixtures",
                supports(kind) {
                    return kind === "format";
                },
                async run({ fixtureCase, runProfiledStage }) {
                    return await runProfiledStage("format", async () => ({
                        resultKind: "text",
                        outputText: fixtureCase.caseId === "failing" ? "actual\n" : "output\n",
                        changed: true
                    }));
                }
            },
            profileCollector: collector,
            continueOnFailure: true
        });

        assert.equal(result.executionResults.length, 1);
        assert.equal(result.failures.length, 1);
        assert.equal(result.failures[0]?.fixtureCase.caseId, "failing");
        const report = collector.createReport();
        assert.equal(report.entries.length, 2);
        assert.equal(
            report.entries.some((entry) => entry.status === "failed"),
            true
        );
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("failed fixture comparisons preserve the adapter changed flag in profiling output", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-failed-changed-"));
    await createTextFixtureCase(
        rootPath,
        "changed-before-compare",
        {
            fixture: {
                kind: "format"
            }
        },
        "input\n",
        "expected\n"
    );

    try {
        const collector = FixtureRunner.createProfileCollector();

        await assert.rejects(
            FixtureRunner.runFixtureSuite({
                fixtureRoot: rootPath,
                profileCollector: collector,
                adapter: {
                    workspaceName: "format",
                    suiteName: "format fixtures",
                    supports(kind) {
                        return kind === "format";
                    },
                    async run({ runProfiledStage }) {
                        return await runProfiledStage("format", async () => ({
                            resultKind: "text",
                            outputText: "different\n",
                            changed: true
                        }));
                    }
                }
            }),
            /must match expected text byte-for-byte/u
        );

        const report = collector.createReport();
        assert.equal(report.entries.length, 1);
        assert.equal(report.entries[0]?.status, "failed");
        assert.equal(report.entries[0]?.changed, true);
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("fixture cases default to exact comparison", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-lint-comparison-"));
    await createTextFixtureCase(
        rootPath,
        "lint-like",
        {
            fixture: {
                kind: "lint"
            }
        },
        "input\n",
        "var total = 1 + 2;\n"
    );

    try {
        const fixtureCases = await FixtureRunner.discoverFixtureCases(rootPath);
        assert.equal(fixtureCases[0]?.comparison, "exact");
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("integration fixtures with refactor config do not receive a runner-managed working project directory", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-integration-project-"));
    await createTextFixtureCase(
        rootPath,
        "integration-refactor",
        {
            refactor: {
                codemods: {
                    loopLengthHoisting: false
                }
            },
            fixture: {
                kind: "integration"
            }
        },
        "var value = 1;\n",
        "var value = 1;\n"
    );

    try {
        const result = await FixtureRunner.runFixtureSuite({
            fixtureRoot: rootPath,
            adapter: {
                workspaceName: "integration",
                suiteName: "integration fixtures",
                supports(kind) {
                    return kind === "integration";
                },
                async run({ workingProjectDirectoryPath, runProfiledStage }) {
                    assert.equal(workingProjectDirectoryPath, null);
                    return await runProfiledStage("format", async () => ({
                        resultKind: "text" as const,
                        outputText: "var value = 1;\n",
                        changed: false
                    }));
                }
            }
        });

        assert.equal(result.executionResults.length, 1);
        assert.deepEqual(result.failures, []);
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("runFixtureSuite can target a single case id", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-case-filter-"));
    await createTextFixtureCase(rootPath, "first", { fixture: { kind: "format" } }, "input\n", "first\n");
    await createTextFixtureCase(rootPath, "second", { fixture: { kind: "format" } }, "input\n", "second\n");

    try {
        const result = await FixtureRunner.runFixtureSuite({
            fixtureRoot: rootPath,
            caseIds: ["second"],
            adapter: {
                workspaceName: "format",
                suiteName: "format fixtures",
                supports(kind) {
                    return kind === "format";
                },
                async run({ fixtureCase, runProfiledStage }) {
                    return await runProfiledStage("format", async () => ({
                        resultKind: "text",
                        outputText: `${fixtureCase.caseId}\n`,
                        changed: true
                    }));
                }
            }
        });

        assert.deepEqual(
            result.fixtureCases.map((fixtureCase) => fixtureCase.caseId),
            ["second"]
        );
        assert.equal(result.executionResults.length, 1);
        assert.equal(result.executionResults[0]?.fixtureCase.caseId, "second");
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("runFixtureSuite can reuse discovered fixture cases", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-discovered-reuse-"));
    await createTextFixtureCase(rootPath, "first", { fixture: { kind: "format" } }, "input\n", "first\n");

    try {
        const discoveredFixtureCases = await FixtureRunner.discoverFixtureCases(rootPath);
        const impossibleFixtureRoot = path.join(rootPath, "missing-fixture-root");

        const result = await FixtureRunner.runFixtureSuite({
            fixtureRoot: impossibleFixtureRoot,
            discoveredFixtureCases,
            adapter: {
                workspaceName: "format",
                suiteName: "format fixtures",
                supports(kind) {
                    return kind === "format";
                },
                async run({ fixtureCase, runProfiledStage }) {
                    return await runProfiledStage("format", async () => ({
                        resultKind: "text",
                        outputText: `${fixtureCase.caseId}\n`,
                        changed: true
                    }));
                }
            }
        });

        assert.equal(result.fixtureCases.length, 1);
        assert.equal(result.executionResults.length, 1);
        assert.equal(result.executionResults[0]?.fixtureCase.caseId, "first");
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("runDiscoveredFixtureCase executes a specific pre-discovered case", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-single-case-"));
    await createTextFixtureCase(rootPath, "target", { fixture: { kind: "format" } }, "input\n", "target\n");

    try {
        const discoveredFixtureCases = await FixtureRunner.discoverFixtureCases(rootPath);
        const targetFixtureCase = discoveredFixtureCases[0];

        assert.notEqual(targetFixtureCase, undefined);

        const executionResult = await FixtureRunner.runDiscoveredFixtureCase({
            adapter: {
                workspaceName: "format",
                suiteName: "format fixtures",
                supports(kind) {
                    return kind === "format";
                },
                async run({ fixtureCase, runProfiledStage }) {
                    return await runProfiledStage("format", async () => ({
                        resultKind: "text",
                        outputText: `${fixtureCase.caseId}\n`,
                        changed: true
                    }));
                }
            },
            fixtureCase: targetFixtureCase
        });

        assert.equal(executionResult.fixtureCase.caseId, "target");
        assert.equal(executionResult.caseResult?.resultKind, "text");
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("runDiscoveredFixtureCase rejects unsupported fixture kinds", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-single-case-kind-"));
    await createTextFixtureCase(rootPath, "target", { fixture: { kind: "format" } }, "input\n", "target\n");

    try {
        const discoveredFixtureCases = await FixtureRunner.discoverFixtureCases(rootPath);
        const targetFixtureCase = discoveredFixtureCases[0];
        assert.notEqual(targetFixtureCase, undefined);

        await assert.rejects(
            FixtureRunner.runDiscoveredFixtureCase({
                adapter: {
                    workspaceName: "lint",
                    suiteName: "lint fixtures",
                    supports(kind) {
                        return kind === "lint";
                    },
                    async run({ runProfiledStage }) {
                        return await runProfiledStage("lint", async () => ({
                            resultKind: "text",
                            outputText: "target\n",
                            changed: false
                        }));
                    }
                },
                fixtureCase: targetFixtureCase
            }),
            /does not support fixture kind/u
        );
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("fixture stage timing rejects duplicate stage names", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-duplicate-stage-"));
    await createTextFixtureCase(
        rootPath,
        "duplicate-stage",
        { fixture: { kind: "integration" } },
        "input\n",
        "input\n"
    );

    try {
        await assert.rejects(
            FixtureRunner.runFixtureSuite({
                fixtureRoot: rootPath,
                adapter: {
                    workspaceName: "integration",
                    suiteName: "integration fixtures",
                    supports(kind) {
                        return kind === "integration";
                    },
                    async run({ runProfiledStage }) {
                        await runProfiledStage("lint", async () => undefined);
                        await runProfiledStage("format", async () => undefined);
                        await runProfiledStage("format", async () => undefined);
                        return {
                            resultKind: "text",
                            outputText: "input\n",
                            changed: false
                        };
                    }
                }
            }),
            /must not run more than once/u
        );
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("fixture stage timing rejects out-of-order stage execution", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "fixture-runner-stage-order-"));
    await createTextFixtureCase(rootPath, "stage-order", { fixture: { kind: "integration" } }, "input\n", "input\n");

    try {
        await assert.rejects(
            FixtureRunner.runFixtureSuite({
                fixtureRoot: rootPath,
                adapter: {
                    workspaceName: "integration",
                    suiteName: "integration fixtures",
                    supports(kind) {
                        return kind === "integration";
                    },
                    async run({ runProfiledStage }) {
                        await runProfiledStage("format", async () => undefined);
                        await runProfiledStage("lint", async () => undefined);
                        return {
                            resultKind: "text",
                            outputText: "input\n",
                            changed: false
                        };
                    }
                }
            }),
            /ran out of order/u
        );
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});
