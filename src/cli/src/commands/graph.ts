import { access, constants } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Semantic } from "@gmloop/semantic";
import { Command, Option } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption, createVerboseOption } from "../cli-core/shared-command-options.js";
import { discoverProjectRoot } from "../workflow/project-root.js";

type GraphCommandSharedOptions = {
    config?: string;
    depth?: number;
    json?: boolean;
    limit?: number;
    path?: string;
    rebuild?: boolean;
    toolsetRoot?: string;
    verbose?: boolean;
};

type GraphResolutionContext = Readonly<{
    projectConfig: Record<string, unknown>;
    projectRoot: string;
}>;

async function loadOptionalProjectConfig(
    projectRoot: string,
    configPathOption: string | undefined
): Promise<Record<string, unknown>> {
    const candidatePath = configPathOption ? path.resolve(configPathOption) : path.join(projectRoot, "gmloop.json");

    try {
        await access(candidatePath, constants.R_OK);
    } catch {
        return {};
    }

    const loadedConfig = await Core.loadGmloopProjectConfig(candidatePath);
    return Core.isObjectLike(loadedConfig) ? (loadedConfig as Record<string, unknown>) : {};
}

async function resolveGraphContext(options: GraphCommandSharedOptions): Promise<GraphResolutionContext> {
    const projectRoot = await discoverProjectRoot({
        configPath: options.config,
        explicitProjectPath: options.path
    });

    return Object.freeze({
        projectConfig: await loadOptionalProjectConfig(projectRoot, options.config),
        projectRoot
    });
}

function printGraphOutput(payload: unknown, asJson: boolean): void {
    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    if (typeof payload === "string") {
        console.log(payload);
        return;
    }

    console.log(JSON.stringify(payload, null, 2));
}

async function ensureGraphIndex(
    options: GraphCommandSharedOptions,
    context: GraphResolutionContext
): Promise<Awaited<ReturnType<typeof Semantic.buildGraphIndex>>> {
    return await Semantic.buildGraphIndex({
        databasePath: undefined,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        rebuild: options.rebuild === true,
        toolsetRoot: options.toolsetRoot
    });
}

async function runGraphIndexAction(options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    const result = await ensureGraphIndex(options, context);
    printGraphOutput(
        {
            command: "graph index",
            databasePath: result.databasePath,
            graphIds: result.graphIds,
            projectRoot: result.config.projectRoot,
            toolsetRoot: result.config.toolsetRoot
        },
        options.json === true
    );
}

async function runGraphSearchAction(queryText: string, options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    await ensureGraphIndex(options, context);
    const result = Semantic.searchGraphIndex({
        limit: options.limit,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        query: queryText,
        toolsetRoot: options.toolsetRoot
    });
    printGraphOutput(result, options.json === true);
}

function resolveGraphNodeId(
    queryOrNodeId: string,
    options: GraphCommandSharedOptions,
    context: GraphResolutionContext
): string | null {
    if (queryOrNodeId.includes("::")) {
        return queryOrNodeId;
    }

    const result = Semantic.searchGraphIndex({
        limit: 1,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        query: queryOrNodeId,
        toolsetRoot: options.toolsetRoot
    });

    return result.results[0]?.id ?? null;
}

async function runGraphSymbolAction(queryOrNodeId: string, options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    await ensureGraphIndex(options, context);
    const nodeId = resolveGraphNodeId(queryOrNodeId, options, context);

    if (!nodeId) {
        throw new Error(`Could not resolve symbol '${queryOrNodeId}'.`);
    }

    const node = Semantic.getGraphNode({
        nodeId,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });

    if (!node) {
        throw new Error(`Graph node '${nodeId}' was not found.`);
    }

    printGraphOutput(node, options.json === true);
}

async function runGraphContextAction(nodeId: string, options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    await ensureGraphIndex(options, context);
    const bundle = Semantic.getGraphContext({
        depth: options.depth,
        nodeId,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });

    if (!bundle) {
        throw new Error(`Graph node '${nodeId}' was not found.`);
    }

    printGraphOutput(bundle, options.json === true);
}

