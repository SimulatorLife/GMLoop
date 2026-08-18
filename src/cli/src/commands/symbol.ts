import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
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

/**
 * Parse the comma-separated `--include` value into a normalised `Set` of
 * include tokens.
 *
 * Each entry is trimmed and lower-cased before insertion, so consumers can
 * do case-insensitive membership checks (`includes.has("node")`) without
 * having to repeat the normalization inline. Empty tokens produced by
 * trailing commas or stray whitespace are dropped so a value like
 * `" node , context ,"` still resolves to `{ node, context }`.
 *
 * The helper intentionally returns a `ReadonlySet` so callers cannot mutate
 * the parsed value; downstream gating logic should treat it as read-only.
 *
 * @param rawValue Raw `--include` value, exactly as supplied by the CLI.
 * @returns A read-only set of normalized include tokens.
 */
export function parseSymbolIncludeOption(rawValue: string | undefined): ReadonlySet<string> {
    if (typeof rawValue !== "string" || rawValue.length === 0) {
        return new Set<string>();
    }
    const normalizedTokens = rawValue
        .split(",")
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length > 0);
    return new Set(normalizedTokens);
}

/**
 * Narrow a list of graph-search candidates to those that match the query
 * by name.
 *
 * The narrow runs in two passes:
 *
 * 1. Exact case-sensitive match — preferred because it preserves the
 *    user's casing as authored.
 * 2. Exact case-insensitive match — falls back when no case-sensitive
 *    match exists, so `demo` still resolves `Demo_script` when the case
 *    does not align.
 *
 * If neither pass yields any candidates, the original list is returned
 * unchanged. Centralizing the two-pass logic keeps the orchestrator from
 * inlining the filter chain and prevents the two passes from drifting
 * apart over time.
 *
 * @param candidates Search-result entries to narrow in place of the
 *                  orchestrator's manual narrowing block.
 * @param query     Raw identifier supplied on the CLI.
 * @returns The narrowed candidates, or the original list when no pass
 *          matches.
 */
export function narrowSymbolCandidatesByName<T extends { name: string }>(
    candidates: ReadonlyArray<T>,
    query: string
): ReadonlyArray<T> {
    const exactMatches = candidates.filter((candidate) => candidate.name === query);
    if (exactMatches.length > 0) {
        return exactMatches;
    }

    const lowerCasedQuery = query.toLowerCase();
    const caseInsensitiveMatches = candidates.filter((candidate) => candidate.name.toLowerCase() === lowerCasedQuery);
    if (caseInsensitiveMatches.length > 0) {
        return caseInsensitiveMatches;
    }

    return candidates;
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

        const kindFilteredCandidates = searchResult.results.filter((entry) => matchesKind(entry.kind, requestedKind));

        if (kindFilteredCandidates.length > 0) {
            const candidates = narrowSymbolCandidatesByName(kindFilteredCandidates, query);

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
                const payload = {
                    command: "symbol inspect",
                    ok: false,
                    error: `Ambiguous symbol '${query}'. Multiple candidates found.`,
                    code: "ambiguous",
                    candidates: candidates.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))
                };
                printSymbolResult(payload, true);
                process.exit(1);
            }
        }
    }

    if (!resolvedNode) {
        const payload = {
            command: "symbol inspect",
            ok: false,
            error: `Symbol '${query}' not found.`,
            code: "unresolved"
        };
        printSymbolResult(payload, true);
        process.exit(1);
    }

    const includes = parseSymbolIncludeOption(options.include ?? "node");

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
