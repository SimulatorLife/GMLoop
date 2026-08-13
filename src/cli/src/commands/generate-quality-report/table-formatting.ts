/**
 * Renders the markdown tables and summary strings that make up the quality report
 * output: per-target test/quality rows, the per-workspace breakdown, and the
 * regression comparison flow description.
 */

import { execSync } from "node:child_process";

import { TestCaseStatus } from "../../modules/quality-report/index.js";

type ReportTableState = {
    testRows: Array<string>;
    qualityRows: Array<string>;
    workspaceRows: Array<string>;
};

const fmtCoverage = (data) => {
    if (!data || !Number.isFinite(data.pct)) {
        return "—";
    }
    return `${data.pct.toFixed(1)}%`;
};

const fmtTime = (s) =>
    !Number.isFinite(s) || s <= 0
        ? "—"
        : s < 1
          ? `${(s * 1000).toFixed(0)}ms`
          : s >= 60
            ? `${Math.floor(s / 60)}m ${(s - Math.floor(s / 60) * 60).toFixed(1)}s`
            : `${s.toFixed(2)}s`;

const fmtLintCount = (value) => (value == null ? "—" : `${value}`);

const fmtDuplicates = (data) => {
    if (!data) {
        return "—";
    }
    return `${data.percentage}% (${data.clones})`;
};

function formatDiffValue(value) {
    return value == null ? "—" : `${Math.max(0, value)}`;
}

function formatFailureBreakdown(failureBreakdown) {
    if (!failureBreakdown) {
        return {
            preExistingFailures: "—",
            newFailures: "—"
        };
    }

    return {
        preExistingFailures: formatDiffValue(failureBreakdown.preExistingFailures),
        newFailures: formatDiffValue(failureBreakdown.newFailures)
    };
}

function generateTestRow(label, results, diffStats, failureBreakdown) {
    const totals = results.stats || {};
    const hasAny = totals.total > 0;
    const coverageCell = fmtCoverage(results.coverage);
    const diff = diffStats
        ? {
              newTests: formatDiffValue(diffStats.newTests),
              removedTests: formatDiffValue(diffStats.removedTests),
              renamedTests: formatDiffValue(diffStats.renamedTests)
          }
        : { newTests: "—", removedTests: "—", renamedTests: "—" };
    const failureCells = formatFailureBreakdown(failureBreakdown);

    if (!hasAny) {
        return `| ${label} | — | — | — | ${failureCells.preExistingFailures} | ${failureCells.newFailures} | — | ${diff.newTests} | ${diff.removedTests} | ${diff.renamedTests} | — | ${coverageCell} |`;
    }
    return `| ${label} | ${totals.total} | ${totals.passed} | ${totals.failed} | ${failureCells.preExistingFailures} | ${failureCells.newFailures} | ${totals.skipped} | ${diff.newTests} | ${diff.removedTests} | ${diff.renamedTests} | ${fmtTime(totals.time)} | ${coverageCell} |`;
}

function generateQualityRow(label, results, healthStats = null) {
    const stats = healthStats || results.health;
    const lintWarningsCell = fmtLintCount(results.lint?.warnings);
    const lintErrorsCell = fmtLintCount(results.lint?.errors);
    const duplicatesCell = fmtDuplicates(results.duplicates);
    const buildSizeCell = stats ? stats.buildSize : "—";
    const largeFilesCell = stats ? stats.largeFiles : "—";
    const todosCell = stats ? stats.todos : "—";

    return `| ${label} | ${lintWarningsCell} | ${lintErrorsCell} | ${duplicatesCell} | ${buildSizeCell} | ${largeFilesCell} | ${todosCell} |`;
}

/**
 * Compute test statistics broken down by workspace/module from test cases.
 *
 * This enables the quality report to show per-workspace test metrics,
 * helping identify which parts of the codebase have test failures.
 */
function computeWorkspaceBreakdown(
    cases: Array<{ time: number; status: string; workspace?: string }>
): Map<string, { total: number; passed: number; failed: number; skipped: number; time: number }> {
    const workspaceStats = new Map<
        string,
        { total: number; passed: number; failed: number; skipped: number; time: number }
    >();

    for (const testCase of cases) {
        const workspace = testCase.workspace;
        if (!workspace) {
            continue;
        }
        let stats = workspaceStats.get(workspace);
        if (!stats) {
            stats = { total: 0, passed: 0, failed: 0, skipped: 0, time: 0 };
            workspaceStats.set(workspace, stats);
        }
        stats.total += 1;
        stats.time += testCase.time;
        switch (testCase.status) {
            case TestCaseStatus.PASSED: {
                stats.passed += 1;
                break;
            }
            case TestCaseStatus.FAILED: {
                stats.failed += 1;
                break;
            }
            case TestCaseStatus.SKIPPED: {
                stats.skipped += 1;
                break;
            }
        }
    }

    return workspaceStats;
}

/**
 * Format a single workspace row for the report table.
 */
