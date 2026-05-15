import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

type GameMakerCliInvocation = Readonly<{
    args: ReadonlyArray<string>;
    command: string;
    displayName: string;
}>;

type GameMakerCliCommandExecutionResult = Readonly<{
    exitCode: number;
    stderr: string;
    stdout: string;
}>;

type GameMakerCliCommandExecutionOptions = Readonly<{
    cwd: string;
    toolPath: string | null;
}>;

type GameMakerCliMcpProbeResult = Readonly<{
    serverName: string;
    serverVersion: string;
    tools: ReadonlyArray<{
        description: string;
        inputSchema: unknown;
        name: string;
    }>;
}>;

type GameMakerCliCatalogDependencies = Readonly<{
    executeCommand?: (
        invocation: GameMakerCliInvocation,
        options: GameMakerCliCommandExecutionOptions
    ) => Promise<GameMakerCliCommandExecutionResult>;
    probeMcpServer?: (
        invocation: GameMakerCliInvocation,
        projectPath: string,
        options: GameMakerCliCommandExecutionOptions
    ) => Promise<GameMakerCliMcpProbeResult>;
}>;

type ParsedHelpCommand = Readonly<{
    description: string;
    name: string;
}>;

type ParsedGameMakerCliHelp = Readonly<{
    argumentsSection: ReadonlyArray<string>;
    commands: ReadonlyArray<ParsedHelpCommand>;
    description: string;
    flagsSection: ReadonlyArray<string>;
    usageLines: ReadonlyArray<string>;
}>;

type GameMakerCliTextCommandSnapshot = Readonly<{
    invocation: GameMakerCliInvocation;
    output: GameMakerCliCommandExecutionResult;
}>;

type GameMakerCliTextParameter = Readonly<{
    choices: ReadonlyArray<string>;
    description: string;
    kind: "argument" | "flag";
    multiple: boolean;
    name: string;
    required: boolean;
    syntax: string;
    valueType: "boolean" | "string";
}>;

type GameMakerCliCommandCatalogEntry = Readonly<{
    commandPath: ReadonlyArray<string>;
    description: string;
    displayName: string;
    parameters: ReadonlyArray<GameMakerCliTextParameter>;
    usageLines: ReadonlyArray<string>;
}>;

type GameMakerCliMcpToolCatalogEntry = Readonly<{
    description: string;
    fields: ReadonlyArray<GameMakerCliTextParameter>;
    name: string;
}>;

export type GameMakerCliCompanionCatalog = Readonly<{
    available: boolean;
    cliCommands: ReadonlyArray<GameMakerCliCommandCatalogEntry>;
    error: string | null;
    invocation: string | null;
    mcpServer: Readonly<{
        available: boolean;
        error: string | null;
        name: string | null;
        projectPath: string | null;
        version: string | null;
    }>;
    mcpTools: ReadonlyArray<GameMakerCliMcpToolCatalogEntry>;
    version: string | null;
}>;

/**
 * Create the command candidates used to query the official GameMaker CLI
 * directly from the installed executable or `npx @gamemaker/gm-cli@latest`.
 */
export function createGameMakerCliInvocationPlan(
    toolPath: string | null,
    forwardedArguments: ReadonlyArray<string>
): ReadonlyArray<GameMakerCliInvocation> {
    if (toolPath !== null) {
        return [
            Object.freeze({
                args: [...forwardedArguments],
                command: toolPath,
                displayName: toolPath
            })
        ];
    }

    return [
        Object.freeze({
            args: [...forwardedArguments],
            command: "gm-cli",
            displayName: "gm-cli"
        }),
        Object.freeze({
            args: ["--yes", "@gamemaker/gm-cli@latest", ...forwardedArguments],
            command: "npx",
            displayName: "npx @gamemaker/gm-cli@latest"
        })
    ];
}

/**
 * Load the current gm-cli command and ResourceTool MCP catalogs directly from
 * the official gm-cli implementation rather than mirroring them in GMLoop.
 */
