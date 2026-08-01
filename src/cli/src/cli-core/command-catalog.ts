import type { Argument, Command, Option } from "commander";

import { isCommandExcludedFromMcpTools } from "./mcp-command-exclusion.js";

export type CliCatalogArgument = Readonly<{
    choices: ReadonlyArray<string>;
    defaultValue: unknown;
    description: string;
    name: string;
    required: boolean;
    variadic: boolean;
}>;

export type CliCatalogOption = Readonly<{
    attributeName: string;
    boolean: boolean;
    choices: ReadonlyArray<string>;
    description: string;
    flags: string;
    hidden: boolean;
    long: string | undefined;
    name: string;
    negate: boolean;
    optional: boolean;
    short: string | undefined;
    variadic: boolean;
}>;

export type CliCatalogEntry = Readonly<{
    arguments: ReadonlyArray<CliCatalogArgument>;
    commandName: string;
    commandPath: ReadonlyArray<string>;
    description: string;
    displayName: string;
    excludeFromMcp: boolean;
    options: ReadonlyArray<CliCatalogOption>;
    usage: string;
}>;

function normalizeArgument(argument: Argument): CliCatalogArgument {
    return Object.freeze({
        choices: Object.freeze([...(argument.argChoices ?? [])]),
        defaultValue: argument.defaultValue as unknown,
        description: argument.description ?? "",
        name: argument.name(),
        required: argument.required,
        variadic: argument.variadic
    });
}

function normalizeOption(option: Option): CliCatalogOption {
    return Object.freeze({
        attributeName: option.attributeName(),
        boolean: option.isBoolean(),
        choices: Object.freeze([...(option.argChoices ?? [])]),
        description: option.description ?? "",
        flags: option.flags,
        hidden: option.hidden,
        long: option.long,
        name: option.name(),
        negate: option.negate,
        optional: option.optional,
        short: option.short,
        variadic: option.variadic
    });
}

function buildUsage(command: Command, commandPath: ReadonlyArray<string>): string {
    const usageText = typeof command.usage() === "string" ? command.usage() : "";
    return `${commandPath.join(" ")}${usageText ? ` ${usageText}` : ""}`.trim();
}

function collectLeafCommands(
    command: Command,
    ancestry: ReadonlyArray<string>,
    parentExcludedFromMcpTools: boolean
): Array<CliCatalogEntry> {
    const commandName = command.name();
    if (commandName === "help") {
        return [];
    }

    const commandPath = [...ancestry, commandName];
    const excludedFromMcpTools = parentExcludedFromMcpTools || isCommandExcludedFromMcpTools(command);
    const childCommands = [...command.commands].filter((child) => child.name() !== "help");
    if (childCommands.length === 0) {
        return [
            Object.freeze({
                arguments: Object.freeze(command.registeredArguments.map((argument) => normalizeArgument(argument))),
                commandName,
                commandPath: Object.freeze(commandPath),
                description: command.description() ?? "",
                displayName: commandPath.join(" "),
                excludeFromMcp: excludedFromMcpTools,
                options: Object.freeze(command.options.map((option) => normalizeOption(option))),
                usage: buildUsage(command, commandPath)
            })
        ];
    }

    return childCommands.flatMap((child) => collectLeafCommands(child, commandPath, excludedFromMcpTools));
}

/**
 * Flatten Commander commands into a leaf-command catalog suitable for CLI
 * discovery and MCP tool generation.
 */
export function createCliCommandCatalog(program: Command): Array<CliCatalogEntry> {
    return [...program.commands].flatMap((command) => collectLeafCommands(command, [], false));
}
