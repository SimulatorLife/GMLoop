import { writeFile } from "node:fs/promises";
import path from "node:path";

import { Refactor } from "@gmloop/refactor";
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
            const options = this.opts<{
                width: string;
                height: string;
                color: string;
                color2: string;
                pattern: "solid" | "checkerboard";
                checkerSize: string;
            }>();

            const width = Number.parseInt(options.width, 10);
            const height = Number.parseInt(options.height, 10);
            const checkerSize = Number.parseInt(options.checkerSize, 10);

            if (Number.isNaN(width) || width <= 0) {
                throw new Error(`Invalid width: "${options.width}". Must be a positive integer.`);
            }
            if (Number.isNaN(height) || height <= 0) {
                throw new Error(`Invalid height: "${options.height}". Must be a positive integer.`);
            }
            if (Number.isNaN(checkerSize) || checkerSize <= 0) {
                throw new Error(`Invalid checker size: "${options.checkerSize}". Must be a positive integer.`);
            }

            const imageBuffer = Refactor.createSolidColorPng({
                width,
                height,
                color: options.color,
                color2: options.color2,
                pattern: options.pattern,
                checkerSize
            });

            await writeFile(outputPath, imageBuffer);

            printProjectPayload({
                command: "resource create-image",
                ok: true,
                payload: {
                    outputPath: path.resolve(outputPath),
                    width,
                    height,
                    color: options.color,
                    color2: options.color2,
                    pattern: options.pattern,
                    checkerSize
                }
            });
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
