import { CLI } from "@gmloop/cli";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type CliCatalogEntry = ReturnType<typeof CLI.getCliCommandCatalog>[number];
type CliCatalogArgument = CliCatalogEntry["arguments"][number];
type CliCatalogOption = CliCatalogEntry["options"][number];
type McpToolCatalogEntry = ReturnType<typeof CLI.getMcpToolCatalogEntries>[number];

/**
 * Stable identity used by MCP clients when they connect to the GMLoop MCP server.
 */
export type GmloopMcpServerMetadata = Readonly<{
    name: string;
    version: string;
}>;

export const GMLOOP_MCP_SERVER_METADATA: GmloopMcpServerMetadata = Object.freeze({
    name: "gmloop-mcp",
    version: "0.0.1"
});

function normalizeSchemaFieldName(name: string): string {
    return name.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}

function createOptionSchema(option: CliCatalogOption) {
    if (option.variadic) {
        return z.array(z.string());
    }

    if (option.boolean) {
        return z.boolean();
    }

    if (option.choices.length > 0) {
        return z.enum(option.choices as [string, ...Array<string>]);
    }

    return z.string();
}

function createArgumentSchema(argument: CliCatalogArgument) {
    if (argument.variadic) {
        const schema = z.array(z.string());
        return argument.required ? schema : schema.optional();
    }

    const schema = argument.choices.length > 0 ? z.enum(argument.choices as [string, ...Array<string>]) : z.string();
    return argument.required ? schema : schema.optional();
}

type CliJsonInvocationResult<TPayload> = Readonly<{
    payload: TPayload;
    stdout: string;
}>;

type CliGraphEnvelope<TPayload> = Readonly<{
    payload: TPayload;
}>;

function createToolInputSchema(entry: CliCatalogEntry): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const shape: Record<string, z.ZodTypeAny> = {
        cwd: z.string().optional()
    };

    for (const argument of entry.arguments) {
        shape[normalizeSchemaFieldName(argument.name)] = createArgumentSchema(argument);
    }

    for (const option of entry.options) {
        if (option.hidden || !option.long || option.attributeName === "help" || option.attributeName === "version") {
            continue;
        }

        shape[option.attributeName] = createOptionSchema(option).optional();
    }

    return z.object(shape);
}

function appendCommandArguments(
    argv: Array<string>,
    entry: CliCatalogEntry,
    argumentsObject: Record<string, unknown>
): void {
    for (const argument of entry.arguments) {
        const argumentName = normalizeSchemaFieldName(argument.name);
        const value = argumentsObject[argumentName];

        if (Array.isArray(value)) {
            argv.push(...value.map(String));
            continue;
        }

        if (typeof value === "string" && value.length > 0) {
            argv.push(value);
        }
    }
}

function appendCommandOptions(
    argv: Array<string>,
    entry: CliCatalogEntry,
    argumentsObject: Record<string, unknown>
): void {
    for (const option of entry.options) {
        if (option.hidden || !option.long || option.attributeName === "help" || option.attributeName === "version") {
            continue;
        }

        const value = argumentsObject[option.attributeName];
        if (value === undefined || value === null || value === "") {
            continue;
        }

        if (option.boolean) {
            if (option.negate) {
                if (value === false) {
                    argv.push(option.long);
                }
            } else if (value === true) {
                argv.push(option.long);
            }
            continue;
        }

        if (Array.isArray(value)) {
            argv.push(option.long, ...value.map(String));
            continue;
        }

        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            argv.push(option.long, `${value}`);
        }
    }
}

function createCliCommandArgv(entry: CliCatalogEntry, argumentsObject: Record<string, unknown>): Array<string> {
    const argv = [...entry.commandPath];
    appendCommandArguments(argv, entry, argumentsObject);
    appendCommandOptions(argv, entry, argumentsObject);
    return argv;
}

function createToolTextSummary(commandPath: ReadonlyArray<string>, exitCode: number): string {
    return `${commandPath.join(" ")} exited with code ${exitCode}`;
}

function readCliFailureSummary(result: { exitCode: number; stderr: string; stdout: string }): string {
    const stderr = result.stderr.trim();
    if (stderr.length > 0) {
        return stderr;
    }

    const stdout = result.stdout.trim();
    if (stdout.length > 0) {
        return stdout;
    }

    return `CLI command exited with code ${result.exitCode}.`;
}

async function runCliJsonCommand<TPayload>(
    argv: Array<string>,
    cwd = process.cwd()
): Promise<CliJsonInvocationResult<TPayload>> {
    const result = await CLI.runCliCommandCapture({
        argv,
        cwd
    });
    if (result.exitCode !== 0) {
        throw new Error(readCliFailureSummary(result));
    }

    return {
        payload: JSON.parse(result.stdout) as TPayload,
        stdout: result.stdout
    };
}

function createJsonResourceResult(uri: URL, payload: unknown) {
    return {
        contents: [
            {
                mimeType: "application/json",
                text: JSON.stringify(payload, null, 2),
                uri: uri.toString()
            }
        ]
    };
}

function createGraphResourceTemplate(uriTemplate: string): ResourceTemplate {
    return new ResourceTemplate(uriTemplate, {
        list: undefined
    });
}

function getTemplateVariable(variables: Record<string, string | Array<string>>, key: string): string {
    const value = variables[key];
    if (Array.isArray(value)) {
        const firstValue = value[0];
        return typeof firstValue === "string" ? firstValue : "";
    }

    return typeof value === "string" ? value : "";
}

