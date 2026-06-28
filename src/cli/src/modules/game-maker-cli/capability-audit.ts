import type { CliCatalogEntry } from "../../cli-core/command-catalog.js";
import type { McpToolCatalogEntry } from "../../cli-core/mcp-tool-catalog.js";
import type { GameMakerCliCompanionCatalog } from "./catalog.js";

/**
 * Ownership bucket for a planned autonomous GameMaker capability.
 */
export type GameMakerCapabilityClassification =
    | "direct_gm_cli_mcp"
    | "gmloop_companion"
    | "gmloop_native_missing"
    | "defer";

/**
 * Current availability state for a planned capability after comparing GMLoop
 * and official gm-cli catalogs.
 */
export type GameMakerCapabilityImplementationStatus =
    | "deferred"
    | "external_available"
    | "external_unavailable"
    | "gmloop_available"
    | "gmloop_missing"
    | "gmloop_placeholder";

/**
 * One classified capability row in the GameMaker companion boundary audit.
 */
export type GameMakerCapabilityAuditEntry = Readonly<{
    classification: GameMakerCapabilityClassification;
    gmloopCommand: string | null;
    gmloopMcpTool: string | null;
    officialCliCommands: ReadonlyArray<string>;
    officialMcpTools: ReadonlyArray<string>;
    operation: string;
    rationale: string;
    status: GameMakerCapabilityImplementationStatus;
}>;

/**
 * Complete machine-readable boundary report for GMLoop and official gm-cli
 * companion surfaces.
 */
export type GameMakerCapabilityBoundaryAudit = Readonly<{
    capabilities: ReadonlyArray<GameMakerCapabilityAuditEntry>;
    gmloop: Readonly<{
        cliLeafCount: number;
        mcpToolCount: number;
    }>;
    official: Readonly<{
        available: boolean;
        cliLeafCount: number;
        error: string | null;
        invocation: string | null;
        mcpServerAvailable: boolean;
        mcpToolCount: number;
        version: string | null;
    }>;
    summary: Readonly<{
        defer: number;
        directGmCliMcp: number;
        gmloopCompanion: number;
        gmloopNativeMissing: number;
        gmloopPlaceholders: number;
        officialUnavailable: number;
    }>;
}>;

type PlannedCapability = Readonly<{
    classification: GameMakerCapabilityClassification;
    commandPath: ReadonlyArray<string>;
    officialTerms: ReadonlyArray<string>;
    placeholderCommand: boolean;
    rationale: string;
}>;

