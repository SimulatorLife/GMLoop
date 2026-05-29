import { type CliCatalogArgument, type CliCatalogEntry, type CliCatalogOption } from "./command-catalog.js";

export type McpToolCatalogField = Readonly<{
    attributeName: string;
    choices: ReadonlyArray<string>;
    description: string;
    kind: "argument" | "option";
    multiple: boolean;
    name: string;
    required: boolean;
    valueType: "boolean" | "string";
}>;

export type McpToolCatalogEntry = Readonly<{
    commandDisplayName: string;
    commandPath: ReadonlyArray<string>;
    description: string;
    fields: ReadonlyArray<McpToolCatalogField>;
    toolName: string;
}>;

function normalizeMcpToolName(commandPath: ReadonlyArray<string>): string {
    return `gmloop_${commandPath.join("_").replaceAll("-", "_")}`;
}

function normalizeArgumentField(argument: CliCatalogArgument): McpToolCatalogField {
    return Object.freeze({
        attributeName: normalizeSchemaFieldName(argument.name),
        choices: argument.choices,
        description: argument.description,
        kind: "argument",
        multiple: argument.variadic,
        name: argument.name,
        required: argument.required,
        valueType: "string"
    });
}

function normalizeOptionField(option: CliCatalogOption): McpToolCatalogField {
    return Object.freeze({
        attributeName: option.attributeName,
        choices: option.choices,
        description: option.description,
        kind: "option",
        multiple: option.variadic,
        name: option.long ?? option.name,
        required: false,
        valueType: option.boolean ? "boolean" : "string"
    });
}

function createMcpCatalogFields(entry: CliCatalogEntry): ReadonlyArray<McpToolCatalogField> {
    const visibleOptionFields = entry.options
        .filter((option) => !option.hidden && option.attributeName !== "help" && option.attributeName !== "version")
        .map((option) => normalizeOptionField(option));

    return Object.freeze([
        Object.freeze({
            attributeName: "cwd",
            choices: Object.freeze([]),
            description: "Optional working directory for the CLI invocation.",
            kind: "option",
            multiple: false,
            name: "cwd",
            required: false,
            valueType: "string"
        }),
        ...entry.arguments.map((argument) => normalizeArgumentField(argument)),
        ...visibleOptionFields
    ]);
}

function normalizeSchemaFieldName(name: string): string {
    return name.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Derive the public MCP tool catalog directly from the CLI command catalog.
 */
export function createMcpToolCatalogEntries(
    cliCatalog: ReadonlyArray<CliCatalogEntry>
): ReadonlyArray<McpToolCatalogEntry> {
    return Object.freeze(
        cliCatalog
            .filter((entry) => !entry.excludeFromMcp)
            .map((entry) =>
                Object.freeze({
                    commandDisplayName: entry.displayName,
                    commandPath: entry.commandPath,
                    description: entry.description,
                    fields: createMcpCatalogFields(entry),
                    toolName: normalizeMcpToolName(entry.commandPath)
                })
            )
    );
}