async function runGraphNeighborsAction(nodeId: string, options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    await ensureGraphIndex(options, context);
    const neighbors = Semantic.getGraphNeighbors({
        depth: options.depth,
        nodeId,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printGraphOutput(neighbors, options.json === true);
}

async function runGraphUsagesAction(nodeId: string, options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    await ensureGraphIndex(options, context);
    const usages = Semantic.getGraphUsages({
        depth: options.depth,
        nodeId,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printGraphOutput(usages, options.json === true);
}

async function runGraphDoctorAction(options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    const report = Semantic.doctorGraphIndex({
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printGraphOutput(report, options.json === true);
}

function addGraphSharedOptions(
    command: Command,
    { includeDepth = false, includeLimit = false, includeRebuild = false } = {}
): Command {
    command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .addOption(createVerboseOption())
        .addOption(new Option("--toolset-root <path>", "Optional second GameMaker/toolset root to index").default(""))
        .addOption(new Option("--json", "Print machine-readable JSON output").default(false));

    if (includeDepth) {
        command.addOption(
            new Option("--depth <n>", "Neighbor traversal depth")
                .argParser((value) => Number.parseInt(value, 10))
                .default(1)
        );
    }

    if (includeLimit) {
        command.addOption(
            new Option("--limit <n>", "Maximum number of search results")
                .argParser((value) => Number.parseInt(value, 10))
                .default(10)
        );
    }

    if (includeRebuild) {
        command.addOption(new Option("--rebuild", "Force a full graph-index rebuild before querying").default(false));
    }

    return command;
}

/**
 * Create the `graph` command suite.
 */
export function createGraphCommand(): Command {
    const graphCommand = applyStandardCommandOptions(new Command("graph")).description(
        "Build and query the dual-root semantic graph index."
    );

    const indexCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("index")).description("Build or rebuild the graph index."),
        { includeRebuild: true }
    );
    indexCommand.action(async function graphIndexCommandAction() {
        await runGraphIndexAction(this.opts<GraphCommandSharedOptions>());
    });

    const searchCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("search"))
            .description("Search the graph index.")
            .argument("<query...>", "Search query"),
        { includeLimit: true, includeRebuild: true }
    );
    searchCommand.action(async function graphSearchCommandAction(query: Array<string>) {
        await runGraphSearchAction(query.join(" "), this.opts<GraphCommandSharedOptions>());
    });

    const symbolCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("symbol"))
            .description("Resolve and print a single symbol from a name, SCIP id, or graph node id.")
            .argument("<nameOrId>", "Name, SCIP symbol, or graph-qualified node id"),
        { includeRebuild: true }
    );
    symbolCommand.action(async function graphSymbolCommandAction(nameOrId: string) {
        await runGraphSymbolAction(nameOrId, this.opts<GraphCommandSharedOptions>());
    });

    const contextCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("context"))
            .description("Retrieve a structured context bundle for a graph node.")
            .argument("<nodeId>", "Graph-qualified node id"),
        { includeDepth: true, includeRebuild: true }
    );
    contextCommand.action(async function graphContextCommandAction(nodeId: string) {
        await runGraphContextAction(nodeId, this.opts<GraphCommandSharedOptions>());
    });

    const neighborsCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("neighbors"))
            .description("List neighboring graph nodes around a target node.")
            .argument("<nodeId>", "Graph-qualified node id"),
        { includeDepth: true, includeRebuild: true }
    );
    neighborsCommand.action(async function graphNeighborsCommandAction(nodeId: string) {
        await runGraphNeighborsAction(nodeId, this.opts<GraphCommandSharedOptions>());
    });

    const usagesCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("usages"))
            .description("List incoming usage relationships for a target graph node.")
            .argument("<nodeId>", "Graph-qualified node id"),
        { includeDepth: true, includeRebuild: true }
    );
    usagesCommand.action(async function graphUsagesCommandAction(nodeId: string) {
        await runGraphUsagesAction(nodeId, this.opts<GraphCommandSharedOptions>());
    });

    const doctorCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("doctor")).description("Inspect graph-index health and configuration."),
        {}
    );
    doctorCommand.action(async function graphDoctorCommandAction() {
        await runGraphDoctorAction(this.opts<GraphCommandSharedOptions>());
    });

    graphCommand.addCommand(indexCommand);
    graphCommand.addCommand(searchCommand);
    graphCommand.addCommand(symbolCommand);
    graphCommand.addCommand(contextCommand);
    graphCommand.addCommand(neighborsCommand);
    graphCommand.addCommand(usagesCommand);
    graphCommand.addCommand(doctorCommand);

    return graphCommand;
}
