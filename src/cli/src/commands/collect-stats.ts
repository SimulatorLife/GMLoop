import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { Core } from "@gmloop/core";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import type { CommanderCommandLike } from "../cli-core/commander-types.js";
import { type ProjectHealthStats, scanProjectHealth } from "../modules/quality-report/project-health.js";
import { ensureDirSync } from "../shared/ensure-dir.js";

const DEFAULT_OUTPUT_PATH = "reports/project-health.json";

const STAT_LABELS: Readonly<Record<keyof ProjectHealthStats, string>> = Object.freeze({
    buildSize: "Combined build output size",
    largeFiles: "Large source files",
    todos: "TODO markers"
});

const COLLECT_STATS_HELP_EXAMPLES = [
    "  pnpm dlx gmloop collect-stats",
    "  pnpm dlx gmloop collect-stats --output reports/health.json",
    "  pnpm dlx gmloop collect-stats --json",
    "  pnpm dlx gmloop collect-stats --quiet"
];

const COLLECT_STATS_HELP_NOTES = [
    "The JSON report is always written to --output (default:",
    `"${DEFAULT_OUTPUT_PATH}"). Without --json or --quiet, a human-readable`,
    "summary is printed to stdout alongside the file path so the actual",
    "stats are visible without opening the report."
];

/**
 * Print the project health stats to stdout as a key/value summary.
 *
 * Iterates over {@link STAT_LABELS} so the rendered columns stay aligned even
 * when the longest label grows, and prints the resolved report path last so
 * users can see both the numbers and where the machine-readable copy lives.
 */
function printHumanReadableStats(stats: ProjectHealthStats, outputPath: string): void {
    const labelWidth = Object.values(STAT_LABELS).reduce((widest, label) => Math.max(widest, label.length), 0);
    console.log("Project health statistics:");
    for (const key of Object.keys(STAT_LABELS) as Array<keyof ProjectHealthStats>) {
        const label = STAT_LABELS[key].padEnd(labelWidth, " ");
        console.log(`  ${label}  ${stats[key]}`);
    }
    console.log(`Report written to ${outputPath}`);
}

/**
 * Print the project health stats to stdout as a single line of pretty-printed
 * JSON. Used when callers want machine-readable output without opening the
 * persisted report file.
 */
function printStatsJson(stats: ProjectHealthStats): void {
    console.log(Core.stringifyJsonForFile(stats, { space: 2 }));
}

export function createCollectStatsCommand() {
    return applyStandardCommandOptions(
        new Command()
            .name("collect-stats")
            .description("Collect project health statistics (build size, TODOs, etc.)")
            .option("--output <path>", "Path to write the JSON report", DEFAULT_OUTPUT_PATH)
            .option("--json", "Emit machine-readable JSON to stdout (in addition to the report file).")
            .option("--quiet", "Suppress stdout output (only writes the report file).")
            .addHelpText("after", () =>
                ["", ...COLLECT_STATS_HELP_NOTES, "", "Examples:", ...COLLECT_STATS_HELP_EXAMPLES, ""].join("\n")
            )
    );
}

export function runCollectStats({ command }: { command?: CommanderCommandLike } = {}) {
    const options = command?.opts() ?? {};
    const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();
    const outputPath =
        typeof options.output === "string" && options.output.length > 0 ? options.output : DEFAULT_OUTPUT_PATH;
    const emitJson = options.json === true;
    const quiet = options.quiet === true;

    const stats = scanProjectHealth(workspaceRoot);

    const outputDir = path.dirname(outputPath);
    ensureDirSync(outputDir);

    fs.writeFileSync(outputPath, Core.stringifyJsonForFile(stats, { space: 2 }));

    if (quiet) {
        return;
    }

    if (emitJson) {
        printStatsJson(stats);
        return;
    }

    printHumanReadableStats(stats, outputPath);
}
