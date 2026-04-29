import { type ProjectResourceMutationResult, Refactor } from "@gmloop/refactor";
import { Argument, Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { createPathOption, createVerboseOption, createWriteOption } from "../cli-core/shared-command-options.js";
import { discoverProjectRoot } from "../workflow/project-root.js";

type ResourceCommandSharedOptions = Readonly<{
    path?: string;
    verbose?: boolean;
    write?: boolean;
}>;

function printMutationResult(result: ProjectResourceMutationResult): void {
    console.log(`Action: ${result.action}`);
    console.log(`Manifest: ${result.manifestPath}`);
    console.log(`Resource: ${result.resourceKind} ${result.resourceName}`);
    console.log(`Metadata path: ${result.resourcePath}`);
    console.log(`Execution mode: ${result.dryRun ? "dry-run (default)" : "apply changes (--write)"}`);

    if (result.writtenPaths.length > 0) {
        console.log(`Writes: ${result.writtenPaths.join(", ")}`);
    }

    if (result.deletedPaths.length > 0) {
        console.log(`Deletes: ${result.deletedPaths.join(", ")}`);
    }

    for (const warning of result.warnings) {
        console.log(`Warning: ${warning}`);
    }
}

async function resolveResourceProjectRoot(options: ResourceCommandSharedOptions): Promise<string> {
    return discoverProjectRoot({
        explicitProjectPath: options.path
    });
}

async function runResourceCommandAction(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        handleCliError(error, {
            exitCode: 1,
            prefix: "Resource command failed."
        });
    }
}

function addSharedOptions(command: Command): Command {
    return command.addOption(createPathOption()).addOption(createWriteOption()).addOption(createVerboseOption());
}

async function runAddResourceAction(resourceKind: string, resourceName: string, options: ResourceCommandSharedOptions) {
    const projectRoot = await resolveResourceProjectRoot(options);
    const normalizedResourceKind = Refactor.requireProjectResourceKind(resourceKind, resourceKind);
    const result = await Refactor.addProjectResource({
        dryRun: !options.write,
        projectRoot,
        resourceKind: normalizedResourceKind,
        resourceName
    });

    if (options.verbose) {
        console.log(`Project root: ${projectRoot}`);
    }

    printMutationResult(result);
}

async function runRemoveResourceAction(
    resourceKind: string,
    resourceName: string,
    options: ResourceCommandSharedOptions
) {
    const projectRoot = await resolveResourceProjectRoot(options);
    const normalizedResourceKind = Refactor.requireProjectResourceKind(resourceKind, resourceKind);
    const result = await Refactor.removeProjectResource({
        dryRun: !options.write,
        projectRoot,
        resourceKind: normalizedResourceKind,
        resourceName
    });

    if (options.verbose) {
        console.log(`Project root: ${projectRoot}`);
    }

    printMutationResult(result);
}

/**
 * Create the resource command suite for adding and removing GameMaker assets.
 */
export function createResourceCommand(): Command {
    const command = applyStandardCommandOptions(new Command("resource")).description(
        "Add or remove GameMaker project resources using @gmloop/refactor."
    );

    const kinds = Object.values(Refactor.ProjectResourceKind).toSorted((left, right) => left.localeCompare(right));

    const addCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("add"))
            .description("Create a new resource skeleton and register it in the project manifest.")
            .addArgument(new Argument("<kind>", "Resource kind").choices(kinds))
            .argument("<name>", "Resource name")
    );
    addCommand.action(async function resourceAddCommandAction(resourceKind: string, resourceName: string) {
        await runResourceCommandAction(async () => {
            await runAddResourceAction(resourceKind, resourceName, this.opts<ResourceCommandSharedOptions>());
        });
    });

    const removeCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("remove"))
            .description("Remove an existing resource from the project manifest and delete its files.")
            .addArgument(new Argument("<kind>", "Resource kind").choices(kinds))
            .argument("<name>", "Resource name")
    );
    removeCommand.action(async function resourceRemoveCommandAction(resourceKind: string, resourceName: string) {
        await runResourceCommandAction(async () => {
            await runRemoveResourceAction(resourceKind, resourceName, this.opts<ResourceCommandSharedOptions>());
        });
    });

    command.addHelpText(
        "after",
        [
            "",
            "Examples:",
            "  pnpm dlx prettier-plugin-gml resource add script scr_bootstrap --path path/to/project --write",
            "  pnpm dlx prettier-plugin-gml resource remove sprite spr_player --path path/to/project --write"
        ].join("\n")
    );

    command.addCommand(addCommand);
    command.addCommand(removeCommand);

    return command;
}
