import { Core } from "@gmloop/core";
import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
import { discoverProjectRoot } from "../workflow/project-root.js";
import { runLookupGmlIdentifierCommand } from "./lookup-gml-identifier.js";

type SymbolCommandSharedOptions = Readonly<{
    config?: string;
    databasePath?: string;
    depth?: number;
    force?: boolean;
    identifiersPath?: string;
    json?: boolean;
    path?: string;
    source?: "auto" | "builtin" | "project";
    toolsetRoot?: string;
}>;

async function resolveProjectContext(options: SymbolCommandSharedOptions): Promise<{
    projectConfig: Record<string, unknown>;
    projectRoot: string;
}> {
    const projectRoot = await discoverProjectRoot({
        configPath: options.config,
        explicitProjectPath: options.path
    });
    const candidateConfigPath = options.config ?? `${projectRoot}/gmloop.json`;
    const loadedConfig = await Core.loadGmloopProjectConfig(candidateConfigPath).catch(() => ({}));
    const projectConfig = Core.isObjectLike(loadedConfig) ? (loadedConfig as Record<string, unknown>) : {};
    return { projectConfig, projectRoot };
}

async function ensureGraphIndex(options: SymbolCommandSharedOptions): Promise<{
    projectConfig: Record<string, unknown>;
    projectRoot: string;
}> {
    const context = await resolveProjectContext(options);
    await Semantic.buildGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        rebuild: options.force === true,
        toolsetRoot: options.toolsetRoot
    });
    return context;
}

function printSymbolResult(result: unknown, asJson: boolean): void {
    if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
}

async function runSymbolInspectAction(identifierOrNodeId: string, options: SymbolCommandSharedOptions): Promise<void> {
    const source = options.source ?? "auto";
    if (source !== "project") {
        const command = {
            args: [identifierOrNodeId],
            opts: () => ({ identifiersPath: options.identifiersPath, json: true })
        };
        const exitCode = await runLookupGmlIdentifierCommand(command);
        if (exitCode === 0 || source === "builtin") {
            return;
        }
    }

    const context = await ensureGraphIndex(options);
    const query = identifierOrNodeId;
    const nodeId = query.includes("::")
        ? query
        : (Semantic.searchGraphIndex({
              databasePath: options.databasePath,
              limit: 1,
              projectConfig: context.projectConfig,
              projectRoot: context.projectRoot,
              query,
              toolsetRoot: options.toolsetRoot
          }).results[0]?.id ?? null);
    if (!nodeId) {
        throw new Error(`Could not resolve symbol '${identifierOrNodeId}'.`);
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
    printSymbolResult(node, options.json === true);
}

export function createSymbolCommand(): Command {
    const command = applyStandardCommandOptions(new Command("symbol")).description(
        "Inspect symbols and relationships from built-in metadata and/or project graph index."
    );
    const addShared = (nested: Command): Command =>
        nested
            .addOption(createPathOption())
            .addOption(createConfigOption())
            .option("--database-path <path>", "Graph index database path override.")
            .option("--toolset-root <path>", "Toolset project root path override.")
            .option("--force", "Rebuild graph index before query.")
            .option("--json", "Emit JSON output.")
            .option("--depth <n>", "Traversal depth.", Number.parseInt)
            .option("--source <source>", "Lookup source: auto, builtin, or project.", "auto")
            .option("--identifiers-path <path>", "Path to gml-identifiers JSON payload.");

    const inspect = addShared(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Inspect one symbol by identifier or graph node id.")
            .argument("<identifierOrId>", "Identifier name or graph node id.")
    );
    inspect.action(async function symbolInspectAction(identifierOrNodeId: string) {
        await runSymbolInspectAction(identifierOrNodeId, this.opts<SymbolCommandSharedOptions>());
    });

    const context = addShared(
        applyStandardCommandOptions(new Command("context"))
            .description("Show symbol context bundle.")
            .argument("<nodeId>", "Graph node id.")
    );
    context.action(async function symbolContextAction(nodeId: string) {
        const options = this.opts<SymbolCommandSharedOptions>();
        const resolved = await ensureGraphIndex(options);
        const payload = Semantic.getGraphContext({
            databasePath: options.databasePath,
            depth: options.depth,
            nodeId,
            projectConfig: resolved.projectConfig,
            projectRoot: resolved.projectRoot,
            toolsetRoot: options.toolsetRoot
        });
        printSymbolResult(payload, options.json === true);
    });

    const neighbors = addShared(
        applyStandardCommandOptions(new Command("neighbors"))
            .description("Show symbol neighbors.")
            .argument("<nodeId>", "Graph node id.")
    );
    neighbors.action(async function symbolNeighborsAction(nodeId: string) {
        const options = this.opts<SymbolCommandSharedOptions>();
        const resolved = await ensureGraphIndex(options);
        const payload = Semantic.getGraphNeighbors({
            databasePath: options.databasePath,
            depth: options.depth,
            nodeId,
            projectConfig: resolved.projectConfig,
            projectRoot: resolved.projectRoot,
            toolsetRoot: options.toolsetRoot
        });
        printSymbolResult(payload, options.json === true);
    });

    const usages = addShared(
        applyStandardCommandOptions(new Command("usages"))
            .description("Show symbol usages.")
            .argument("<nodeId>", "Graph node id.")
    );
    usages.action(async function symbolUsagesAction(nodeId: string) {
        const options = this.opts<SymbolCommandSharedOptions>();
        const resolved = await ensureGraphIndex(options);
        const payload = Semantic.getGraphUsages({
            databasePath: options.databasePath,
            nodeId,
            projectConfig: resolved.projectConfig,
            projectRoot: resolved.projectRoot,
            toolsetRoot: options.toolsetRoot
        });
        printSymbolResult(payload, options.json === true);
    });

    command.addCommand(inspect);
    command.addCommand(context);
    command.addCommand(neighbors);
    command.addCommand(usages);
    return command;
}
