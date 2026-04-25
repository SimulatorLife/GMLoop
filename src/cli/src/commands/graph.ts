import child_process from "node:child_process";
import { access, constants, writeFile } from "node:fs/promises";
import * as http from "node:http";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Semantic } from "@gmloop/semantic";
import { Command, Option } from "commander";

import { createMinimumValueValidator } from "../cli-core/command-parsing.js";
import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { createConfigOption, createPathOption, createVerboseOption } from "../cli-core/shared-command-options.js";
import { discoverProjectRoot } from "../workflow/project-root.js";
import { renderGraphVisualizationHtml } from "./graph-visualize-template.js";

type GraphCommandSharedOptions = {
    config?: string;
    databasePath?: string;
    depth?: number;
    json?: boolean;
    limit?: number;
    path?: string;
    rebuild?: boolean;
    toolsetRoot?: string;
    verbose?: boolean;
    open?: boolean;
    output?: string;
    serve?: boolean;
};

type GraphResolutionContext = Readonly<{
    projectConfig: Record<string, unknown>;
    projectRoot: string;
}>;

type GraphJsonEnvelope<TPayload> = Readonly<{
    command: string;
    databasePath: string;
    ok: true;
    payload: TPayload;
    projectRoot: string;
    toolsetRoot: string | null;
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

function printGraphOutput(payload: unknown, asJson: boolean, humanText: string): void {
    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    console.log(humanText);
}

async function ensureGraphIndex(
    options: GraphCommandSharedOptions,
    context: GraphResolutionContext
): Promise<Awaited<ReturnType<typeof Semantic.buildGraphIndex>>> {
    return await Semantic.buildGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        rebuild: options.rebuild === true,
        toolsetRoot: options.toolsetRoot
    });
}

async function ensureGraphIndexForQuery(
    options: GraphCommandSharedOptions,
    context: GraphResolutionContext
): Promise<void> {
    if (options.rebuild === true) {
        await ensureGraphIndex(options, context);
        return;
    }

    const config = Semantic.resolveGraphIndexConfig({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });

    try {
        await access(config.databasePath, constants.R_OK);
    } catch {
        await ensureGraphIndex(options, context);
    }
}

function openHtmlInDefaultBrowser(filePath: string): void {
    const platform = process.platform;
    let cmd: string;
    if (platform === "darwin") {
        cmd = "open";
    } else if (platform === "win32") {
        cmd = "start";
    } else {
        cmd = "xdg-open";
    }
    // Expected behavior: we want to open a dynamic path provided by user args
    // eslint-disable-next-line security/detect-child-process -- Intentionally opening default browser
    child_process.exec(`${cmd} "${filePath}"`);
}

function createGraphEnvelope<TPayload>(
    command: string,
    context: GraphResolutionContext,
    options: GraphCommandSharedOptions,
    payload: TPayload
): GraphJsonEnvelope<TPayload> {
    const config = Semantic.resolveGraphIndexConfig({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });

    return Object.freeze({
        command,
        databasePath: config.databasePath,
        ok: true,
        payload,
        projectRoot: config.projectRoot,
        toolsetRoot: config.toolsetRoot
    });
}

async function runGraphIndexAction(options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    const result = await ensureGraphIndex(options, context);
    const payload = {
        databasePath: result.databasePath,
        graphIds: result.graphIds
    };
    printGraphOutput(
        createGraphEnvelope("graph index", context, options, payload),
        options.json === true,
        `Indexed ${result.graphIds.join(", ")} graph(s) at ${result.databasePath}.`
    );
}

async function runGraphSearchAction(queryText: string, options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    await ensureGraphIndexForQuery(options, context);
    const result = Semantic.searchGraphIndex({
        databasePath: options.databasePath,
        limit: options.limit,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        query: queryText,
        toolsetRoot: options.toolsetRoot
    });
    printGraphOutput(
        createGraphEnvelope("graph search", context, options, result),
        options.json === true,
        `Found ${String(result.results.length)} graph result(s) for "${result.query}".`
    );
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
        databasePath: options.databasePath,
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
    await ensureGraphIndexForQuery(options, context);
    const nodeId = resolveGraphNodeId(queryOrNodeId, options, context);

    if (!nodeId) {
        throw new Error(`Could not resolve symbol '${queryOrNodeId}'.`);
    }

    const node = Semantic.getGraphNode({
        databasePath: options.databasePath,
        nodeId,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });

    if (!node) {
        throw new Error(`Graph node '${nodeId}' was not found.`);
    }

    printGraphOutput(
        createGraphEnvelope("graph symbol", context, options, node),
        options.json === true,
        `${node.id} (${node.kind}) ${node.summary}`
    );
}

