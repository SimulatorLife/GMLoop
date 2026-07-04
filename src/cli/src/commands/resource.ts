import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
import { ensureProjectGraphIndex, printProjectPayload } from "../workflow/project-root.js";

type ResourceCommandSharedOptions = Readonly<{
    config?: string;
    databasePath?: string;
    json?: boolean;
    path?: string;
    toolsetRoot?: string;
}>;

const RESOURCE_COMMAND_FAILURE_PREFIX = "Resource command failed.";

async function runResourceCommandAction(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        handleCliError(error, {
            exitCode: 1,
            prefix: RESOURCE_COMMAND_FAILURE_PREFIX
        });
    }
}

function addSharedOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .option("--database-path <path>", "Graph index database path override.")
        .option("--toolset-root <path>", "Toolset project root path override.")
        .option("--json", "Emit JSON output.");
}

/**
 * Create the graph-backed resource inspection command suite.
 */
export function createResourceCommand(): Command {
    const command = applyStandardCommandOptions(new Command("resource")).description(
        "Inspect project resources. Use `gm-cli resourcetool ...` for resource edits."
    );

    const listCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("list")).description("List indexed resources.")
    );
    listCommand.action(async function resourceListCommandAction() {
        await runResourceCommandAction(async () => {
            const options = this.opts<ResourceCommandSharedOptions>();
            const context = await ensureProjectGraphIndex(options);
            const result = Semantic.searchGraphIndex({
                databasePath: options.databasePath,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                query: "",
                toolsetRoot: options.toolsetRoot
            });
            printProjectPayload({ ok: true, payload: result.results });
        });
    });

    const findCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("find"))
            .description("Search resources by query text.")
            .argument("<query>", "Resource query text.")
    );
    findCommand.action(async function resourceFindCommandAction(query: string) {
        await runResourceCommandAction(async () => {
            const options = this.opts<ResourceCommandSharedOptions>();
            const context = await ensureProjectGraphIndex(options);
            const result = Semantic.searchGraphIndex({
                databasePath: options.databasePath,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                query,
                toolsetRoot: options.toolsetRoot
            });
            printProjectPayload({ ok: true, payload: result });
        });
    });

    command.addHelpText(
        "after",
        [
            "",
            "Examples:",
            "  pnpm dlx gmloop resource list --path path/to/project",
            "  pnpm dlx gmloop resource find scr_player --path path/to/project",
            '  pnpm dlx @gamemaker/gm-cli@latest resourcetool eval "resource list"'
        ].join("\n")
    );

    command.addCommand(listCommand);
    command.addCommand(findCommand);

    return command;
}
