import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import {
    type ConfiguredGameMakerCliMcpServer,
    discoverConfiguredGameMakerCliMcpServer
} from "./configured-mcp-server.js";
import { probeStdioMcpServer, type StdioMcpServerProbeResult } from "./stdio-mcp-server.js";

const companionCatalogCache = new Map<string, Promise<GameMakerCliCompanionCatalog>>();

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
    discoverConfiguredMcpServer?: (projectRoot: string | null) => Promise<ConfiguredGameMakerCliMcpServer | null>;
    executeCommand?: (
        invocation: GameMakerCliInvocation,
        options: GameMakerCliCommandExecutionOptions
    ) => Promise<GameMakerCliCommandExecutionResult>;
    probeConfiguredMcpServer?: (options: {
        args: ReadonlyArray<string>;
        command: string;
        cwd: string;
        displayName: string;
        env?: Readonly<Record<string, string>>;
        timeoutMs?: number;
    }) => Promise<StdioMcpServerProbeResult>;
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
        serverId: string | null;
        sourcePath: string | null;
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
    const normalizedToolPath = normalizeConfiguredToolPath(toolPath);

    if (normalizedToolPath !== null) {
        return [
            Object.freeze({
                args: [...forwardedArguments],
                command: normalizedToolPath,
                displayName: normalizedToolPath
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

function normalizeConfiguredToolPath(toolPath: string | null): string | null {
    if (toolPath === null) {
        return null;
    }

    const trimmedToolPath = toolPath.trim();
    return trimmedToolPath.length > 0 ? trimmedToolPath : null;
}

/**
 * Load the current gm-cli command and ResourceTool MCP catalogs directly from
 * the official gm-cli implementation rather than mirroring them in GMLoop.
 */
export function loadGameMakerCliCompanionCatalog(
    options: Readonly<{
        projectRoot: string | null;
        toolPath?: string | null;
    }>,
    dependencies: GameMakerCliCatalogDependencies = {}
): Promise<GameMakerCliCompanionCatalog> {
    const isTest =
        process.env.NODE_ENV === "test" ||
        process.env.GMLOOP_TEST === "1" ||
        process.execArgv.some(
            (arg) => typeof arg === "string" && (arg.startsWith("--test") || arg.startsWith("--test-"))
        ) ||
        process.argv.some((arg) => typeof arg === "string" && (arg.startsWith("--test") || arg.includes("test/dist/")));

    if (isTest) {
        return Promise.resolve(
            createUnavailableGameMakerCliCompanionCatalog(
                new Error("GameMaker CLI detection is disabled during test execution.")
            )
        );
    }

    const hasDependencies = Object.keys(dependencies).length > 0;
    const cacheKey = `${options.projectRoot ?? ""}:${options.toolPath ?? ""}`;
    if (!hasDependencies) {
        const cached = companionCatalogCache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }
    }

    const promise = (async () => {
        const executionOptions = Object.freeze({
            cwd: options.projectRoot ?? process.cwd(),
            toolPath: options.toolPath ?? null
        });
        const discoverConfiguredMcpServer =
            dependencies.discoverConfiguredMcpServer ?? discoverConfiguredGameMakerCliMcpServer;
        const executeCommand = dependencies.executeCommand ?? executeGameMakerCliCommand;
        const probeConfiguredMcpServer = dependencies.probeConfiguredMcpServer ?? probeStdioMcpServer;
        const probeMcpServer = dependencies.probeMcpServer ?? probeGameMakerCliMcpServer;

        let versionSnapshot: GameMakerCliTextCommandSnapshot;
        try {
            versionSnapshot = await runGameMakerCliTextCommand(["--version"], executionOptions, executeCommand);
        } catch (error) {
            return createUnavailableGameMakerCliCompanionCatalog(error);
        }

        const invocationDisplayName = versionSnapshot.invocation.displayName;
        const version = versionSnapshot.output.stdout.trim().length > 0 ? versionSnapshot.output.stdout.trim() : null;

        let cliCommands: ReadonlyArray<GameMakerCliCommandCatalogEntry> | null = null;
        const cacheFilePath = options.projectRoot
            ? path.join(options.projectRoot, ".gmloop", "gm-cli-commands-cache.json")
            : null;

        if (cacheFilePath && version !== null) {
            try {
                const cacheContent = await readFile(cacheFilePath, "utf8");
                const parsedCache = parseCachedCompanionCatalogCommands(cacheContent, version, cacheFilePath);
                if (parsedCache !== null) {
                    cliCommands = parsedCache;
                }
            } catch (error) {
                // Re-query gm-cli when the cache cannot be read or parsed at all.
                // The structural-validation failures handled inside
                // `parseCachedCompanionCatalogCommands` already log a warning and
                // return `null`, so we only reach this branch for I/O errors
                // such as `ENOENT` (no cache yet) or `EACCES` (read denied).
                const reason = Core.getErrorMessage(error, { fallback: "unknown read failure" });
                console.warn(
                    `gm-cli companion catalog cache read failed at ${cacheFilePath}; re-querying gm-cli (${reason}).`
                );
            }
        }

        if (cliCommands === null) {
            let rootHelpSnapshot: GameMakerCliTextCommandSnapshot;
            try {
                rootHelpSnapshot = await runGameMakerCliTextCommand(["--help"], executionOptions, executeCommand);
            } catch (error) {
                return createUnavailableGameMakerCliCompanionCatalog(error, invocationDisplayName, version);
            }

            const rootHelp = parseGameMakerCliHelp(rootHelpSnapshot.output.stdout);
            cliCommands = await collectGameMakerCliLeafCommands([], rootHelp, executionOptions, executeCommand);

            if (cacheFilePath && version !== null) {
                try {
                    await mkdir(path.dirname(cacheFilePath), { recursive: true });
                    await writeFile(cacheFilePath, JSON.stringify({ version, commands: cliCommands }, null, 2), "utf8");
                } catch {
                    // Ignore cache write failures
                }
            }
        }
        const resolvedProjectPath = await resolveSingleProjectManifestPathOrNull(options.projectRoot);
        const configuredExternalMcpServer = await discoverConfiguredMcpServer(options.projectRoot);

        if (resolvedProjectPath === null && configuredExternalMcpServer === null) {
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
                    serverId: configuredExternalMcpServer?.serverId ?? null,
                    sourcePath: configuredExternalMcpServer?.sourcePath ?? null,
                    version: null
                }),
                mcpTools: [],
                version
            });
        }

        try {
            const mcpProbeResult =
                configuredExternalMcpServer === null
                    ? await runGameMakerCliMcpProbe(resolvedProjectPath ?? "", executionOptions, probeMcpServer)
                    : await probeConfiguredExternalGameMakerCliMcpServer(
                          configuredExternalMcpServer,
                          resolvedProjectPath,
                          executionOptions.cwd,
                          probeConfiguredMcpServer
                      );
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
                    serverId: configuredExternalMcpServer?.serverId ?? null,
                    sourcePath: configuredExternalMcpServer?.sourcePath ?? null,
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
                    error: Core.getErrorMessage(error),
                    name: null,
                    projectPath: resolvedProjectPath,
                    serverId: configuredExternalMcpServer?.serverId ?? null,
                    sourcePath: configuredExternalMcpServer?.sourcePath ?? null,
                    version: null
                }),
                mcpTools: [],
                version
            });
        }
    })();

    if (!hasDependencies) {
        companionCatalogCache.set(cacheKey, promise);
    }

    return promise;
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