async function runGraphContextAction(nodeId: string, options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    await ensureGraphIndexForQuery(options, context);
    const bundle = Semantic.getGraphContext({
        databasePath: options.databasePath,
        depth: options.depth,
        nodeId,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });

    if (!bundle) {
        throw new Error(`Graph node '${nodeId}' was not found.`);
    }

    printGraphOutput(
        createGraphEnvelope("graph context", context, options, bundle),
        options.json === true,
        `Context for ${bundle.target.id}: ${bundle.summary}`
    );
}

async function runGraphNeighborsAction(nodeId: string, options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    await ensureGraphIndexForQuery(options, context);
    const neighbors = Semantic.getGraphNeighbors({
        databasePath: options.databasePath,
        depth: options.depth,
        nodeId,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printGraphOutput(
        createGraphEnvelope("graph neighbors", context, options, neighbors),
        options.json === true,
        `Found ${String(neighbors.length)} neighbor(s) for ${nodeId}.`
    );
}

async function runGraphUsagesAction(nodeId: string, options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    await ensureGraphIndexForQuery(options, context);
    const usages = Semantic.getGraphUsages({
        databasePath: options.databasePath,
        depth: options.depth,
        nodeId,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printGraphOutput(
        createGraphEnvelope("graph usages", context, options, usages),
        options.json === true,
        `Found ${String(usages.length)} usage(s) for ${nodeId}.`
    );
}

async function runGraphDoctorAction(options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    const report = Semantic.doctorGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printGraphOutput(
        createGraphEnvelope("graph doctor", context, options, report),
        options.json === true,
        report.issues.length === 0
            ? `Graph index is healthy at ${report.databasePath}.`
            : `Graph doctor reported ${String(report.issues.length)} issue(s).`
    );
}

async function runGraphVisualizeAction(options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    await ensureGraphIndexForQuery(options, context);

    const config = Semantic.resolveGraphIndexConfig({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });

    if (options.serve === true) {
        const server = http.createServer((req, res) => {
            if (req.method === "GET" && (req.url === "/" || req.url === "")) {
                const db = Semantic.openExistingGraphIndexDatabase(config.databasePath);
                let payloadStr: string;
                try {
                    const payload = Semantic.exportGraphVisualizationData(db, config.projectRoot);
                    payloadStr = JSON.stringify(payload);
                } catch (error: unknown) {
                    res.writeHead(500, { "Content-Type": "text/plain" });
                    res.end(`Error exporting data: ${Core.getErrorMessageOrFallback(error)}`);
                    return;
                } finally {
                    db.close();
                }

                const htmlContent = renderGraphVisualizationHtml(payloadStr, config.projectRoot, true);
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(htmlContent);
            } else if (req.method === "POST" && req.url === "/api/reindex") {
                ensureGraphIndex({ ...options, rebuild: true }, context)
                    .then(() => {
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: true }));
                        return null;
                    })
                    .catch((error: unknown) => {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: Core.getErrorMessageOrFallback(error) }));
                    });
            } else {
                res.writeHead(404);
                res.end("Not found");
            }
        });

        await new Promise<void>((resolve, reject) => {
            server.listen(0, "127.0.0.1", () => {
                const address = server.address();
                if (address && typeof address === "object") {
                    const url = `http://127.0.0.1:${String(address.port)}`;
                    printGraphOutput(
                        createGraphEnvelope("graph visualize", context, options, { url }),
                        options.json === true,
                        `Serving graph visualization at ${url}`
                    );
                    if (options.open) {
                        openHtmlInDefaultBrowser(url);
                    }
                }
            });
            server.on("error", reject);
        });

        return;
    }

    const dbPath = config.databasePath;
    const db = Semantic.openExistingGraphIndexDatabase(dbPath);
    let payloadStr: string;
    try {
        const payload = Semantic.exportGraphVisualizationData(db, config.projectRoot);
        payloadStr = JSON.stringify(payload);
    } finally {
        db.close();
    }

    const htmlContent = renderGraphVisualizationHtml(payloadStr, config.projectRoot);
    const outputPath = options.output ?? path.join(path.dirname(dbPath), "graph.html");

    await writeFile(outputPath, htmlContent, "utf8");

    printGraphOutput(
        createGraphEnvelope("graph visualize", context, options, { outputPath }),
        options.json === true,
        `Exported graph visualization to ${outputPath}`
    );

    if (options.open) {
        openHtmlInDefaultBrowser(outputPath);
    }
}

