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

const INCLUDE_FLAG_KEYS = ["node", "context", "neighbors", "usages", "dependents"] as const;
type IncludeFlag = (typeof INCLUDE_FLAG_KEYS)[number];

type GraphNodeRecord = NonNullable<ReturnType<typeof Semantic.getGraphNode>>;

type GraphQueryContext = Readonly<{
    databasePath?: string;
    projectConfig: Record<string, unknown>;
    projectRoot: string;
    toolsetRoot?: string;
}>;

type ResolvedSymbolNode = Readonly<{
    kind: string;
    matchesRequestedKind: boolean;
    node: GraphNodeRecord;
    nodeId: string;
}>;

type AmbiguousSymbolCandidate = Readonly<{ id: string; kind: string; name: string }>;

type ResolutionOutcome =
    | { candidates: ReadonlyArray<AmbiguousSymbolCandidate>; query: string; status: "ambiguous" }
    | { status: "missing" }
    | { resolution: ResolvedSymbolNode; status: "resolved" };

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
 * Parse the comma-separated `--include` value into a normalised set of
 * recognised include flags. Unknown entries are silently dropped so that
 * future additions don't require the CLI command to ship a parallel change.
 *
 * Exposed for unit testing; not part of the command's public surface.
 */
export function parseIncludeFlags(rawValue: string | undefined): Set<IncludeFlag> {
    const flags = new Set<IncludeFlag>();
    for (const entry of rawValue?.split(",") ?? []) {
        const normalized = entry.trim().toLowerCase();
        if ((INCLUDE_FLAG_KEYS as ReadonlyArray<string>).includes(normalized)) {
            flags.add(normalized as IncludeFlag);
        }
    }
    return flags;
}

/**
 * Narrow an ambiguous candidate set to a single best match by preferring
 * exact case-sensitive name equality, then case-insensitive equality. The
 * prior inline implementation combined these two filters with the caller's
 * ambiguity check, which made both the matching strategy and its empty-set
 * behaviour hard to verify in isolation.
 *
 * Exposed for unit testing; not part of the command's public surface.
 */
export function narrowSymbolCandidatesByName<T extends { name: string }>(
    candidates: ReadonlyArray<T>,
    query: string
): Array<T> {
    const exactCaseSensitive = candidates.filter((candidate) => candidate.name === query);
    if (exactCaseSensitive.length > 0) {
        return [...exactCaseSensitive];
    }

    const loweredQuery = query.toLowerCase();
    const exactCaseInsensitive = candidates.filter((candidate) => candidate.name.toLowerCase() === loweredQuery);
    return [...exactCaseInsensitive];
}

/**
 * Resolve `query` to a single graph node, preferring an exact direct lookup
 * over the wider graph search. Returns the resolution shape that captures
 * whether the symbol was resolved, the search produced multiple candidates
 * with the same name, or no kind-matching candidate was found.
 *
 * The narrowing contract preserves the legacy behaviour exactly: when the
 * search returns at least one kind-matching candidate but the query matches
 * none of them by exact or case-insensitive name, the resolution is
 * "ambiguous" rather than "missing" so the CLI still surfaces the
 * kind-filtered candidate set instead of pretending nothing was found.
 *
 * Exposed for unit testing; not part of the command's public surface.
 */
export function resolveSymbolNode(query: string, requestedKind: string, context: GraphQueryContext): ResolutionOutcome {
    const directNode = Semantic.getGraphNode({
        databasePath: context.databasePath,
        nodeId: query,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: context.toolsetRoot
    });

    if (directNode && matchesKind(directNode.kind, requestedKind)) {
        return {
            status: "resolved",
            resolution: {
                kind: directNode.kind,
                matchesRequestedKind: true,
                node: directNode,
                nodeId: directNode.id
            }
        };
    }

    const searchResult = Semantic.searchGraphIndex({
        databasePath: context.databasePath,
        limit: 100,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        query,
        toolsetRoot: context.toolsetRoot
    });

    const kindMatchingCandidates = searchResult.results.filter((entry) => matchesKind(entry.kind, requestedKind));
    if (kindMatchingCandidates.length === 0) {
        return { status: "missing" };
    }

    const narrowedCandidates = narrowSymbolCandidatesByName(kindMatchingCandidates, query);
    const finalCandidates = narrowedCandidates.length > 0 ? narrowedCandidates : kindMatchingCandidates;

    if (finalCandidates.length === 1) {
        const uniqueMatch = finalCandidates[0];
        const resolved = Semantic.getGraphNode({
            databasePath: context.databasePath,
            nodeId: uniqueMatch.id,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            toolsetRoot: context.toolsetRoot
        });
        if (resolved) {
            return {
                status: "resolved",
                resolution: {
                    kind: resolved.kind,
                    matchesRequestedKind: true,
                    node: resolved,
                    nodeId: resolved.id
                }
            };
        }
    }

    return {
        candidates: finalCandidates.map((candidate) => ({
            id: candidate.id,
            kind: candidate.kind,
            name: candidate.name
        })),
        query,
        status: "ambiguous"
    };
}