const PLANNED_CAPABILITIES: ReadonlyArray<PlannedCapability> = Object.freeze([
    createPlannedCapability({
        commandPath: ["project", "create"],
        classification: "direct_gm_cli_mcp",
        officialTerms: ["project create", "create project"],
        rationale: "Official gm-cli owns ordinary GameMaker project creation."
    }),
    createPlannedCapability({
        commandPath: ["project", "init"],
        classification: "direct_gm_cli_mcp",
        officialTerms: ["project init", "init project", "initialize project"],
        rationale: "Official gm-cli owns project initialization when no GMLoop setup is needed."
    }),
    createPlannedCapability({
        commandPath: ["project", "inspect"],
        classification: "gmloop_companion",
        officialTerms: ["project inspect", "inspect project"],
        rationale: "GMLoop project inspection should add configuration, graph, and evidence context."
    }),
    createPlannedCapability({
        commandPath: ["project", "validate"],
        classification: "gmloop_companion",
        officialTerms: ["project validate", "validate project"],
        rationale: "GMLoop validation owns parser, graph, lint, refactor, and evidence signals."
    }),
    ...createResourceMutationCapabilities(),
    ...[
        ["resource", "list"],
        ["resource", "find"],
        ["resource", "inspect"],
        ["resource", "deps"],
        ["resource", "dependents"],
        ["resource", "audit"]
    ].map((commandPath) =>
        createPlannedCapability({
            commandPath,
            classification: "gmloop_companion",
            officialTerms: [commandPath.join(" ")],
            rationale: "GMLoop resource inventory commands add semantic graph and dependency context."
        })
    ),
    createPlannedCapability({
        commandPath: ["object", "update"],
        classification: "gmloop_native_missing",
        officialTerms: ["object update", "update object"],
        placeholderCommand: true,
        rationale: "Object updates need refactor-safe validation and hot-reload-aware evidence before writes."
    }),
    createPlannedCapability({
        commandPath: ["object", "event", "list"],
        classification: "gmloop_companion",
        officialTerms: ["object event list", "list object events"],
        rationale: "Object event inventory should be graph/refactor aware for autonomous edits."
    }),
    createPlannedCapability({
        commandPath: ["object", "event", "inspect"],
        classification: "gmloop_companion",
        officialTerms: ["object event inspect", "inspect object event"],
        rationale: "Object event inspection should connect handlers to graph and validation context."
    }),
    ...[
        ["object", "event", "add"],
        ["object", "event", "update"],
        ["object", "event", "delete"],
        ["room", "instance", "add"],
        ["room", "instance", "update"],
        ["room", "instance", "delete"],
        ["room", "layer", "create"],
        ["room", "layer", "update"],
        ["room", "layer", "delete"],
        ["room", "layer", "reorder"],
        ["room", "camera", "update"]
    ].map((commandPath) =>
        createPlannedCapability({
            commandPath,
            classification: "gmloop_companion",
            officialTerms: [commandPath.join(" ")],
            rationale: "GMLoop owns this as a refactor-aware companion operation with dry-run/write semantics."
        })
    ),
    ...[
        ["room", "update"],
        ["room", "repair"],
        ["room", "camera", "frame"]
    ].map((commandPath) =>
        createPlannedCapability({
            commandPath,
            classification: "gmloop_native_missing",
            officialTerms: [commandPath.join(" ")],
            placeholderCommand: true,
            rationale: "This should become a GMLoop-owned companion only when backed by graph/refactor validation."
        })
    ),
    ...[
        ["room", "layer", "list"],
        ["room", "layer", "inspect"],
        ["room", "camera", "list"],
        ["room", "camera", "inspect"]
    ].map((commandPath) =>
        createPlannedCapability({
            commandPath,
            classification: "gmloop_companion",
            officialTerms: [commandPath.join(" ")],
            rationale: "GMLoop owns this room metadata inspection as graph/refactor-aware companion context."
        })
    ),
    ...[
        ["validate", "project"],
        ["validate", "room"],
        ["validate", "resource"],
        ["runner", "logs"],
        ["runtime", "status"],
        ["live-reload", "status"]
    ].map((commandPath) =>
        createPlannedCapability({
            commandPath,
            classification: "gmloop_companion",
            officialTerms: [commandPath.join(" ")],
            rationale: "GMLoop owns validation, runtime state, and autonomous evidence aggregation."
        })
    ),
    ...[
        ["game", "build"],
        ["game", "run"],
        ["game", "package"],
        ["manual", "search"],
        ["publish", "gxgames"]
    ].map((commandPath) =>
        createPlannedCapability({
            commandPath,
            classification: "direct_gm_cli_mcp",
            officialTerms: [commandPath.join(" "), commandPath.at(-1) ?? ""],
            rationale: "Official gm-cli owns this lifecycle operation unless GMLoop adds evidence aggregation."
        })
    )
]);

function createPlannedCapability(parameters: {
    classification: GameMakerCapabilityClassification;
    commandPath: ReadonlyArray<string>;
    officialTerms: ReadonlyArray<string>;
    placeholderCommand?: boolean;
    rationale: string;
}): PlannedCapability {
    return Object.freeze({
        classification: parameters.classification,
        commandPath: Object.freeze([...parameters.commandPath]),
        officialTerms: Object.freeze([...parameters.officialTerms]),
        placeholderCommand: parameters.placeholderCommand === true,
        rationale: parameters.rationale
    });
}

