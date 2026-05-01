import { type ProjectResourceMutationResult, Refactor } from "@gmloop/refactor";
import { Semantic } from "@gmloop/semantic";
import { Argument, Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { createPathOption, createVerboseOption, createWriteOption } from "../cli-core/shared-command-options.js";
import { ensureProjectGraphIndex, printProjectPayload } from "../workflow/project-context.js";
import { discoverProjectRoot } from "../workflow/project-root.js";

type ResourceCommandSharedOptions = Readonly<{
    config?: string;
    databasePath?: string;
    json?: boolean;
    path?: string;
    toolsetRoot?: string;
    verbose?: boolean;
    write?: boolean;
}>;

const RESOURCE_COMMAND_FAILURE_PREFIX = "Resource command failed.";
const RESOURCE_KIND_ARGUMENT_DESCRIPTION = "Resource kind";


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

function resolveResourceProjectRoot(options: ResourceCommandSharedOptions): Promise<string> {
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
            prefix: RESOURCE_COMMAND_FAILURE_PREFIX
        });
    }
}

function addSharedOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .addOption(createWriteOption())
        .addOption(createVerboseOption())
        .option("--config <path>", "Path to gmloop config file.")
        .option("--database-path <path>", "Graph index database path override.")
        .option("--toolset-root <path>", "Toolset project root path override.")
        .option("--json", "Emit JSON output.");
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

async function runRenameResourceAction(
    resourceKind: string,
    resourceName: string,
    newResourceName: string,
    options: ResourceCommandSharedOptions
) {
    const projectRoot = await resolveResourceProjectRoot(options);
    const normalizedResourceKind = Refactor.requireProjectResourceKind(resourceKind, resourceKind);
    const result = await Refactor.renameProjectResource({
        dryRun: !options.write,
        newResourceName,
        projectRoot,
        resourceKind: normalizedResourceKind,
        resourceName
    });

    if (options.verbose) {
        console.log(`Project root: ${projectRoot}`);
    }

    printMutationResult(result);
}

async function runDuplicateResourceAction(
    resourceKind: string,
    resourceName: string,
    newResourceName: string,
    options: ResourceCommandSharedOptions
) {
    const projectRoot = await resolveResourceProjectRoot(options);
    const normalizedResourceKind = Refactor.requireProjectResourceKind(resourceKind, resourceKind);
    const result = await Refactor.duplicateProjectResource({
        dryRun: !options.write,
        newResourceName,
        projectRoot,
        resourceKind: normalizedResourceKind,
        resourceName
    });

    if (options.verbose) {
        console.log(`Project root: ${projectRoot}`);
    }

    printMutationResult(result);
}