export async function loadGameMakerCliCompanionCatalog(
    options: Readonly<{
        projectRoot: string | null;
        toolPath?: string | null;
    }>,
    dependencies: GameMakerCliCatalogDependencies = {}
): Promise<GameMakerCliCompanionCatalog> {
    const executionOptions = Object.freeze({
        cwd: options.projectRoot ?? process.cwd(),
        toolPath: options.toolPath ?? null
    });
    const executeCommand = dependencies.executeCommand ?? executeGameMakerCliCommand;
    const probeMcpServer = dependencies.probeMcpServer ?? probeGameMakerCliMcpServer;

    let versionSnapshot: GameMakerCliTextCommandSnapshot;
    try {
        versionSnapshot = await runGameMakerCliTextCommand(["--version"], executionOptions, executeCommand);
    } catch (error) {
        return createUnavailableGameMakerCliCompanionCatalog(error);
    }

    const invocationDisplayName = versionSnapshot.invocation.displayName;
    const version = versionSnapshot.output.stdout.trim().length > 0 ? versionSnapshot.output.stdout.trim() : null;

    let rootHelpSnapshot: GameMakerCliTextCommandSnapshot;
    try {
        rootHelpSnapshot = await runGameMakerCliTextCommand(["--help"], executionOptions, executeCommand);
    } catch (error) {
        return createUnavailableGameMakerCliCompanionCatalog(error, invocationDisplayName, version);
    }

    const rootHelp = parseGameMakerCliHelp(rootHelpSnapshot.output.stdout);
    const cliCommands = await collectGameMakerCliLeafCommands([], rootHelp, executionOptions, executeCommand);
    const resolvedProjectPath = await resolveSingleProjectManifestPathOrNull(options.projectRoot);

    if (resolvedProjectPath === null) {
        return Object.freeze({
            available: true,
            cliCommands,
            error: null,
            invocation: invocationDisplayName,
            mcpServer: Object.freeze({
                available: false,
                error:
                    options.projectRoot === null
                        ? "No active GameMaker project is loaded, so the ResourceTool MCP catalog is unavailable."
                        : "Could not resolve a single .yyp file for ResourceTool MCP discovery.",
                name: null,
                projectPath: null,
                version: null
            }),
            mcpTools: [],
            version
        });
    }

    try {
        const mcpProbeResult = await runGameMakerCliMcpProbe(resolvedProjectPath, executionOptions, probeMcpServer);
        return Object.freeze({
            available: true,
            cliCommands,
            error: null,
            invocation: invocationDisplayName,
            mcpServer: Object.freeze({
                available: true,
                error: null,
                name: mcpProbeResult.serverName,
                projectPath: resolvedProjectPath,
                version: mcpProbeResult.serverVersion
            }),
            mcpTools: mcpProbeResult.tools
                .map((tool) =>
                    Object.freeze({
                        description: tool.description,
                        fields: createGameMakerCliMcpFieldEntries(tool.inputSchema),
                        name: tool.name
                    })
                )
                .sort((leftEntry, rightEntry) => leftEntry.name.localeCompare(rightEntry.name)),
            version
        });
    } catch (error) {
        return Object.freeze({
            available: true,
            cliCommands,
            error: null,
            invocation: invocationDisplayName,
            mcpServer: Object.freeze({
                available: false,
                error: error instanceof Error ? error.message : "Could not inspect ResourceTool MCP tools.",
                name: null,
                projectPath: resolvedProjectPath,
                version: null
            }),
            mcpTools: [],
            version
        });
    }
}

async function collectGameMakerCliLeafCommands(
    commandPath: ReadonlyArray<string>,
    parsedHelp: ParsedGameMakerCliHelp,
    executionOptions: GameMakerCliCommandExecutionOptions,
    executeCommand: (
        invocation: GameMakerCliInvocation,
        options: GameMakerCliCommandExecutionOptions
    ) => Promise<GameMakerCliCommandExecutionResult>
): Promise<ReadonlyArray<GameMakerCliCommandCatalogEntry>> {
    if (parsedHelp.commands.length === 0) {
        return [
            Object.freeze({
                commandPath,
                description: parsedHelp.description,
                displayName: commandPath.join(" "),
                parameters: [
                    ...parsedHelp.flagsSection.map((line) => createGameMakerCliTextParameter(line, "flag")),
                    ...parsedHelp.argumentsSection.map((line) => createGameMakerCliTextParameter(line, "argument"))
                ],
                usageLines: parsedHelp.usageLines
            })
        ];
    }

    const nestedEntries = await Promise.all(
        parsedHelp.commands.map(async (commandEntry) => {
            const childCommandPath = [...commandPath, commandEntry.name];
            const childHelpSnapshot = await runGameMakerCliTextCommand(
                [...childCommandPath, "--help"],
                executionOptions,
                executeCommand
            );
            return await collectGameMakerCliLeafCommands(
                childCommandPath,
                parseGameMakerCliHelp(childHelpSnapshot.output.stdout),
                executionOptions,
                executeCommand
            );
        })
    );

    return Object.freeze(
        nestedEntries
            .flat()
            .toSorted((leftEntry, rightEntry) => leftEntry.displayName.localeCompare(rightEntry.displayName))
    );
}

