import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { CliUsageError, handleCliError } from "../cli-core/errors.js";
import { scanProjectHealth } from "../modules/quality-report/project-health.js";
import {
    calculateFailureBreakdown,
    chooseTargetResultSet,
    computeTestDiff,
    describeRegressionCause,
    detectRegressions,
    summarizeRegressedTests
} from "./generate-quality-report/regression-detection.js";
import { readTestResults } from "./generate-quality-report/result-aggregation.js";
import {
    addReportRowForResultSet,
    createQualityReportTables,
    formatQualityReportTable,
    formatRegressionComparisonFlow,
    resolveHeadReportLabel
} from "./generate-quality-report/table-formatting.js";

export function createGenerateQualityReportCommand() {
    return applyStandardCommandOptions(
        new Command()
            .name("generate-quality-report")
            .description("Generate a quality report (tests, lint, coverage, duplicates) and detect regressions.")
            .option("--base <path>", "Path to base reports")
            .option("--head <path>", "Path to head reports")
            .option("--merge <path>", "Path to merge reports")
            .option("--report-file <path>", "Path to write the report markdown file")
    );
}

export function runGenerateQualityReport({ command }: any = {}) {
    const options = command?.opts() || {};
    const exitCode = runCli(options);

    if (exitCode === 10) {
        return exitCode;
    }

    if (exitCode !== 0) {
        process.exitCode = exitCode;
        throw new CliUsageError(exitCode === 11 ? "Lint errors detected." : "Test regressions detected.");
    }

    return 0;
}

function runCli(options: any = {}) {
    const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();
    const reportFile = options.reportFile || path.join("reports", "summary-report.md");

    const baseDir = options.base ? [options.base] : [path.join("base", "reports"), "base-reports"];
    const headDir = options.head ? [options.head] : ["reports"];
    const mergeDir = options.merge ? [options.merge] : [path.join("merge", "reports"), "merge-reports"];

    const base = readTestResults(baseDir, { workspace: workspaceRoot });
    const head = readTestResults(headDir, { workspace: workspaceRoot });
    const merged = readTestResults(mergeDir, { workspace: workspaceRoot });

    const { target, usingMerged } = chooseTargetResultSet({
        merged,
        head
    });

    const diffStats = {
        base: base.usedDir ? { newTests: 0, removedTests: 0, renamedTests: 0 } : null,
        head: computeTestDiff(base, head),
        merge: computeTestDiff(base, merged)
    };
    const failureBreakdowns = {
        base: calculateFailureBreakdown(base, base),
        head: calculateFailureBreakdown(base, head),
        merge: calculateFailureBreakdown(base, merged)
    };

    const healthStats = scanProjectHealth(workspaceRoot);

    const reportTables = createQualityReportTables();

    addReportRowForResultSet(reportTables, {
        label: "Base",
        results: base,
        diffStats: diffStats.base,
        failureBreakdown: failureBreakdowns.base
    });

    addReportRowForResultSet(reportTables, {
        label: resolveHeadReportLabel({ base, merged }),
        results: head,
        diffStats: diffStats.head,
        failureBreakdown: failureBreakdowns.head,
        healthStats,
        includeWorkspaceBreakdown: true
    });

    addReportRowForResultSet(reportTables, {
        label: "Merged",
        results: merged,
        diffStats: diffStats.merge,
        failureBreakdown: failureBreakdowns.merge
    });

    const table = formatQualityReportTable(reportTables);
    const comparisonFlow = formatRegressionComparisonFlow({
        base,
        head,
        merged
    });
    console.log(table);
    console.log(`\n${comparisonFlow}`);

    let exitCode = 0;
    let statusLine;
    const lintErrorCount = Number(target.lint?.errors ?? 0);
    const hasLintErrors = Number.isFinite(lintErrorCount) && lintErrorCount > 0;

    if (hasLintErrors) {
        exitCode = 11;
        statusLine = `❌ Lint errors detected on gate target (${usingMerged ? "Merged" : "PR (Head)"}): ${String(lintErrorCount)}.`;
    } else if (base.usedDir && target.usedDir) {
        const regressions = detectRegressions(base, target);
        const gateLabel = usingMerged ? "Base → Merged" : "Base → PR (Head)";
        if (regressions.length > 0) {
            exitCode = 10;
            const cause = describeRegressionCause(regressions, diffStats[usingMerged ? "merge" : "head"]);
            const summary = summarizeRegressedTests(regressions);
            statusLine = `❌ Test regressions detected (${gateLabel}). ${summary}. Cause: ${cause}`;
        } else {
            statusLine = `✅ No test regressions detected (${gateLabel}).`;
        }
    } else {
        statusLine = "⚠️ Unable to compare base and target results (missing artifacts for gate target).";
    }

    console.log(`\n${statusLine}`);

    if (reportFile) {
        const reportContent = [
            "<!-- automerge-pr-test-summary -->",
            "### Quality Report Summary",
            "",
            table,
            "",
            comparisonFlow,
            "",
            statusLine
        ].join("\n");
        fs.writeFileSync(reportFile, reportContent);
    }

    return exitCode;
}

const isMainModule = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMainModule) {
    try {
        const exitCode = runCli();
        if (typeof exitCode === "number") {
            process.exitCode = exitCode;
        }
    } catch (error) {
        handleCliError(error, {
            prefix: "Failed to detect test regressions.",
            exitCode: typeof error?.exitCode === "number" ? error.exitCode : 1
        });
    }
}

export { collectTestCases } from "./generate-quality-report/junit-parsing.js";
export {
    detectRegressions,
    detectResolvedFailures,
    ensureResultsAvailability,
    reportRegressionSummary
} from "./generate-quality-report/regression-detection.js";
export { readTestResults } from "./generate-quality-report/result-aggregation.js";
