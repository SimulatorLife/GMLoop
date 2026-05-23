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

function resolveNodeIdFromQuery(
    nameOrId: string,
    options: ResourceCommandSharedOptions,
    context: Awaited<ReturnType<typeof ensureProjectGraphIndex>>
): string {
    if (nameOrId.includes("::")) {
        return nameOrId;
    }
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
    return nodeId;
}

async function runInspectResourceAction(nameOrId: string, options: ResourceCommandSharedOptions): Promise<void> {
    const context = await ensureProjectGraphIndex(options);
    const resolvedId = resolveNodeIdFromQuery(nameOrId, options, context);
    const payload = Semantic.getGraphNode({
        databasePath: options.databasePath,
        nodeId: resolvedId,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printProjectPayload({ ok: payload !== null, payload });
}

async function runDepsResourceAction(nameOrId: string, options: ResourceCommandSharedOptions): Promise<void> {
    const context = await ensureProjectGraphIndex(options);
    const nodeId = resolveNodeIdFromQuery(nameOrId, options, context);
    const neighbors = Semantic.getGraphNeighbors({
        databasePath: options.databasePath,
        nodeId,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printProjectPayload({ ok: true, payload: neighbors.filter((entry) => entry.direction === "outgoing") });
}

async function runDependentsResourceAction(nameOrId: string, options: ResourceCommandSharedOptions): Promise<void> {
    const context = await ensureProjectGraphIndex(options);
    const nodeId = resolveNodeIdFromQuery(nameOrId, options, context);
    const usages = Semantic.getGraphUsages({
        databasePath: options.databasePath,
        nodeId,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printProjectPayload({ ok: true, payload: usages });
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

    const inspectCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Inspect one resource by id or query.")
            .argument("<nameOrId>", "Resource name or graph node id.")
    );
    inspectCommand.action(async function resourceInspectCommandAction(nameOrId: string) {
        await runResourceCommandAction(async () => {
            await runInspectResourceAction(nameOrId, this.opts<ResourceCommandSharedOptions>());
        });
    });

    const depsCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("deps"))
            .description("List outgoing dependencies for a resource.")
            .argument("<nameOrId>", "Resource name or graph node id.")
    );
    depsCommand.action(async function resourceDepsCommandAction(nameOrId: string) {
        await runResourceCommandAction(async () => {
            await runDepsResourceAction(nameOrId, this.opts<ResourceCommandSharedOptions>());
        });
    });

    const dependentsCommand = addSharedOptions(
        applyStandardCommandOptions(new Command("dependents"))
            .description("List incoming usages for a resource.")
            .argument("<nameOrId>", "Resource name or graph node id.")
    );
    dependentsCommand.action(async function resourceDependentsCommandAction(nameOrId: string) {
        await runResourceCommandAction(async () => {
            await runDependentsResourceAction(nameOrId, this.opts<ResourceCommandSharedOptions>());
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

    command.addHelpText(
        "after",
        [
            "",
            "Examples:",
            "  pnpm dlx gmloop resource list --path path/to/project",
            "  pnpm dlx gmloop resource inspect scr_player --path path/to/project",
            '  pnpm dlx @gamemaker/gm-cli@latest resourcetool eval "resource list"'
        ].join("\n")
    );

    command.addCommand(listCommand);
    command.addCommand(findCommand);
    command.addCommand(inspectCommand);
    command.addCommand(depsCommand);
    command.addCommand(dependentsCommand);
    command.addCommand(auditCommand);

    return command;
}