function parseGameMakerCliHelp(helpText: string): ParsedGameMakerCliHelp {
    const usageSectionLines: Array<string> = [];
    const flagsSectionLines: Array<string> = [];
    const argumentsSectionLines: Array<string> = [];
    const commandsSectionLines: Array<string> = [];

    let activeHeading: "ARGUMENTS" | "COMMANDS" | "FLAGS" | "USAGE" | null = null;

    for (const rawLine of helpText.split(/\r?\n/u)) {
        const trimmedLine = rawLine.trim();
        if (
            trimmedLine === "USAGE" ||
            trimmedLine === "FLAGS" ||
            trimmedLine === "ARGUMENTS" ||
            trimmedLine === "COMMANDS"
        ) {
            activeHeading = trimmedLine;
            continue;
        }

        if (activeHeading === "USAGE") {
            usageSectionLines.push(rawLine);
            continue;
        }

        if (activeHeading === "FLAGS") {
            flagsSectionLines.push(rawLine);
            continue;
        }

        if (activeHeading === "ARGUMENTS") {
            argumentsSectionLines.push(rawLine);
            continue;
        }

        if (activeHeading === "COMMANDS") {
            commandsSectionLines.push(rawLine);
        }
    }

    const usageLines: Array<string> = [];
    const descriptionLines: Array<string> = [];
    let usageMode = true;

    for (const line of usageSectionLines) {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) {
            if (usageLines.length > 0) {
                usageMode = false;
            }
            continue;
        }

        if (usageMode) {
            usageLines.push(trimmedLine);
            continue;
        }

        descriptionLines.push(trimmedLine);
    }

    return Object.freeze({
        argumentsSection: Object.freeze(
            argumentsSectionLines.map((line) => line.trim()).filter((line) => line.length > 0)
        ),
        commands: Object.freeze(
            commandsSectionLines
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .map((line) => {
                    const [name, ...descriptionParts] = line.split(/\s+/u);
                    return Object.freeze({
                        description: descriptionParts.join(" ").trim(),
                        name: name ?? ""
                    });
                })
                .filter((entry) => entry.name.length > 0)
        ),
        description: descriptionLines.join(" ").trim(),
        flagsSection: Object.freeze(flagsSectionLines.map((line) => line.trim()).filter((line) => line.length > 0)),
        usageLines: Object.freeze(usageLines)
    });
}

function createGameMakerCliTextParameter(
    line: string,
    kind: GameMakerCliTextParameter["kind"]
): GameMakerCliTextParameter {
    const parts = line.trim().split(/\s{2,}/u);
    const description = parts.length > 1 ? (parts.at(-1) ?? "") : "";
    const syntax = (parts.length > 1 ? parts.slice(0, -1) : parts).join(" ").trim();
    const tokens = syntax.replaceAll(/[[\]<>]/gu, "").split(/[,\s/]+/u);
    const normalizedName =
        tokens.find((token) => token.startsWith("--")) ??
        tokens.find((token) => token.startsWith("-")) ??
        tokens.find((token) => /^[A-Za-z0-9_-]+$/u.test(token));
    const cleanedName = (normalizedName ?? syntax).replace(/^-{1,2}/u, "").replace(/^no-/u, "");
    const choiceBlockMatch = description.match(/\[([^\]]+)\]/u);
    const rawChoices = choiceBlockMatch?.[1].split(/,\s*default\s*=/u)[0] ?? "";
    const choices = rawChoices.includes("|")
        ? rawChoices
              .split("|")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0)
        : [];
    const multiple = syntax.includes("...");
    const required = kind === "argument" && !syntax.startsWith("[");
    const valueType =
        kind === "flag" && (syntax.includes("/--no-") || /^-h\b/u.test(syntax) || /^--help\b/u.test(syntax))
            ? "boolean"
            : "string";

    return Object.freeze({
        choices: Object.freeze(choices),
        description,
        kind,
        multiple,
        name: cleanedName,
        required,
        syntax,
        valueType
    });
}

