import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { FixtureRunner } from "@gmloop/fixture-runner";

import { createFixtureSuiteRegistry } from "./fixture-suite-registry.js";

const execFileAsync = promisify(execFile);

interface DeepCpuProfileFailureEntry {
    caseId: string;
    message: string;
}

const MAX_NON_PERFORMANCE_FAILURES_IN_WARNING = 10;

function renderNonPerformanceFailureSummary(failures: ReadonlyArray<string>): string {
    const visibleFailures = failures.slice(0, MAX_NON_PERFORMANCE_FAILURES_IN_WARNING);
    const omittedCount = failures.length - visibleFailures.length;

    if (omittedCount <= 0) {
        return visibleFailures.join("\n- ");
    }

    return `${visibleFailures.join("\n- ")}\n- ...and ${omittedCount} more non-performance fixture mismatches`;
}

function profilingEnabled(): boolean {
    return process.env.GMLOOP_FIXTURE_PROFILE === "1";
}

function deepCpuProfilingEnabled(): boolean {
    return process.env.GMLOOP_FIXTURE_DEEP_CPU === "1";
}

function formatFixtureFailureMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return typeof error === "string" ? error : JSON.stringify(error);
}

function isPerformanceBudgetFailureMessage(message: string): boolean {
    return message.includes("exceeded profiling budgets");
}

function createDeepCpuArtifactPath(workspaceName: string, caseId: string): string {
    const safeCaseId = caseId.replaceAll(/[^a-zA-Z0-9._-]+/gu, "-");
    return path.resolve(process.cwd(), "reports", "fixture-cpu", `${workspaceName}-${safeCaseId}.cpuprofile`);
}

function createDeepCpuFailureReportPath(workspaceName: string): string {
    return path.resolve(process.cwd(), "reports", "fixture-cpu", `${workspaceName}-failures.json`);
}

async function readDeepCpuFailureEntries(workspaceName: string): Promise<ReadonlyArray<DeepCpuProfileFailureEntry>> {
    const reportPath = createDeepCpuFailureReportPath(workspaceName);

    try {
        const content = await readFile(reportPath, "utf8");
        const parsed = JSON.parse(content) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.flatMap((entry) => {
            if (
                typeof entry === "object" &&
                entry !== null &&
                typeof (entry as { caseId?: unknown }).caseId === "string" &&
                typeof (entry as { message?: unknown }).message === "string"
            ) {
                return [
                    {
                        caseId: (entry as { caseId: string }).caseId,
                        message: (entry as { message: string }).message
                    }
                ];
            }

            return [];
        });
    } catch {
        return [];
    }
}

async function collectDeepCpuProfileArtifacts(parameters: {
    workspaceName: string;
    cases: ReadonlyArray<{
        caseId: string;
        outputPath: string;
    }>;
}): Promise<void> {
    if (parameters.cases.length === 0) {
        return;
    }

    await execFileAsync(process.execPath, [path.resolve(process.cwd(), "test/dist/fixture-deep-cpu-case.js")], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            GMLOOP_FIXTURE_DEEP_CPU: "0",
            GMLOOP_FIXTURE_DEEP_CPU_WORKSPACE: parameters.workspaceName,
            GMLOOP_FIXTURE_DEEP_CPU_CASES_JSON: JSON.stringify(parameters.cases),
            GMLOOP_FIXTURE_DEEP_CPU_FAILURES_JSON_OUTPUT: createDeepCpuFailureReportPath(parameters.workspaceName)
        },
        maxBuffer: 1024 * 1024 * 10
    });
}

