import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, test } from "node:test";

import { Core } from "@gmloop/core";

import { discoverFixtureCases } from "../discovery/index.js";
import {
    collectBudgetFailures,
    createFixtureMemorySummary,
    createProfileCollector,
    createStageTimer
} from "../profiling/index.js";
import {
    type FixtureAdapter,
    FixtureAssertion as FA,
    type FixtureCase,
    type FixtureCaseExecutionResult,
    type FixtureCaseResult,
    type FixtureComparison,
    type FixtureProfileBudgets,
    type FixtureProfileCollector,
    type FixtureRunFailure,
    type FixtureRunResult,
    type FixtureStageName
} from "../types.js";

type DirectoryComparisonStats = Readonly<{
    totalComparedFiles: number;
    peakBufferedFileCount: number;
}>;

/**
 * Compare two fixture directories by path and UTF-8 file content while keeping
 * in-memory file buffering bounded to one pair of files at a time.
 *
 * @param actualDirectoryPath Produced fixture output directory.
 * @param expectedDirectoryPath Golden expected fixture directory.
 * @returns Deterministic comparison stats for tests/profiling assertions.
 */
export async function compareDirectoryTrees(
    actualDirectoryPath: string,
    expectedDirectoryPath: string
): Promise<DirectoryComparisonStats> {
    const [actualPaths, expectedPaths] = await Promise.all([
        Core.listRelativeFilePathsRecursively(actualDirectoryPath),
        Core.listRelativeFilePathsRecursively(expectedDirectoryPath)
    ]);

    const sortedActualPaths = [...actualPaths].sort();
    const sortedExpectedPaths = [...expectedPaths].sort();

    assert.deepEqual(
        sortedActualPaths,
        sortedExpectedPaths,
        "Project tree output paths must match expected tree paths byte-for-byte."
    );

    async function compareNextFile(nextIndex: number): Promise<number> {
        if (nextIndex >= sortedActualPaths.length) {
            return 0;
        }
        const relativePath = sortedActualPaths[nextIndex];
        if (relativePath === undefined) {
            throw new Error("Directory comparison encountered an unexpected undefined relative path.");
        }
        const [actualText, expectedText] = await Promise.all([
            readFile(path.join(actualDirectoryPath, relativePath), "utf8"),
            readFile(path.join(expectedDirectoryPath, relativePath), "utf8")
        ]);
        assert.equal(actualText, expectedText, `Project tree file "${relativePath}" must match expected text.`);
        return 1 + (await compareNextFile(nextIndex + 1));
    }

    const comparedFiles = await compareNextFile(0);

    return Object.freeze({
        totalComparedFiles: comparedFiles,
        peakBufferedFileCount: comparedFiles > 0 ? 2 : 0
    });
}

function canonicalizeFixtureText(text: string, comparison: FixtureComparison): string {
    if (comparison === "ignore-whitespace-and-line-endings") {
        return text.replaceAll(/\r\n?/gu, "\n").replaceAll(/\s+/gu, "");
    }

    return text;
}

async function compareFixtureCaseResult(fixtureCase: FixtureCase, caseResult: FixtureCaseResult): Promise<void> {
    if (fixtureCase.assertion === FA.PARSE_ERROR) {
        throw new Error(`Fixture ${fixtureCase.caseId} expected a parse error but completed successfully.`);
    }

    if (fixtureCase.assertion === FA.PROJECT_TREE) {
        assert.equal(
            caseResult.resultKind,
            "project-tree",
            `Fixture ${fixtureCase.caseId} must return a project-tree result.`
        );
        assert.notEqual(
            fixtureCase.expectedDirectoryPath,
            null,
            `Fixture ${fixtureCase.caseId} is missing expected/ directory.`
        );
        await compareDirectoryTrees(caseResult.outputDirectoryPath, fixtureCase.expectedDirectoryPath);
        return;
    }

    assert.equal(caseResult.resultKind, "text", `Fixture ${fixtureCase.caseId} must return a text result.`);
    const expectedText =
        fixtureCase.assertion === FA.IDEMPOTENT
            ? await readFile(fixtureCase.inputFilePath ?? "", "utf8")
            : await readFile(fixtureCase.expectedFilePath ?? "", "utf8");
    const actualOutput = canonicalizeFixtureText(caseResult.outputText, fixtureCase.comparison);
    const canonicalExpected = canonicalizeFixtureText(expectedText, fixtureCase.comparison);

    assert.equal(
        actualOutput,
        canonicalExpected,
        fixtureCase.comparison === "exact"
            ? `${fixtureCase.caseId} output must match expected text byte-for-byte.`
            : `${fixtureCase.caseId} output must match expected text for comparison mode ${fixtureCase.comparison}.`
    );
}

