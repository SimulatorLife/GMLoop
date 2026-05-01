import { rm } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createPathOption } from "../cli-core/shared-command-options.js";
import { discoverProjectRoot } from "../workflow/project-root.js";

type ProjectCacheCleanOptions = Readonly<{
    force?: boolean;
    ide?: boolean;
    json?: boolean;
    path?: string;
    project?: boolean;
    runner?: boolean;
}>;

function printProjectPayload(payload: unknown, asJson: boolean): void {
    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    console.log(JSON.stringify(payload, null, 2));
}

async function runProjectCacheCleanAction(options: ProjectCacheCleanOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.path
    });
    const targets = [
        options.project ? path.join(projectRoot, ".gmloop", "cache") : null,
        options.ide ? path.join(projectRoot, ".idea") : null,
        options.runner ? path.join(projectRoot, "runner") : null
    ].filter((entry): entry is string => entry !== null);

    if (options.force === true) {
        await Promise.all(targets.map((target) => rm(target, { force: true, recursive: true })));
    }

    printProjectPayload(
        {
            command: "project cache clean",
            mode: options.force === true ? "apply" : "dry-run",
            ok: true,
            payload: {
                projectRoot,
                targets
            }
        },
        options.json === true
    );
}

export function createProjectCommand(): Command {
    const command = applyStandardCommandOptions(new Command("project")).description("Project hygiene commands.");
    const cache = applyStandardCommandOptions(new Command("cache")).description("Project cache operations.");
    const clean = applyStandardCommandOptions(new Command("clean"))
        .description("Clean project caches.")
        .addOption(createPathOption())
        .option("--project", "Include .gmloop cache.")
        .option("--ide", "Include IDE cache/artifacts under project tree.")
        .option("--runner", "Include local runner cache/artifacts under project tree.")
        .option("--force", "Apply deletion. Without this flag, returns dry-run plan.")
        .option("--json", "Emit JSON output.");
    clean.action(async function projectCacheCleanAction() {
        await runProjectCacheCleanAction(this.opts<ProjectCacheCleanOptions>());
    });
    cache.addCommand(clean);
    command.addCommand(cache);
    return command;
}
