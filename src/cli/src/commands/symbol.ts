import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
import { emitJsonErrorAndExit } from "../shared/json-error-payload.js";
import { ensureProjectGraphIndex } from "../workflow/project-root.js";

type SymbolCommandSharedOptions = Readonly<{
    config?: string;
    databasePath?: string;
    depth?: number;
    force?: boolean;
    json?: boolean;
    path?: string;
    toolsetRoot?: string;
}>;

type SymbolInspectOptions = SymbolCommandSharedOptions &
    Readonly<{
        kind?: "auto" | "resource" | "script" | "room" | "object" | "symbol";
        include?: string;
    }>;

const RESOURCE_KINDS = new Set([
    "sprite",
    "sound",
    "room",
    "object",
    "script",
    "tileset",
    "font",
    "sequence",
    "anim_curve",
    "timeline",
    "shader",
    "particle_system",
    "extension",
    "data_file",
    "note",
    "path"
]);

function isResourceKind(kind: string): boolean {
    return RESOURCE_KINDS.has(kind);
}

function matchesKind(nodeKind: string, filterKind: string): boolean {
    if (!filterKind || filterKind === "auto") {
        return true;
    }
    if (filterKind === "script") {
        return nodeKind === "script";
    }
    if (filterKind === "room") {
        return nodeKind === "room";
    }
    if (filterKind === "object") {
        return nodeKind === "object";
    }
    if (filterKind === "resource") {
        return isResourceKind(nodeKind);
    }
    if (filterKind === "symbol") {
        return !isResourceKind(nodeKind);
    }
    return false;
}

function printSymbolResult(result: unknown, asJson: boolean): void {
    if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
}

async function runSymbolInspectAction(identifierOrNodeId: string, options: SymbolInspectOptions): Promise<void> {
    const context = await ensureProjectGraphIndex(options);
    const query = identifierOrNodeId;
    const requestedKind = options.kind ?? "auto";

    let resolvedNode = null;

    // 1. Try direct lookup first (if it's a valid ID)
    const directNode = Semantic.getGraphNode({
        databasePath: options.databasePath,
        nodeId: query,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });

    if (directNode && matchesKind(directNode.kind, requestedKind)) {
        resolvedNode = directNode;
    }

    // 2. Fallback to graph search if direct lookup didn't yield a matching node
    if (!resolvedNode) {
        const searchResult = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            limit: 100,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query,
            toolsetRoot: options.toolsetRoot
        });

        let candidates = searchResult.results.filter((entry) => matchesKind(entry.kind, requestedKind));

        if (candidates.length > 0) {
            // Narrow by exact case-sensitive name match
            const exactMatches = candidates.filter((c) => c.name === query);
            if (exactMatches.length > 0) {
                candidates = exactMatches;
            } else {
                // Narrow by exact case-insensitive name match
                const caseInsensitiveMatches = candidates.filter((c) => c.name.toLowerCase() === query.toLowerCase());
                if (caseInsensitiveMatches.length > 0) {
                    candidates = caseInsensitiveMatches;
                }
            }

            if (candidates.length === 1) {
                const candidateId = candidates[0].id;
                resolvedNode = Semantic.getGraphNode({
                    databasePath: options.databasePath,
                    nodeId: candidateId,
                    projectConfig: context.projectConfig,
                    projectRoot: context.projectRoot,
                    toolsetRoot: options.toolsetRoot
                });
            } else if (candidates.length > 1) {
                emitJsonErrorAndExit({
                    command: "symbol inspect",
                    code: "ambiguous",
                    error: `Ambiguous symbol '${query}'. Multiple candidates found.`,
                    extras: {
                        candidates: candidates.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))
                    }
                });
            }
        }
    }

    if (!resolvedNode) {
        emitJsonErrorAndExit({
            command: "symbol inspect",
            code: "unresolved",
            error: `Symbol '${query}' not found.`
        });
    }

    const includeOption = options.include ?? "node";
    const includes = new Set(includeOption.split(",").map((s) => s.trim().toLowerCase()));

    const payload: Record<string, unknown> = {
        resolvedId: resolvedNode.id,
        resolvedKind: resolvedNode.kind
    };

    if (includes.has("node")) {
        payload.node = resolvedNode;
    }
    if (includes.has("context")) {
        payload.context = Semantic.getGraphContext({
            databasePath: options.databasePath,
            depth: options.depth,
            nodeId: resolvedNode.id,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            toolsetRoot: options.toolsetRoot
        });
    }
    if (includes.has("neighbors")) {
        payload.neighbors = Semantic.getGraphNeighbors({
            databasePath: options.databasePath,
            depth: options.depth,
            nodeId: resolvedNode.id,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            toolsetRoot: options.toolsetRoot
        });
    }
    if (includes.has("usages") || includes.has("dependents")) {
        const usages = Semantic.getGraphUsages({
            databasePath: options.databasePath,
            depth: options.depth,
            nodeId: resolvedNode.id,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            toolsetRoot: options.toolsetRoot
        });
        if (includes.has("usages")) {
            payload.usages = usages;
        }
        if (includes.has("dependents")) {
            payload.dependents = usages;
        }
    }

    printSymbolResult({ command: "symbol inspect", ok: true, payload }, true);
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
            .option("--depth <n>", "Traversal depth.", Number.parseInt);

    const inspect = addShared(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Inspect one symbol by identifier or graph node id.")
            .argument("<identifierOrId>", "Identifier name or graph node id.")
            .option("--kind <kind>", "Filter by kind: auto, resource, script, room, object, symbol.", "auto")
            .option(
                "--include <items>",
                "Comma-separated items to include: node, context, neighbors, usages, dependents.",
                "node"
            )
    );
    inspect.action(async function symbolInspectAction(identifierOrNodeId: string) {
        await runSymbolInspectAction(identifierOrNodeId, this.opts<SymbolInspectOptions>());
    });

    command.addCommand(inspect);
    return command;
}