function createGameMakerCliMcpFieldEntries(inputSchema: unknown): ReadonlyArray<GameMakerCliTextParameter> {
    if (!isObjectRecord(inputSchema)) {
        return [];
    }

    const properties = isObjectRecord(inputSchema.properties) ? inputSchema.properties : null;
    if (properties === null) {
        return [];
    }

    const requiredFields = Array.isArray(inputSchema.required)
        ? new Set(
              inputSchema.required
                  .filter((entry): entry is string => typeof entry === "string")
                  .map((entry) => entry.trim())
                  .filter((entry) => entry.length > 0)
          )
        : new Set<string>();

    return Object.entries(properties)
        .map(([fieldName, rawSchema]) => createGameMakerCliMcpFieldEntry(fieldName, rawSchema, requiredFields))
        .filter((entry): entry is GameMakerCliTextParameter => entry !== null)
        .toSorted((leftEntry, rightEntry) => leftEntry.name.localeCompare(rightEntry.name));
}

function createGameMakerCliMcpFieldEntry(
    fieldName: string,
    rawSchema: unknown,
    requiredFields: ReadonlySet<string>
): GameMakerCliTextParameter | null {
    if (!isObjectRecord(rawSchema)) {
        return null;
    }

    const multiple = rawSchema.type === "array";
    const valueSchema = multiple && isObjectRecord(rawSchema.items) ? rawSchema.items : rawSchema;
    const description = typeof rawSchema.description === "string" ? rawSchema.description.trim() : "";
    const enumValues = Array.isArray(valueSchema.enum)
        ? valueSchema.enum.filter((entry): entry is string => typeof entry === "string")
        : [];
    const valueType = valueSchema.type === "boolean" ? "boolean" : "string";

    return Object.freeze({
        choices: Object.freeze(enumValues),
        description,
        kind: "argument",
        multiple,
        name: fieldName,
        required: requiredFields.has(fieldName),
        syntax: multiple ? `${fieldName}[]` : fieldName,
        valueType
    });
}

async function runGameMakerCliTextCommand(
    forwardedArguments: ReadonlyArray<string>,
    options: GameMakerCliCommandExecutionOptions,
    executeCommand: (
        invocation: GameMakerCliInvocation,
        options: GameMakerCliCommandExecutionOptions
    ) => Promise<GameMakerCliCommandExecutionResult>
): Promise<GameMakerCliTextCommandSnapshot> {
    const invocationPlan = createGameMakerCliInvocationPlan(options.toolPath, forwardedArguments);
    return await runGameMakerCliTextCommandAtIndex(invocationPlan, options, executeCommand, 0);
}

async function runGameMakerCliTextCommandAtIndex(
    invocationPlan: ReadonlyArray<GameMakerCliInvocation>,
    options: GameMakerCliCommandExecutionOptions,
    executeCommand: (
        invocation: GameMakerCliInvocation,
        options: GameMakerCliCommandExecutionOptions
    ) => Promise<GameMakerCliCommandExecutionResult>,
    index: number
): Promise<GameMakerCliTextCommandSnapshot> {
    const invocation = invocationPlan[index];
    if (invocation === undefined) {
        throw new Error("Could not find the official GameMaker CLI.");
    }

    try {
        const output = await executeCommand(invocation, options);
        if (output.exitCode !== 0) {
            throw new Error(
                output.stderr.trim() || output.stdout.trim() || `gm-cli exited with code ${output.exitCode}.`
            );
        }

        return Object.freeze({
            invocation,
            output
        });
    } catch (error) {
        if (options.toolPath === null && invocation.command === "gm-cli" && isMissingCommandError(error)) {
            return await runGameMakerCliTextCommandAtIndex(invocationPlan, options, executeCommand, index + 1);
        }

        throw error;
    }
}

async function runGameMakerCliMcpProbe(
    projectPath: string,
    options: GameMakerCliCommandExecutionOptions,
    probeMcpServer: (
        invocation: GameMakerCliInvocation,
        projectPath: string,
        options: GameMakerCliCommandExecutionOptions
    ) => Promise<GameMakerCliMcpProbeResult>
): Promise<GameMakerCliMcpProbeResult> {
    const invocationPlan = createGameMakerCliInvocationPlan(options.toolPath, ["resourcetool", "mcp", projectPath]);
    return await runGameMakerCliMcpProbeAtIndex(invocationPlan, projectPath, options, probeMcpServer, 0);
}

