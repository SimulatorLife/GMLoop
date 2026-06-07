import type { Command } from "commander";

const MCP_TOOL_EXCLUDED_SYMBOL = Symbol.for("@gmloop/cli/mcp-tool-excluded");

type CommandWithMcpToolMetadata = Command & {
    [MCP_TOOL_EXCLUDED_SYMBOL]?: boolean;
};

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
    return commandWithMetadata[MCP_TOOL_EXCLUDED_SYMBOL] === true;
}