/**
 * Materialise the inspection payload for a resolved symbol by reading each
 * requested graph relation (context, neighbors, usages) once. Keeping the
 * include-driven branching in a single helper means the orchestrator can
 * stay focused on top-level success/failure paths and the per-include
 * contract stays trivially unit-testable.
 *
 * Exposed for unit testing; not part of the command's public surface.
 */
export function buildSymbolInspectionPayload(
    resolvedNode: GraphNodeRecord,
    includes: ReadonlySet<IncludeFlag>,
    options: Readonly<{ context: GraphQueryContext; depth?: number }>
): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        resolvedId: resolvedNode.id,
        resolvedKind: resolvedNode.kind
    };

    if (includes.has("node")) {
        payload.node = resolvedNode;
    }
    if (includes.has("context")) {
        payload.context = Semantic.getGraphContext({
            databasePath: options.context.databasePath,
            depth: options.depth,
            nodeId: resolvedNode.id,
            projectConfig: options.context.projectConfig,
            projectRoot: options.context.projectRoot,
            toolsetRoot: options.context.toolsetRoot
        });
    }
    if (includes.has("neighbors")) {
        payload.neighbors = Semantic.getGraphNeighbors({
            databasePath: options.context.databasePath,
            depth: options.depth,
            nodeId: resolvedNode.id,
            projectConfig: options.context.projectConfig,
            projectRoot: options.context.projectRoot,
            toolsetRoot: options.context.toolsetRoot
        });
    }
    if (includes.has("usages") || includes.has("dependents")) {
        const usages = Semantic.getGraphUsages({
            databasePath: options.context.databasePath,
            depth: options.depth,
            nodeId: resolvedNode.id,
            projectConfig: options.context.projectConfig,
            projectRoot: options.context.projectRoot,
            toolsetRoot: options.context.toolsetRoot
        });
        if (includes.has("usages")) {
            payload.usages = usages;
        }
        if (includes.has("dependents")) {
            payload.dependents = usages;
        }
    }

    return payload;
}

function emitSymbolFailure(payload: Record<string, unknown>, exitCode: 1): void {
    printSymbolResult(payload, true);
    process.exit(exitCode);
}

async function runSymbolInspectAction(identifierOrNodeId: string, options: SymbolInspectOptions): Promise<void> {
    const context = await ensureProjectGraphIndex(options);
    const query = identifierOrNodeId;
    const requestedKind = options.kind ?? "auto";
    const graphContext: GraphQueryContext = {
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    };

    const resolution = resolveSymbolNode(query, requestedKind, graphContext);

    if (resolution.status === "ambiguous") {
        emitSymbolFailure(
            {
                candidates: resolution.candidates,
                code: "ambiguous",
                command: "symbol inspect",
                error: `Ambiguous symbol '${resolution.query}'. Multiple candidates found.`,
                ok: false
            },
            1
        );
        return;
    }

    if (resolution.status === "missing") {
        emitSymbolFailure(
            {
                code: "unresolved",
                command: "symbol inspect",
                error: `Symbol '${query}' not found.`,
                ok: false
            },
            1
        );
        return;
    }

    const includes = parseIncludeFlags(options.include);
    const payload = buildSymbolInspectionPayload(resolution.resolution.node, includes, {
        context: graphContext,
        depth: options.depth
    });
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

export const __symbolInspectTest__ = Object.freeze({
    buildSymbolInspectionPayload,
    narrowSymbolCandidatesByName,
    parseIncludeFlags,
    resolveSymbolNode
});