function createFixtureProfileEntry(
    adapter: FixtureAdapter,
    fixtureCase: FixtureCase,
    caseResult: FixtureCaseResult | null,
    status: "passed" | "failed",
    budgets: FixtureProfileBudgets | null,
    stages: ReturnType<ReturnType<typeof createStageTimer>["getStages"]>
) {
    const deepCpuProfileArtifactPath = null;
    const budgetFailures = collectBudgetFailures(stages, budgets);

    return Object.freeze({
        workspace: adapter.workspaceName,
        suite: adapter.suiteName,
        caseId: fixtureCase.caseId,
        fixturePath: fixtureCase.fixturePath,
        status,
        changed: caseResult?.changed ?? false,
        totalMs: stages.find((stage) => stage.stageName === "total")?.durationMs ?? 0,
        stages,
        budgets,
        budgetFailures,
        deepCpuProfileArtifactPath,
        memorySummary: createFixtureMemorySummary(stages)
    });
}

async function readFixtureInputText(fixtureCase: FixtureCase): Promise<string | null> {
    return fixtureCase.inputFilePath ? await readFile(fixtureCase.inputFilePath, "utf8") : null;
}

function assertFixtureBudgetsWithinLimits(
    fixtureCase: FixtureCase,
    budgetFailures: ReturnType<typeof collectBudgetFailures>
): void {
    if (budgetFailures.length === 0) {
        return;
    }

    throw new Error(
        `Fixture ${fixtureCase.caseId} exceeded profiling budgets:\n${budgetFailures
            .map((failure) => `- ${failure.metricName} on ${failure.stageName}: ${failure.actual} > ${failure.budget}`)
            .join("\n")}`
    );
}

async function executeFixtureCase(
    adapter: FixtureAdapter,
    fixtureCase: FixtureCase,
    profileCollector: FixtureProfileCollector
): Promise<FixtureCaseExecutionResult> {
    const stageTimer = createStageTimer();
    const budgets = fixtureCase.config.fixture.profile?.budgets ?? null;
    const inputText = await readFixtureInputText(fixtureCase);
    const runProfiledStage = <T>(
        stageName: Exclude<FixtureStageName, "load" | "compare" | "total">,
        operation: () => Promise<T>
    ) => stageTimer.runStage(stageName, operation);
    let workingProjectDirectoryPath: string | null = null;
    let caseResult: FixtureCaseResult | null = null;

    try {
        await stageTimer.runStage("load", async () => {
            if (fixtureCase.projectDirectoryPath) {
                workingProjectDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gmloop-fixture-runner-"));
                await cp(fixtureCase.projectDirectoryPath, workingProjectDirectoryPath, { recursive: true });
                // The source fixture files may be read-only (e.g. protected golden files).
                // Make all copied files writable so the refactor engine can write changes.
                const tempDir = workingProjectDirectoryPath;
                const copiedFiles = await Core.listRelativeFilePathsRecursively(tempDir);
                await Promise.all(copiedFiles.map((relPath) => chmod(path.join(tempDir, relPath), 0o644)));
            }
        });

        await stageTimer.runStage("total", async () => {
            if (fixtureCase.assertion === FA.PARSE_ERROR) {
                await assert.rejects(
                    adapter.run({
                        fixtureCase,
                        config: fixtureCase.config,
                        inputText,
                        workingProjectDirectoryPath,
                        runProfiledStage
                    })
                );
                return;
            }

            caseResult = await adapter.run({
                fixtureCase,
                config: fixtureCase.config,
                inputText,
                workingProjectDirectoryPath,
                runProfiledStage
            });
            await stageTimer.runStage("compare", async () => {
                await compareFixtureCaseResult(fixtureCase, caseResult);
            });
        });

        const profileEntry = createFixtureProfileEntry(
            adapter,
            fixtureCase,
            caseResult,
            "passed",
            budgets,
            stageTimer.getStages()
        );
        assertFixtureBudgetsWithinLimits(fixtureCase, profileEntry.budgetFailures);
        profileCollector.addEntry(profileEntry);

        return {
            fixtureCase,
            profileEntry,
            caseResult
        };
    } catch (error) {
        const profileEntry = createFixtureProfileEntry(
            adapter,
            fixtureCase,
            caseResult,
            "failed",
            budgets,
            stageTimer.getStages()
        );
        profileCollector.addEntry(profileEntry);
        throw error;
    } finally {
        if (workingProjectDirectoryPath !== null) {
            await rm(workingProjectDirectoryPath, { recursive: true, force: true });
        }
    }
}