async function runProfileCollection(): Promise<void> {
    const collector = FixtureRunner.createProfileCollector();
    const fixtureSuites = createFixtureSuiteRegistry();
    const runFailures: Array<string> = [];
    const nonPerformanceFailures: Array<string> = [];
    const deepCpuFailures: Array<string> = [];
    const deepCpuArtifactPathByFixtureId = new Map<string, string>();

    for (const fixtureSuite of fixtureSuites) {
        const result = await FixtureRunner.runFixtureSuite({
            fixtureRoot: fixtureSuite.fixtureRoot,
            adapter: fixtureSuite.adapter,
            profileCollector: collector,
            continueOnFailure: true
        });
        for (const failure of result.failures) {
            const formattedFailure = `[${fixtureSuite.workspaceName}] ${failure.fixtureCase.caseId}: ${formatFixtureFailureMessage(failure.error)}`;

            if (isPerformanceBudgetFailureMessage(formattedFailure)) {
                runFailures.push(formattedFailure);
                continue;
            }

            nonPerformanceFailures.push(formattedFailure);
        }

        if (!deepCpuProfilingEnabled()) {
            continue;
        }

        const deepCpuCases: Array<{
            caseId: string;
            outputPath: string;
        }> = [];

        for (const fixtureCase of result.fixtureCases) {
            if (
                fixtureCase.config.fixture.profile?.deepCpuProfile !== true &&
                process.env.GMLOOP_FIXTURE_DEEP_CPU !== "1"
            ) {
                continue;
            }

            const outputPath = createDeepCpuArtifactPath(fixtureSuite.workspaceName, fixtureCase.caseId);
            deepCpuCases.push({
                caseId: fixtureCase.caseId,
                outputPath
            });
            deepCpuArtifactPathByFixtureId.set(`${fixtureSuite.workspaceName}/${fixtureCase.caseId}`, outputPath);
        }

        try {
            await collectDeepCpuProfileArtifacts({
                workspaceName: fixtureSuite.workspaceName,
                cases: deepCpuCases
            });
        } catch (error) {
            const reportedFailures = await readDeepCpuFailureEntries(fixtureSuite.workspaceName);
            if (reportedFailures.length > 0) {
                deepCpuFailures.push(
                    ...reportedFailures.map(
                        (failure) => `[${fixtureSuite.workspaceName}] ${failure.caseId}: ${failure.message}`
                    )
                );
            } else {
                deepCpuFailures.push(`[${fixtureSuite.workspaceName}]: ${formatFixtureFailureMessage(error)}`);
            }
        }
    }

    const rawReport = collector.createReport();
    const report = Object.freeze({
        ...rawReport,
        entries: Object.freeze(
            rawReport.entries.map((entry) =>
                Object.freeze({
                    ...entry,
                    deepCpuProfileArtifactPath:
                        deepCpuArtifactPathByFixtureId.get(`${entry.workspace}/${entry.caseId}`) ??
                        entry.deepCpuProfileArtifactPath
                })
            )
        )
    });
    const outputPath = process.env.GMLOOP_FIXTURE_PROFILE_OUTPUT
        ? path.resolve(process.env.GMLOOP_FIXTURE_PROFILE_OUTPUT)
        : path.resolve(process.cwd(), "reports", "fixture-profile.json");

    await FixtureRunner.writeJsonProfileReport(report, outputPath);
    console.log(FixtureRunner.renderHumanProfileReport(report));

    if (nonPerformanceFailures.length > 0) {
        console.warn(
            [
                "Fixture profiling observed non-performance fixture mismatches.",
                "These are validated by dedicated correctness suites and do not fail performance profiling:",
                `- ${renderNonPerformanceFailureSummary(nonPerformanceFailures)}`
            ].join("\n")
        );
    }

    if (runFailures.length > 0 || deepCpuFailures.length > 0) {
        throw new Error(
            [
                runFailures.length > 0
                    ? `Fixture profiling encountered failing cases:\n- ${runFailures.join("\n- ")}`
                    : "",
                deepCpuFailures.length > 0
                    ? `Fixture deep CPU profiling encountered failing cases:\n- ${deepCpuFailures.join("\n- ")}`
                    : ""
            ]
                .filter((value) => value.length > 0)
                .join("\n")
        );
    }
}

void test("fixture profile report", async () => {
    if (!profilingEnabled()) {
        return;
    }

    await runProfileCollection();
});