async function runGameMakerCliMcpProbeAtIndex(
    invocationPlan: ReadonlyArray<GameMakerCliInvocation>,
    projectPath: string,
    options: GameMakerCliCommandExecutionOptions,
    probeMcpServer: (
        invocation: GameMakerCliInvocation,
        projectPath: string,
        options: GameMakerCliCommandExecutionOptions
    ) => Promise<GameMakerCliMcpProbeResult>,
    index: number
): Promise<GameMakerCliMcpProbeResult> {
    const invocation = invocationPlan[index];
    if (invocation === undefined) {
        throw new Error("Could not start the official GameMaker CLI ResourceTool MCP server.");
    }

    try {
        return await probeMcpServer(invocation, projectPath, options);
    } catch (error) {
        if (options.toolPath === null && invocation.command === "gm-cli" && isMissingCommandError(error)) {
            return await runGameMakerCliMcpProbeAtIndex(
                invocationPlan,
                projectPath,
                options,
                probeMcpServer,
                index + 1
            );
        }

        throw error;
    }
}

async function executeGameMakerCliCommand(
    invocation: GameMakerCliInvocation,
    options: GameMakerCliCommandExecutionOptions
): Promise<GameMakerCliCommandExecutionResult> {
    return await new Promise<GameMakerCliCommandExecutionResult>((resolve, reject) => {
        const childProcess = spawn(invocation.command, [...invocation.args], {
            cwd: options.cwd,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";

        childProcess.stdout.setEncoding("utf8");
        childProcess.stdout.on("data", (chunk: string) => {
            stdout += chunk;
        });

        childProcess.stderr.setEncoding("utf8");
        childProcess.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });

        childProcess.on("error", reject);
        childProcess.on("close", (code, signal) => {
            if (signal !== null) {
                reject(new Error(`gm-cli terminated with signal ${signal}.`));
                return;
            }

            resolve(
                Object.freeze({
                    exitCode: code ?? 1,
                    stderr,
                    stdout
                })
            );
        });
    });
}