export function listGmloopMcpToolNames(): Array<string> {
    return listGmloopMcpToolCatalogEntries().map((entry) => entry.toolName);
}

export function listGmloopMcpToolCatalogEntries(): ReadonlyArray<McpToolCatalogEntry> {
    return CLI.getMcpToolCatalogEntries();
}

function registerCliTools(server: McpServer): void {
    const cliCatalogByCommandDisplayName = new Map(
        CLI.getCliCommandCatalog().map((entry) => [entry.displayName, entry])
    );

    for (const toolCatalogEntry of listGmloopMcpToolCatalogEntries()) {
        const entry = cliCatalogByCommandDisplayName.get(toolCatalogEntry.commandDisplayName);
        if (!entry) {
            throw new Error(
                `Missing CLI command catalog entry for MCP command '${toolCatalogEntry.commandDisplayName}'.`
            );
        }

        server.registerTool(
            toolCatalogEntry.toolName,
            {
                description: entry.description,
                inputSchema: createToolInputSchema(entry)
            },
            async (argumentsObject) => {
                const normalizedArguments: Record<string, unknown> = argumentsObject;
                const argv = createCliCommandArgv(entry, normalizedArguments);
                const cwdValue = normalizedArguments.cwd;
                const cwd = typeof cwdValue === "string" && cwdValue.length > 0 ? cwdValue : process.cwd();
                const result = await CLI.runCliCommandCapture({
                    argv,
                    cwd
                });

                return {
                    content: [
                        {
                            text: createToolTextSummary(entry.commandPath, result.exitCode),
                            type: "text"
                        }
                    ],
                    isError: result.exitCode !== 0,
                    structuredContent: {
                        argv,
                        command: entry.displayName,
                        cwd,
                        exitCode: result.exitCode,
                        stderr: result.stderr,
                        stdout: result.stdout
                    }
                };
            }
        );
    }
}

function registerGraphResources(server: McpServer): void {
    server.registerResource(
        "graph-overview",
        "gm://graph/overview",
        {
            description: "Overview of the current graph-index state."
        },
        async (uri) => {
            const report = await runCliJsonCommand<unknown>(["graph", "doctor", "--json"]);
            return createJsonResourceResult(uri, report.payload);
        }
    );

    server.registerResource(
        "graph-project-overview",
        "gm://graph/project/overview",
        {
            description: "Overview of the active project graph."
        },
        async (uri) => {
            const report = await runCliJsonCommand<
                CliGraphEnvelope<{
                    graphs?: Array<{ graphId?: string }>;
                }>
            >(["graph", "doctor", "--json"]);
            return createJsonResourceResult(
                uri,
                report.payload.payload.graphs?.find((entry) => entry.graphId === "project") ?? null
            );
        }
    );

    server.registerResource(
        "graph-toolset-overview",
        "gm://graph/toolset/overview",
        {
            description: "Overview of the optional toolset graph."
        },
        async (uri) => {
            const report = await runCliJsonCommand<
                CliGraphEnvelope<{
                    graphs?: Array<{ graphId?: string }>;
                }>
            >(["graph", "doctor", "--json"]);
            return createJsonResourceResult(
                uri,
                report.payload.payload.graphs?.find((entry) => entry.graphId === "toolset") ?? null
            );
        }
    );

    server.registerResource(
        "graph-node",
        createGraphResourceTemplate("gm://node/{nodeId}"),
        {
            description: "Graph node lookup by graph-qualified node id."
        },
        async (uri, variables) => {
            const node = await runCliJsonCommand<unknown>([
                "graph",
                "symbol",
                getTemplateVariable(variables, "nodeId"),
                "--json"
            ]);
            return createJsonResourceResult(uri, node.payload);
        }
    );

    server.registerResource(
        "graph-context",
        createGraphResourceTemplate("gm://context/{nodeId}"),
        {
            description: "Structured graph context bundle for a graph node."
        },
        async (uri, variables) => {
            const depth = Number.parseInt(uri.searchParams.get("depth") ?? "2");
            const bundle = await runCliJsonCommand<unknown>([
                "graph",
                "context",
                getTemplateVariable(variables, "nodeId"),
                "--depth",
                String(depth),
                "--json"
            ]);
            return createJsonResourceResult(uri, bundle.payload);
        }
    );

    server.registerResource(
        "graph-neighbors",
        createGraphResourceTemplate("gm://neighbors/{nodeId}"),
        {
            description: "Graph neighbors around a graph-qualified node id."
        },
        async (uri, variables) => {
            const depth = Number.parseInt(uri.searchParams.get("depth") ?? "2");
            const neighbors = await runCliJsonCommand<unknown>([
                "graph",
                "neighbors",
                getTemplateVariable(variables, "nodeId"),
                "--depth",
                String(depth),
                "--json"
            ]);
            return createJsonResourceResult(uri, neighbors.payload);
        }
    );
}

/**
 * Create the GMLoop MCP server instance.
 */
export function createGmloopMcpServer(): McpServer {
    const server = new McpServer(GMLOOP_MCP_SERVER_METADATA);
    registerCliTools(server);
    registerGraphResources(server);
    return server;
}

/**
 * Start the GMLoop MCP server over stdio for local agent integrations.
 */
export async function runGmloopMcpStdioServer(): Promise<void> {
    const server = createGmloopMcpServer();
    const transport = new StdioServerTransport();

    await server.connect(transport);
}