function isValidCachedCompanionCatalogParameter(value: unknown): value is GameMakerCliTextParameter {
    if (!isObjectRecord(value)) {
        return false;
    }
    if (value.kind !== "argument" && value.kind !== "flag") {
        return false;
    }
    if (value.valueType !== "boolean" && value.valueType !== "string") {
        return false;
    }
    if (typeof value.description !== "string") {
        return false;
    }
    if (typeof value.name !== "string") {
        return false;
    }
    if (typeof value.syntax !== "string") {
        return false;
    }
    if (typeof value.multiple !== "boolean") {
        return false;
    }
    if (typeof value.required !== "boolean") {
        return false;
    }
    if (!Array.isArray(value.choices)) {
        return false;
    }
    return value.choices.every((entry) => typeof entry === "string");
}

function isValidCachedCompanionCatalogEntry(value: unknown): value is GameMakerCliCommandCatalogEntry {
    if (!isObjectRecord(value)) {
        return false;
    }
    if (typeof value.description !== "string") {
        return false;
    }
    if (typeof value.displayName !== "string" || value.displayName.length === 0) {
        return false;
    }
    if (!Array.isArray(value.commandPath) || !value.commandPath.every((segment) => typeof segment === "string")) {
        return false;
    }
    if (!Array.isArray(value.usageLines) || !value.usageLines.every((line) => typeof line === "string")) {
        return false;
    }
    if (
        !Array.isArray(value.parameters) ||
        !value.parameters.every((parameter) => isValidCachedCompanionCatalogParameter(parameter))
    ) {
        return false;
    }
    return true;
}