async function runMoveResourceAction(
    resourceKind: string,
    resourceName: string,
    destinationFolder: string,
    options: ResourceCommandSharedOptions
) {
    const projectRoot = await resolveResourceProjectRoot(options);
    const normalizedResourceKind = Refactor.requireProjectResourceKind(resourceKind, resourceKind);
    const result = await Refactor.moveProjectResource({
        destinationFolder,
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
            .addArgument(new Argument("<kind>", RESOURCE_KIND_ARGUMENT_DESCRIPTION).choices(kinds))
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
            .addArgument(new Argument("<kind>", RESOURCE_KIND_ARGUMENT_DESCRIPTION).choices(kinds))
            .argument("<name>", "Resource name")
    );
    removeCommand.action(async function resourceRemoveCommandAction(resourceKind: string, resourceName: string) {
        await runResourceCommandAction(async () => {
            await runRemoveResourceAction(resourceKind, resourceName, this.opts<ResourceCommandSharedOptions>());
        });
    });

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

    const inspectCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Inspect one resource by id or query.")
            .argument("<nameOrId>", "Resource name or graph node id.")
    );
    inspectCommand.action(async function resourceInspectCommandAction(nameOrId: string) {
        await runResourceCommandAction(async () => {
            const options = this.opts<ResourceCommandSharedOptions>();
            const context = await ensureProjectGraphIndex(options);
            const resolvedId = nameOrId.includes("::")
                ? nameOrId
                : (Semantic.searchGraphIndex({
                      databasePath: options.databasePath,
                      limit: 1,
                      projectConfig: context.projectConfig,
                      projectRoot: context.projectRoot,
                      query: nameOrId,
                      toolsetRoot: options.toolsetRoot
                  }).results[0]?.id ?? null);
            if (!resolvedId) {
                throw new Error(`Could not resolve resource '${nameOrId}'.`);
            }
            const payload = Semantic.getGraphNode({
                databasePath: options.databasePath,
                nodeId: resolvedId,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                toolsetRoot: options.toolsetRoot
            });
            printProjectPayload({ ok: payload !== null, payload });
        });
    });

    const depsCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("deps"))
            .description("List outgoing dependencies for a resource.")
            .argument("<nameOrId>", "Resource name or graph node id.")
    );
    depsCommand.action(async function resourceDepsCommandAction(nameOrId: string) {
        await runResourceCommandAction(async () => {
            const options = this.opts<ResourceCommandSharedOptions>();
            const context = await ensureProjectGraphIndex(options);
            const search = Semantic.searchGraphIndex({
                databasePath: options.databasePath,
                limit: 1,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                query: nameOrId,
                toolsetRoot: options.toolsetRoot
            });
            const nodeId = search.results[0]?.id;
            if (!nodeId) {
                throw new Error(`Could not resolve resource '${nameOrId}'.`);
            }
            const neighbors = Semantic.getGraphNeighbors({
                databasePath: options.databasePath,
                nodeId,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                toolsetRoot: options.toolsetRoot
            });
            printProjectPayload({ ok: true, payload: neighbors.filter((entry) => entry.direction === "outgoing") });
        });
    });

    const dependentsCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("dependents"))
            .description("List incoming usages for a resource.")
            .argument("<nameOrId>", "Resource name or graph node id.")
    );
    dependentsCommand.action(async function resourceDependentsCommandAction(nameOrId: string) {
        await runResourceCommandAction(async () => {
            const options = this.opts<ResourceCommandSharedOptions>();
            const context = await ensureProjectGraphIndex(options);
            const search = Semantic.searchGraphIndex({
                databasePath: options.databasePath,
                limit: 1,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                query: nameOrId,
                toolsetRoot: options.toolsetRoot
            });
            const nodeId = search.results[0]?.id;
            if (!nodeId) {
                throw new Error(`Could not resolve resource '${nameOrId}'.`);
            }
            const usages = Semantic.getGraphUsages({
                databasePath: options.databasePath,
                nodeId,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                toolsetRoot: options.toolsetRoot
            });
            printProjectPayload({ ok: true, payload: usages });
        });
    });

    const auditCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("audit")).description("Run graph-backed resource audit summary.")
    );
    auditCommand.action(async function resourceAuditCommandAction() {
        await runResourceCommandAction(async () => {
            const options = this.opts<ResourceCommandSharedOptions>();
            const context = await ensureProjectGraphIndex(options);
            const everything = Semantic.searchGraphIndex({
                databasePath: options.databasePath,
                limit: 2000,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                query: "",
                toolsetRoot: options.toolsetRoot
            });
            const kindCounts = everything.results.reduce<Record<string, number>>((acc, entry) => {
                acc[entry.kind] = (acc[entry.kind] ?? 0) + 1;
                return acc;
            }, {});
            printProjectPayload({ ok: true, payload: { kindCounts, total: everything.results.length } });
        });
    });

    const renameCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("rename"))
            .description("Rename an existing resource.")
            .addArgument(new Argument("<kind>", RESOURCE_KIND_ARGUMENT_DESCRIPTION).choices(kinds))
            .argument("<name>", "Current resource name")
            .requiredOption("--new-name <name>", "New resource name")
    );
    renameCommand.action(async function resourceRenameCommandAction(resourceKind: string, resourceName: string) {
        await runResourceCommandAction(async () => {
            const options = this.opts<ResourceCommandSharedOptions & { newName: string }>();
            await runRenameResourceAction(resourceKind, resourceName, options.newName, options);
        });
    });

    const duplicateCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("duplicate"))
            .description("Duplicate an existing resource.")
            .addArgument(new Argument("<kind>", RESOURCE_KIND_ARGUMENT_DESCRIPTION).choices(kinds))
            .argument("<name>", "Source resource name")
            .requiredOption("--new-name <name>", "New duplicated resource name")
    );
    duplicateCommand.action(async function resourceDuplicateCommandAction(resourceKind: string, resourceName: string) {
        await runResourceCommandAction(async () => {
            const options = this.opts<ResourceCommandSharedOptions & { newName: string }>();
            await runDuplicateResourceAction(resourceKind, resourceName, options.newName, options);
        });
    });

    const moveCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("move"))
            .description("Move a resource to a new destination folder.")
            .addArgument(new Argument("<kind>", RESOURCE_KIND_ARGUMENT_DESCRIPTION).choices(kinds))
            .argument("<name>", "Resource name")
            .requiredOption("--destination-folder <path>", "Destination folder path")
    );
    moveCommand.action(async function resourceMoveCommandAction(resourceKind: string, resourceName: string) {
        await runResourceCommandAction(async () => {
            const options = this.opts<ResourceCommandSharedOptions & { destinationFolder: string }>();
            await runMoveResourceAction(resourceKind, resourceName, options.destinationFolder, options);
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
    command.addCommand(listCommand);
    command.addCommand(findCommand);
    command.addCommand(inspectCommand);
    command.addCommand(depsCommand);
    command.addCommand(dependentsCommand);
    command.addCommand(auditCommand);
    command.addCommand(renameCommand);
    command.addCommand(duplicateCommand);
    command.addCommand(moveCommand);

    return command;
}