function addGraphSharedOptions(
    command: Command,
    { includeDepth = false, includeLimit = false, includeRebuild = false } = {}
): Command {
    command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .addOption(createVerboseOption())
        .addOption(new Option("--database-path <path>", "SQLite graph-index database path"))
        .addOption(new Option("--toolset-root <path>", "Optional second GameMaker/toolset root to index").default(""))
        .addOption(new Option("--json", "Print machine-readable JSON output").default(false));

    if (includeDepth) {
        command.addOption(
            new Option("--depth <n>", "Neighbor traversal depth")
                .argParser(createMinimumValueValidator(1, "Depth must be at least 1"))
                .default(1)
        );
    }

    if (includeLimit) {
        command.addOption(
            new Option("--limit <n>", "Maximum number of search results")
                .argParser(createMinimumValueValidator(1, "Limit must be at least 1"))
                .default(10)
        );
    }

    if (includeRebuild) {
        command.addOption(new Option("--rebuild", "Force a full graph-index rebuild before querying").default(false));
    }

    return command;
}

async function runGraphCommandAction(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        handleCliError(error, {
            exitCode: 1,
            prefix: "Graph command failed."
        });
    }
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
        await runGraphCommandAction(async () => {
            await runGraphIndexAction(this.opts<GraphCommandSharedOptions>());
        });
    });

    const searchCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("search"))
            .description("Search the graph index.")
            .argument("<query...>", "Search query"),
        { includeLimit: true, includeRebuild: true }
    );
    searchCommand.action(async function graphSearchCommandAction(query: Array<string>) {
        await runGraphCommandAction(async () => {
            await runGraphSearchAction(query.join(" "), this.opts<GraphCommandSharedOptions>());
        });
    });

    const symbolCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("symbol"))
            .description("Resolve and print a single symbol from a name, SCIP id, or graph node id.")
            .argument("<nameOrId>", "Name, SCIP symbol, or graph-qualified node id"),
        { includeRebuild: true }
    );
    symbolCommand.action(async function graphSymbolCommandAction(nameOrId: string) {
        await runGraphCommandAction(async () => {
            await runGraphSymbolAction(nameOrId, this.opts<GraphCommandSharedOptions>());
        });
    });

    const contextCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("context"))
            .description("Retrieve a structured context bundle for a graph node.")
            .argument("<nodeId>", "Graph-qualified node id"),
        { includeDepth: true, includeRebuild: true }
    );
    contextCommand.action(async function graphContextCommandAction(nodeId: string) {
        await runGraphCommandAction(async () => {
            await runGraphContextAction(nodeId, this.opts<GraphCommandSharedOptions>());
        });
    });

    const neighborsCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("neighbors"))
            .description("List neighboring graph nodes around a target node.")
            .argument("<nodeId>", "Graph-qualified node id"),
        { includeDepth: true, includeRebuild: true }
    );
    neighborsCommand.action(async function graphNeighborsCommandAction(nodeId: string) {
        await runGraphCommandAction(async () => {
            await runGraphNeighborsAction(nodeId, this.opts<GraphCommandSharedOptions>());
        });
    });

    const usagesCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("usages"))
            .description("List incoming usage relationships for a target graph node.")
            .argument("<nodeId>", "Graph-qualified node id"),
        { includeDepth: true, includeRebuild: true }
    );
    usagesCommand.action(async function graphUsagesCommandAction(nodeId: string) {
        await runGraphCommandAction(async () => {
            await runGraphUsagesAction(nodeId, this.opts<GraphCommandSharedOptions>());
        });
    });

    const doctorCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("doctor")).description("Inspect graph-index health and configuration."),
        {}
    );
    doctorCommand.action(async function graphDoctorCommandAction() {
        await runGraphCommandAction(async () => {
            await runGraphDoctorAction(this.opts<GraphCommandSharedOptions>());
        });
    });

    const visualizeCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("visualize")).description(
            "Render an interactive graph index visualization HTML file."
        ),
        { includeRebuild: true }
    );
    visualizeCommand
        .addOption(new Option("--output <path>", "Output HTML file path"))
        .addOption(new Option("--open", "Open the generated file in your default browser").default(true))
        .addOption(new Option("--no-open", "Do not open the generated file").default(false))
        .addOption(new Option("--serve", "Serve dynamically rather than writing an output file").default(false))
        .action(async function graphVisualizeCommandAction() {
            await runGraphCommandAction(async () => {
                await runGraphVisualizeAction(this.opts<GraphCommandSharedOptions>());
            });
        });

    graphCommand.addCommand(indexCommand);
    graphCommand.addCommand(searchCommand);
    graphCommand.addCommand(symbolCommand);
    graphCommand.addCommand(contextCommand);
    graphCommand.addCommand(neighborsCommand);
    graphCommand.addCommand(usagesCommand);
    graphCommand.addCommand(doctorCommand);
    graphCommand.addCommand(visualizeCommand);

    return graphCommand;
}