/**
 * Parse and validate the persisted `.gmloop/gm-cli-commands-cache.json`
 * payload before the catalog loader trusts it as the canonical command list.
 *
 * The cache file is hand-editable on disk and is written by older and newer
 * gm-cli / GMLoop builds alike, so its contents are intentionally untrusted.
 * The previous loader only checked `cacheData.version === version` and
 * `Array.isArray(cacheData.commands)` before passing `cacheData.commands`
 * downstream as a typed `GameMakerCliCommandCatalogEntry[]`. That shallow
 * validation let a single malformed entry (missing `displayName`,
 * `parameters` containing a non-object, wrong `kind` literal, etc.) leak
 * through and crash consumers the first time they read a nested property.
 *
 * This helper turns every failure mode — truncated JSON, non-object
 * top-level value, missing or wrong-type `version`, mismatched version,
 * missing `commands`, non-array `commands`, malformed command entry,
 * malformed parameter entry — into a `null` return after a structured
 * warning that names the offending cache path. The caller falls back to
 * re-querying gm-cli so the next cache write produces a well-formed file.
 *
 * @param cacheContent Raw cache file contents, exactly as read from disk.
 * @param expectedVersion The gm-cli `--version` string the cache must match.
 * @param cacheFilePath Absolute path used to localize error messages.
 * @returns A frozen array of valid catalog entries, or `null` when any
 *          validation step fails.
 */
