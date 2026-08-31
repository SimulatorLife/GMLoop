import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
    type FixtureCase,
    type FixtureProfileCollector,
    type FixtureProfileReport,
    FixtureRunner
} from "@gmloop/fixture-runner";

import { createFixtureSuiteRegistry, type FixtureSuiteRegistration } from "./fixture-suite-registry.js";

const execFileAsync = promisify(execFile);

interface DeepCpuProfileFailureEntry {
    caseId: string;
    message: string;
}

interface DeepCpuCaseRequest {
    caseId: string;
    outputPath: string;
}

interface SuiteFailure {
    fixtureCase: FixtureCase;
    error: unknown;
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
    cases: ReadonlyArray<DeepCpuCaseRequest>;
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

function partitionSuiteFailures(
    workspaceName: string,
    failures: ReadonlyArray<SuiteFailure>,
    runFailures: Array<string>,
    nonPerformanceFailures: Array<string>
): void {
    for (const failure of failures) {
        const formattedFailure = `[${workspaceName}] ${failure.fixtureCase.caseId}: ${formatFixtureFailureMessage(failure.error)}`;
        if (isPerformanceBudgetFailureMessage(formattedFailure)) {
            runFailures.push(formattedFailure);
        } else {
            nonPerformanceFailures.push(formattedFailure);
        }
    }
}

function selectDeepCpuCasesForSuite(
    fixtureSuite: FixtureSuiteRegistration,
    fixtureCases: ReadonlyArray<FixtureCase>,
    deepCpuArtifactPathByFixtureId: Map<string, string>
): Array<DeepCpuCaseRequest> {
    const deepCpuCases: Array<DeepCpuCaseRequest> = [];
    const deepCpuOverride = process.env.GMLOOP_FIXTURE_DEEP_CPU === "1";

    for (const fixtureCase of fixtureCases) {
        const isExplicit = fixtureCase.config.fixture.profile?.deepCpuProfile === true;
        if (!isExplicit && !deepCpuOverride) {
            continue;
        }

        const outputPath = createDeepCpuArtifactPath(fixtureSuite.workspaceName, fixtureCase.caseId);
        deepCpuCases.push({ caseId: fixtureCase.caseId, outputPath });
        deepCpuArtifactPathByFixtureId.set(`${fixtureSuite.workspaceName}/${fixtureCase.caseId}`, outputPath);
    }

    return deepCpuCases;
}

async function appendDeepCpuFailureReport(
    workspaceName: string,
    error: unknown,
    deepCpuFailures: Array<string>
): Promise<void> {
    const reportedFailures = await readDeepCpuFailureEntries(workspaceName);
    if (reportedFailures.length === 0) {
        deepCpuFailures.push(`[${workspaceName}]: ${formatFixtureFailureMessage(error)}`);
        return;
    }

    for (const failure of reportedFailures) {
        deepCpuFailures.push(`[${workspaceName}] ${failure.caseId}: ${failure.message}`);
    }
}

async function collectDeepCpuProfilesForSuite(
    workspaceName: string,
    cases: ReadonlyArray<DeepCpuCaseRequest>,
    deepCpuFailures: Array<string>
): Promise<void> {
    try {
        await collectDeepCpuProfileArtifacts({
            workspaceName,
            cases
        });
    } catch (error) {
        await appendDeepCpuFailureReport(workspaceName, error, deepCpuFailures);
    }
}

function buildAnnotatedProfileReport(
    collector: FixtureProfileCollector,
    deepCpuArtifactPathByFixtureId: ReadonlyMap<string, string>
): FixtureProfileReport {
    const rawReport = collector.createReport();
    return Object.freeze({
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
}

function resolveProfileReportOutputPath(): string {
    const configured = process.env.GMLOOP_FIXTURE_PROFILE_OUTPUT;
    if (configured) {
        return path.resolve(configured);
    }
    return path.resolve(process.cwd(), "reports", "fixture-profile.json");
}

function warnAboutNonPerformanceFailures(failures: ReadonlyArray<string>): void {
    if (failures.length === 0) {
        return;
    }

    console.warn(
        [
            "Fixture profiling observed non-performance fixture mismatches.",
            "These are validated by dedicated correctness suites and do not fail performance profiling:",
            `- ${renderNonPerformanceFailureSummary(failures)}`
        ].join("\n")
    );
}

function throwIfCriticalFailures(runFailures: ReadonlyArray<string>, deepCpuFailures: ReadonlyArray<string>): void {
    if (runFailures.length === 0 && deepCpuFailures.length === 0) {
        return;
    }

    const sections: Array<string> = [];
    if (runFailures.length > 0) {
        sections.push(`Fixture profiling encountered failing cases:\n- ${runFailures.join("\n- ")}`);
    }
    if (deepCpuFailures.length > 0) {
        sections.push(`Fixture deep CPU profiling encountered failing cases:\n- ${deepCpuFailures.join("\n- ")}`);
    }
    throw new Error(sections.join("\n"));
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

        partitionSuiteFailures(fixtureSuite.workspaceName, result.failures, runFailures, nonPerformanceFailures);

        if (!deepCpuProfilingEnabled()) {
            continue;
        }

        const deepCpuCases = selectDeepCpuCasesForSuite(
            fixtureSuite,
            result.fixtureCases,
            deepCpuArtifactPathByFixtureId
        );
        await collectDeepCpuProfilesForSuite(fixtureSuite.workspaceName, deepCpuCases, deepCpuFailures);
    }

    const report = buildAnnotatedProfileReport(collector, deepCpuArtifactPathByFixtureId);
    const outputPath = resolveProfileReportOutputPath();
    await FixtureRunner.writeJsonProfileReport(report, outputPath);
    console.log(FixtureRunner.renderHumanProfileReport(report));

    warnAboutNonPerformanceFailures(nonPerformanceFailures);
    throwIfCriticalFailures(runFailures, deepCpuFailures);
}

void test("fixture profile report", async () => {
    if (!profilingEnabled()) {
        return;
    }

    await runProfileCollection();
});
