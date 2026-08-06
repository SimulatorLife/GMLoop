import { access, constants } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Semantic } from "@gmloop/semantic";
import { type Command, Option } from "commander";

import { createMinimumValueValidator } from "../../cli-core/command-parsing.js";
import { createConfigOption, createPathOption, createVerboseOption } from "../../cli-core/shared-command-options.js";
import { runSemanticIndexOperation } from "../../modules/runtime/semantic-index-operation.js";
import { discoverProjectRoot } from "../../workflow/project-root.js";

type GraphCommandSharedOptions = {
    config?: string;
    databasePath?: string;
    depth?: number;
    force?: boolean;
    json?: boolean;
    limit?: number;
    path?: string;
    toolsetRoot?: string;
    verbose?: boolean;
    open?: boolean;
    output?: string;
    serve?: boolean;
    liveReload?: boolean;
    projectState?: string;
    vacuum?: boolean;
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

export type { GraphCommandSharedOptions, GraphJsonEnvelope, GraphResolutionContext };

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
    return Core.isObjectLike(loadedConfig) ? loadedConfig : {};
}

async function resolveGraphContext(options: GraphCommandSharedOptions): Promise<GraphResolutionContext> {
    const projectRoot = await discoverProjectRoot({
        configPath: options.config,
        explicitProjectPath: options.path,
        statePathOption: options.projectState
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

function ensureGraphIndex(
    options: GraphCommandSharedOptions,
    context: GraphResolutionContext
): Promise<Awaited<ReturnType<typeof Semantic.buildGraphIndex>>> {
    return runSemanticIndexOperation(context.projectRoot, (onProgress) =>
        Semantic.buildGraphIndex({
            databasePath: options.databasePath,
            onProgress,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            rebuild: options.force === true,
            toolsetRoot: options.toolsetRoot
        })
    );
}

/**
 * Ensure the graph tables are up-to-date before answering a query.
 *
 * Graph tables are a projection of the canonical semantic store. Reconcile the
 * projection on every query so visualization, search, and LSP facts always
 * share the same persisted project snapshot. The semantic builder restores
 * from SQLite and only parses sources when that snapshot is absent or stale,
 * so this does not reintroduce a second source-of-truth scan.
 */
async function ensureGraphIndexForQuery(
    options: GraphCommandSharedOptions,
    context: GraphResolutionContext
): Promise<void> {
    await ensureGraphIndex(options, context);
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

function addGraphSharedOptions(
    command: Command,
    { includeDepth = false, includeLimit = false, includeForce = false } = {}
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

    if (includeForce) {
        command.addOption(new Option("--force", "Force graph-index regeneration before continuing.").default(false));
    }

    return command;
}

export {
    addGraphSharedOptions,
    createGraphEnvelope,
    ensureGraphIndex,
    ensureGraphIndexForQuery,
    loadOptionalProjectConfig,
    printGraphOutput,
    resolveGraphContext
};