async function probeGameMakerCliMcpServer(
    invocation: GameMakerCliInvocation,
    _projectPath: string,
    options: GameMakerCliCommandExecutionOptions
): Promise<GameMakerCliMcpProbeResult> {
    return await new Promise<GameMakerCliMcpProbeResult>((resolve, reject) => {
        const childProcess = spawn(invocation.command, [...invocation.args], {
            cwd: options.cwd,
            env: process.env,
            stdio: ["pipe", "pipe", "pipe"]
        });

        childProcess.stdout.setEncoding("utf8");
        childProcess.stderr.setEncoding("utf8");

        let stdoutBuffer = "";
        let stderrBuffer = "";
        const pendingMessages: Array<Record<string, unknown>> = [];
        let settled = false;

        const cleanup = () => {
            if (!childProcess.killed) {
                childProcess.kill("SIGTERM");
            }
        };

        const timeout = setTimeout(() => {
            if (settled) {
                return;
            }

            settled = true;
            cleanup();
            reject(new Error("Timed out while inspecting gm-cli ResourceTool MCP tools."));
        }, 30_000);

        const finalize = (callback: () => void) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
            callback();
        };

        const flushStdoutMessages = () => {
            let newlineIndex = stdoutBuffer.indexOf("\n");
            while (newlineIndex >= 0) {
                const rawLine = stdoutBuffer.slice(0, newlineIndex).trim();
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
                if (rawLine.length > 0) {
                    try {
                        const parsedLine = JSON.parse(rawLine) as Record<string, unknown>;
                        pendingMessages.push(parsedLine);
                    } catch {
                        // Ignore non-JSON log lines; only stdout JSON-RPC payloads matter.
                    }
                }
                newlineIndex = stdoutBuffer.indexOf("\n");
            }
        };

        const sendMessage = (payload: Record<string, unknown>) => {
            childProcess.stdin.write(`${JSON.stringify(payload)}\n`);
        };

        const waitForMessage = (
            predicate: (message: Record<string, unknown>) => boolean,
            onMatch: (message: Record<string, unknown>) => void
        ) => {
            const interval = setInterval(() => {
                const messageIndex = pendingMessages.findIndex(predicate);
                if (messageIndex === -1) {
                    return;
                }

                clearInterval(interval);
                const [message] = pendingMessages.splice(messageIndex, 1);
                if (message === undefined) {
                    finalize(() => reject(new Error("gm-cli ResourceTool MCP returned an unexpected empty message.")));
                    return;
                }

                onMatch(message);
            }, 20);

            return interval;
        };

        childProcess.stdout.on("data", (chunk: string) => {
            stdoutBuffer += chunk;
            flushStdoutMessages();
        });
        childProcess.stderr.on("data", (chunk: string) => {
            stderrBuffer += chunk;
        });

        childProcess.on("error", (error) => {
            finalize(() => reject(error));
        });
        childProcess.on("close", (code, signal) => {
            if (settled) {
                return;
            }

            finalize(() => {
                if (signal !== null) {
                    reject(new Error(`gm-cli ResourceTool MCP exited with signal ${signal}.`));
                    return;
                }

                reject(
                    new Error(
                        stderrBuffer.trim() ||
                            `gm-cli ResourceTool MCP exited before returning tools (code ${String(code ?? 1)}).`
                    )
                );
            });
        });

        sendMessage({
            id: 1,
            jsonrpc: "2.0",
            method: "initialize",
            params: {
                capabilities: {},
                clientInfo: {
                    name: "gmloop-config-probe",
                    version: "0.0.1"
                },
                protocolVersion: "2025-03-26"
            }
        });

        const initializeInterval = waitForMessage(
            (message) => message.id === 1,
            (message) => {
                const result = isObjectRecord(message.result) ? message.result : null;
                if (result === null) {
                    finalize(() =>
                        reject(new Error("gm-cli ResourceTool MCP did not return a valid initialize response."))
                    );
                    return;
                }

                sendMessage({
                    jsonrpc: "2.0",
                    method: "notifications/initialized",
                    params: {}
                });
                sendMessage({
                    id: 2,
                    jsonrpc: "2.0",
                    method: "tools/list",
                    params: {}
                });

                const toolsInterval = waitForMessage(
                    (toolsMessage) => toolsMessage.id === 2,
                    (toolsMessage) => {
                        const toolsResult = isObjectRecord(toolsMessage.result) ? toolsMessage.result : null;
                        const toolsValue = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];
                        const serverInfo = isObjectRecord(result.serverInfo) ? result.serverInfo : null;

                        finalize(() =>
                            resolve(
                                Object.freeze({
                                    serverName: typeof serverInfo?.name === "string" ? serverInfo.name : "ResourceTool",
                                    serverVersion:
                                        typeof serverInfo?.version === "string" ? serverInfo.version : "unknown",
                                    tools: Object.freeze(
                                        toolsValue
                                            .map((entry) => {
                                                if (!isObjectRecord(entry) || typeof entry.name !== "string") {
                                                    return null;
                                                }

                                                return Object.freeze({
                                                    description:
                                                        typeof entry.description === "string" ? entry.description : "",
                                                    inputSchema: entry.inputSchema,
                                                    name: entry.name
                                                });
                                            })
                                            .filter(
                                                (
                                                    entry
                                                ): entry is Readonly<{
                                                    description: string;
                                                    inputSchema: unknown;
                                                    name: string;
                                                }> => entry !== null
                                            )
                                    )
                                })
                            )
                        );
                    }
                );

                childProcess.on("close", () => {
                    clearInterval(toolsInterval);
                });
            }
        );

        childProcess.on("close", () => {
            clearInterval(initializeInterval);
        });
    });
}

async function resolveSingleProjectManifestPathOrNull(projectRoot: string | null): Promise<string | null> {
    if (projectRoot === null) {
        return null;
    }

    const entries = await readdir(projectRoot, { withFileTypes: true }).catch(() => []);
    const manifestPaths = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".yyp"))
        .map((entry) => path.join(projectRoot, entry.name))
        .sort((leftPath, rightPath) => leftPath.localeCompare(rightPath));

    return manifestPaths.length === 1 ? manifestPaths[0] : null;
}

function createUnavailableGameMakerCliCompanionCatalog(
    error: unknown,
    invocation: string | null = null,
    version: string | null = null
): GameMakerCliCompanionCatalog {
    return Object.freeze({
        available: false,
        cliCommands: [],
        error: error instanceof Error ? error.message : "Could not load gm-cli metadata.",
        invocation,
        mcpServer: Object.freeze({
            available: false,
            error: "The official gm-cli is not available, so ResourceTool MCP metadata could not be loaded.",
            name: null,
            projectPath: null,
            version: null
        }),
        mcpTools: [],
        version
    });
}

function isMissingCommandError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
