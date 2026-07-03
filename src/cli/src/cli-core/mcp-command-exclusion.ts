import type { Command } from "commander";

const MCP_TOOL_EXCLUDED_SYMBOL = Symbol.for("@gmloop/cli/mcp-tool-excluded");

type CommandWithMcpToolMetadata = Command & {
    [MCP_TOOL_EXCLUDED_SYMBOL]?: boolean;
};

/**
 * Unified deny-list of command paths that should not be exposed as MCP tools.
 * Matches exact command paths (e.g. `["graph", "visualize"]`) or prefixes (e.g. `["ui"]`).
 */
export const MCP_TOOL_DENY_LIST: ReadonlyArray<ReadonlyArray<string>> = Object.freeze([
    // Internal graph/UI visualization workflow (browser/server oriented).
    Object.freeze(["graph", "visualize"]),
    // Direct transpile output and internal CI telemetry/reporting flows.
    Object.freeze(["transpile"]),
    Object.freeze(["collect-stats"]),
    // Manual-derived artifact generation for GMLoop internals/tooling.
    Object.freeze(["generate-feather-metadata"]),
    Object.freeze(["generate-gml-identifiers"]),
    Object.freeze(["generate-quality-report"]),
    // Internal platform/toolchain command families.
    Object.freeze(["ui"]),
    Object.freeze(["profile"]),
    Object.freeze(["test"]),
    Object.freeze(["replay"]),
    // Low-level live-reload or file watching commands
    Object.freeze(["watch"]),
    Object.freeze(["live-reload", "prepare"]),
    Object.freeze(["live-reload", "build"])
]);

/**
 * Resolve the full ancestry command path for a Commander Command, ignoring the root program.
 */
function getCommandPath(command: Command): Array<string> {
    const pathList: Array<string> = [];
    let current: Command | null = command;
    while (current) {
        const name = current.name();
        // Ignores the empty program name or root program which doesn't have a parent
        if (name && current.parent) {
            pathList.unshift(name);
        }
        current = current.parent;
    }
    return pathList;
}

/**
 * Mark a command (and its descendant leaf commands) as excluded from MCP tool catalog generation.
 */
export function excludeCommandFromMcpTools<TCommand extends Command>(command: TCommand): TCommand {
    const commandWithMetadata = command as CommandWithMcpToolMetadata;
    commandWithMetadata[MCP_TOOL_EXCLUDED_SYMBOL] = true;
    return command;
}

/**
 * Check whether a command has been excluded from MCP tool catalog generation.
 */
export function isCommandExcludedFromMcpTools(command: Command): boolean {
    const commandWithMetadata = command as CommandWithMcpToolMetadata;
    if (commandWithMetadata[MCP_TOOL_EXCLUDED_SYMBOL] === true) {
        return true;
    }

    if (process.env.GMLOOP_EXPOSE_INTERNAL_MCP_TOOLS === "true") {
        return false;
    }

    const commandPath = getCommandPath(command);
    return MCP_TOOL_DENY_LIST.some((deniedPath) => {
        if (deniedPath.length > commandPath.length) {
            return false;
        }
        return deniedPath.every((segment, index) => commandPath[index] === segment);
    });
}