function createResourceMutationCapabilities(): ReadonlyArray<PlannedCapability> {
    return Object.freeze(
        ["add", "remove", "rename", "duplicate", "move"].map((operation) =>
            createPlannedCapability({
                commandPath: ["resource", operation],
                classification: "direct_gm_cli_mcp",
                officialTerms: [`resource ${operation}`, `resourcetool ${operation}`, operation],
                rationale: "Official ResourceTool MCP owns ordinary GameMaker resource metadata mutation."
            })
        )
    );
}

function normalizeSearchText(value: string): string {
    return value.replaceAll(/[_-]+/gu, " ").replaceAll(/\s+/gu, " ").trim().toLowerCase();
}

function createMcpToolName(commandPath: ReadonlyArray<string>): string {
    return `gmloop_${commandPath.join("_").replaceAll("-", "_")}`;
}

function findCliCommand(
    cliCatalog: ReadonlyArray<CliCatalogEntry>,
    commandPath: ReadonlyArray<string>
): CliCatalogEntry | null {
    const displayName = commandPath.join(" ");
    return cliCatalog.find((entry) => entry.displayName === displayName) ?? null;
}

function findMcpTool(
    mcpCatalog: ReadonlyArray<McpToolCatalogEntry>,
    commandPath: ReadonlyArray<string>
): McpToolCatalogEntry | null {
    const toolName = createMcpToolName(commandPath);
    return mcpCatalog.find((entry) => entry.toolName === toolName) ?? null;
}

function includesEveryOperationTerm(candidateText: string, operation: string): boolean {
    const normalizedCandidate = normalizeSearchText(candidateText);
    return normalizeSearchText(operation)
        .split(" ")
        .every((term) => normalizedCandidate.includes(term));
}

function findOfficialCliCommands(
    companionCatalog: GameMakerCliCompanionCatalog,
    plannedCapability: PlannedCapability
): ReadonlyArray<string> {
    return Object.freeze(
        companionCatalog.cliCommands
            .filter((entry) =>
                plannedCapability.officialTerms.some(
                    (term) =>
                        includesEveryOperationTerm(entry.displayName, term) ||
                        includesEveryOperationTerm(entry.description, term)
                )
            )
            .map((entry) => entry.displayName)
            .toSorted((left, right) => left.localeCompare(right))
    );
}

function findOfficialMcpTools(
    companionCatalog: GameMakerCliCompanionCatalog,
    plannedCapability: PlannedCapability
): ReadonlyArray<string> {
    return Object.freeze(
        companionCatalog.mcpTools
            .filter((entry) =>
                plannedCapability.officialTerms.some(
                    (term) =>
                        includesEveryOperationTerm(entry.name, term) ||
                        includesEveryOperationTerm(entry.description, term)
                )
            )
            .map((entry) => entry.name)
            .toSorted((left, right) => left.localeCompare(right))
    );
}

function classifyImplementationStatus(parameters: {
    cliCommand: CliCatalogEntry | null;
    mcpTool: McpToolCatalogEntry | null;
    officialCliCommands: ReadonlyArray<string>;
    officialMcpTools: ReadonlyArray<string>;
    plannedCapability: PlannedCapability;
}): GameMakerCapabilityImplementationStatus {
    if (parameters.plannedCapability.classification === "defer") {
        return "deferred";
    }

    if (parameters.plannedCapability.classification === "direct_gm_cli_mcp") {
        return parameters.officialCliCommands.length > 0 || parameters.officialMcpTools.length > 0
            ? "external_available"
            : "external_unavailable";
    }

    if (parameters.plannedCapability.placeholderCommand && parameters.cliCommand !== null) {
        return "gmloop_placeholder";
    }

    if (parameters.cliCommand !== null && parameters.mcpTool !== null) {
        return "gmloop_available";
    }

    return "gmloop_missing";
}

