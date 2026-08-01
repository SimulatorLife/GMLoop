import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { Core } from "@gmloop/core";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import type { CommanderCommandLike } from "../cli-core/commander-types.js";
import { scanProjectHealth } from "../modules/quality-report/project-health.js";
import { ensureDirSync } from "../shared/ensure-dir.js";

export function createCollectStatsCommand() {
    return applyStandardCommandOptions(
        new Command()
            .name("collect-stats")
            .description("Collect project health statistics (build size, TODOs, etc.)")
            .option("--output <path>", "Path to write the JSON report", "reports/project-health.json")
    );
}

export function runCollectStats({ command }: { command?: CommanderCommandLike } = {}) {
    const options = command?.opts() ?? {};
    const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();
    const outputPath =
        typeof options.output === "string" ? options.output : path.join("reports", "project-health.json");

    const stats = scanProjectHealth(workspaceRoot);

    const outputDir = path.dirname(outputPath);
    ensureDirSync(outputDir);

    fs.writeFileSync(outputPath, Core.stringifyJsonForFile(stats, { space: 2 }));
    console.log(`Project health stats written to ${outputPath}`);
}