function ensureAdapterSupportsFixtureCase(adapter: FixtureAdapter, fixtureCase: FixtureCase): void {
    if (!adapter.supports(fixtureCase.kind)) {
        throw new Error(`${adapter.workspaceName} adapter does not support fixture kind ${fixtureCase.kind}.`);
    }
}

/**
 * Run one already-discovered fixture case through the shared execution pipeline.
 *
 * @param parameters Fixture case, adapter, and optional collector.
 * @returns Execution details for the requested fixture case.
 */
export async function runDiscoveredFixtureCase(parameters: {
    adapter: FixtureAdapter;
    fixtureCase: FixtureCase;
    profileCollector?: FixtureProfileCollector;
}): Promise<FixtureCaseExecutionResult> {
    const profileCollector = parameters.profileCollector ?? createProfileCollector();
    ensureAdapterSupportsFixtureCase(parameters.adapter, parameters.fixtureCase);
    return await executeFixtureCase(parameters.adapter, parameters.fixtureCase, profileCollector);
}

/**
 * Run all fixture cases for a given adapter without registering Node test cases.
 *
 * @param parameters Fixture root, adapter, and optional collector.
 * @returns Executed fixture cases and their results.
 */
export async function runFixtureSuite(parameters: {
    fixtureRoot: string;
    adapter: FixtureAdapter;
    profileCollector?: FixtureProfileCollector;
    continueOnFailure?: boolean;
    caseIds?: ReadonlyArray<string>;
    discoveredFixtureCases?: ReadonlyArray<FixtureCase>;
}): Promise<FixtureRunResult> {
    const discoveredFixtureCases =
        parameters.discoveredFixtureCases ?? (await discoverFixtureCases(parameters.fixtureRoot));
    const caseIdFilter = parameters.caseIds ? new Set(parameters.caseIds) : null;
    const fixtureCases = caseIdFilter
        ? discoveredFixtureCases.filter((fixtureCase) => caseIdFilter.has(fixtureCase.caseId))
        : discoveredFixtureCases;
    const profileCollector = parameters.profileCollector ?? createProfileCollector();
    const executionResults: Array<FixtureCaseExecutionResult> = [];
    const failures: Array<FixtureRunFailure> = [];

    await Core.runInParallelWithLimit(
        fixtureCases,
        async (fixtureCase) => {
            try {
                executionResults.push(
                    await runDiscoveredFixtureCase({
                        adapter: parameters.adapter,
                        fixtureCase,
                        profileCollector
                    })
                );
            } catch (error) {
                if (!parameters.continueOnFailure) {
                    throw error;
                }

                failures.push(
                    Object.freeze({
                        fixtureCase,
                        error
                    })
                );
            }
        },
        /* concurrency limit: */ 8
    );

    if (failures.length > 0 && !parameters.continueOnFailure) {
        throw failures[0]?.error;
    }

    return Object.freeze({
        fixtureCases,
        executionResults: Object.freeze(executionResults),
        failures: Object.freeze(failures)
    });
}

/**
 * Register a Node test suite backed by shared fixture discovery and execution.
 *
 * @param parameters Fixture root and owning workspace adapter.
 */
export async function registerNodeFixtureSuite(parameters: {
    fixtureRoot: string;
    adapter: FixtureAdapter;
}): Promise<ReadonlyArray<FixtureCase>> {
    const fixtureCases = await discoverFixtureCases(parameters.fixtureRoot);

    void test(`${parameters.adapter.suiteName} discovers fixture cases`, () => {
        assert.equal(
            fixtureCases.length > 0,
            true,
            `Expected at least one fixture for ${parameters.adapter.suiteName}.`
        );
    });

    void describe(parameters.adapter.suiteName, () => {
        for (const fixtureCase of fixtureCases) {
            void it(`${parameters.adapter.workspaceName} fixture ${fixtureCase.caseId}`, async () => {
                await executeFixtureCase(parameters.adapter, fixtureCase, createProfileCollector());
            });
        }
    });

    return Object.freeze(fixtureCases);
}