function createAuditEntry(parameters: {
    cliCatalog: ReadonlyArray<CliCatalogEntry>;
    companionCatalog: GameMakerCliCompanionCatalog;
    mcpCatalog: ReadonlyArray<McpToolCatalogEntry>;
    plannedCapability: PlannedCapability;
}): GameMakerCapabilityAuditEntry {
    const cliCommand = findCliCommand(parameters.cliCatalog, parameters.plannedCapability.commandPath);
    const mcpTool = findMcpTool(parameters.mcpCatalog, parameters.plannedCapability.commandPath);
    const officialCliCommands = findOfficialCliCommands(parameters.companionCatalog, parameters.plannedCapability);
    const officialMcpTools = findOfficialMcpTools(parameters.companionCatalog, parameters.plannedCapability);

    return Object.freeze({
        classification: parameters.plannedCapability.classification,
        gmloopCommand: cliCommand?.displayName ?? null,
        gmloopMcpTool: mcpTool?.toolName ?? null,
        officialCliCommands,
        officialMcpTools,
        operation: parameters.plannedCapability.commandPath.join(" "),
        rationale: parameters.plannedCapability.rationale,
        status: classifyImplementationStatus({
            cliCommand,
            mcpTool,
            officialCliCommands,
            officialMcpTools,
            plannedCapability: parameters.plannedCapability
        })
    });
}

function countEntries(
    entries: ReadonlyArray<GameMakerCapabilityAuditEntry>,
    predicate: (entry: GameMakerCapabilityAuditEntry) => boolean
): number {
    return entries.filter((entry) => predicate(entry)).length;
}

/**
 * Compare the planned autonomous GameMaker capability surface against current
 * GMLoop CLI/MCP commands and the discovered official gm-cli companion catalog.
 */
export function createGameMakerCapabilityBoundaryAudit(parameters: {
    cliCatalog: ReadonlyArray<CliCatalogEntry>;
    companionCatalog: GameMakerCliCompanionCatalog;
    mcpCatalog: ReadonlyArray<McpToolCatalogEntry>;
}): GameMakerCapabilityBoundaryAudit {
    const capabilities = Object.freeze(
        PLANNED_CAPABILITIES.map((plannedCapability) =>
            createAuditEntry({
                cliCatalog: parameters.cliCatalog,
                companionCatalog: parameters.companionCatalog,
                mcpCatalog: parameters.mcpCatalog,
                plannedCapability
            })
        ).toSorted((left, right) => left.operation.localeCompare(right.operation))
    );

    return Object.freeze({
        capabilities,
        gmloop: Object.freeze({
            cliLeafCount: parameters.cliCatalog.length,
            mcpToolCount: parameters.mcpCatalog.length
        }),
        official: Object.freeze({
            available: parameters.companionCatalog.available,
            cliLeafCount: parameters.companionCatalog.cliCommands.length,
            error: parameters.companionCatalog.error,
            invocation: parameters.companionCatalog.invocation,
            mcpServerAvailable: parameters.companionCatalog.mcpServer.available,
            mcpToolCount: parameters.companionCatalog.mcpTools.length,
            version: parameters.companionCatalog.version
        }),
        summary: Object.freeze({
            defer: countEntries(capabilities, (entry) => entry.classification === "defer"),
            directGmCliMcp: countEntries(capabilities, (entry) => entry.classification === "direct_gm_cli_mcp"),
            gmloopCompanion: countEntries(capabilities, (entry) => entry.classification === "gmloop_companion"),
            gmloopNativeMissing: countEntries(
                capabilities,
                (entry) => entry.classification === "gmloop_native_missing"
            ),
            gmloopPlaceholders: countEntries(capabilities, (entry) => entry.status === "gmloop_placeholder"),
            officialUnavailable: countEntries(capabilities, (entry) => entry.status === "external_unavailable")
        })
    });
}
