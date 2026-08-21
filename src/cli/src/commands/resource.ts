import { writeFile } from "node:fs/promises";

import { Refactor } from "@gmloop/refactor";
import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { printResourceCommandPayload } from "../cli-core/resource-command-shared.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
import { ensureProjectGraphIndex } from "../workflow/project-root.js";
import {
    buildCreateImageResultPayload,
    type CreateImageRawOptions,
    parseCreateImageOptions
} from "./resource/create-image-options.js";

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
 * Execute the `resource create-image` workflow as a sequence of delegation
 * steps: parse the CLI request, render the PNG, write the file, and print
 * the resulting payload. Each step is owned by a dedicated helper so this
 * orchestrator focuses on sequencing rather than primitive bookkeeping.
 */
async function runCreateImageAction(outputPath: string, rawOptions: CreateImageRawOptions): Promise<void> {
    const request = parseCreateImageOptions(rawOptions);
    const imageBuffer = Refactor.createSolidColorPng(request);
    await writeFile(outputPath, imageBuffer);
    printResourceCommandPayload(buildCreateImageResultPayload(request, outputPath));
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
            printResourceCommandPayload({ ok: true, payload: result.results });
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
            printResourceCommandPayload({ ok: true, payload: result });
        });
    });

    const createImageCommand = applyStandardCommandOptions(new Command("create-image"))
        .description("Create a PNG image of given dimensions and color/pattern.")
        .argument("<output>", "Path to save the generated PNG image.")
        .option("--width <number>", "Width of the image in pixels.", "64")
        .option("--height <number>", "Height of the image in pixels.", "64")
        .option("--color <color>", "Primary color (name or hex, e.g. 'red', '#FF0000').", "red")
        .option("--color2 <color>", "Secondary color (only for checkerboard pattern).", "white")
        .option("--pattern <pattern>", "Image pattern: solid or checkerboard.", "solid")
        .option("--checker-size <number>", "Checkerboard square size in pixels.", "8")
        .option("--json", "Emit JSON output.");

    createImageCommand.action(async function resourceCreateImageAction(outputPath: string) {
        await runResourceCommandAction(async () => {
            await runCreateImageAction(outputPath, this.opts<CreateImageRawOptions>());
        });
    });

    command.addHelpText(
        "after",
        [
            "",
            "Examples:",
            "  pnpm dlx gmloop resource list --path path/to/project",
            "  pnpm dlx gmloop resource find scr_player --path path/to/project",
            "  pnpm dlx gmloop resource create-image tmp/placeholder.png --width 32 --height 32 --color '#ff0000'",
            "  pnpm dlx gmloop resource create-image tmp/checker.png --width 64 --height 64 --pattern checkerboard --color gray --color2 white",
            '  pnpm dlx @gamemaker/gm-cli@latest resourcetool eval "resource list"'
        ].join("\n")
    );

    command.addCommand(listCommand);
    command.addCommand(findCommand);
    command.addCommand(createImageCommand);

    return command;
}