function parseCachedCompanionCatalogCommands(
    cacheContent: string,
    expectedVersion: string,
    cacheFilePath: string
): ReadonlyArray<GameMakerCliCommandCatalogEntry> | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(cacheContent);
    } catch (error) {
        const reason = Core.getErrorMessage(error, { fallback: "unknown parse failure" });
        console.warn(
            `gm-cli companion catalog cache at ${cacheFilePath} is not valid JSON (${reason}); re-querying gm-cli.`
        );
        return null;
    }

    if (!isObjectRecord(parsed)) {
        console.warn(`gm-cli companion catalog cache at ${cacheFilePath} must be a JSON object; re-querying gm-cli.`);
        return null;
    }

    if (typeof parsed.version !== "string") {
        console.warn(
            `gm-cli companion catalog cache at ${cacheFilePath} is missing a string "version" field; re-querying gm-cli.`
        );
        return null;
    }

    if (parsed.version !== expectedVersion) {
        console.warn(
            `gm-cli companion catalog cache at ${cacheFilePath} has version ${JSON.stringify(parsed.version)} but gm-cli reports ${JSON.stringify(expectedVersion)}; re-querying gm-cli.`
        );
        return null;
    }

    if (!Array.isArray(parsed.commands)) {
        console.warn(
            `gm-cli companion catalog cache at ${cacheFilePath} is missing an array "commands" field; re-querying gm-cli.`
        );
        return null;
    }

    const validatedEntries: Array<GameMakerCliCommandCatalogEntry> = [];
    for (const [index, rawEntry] of parsed.commands.entries()) {
        if (!isValidCachedCompanionCatalogEntry(rawEntry)) {
            console.warn(
                `gm-cli companion catalog cache at ${cacheFilePath} has a malformed entry at index ${index}; re-querying gm-cli.`
            );
            return null;
        }
        validatedEntries.push(
            Object.freeze({
                commandPath: Object.freeze([...rawEntry.commandPath]),
                description: rawEntry.description,
                displayName: rawEntry.displayName,
                parameters: Object.freeze(
                    rawEntry.parameters.map((parameter) =>
                        Object.freeze({
                            choices: Object.freeze([...parameter.choices]),
                            description: parameter.description,
                            kind: parameter.kind,
                            multiple: parameter.multiple,
                            name: parameter.name,
                            required: parameter.required,
                            syntax: parameter.syntax,
                            valueType: parameter.valueType
                        })
                    )
                ),
                usageLines: Object.freeze([...rawEntry.usageLines])
            })
        );
    }

    return Object.freeze(validatedEntries);
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

async function probeConfiguredExternalGameMakerCliMcpServer(
    configuredServer: Readonly<{
        args: ReadonlyArray<string>;
        command: string;
        displayName: string;
        env: Readonly<Record<string, string>>;
    }>,
    projectPath: string | null,
    cwd: string,
    probeConfiguredMcpServer: (options: {
        args: ReadonlyArray<string>;
        command: string;
        cwd: string;
        displayName: string;
        env?: Readonly<Record<string, string>>;
        timeoutMs?: number;
    }) => Promise<StdioMcpServerProbeResult>
): Promise<GameMakerCliMcpProbeResult> {
    const hasProjectArgument =
        projectPath !== null &&
        (configuredServer.args.some((entry) => entry.toLowerCase().endsWith(".yyp")) ||
            configuredServer.args.some((entry) => path.resolve(cwd, entry) === projectPath));
    const args =
        projectPath === null || hasProjectArgument
            ? [...configuredServer.args]
            : [...configuredServer.args, projectPath];

    const probeResult = await probeConfiguredMcpServer({
        args,
        command: configuredServer.command,
        cwd,
        displayName: configuredServer.displayName,
        env: configuredServer.env
    });

    return Object.freeze({
        serverName: probeResult.serverName,
        serverVersion: probeResult.serverVersion,
        tools: probeResult.tools
    });
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
    return await probeStdioMcpServer({
        args: invocation.args,
        command: invocation.command,
        cwd: options.cwd,
        displayName: invocation.displayName
    });
}

async function resolveSingleProjectManifestPathOrNull(projectRoot: string | null): Promise<string | null> {
    if (projectRoot === null) {
        return null;
    }

    const entries = await Core.safeReaddirWithFileTypes(projectRoot);
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
        error: Core.getErrorMessage(error, { fallback: "Could not load gm-cli metadata." }),
        invocation,
        mcpServer: Object.freeze({
            available: false,
            error: "The official gm-cli is not available, so ResourceTool MCP metadata could not be loaded.",
            name: null,
            projectPath: null,
            serverId: null,
            sourcePath: null,
            version: null
        }),
        mcpTools: [],
        version
    });
}

function isMissingCommandError(error: unknown): error is NodeJS.ErrnoException {
    const like = error as { code?: unknown };
    return Core.isErrorLike(error) && like.code === "ENOENT";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Test-only access to the cache validation primitives. */
export const __gameMakerCliCatalogTest__ = Object.freeze({
    isValidCachedCompanionCatalogEntry,
    isValidCachedCompanionCatalogParameter,
    parseCachedCompanionCatalogCommands
});