function generateWorkspaceRow(
    workspace: string,
    stats: { total: number; passed: number; failed: number; skipped: number; time: number }
): string {
    const duration = fmtTime(stats.time);
    return `| ${workspace} | ${stats.total} | ${stats.passed} | ${stats.failed} | ${stats.skipped} | ${duration} |`;
}

/**
 * Create the report table containers with their headings pre-populated.
 */
function createQualityReportTables(): ReportTableState {
    return {
        testRows: [
            "#### Test Results",
            "",
            "| Target | Total | Passed | Failed | Failed (Pre-existing) | Failed (New) | Skipped | New | Removed | Renamed | Duration | Coverage |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
        ],
        qualityRows: [
            "#### Code Quality",
            "",
            "| Target | Lint Warnings | Lint Errors | Duplicated Code | Build Size | Files > 1k LoC | TODOs |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
        ],
        workspaceRows: [
            "#### Test Results by Workspace",
            "",
            "| Workspace | Total | Passed | Failed | Skipped | Duration |",
            "| --- | ---: | ---: | ---: | ---: | ---: |"
        ]
    };
}

/**
 * Append report rows for an available result set, keeping the orchestration
 * layer free from direct array mutation.
 */
function addReportRowForResultSet(
    tables: ReportTableState,
    {
        label,
        results,
        diffStats,
        failureBreakdown,
        healthStats = null,
        includeWorkspaceBreakdown = false
    }: {
        label: string;
        results: {
            usedDir?: string | null;
            lint?: unknown;
            duplicates?: unknown;
            health?: unknown;
            cases?: Array<{ time: number; status: string; workspace?: string }>;
        };
        diffStats: any;
        failureBreakdown: unknown;
        healthStats?: unknown;
        includeWorkspaceBreakdown?: boolean;
    }
): void {
    if (!results?.usedDir) {
        return;
    }

    tables.testRows.push(generateTestRow(label, results, diffStats, failureBreakdown));
    tables.qualityRows.push(generateQualityRow(label, results, healthStats));

    // Compute and append workspace breakdown rows
    if (includeWorkspaceBreakdown && results.cases && results.cases.length > 0) {
        const workspaceStats = computeWorkspaceBreakdown(results.cases);
        // Sort workspaces alphabetically for consistent output
        const sortedWorkspaces = Array.from(workspaceStats.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        for (const [workspace, stats] of sortedWorkspaces) {
            tables.workspaceRows.push(generateWorkspaceRow(workspace, stats));
        }
    }
}

/**
 * Resolve a user-friendly label for the head results, optionally including the
 * current branch name when the base and merged inputs are not present.
 */
function resolveHeadReportLabel({ base, merged }) {
    if (base.usedDir || merged.usedDir) {
        return "PR (Head)";
    }

    let label = "Current";
    try {
        const branch = execSync("git rev-parse --abbrev-ref HEAD", {
            encoding: "utf8"
        }).trim();
        if (branch) {
            label = `Local (${branch})`;
        }
    } catch {
        // Ignore git command errors to avoid breaking the report generation.
        // REASON: Retrieving the current git branch name is a cosmetic enhancement
        // for the quality report label. If the git command fails (e.g., not in a
        // git repository, git not installed, or detached HEAD state), we fall back
        // to the default label without branch information rather than aborting.
        // WHAT WOULD BREAK: Propagating the exception would prevent the quality
        // report from being generated, even though the underlying data is valid.
    }
    return label;
}

/**
 * Format the final report markdown table with the test and quality sections.
 */
function formatQualityReportTable({ testRows, qualityRows, workspaceRows }: ReportTableState): string {
    const parts: string[] = [...testRows, "", ...qualityRows];
    // Only include workspace section if it has more than header rows
    if (workspaceRows.length > 2) {
        parts.push("", ...workspaceRows);
    }
    return parts.join("\n");
}

function formatRegressionComparisonFlow({
    base,
    head,
    merged
}: {
    base: { usedDir?: string | null };
    head: { usedDir?: string | null };
    merged: { usedDir?: string | null };
}): string {
    const lines = [
        "#### Regression Comparison Flow",
        "",
        "- Base: baseline snapshot used as the source of truth for historical pass/fail state.",
        "- PR (Head): pull request head commit snapshot."
    ];

    if (merged.usedDir) {
        lines.push(
            "- Merged: synthetic merge snapshot for this PR event (`base.sha + head.sha`).",
            "- Regression gate target: **Merged**."
        );
    } else {
        lines.push("- Merged: unavailable for this run.", "- Regression gate target: **PR (Head)**.");
    }

    if (!base.usedDir && !head.usedDir && !merged.usedDir) {
        lines.push("- Regression gate target: unavailable (missing required artifacts).");
    }

    return lines.join("\n");
}

export {
    addReportRowForResultSet,
    createQualityReportTables,
    formatQualityReportTable,
    formatRegressionComparisonFlow,
    resolveHeadReportLabel
};
export type { ReportTableState };
