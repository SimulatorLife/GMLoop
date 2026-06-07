import { access, constants, readFile } from "node:fs/promises";
import path from "node:path";

type ConfiguredMcpServerEntry = {
    args: Array<string>;
    command: string | null;
    enabled: boolean;
    env: Record<string, string>;
    type: string | null;
};

export type ConfiguredGameMakerCliMcpServer = Readonly<{
    args: ReadonlyArray<string>;
    command: string;
    displayName: string;
    env: Readonly<Record<string, string>>;
    serverId: string;
    sourcePath: string;
}>;

/**
 * Discover a configured external gm-cli ResourceTool MCP server from local MCP
 * config files so the UI can inspect the actual server definition.
 */
export async function discoverConfiguredGameMakerCliMcpServer(
    projectRoot: string | null
): Promise<ConfiguredGameMakerCliMcpServer | null> {
    const candidatePaths = createMcpConfigurationCandidatePaths(projectRoot);
    const readableCandidates = await Promise.all(
        candidatePaths.map(async (candidatePath) => ({
            candidatePath,
            readable: await isReadableFile(candidatePath)
        }))
    );
    const readableCandidatePaths = readableCandidates
        .filter((entry) => entry.readable)
        .map((entry) => entry.candidatePath);
    const loadedServers = await Promise.all(
        readableCandidatePaths.map(
            async (candidatePath) => await loadConfiguredGameMakerCliMcpServerFromPath(candidatePath)
        )
    );

    for (const configuredServer of loadedServers) {
        if (configuredServer !== null) {
            return configuredServer;
        }
    }

    return null;
}

async function loadConfiguredGameMakerCliMcpServerFromPath(
    configurationPath: string
): Promise<ConfiguredGameMakerCliMcpServer | null> {
    const configurationText = await readFile(configurationPath, "utf8");
    const serverEntries =
        path.extname(configurationPath).toLowerCase() === ".json"
            ? parseJsonMcpServerEntries(configurationText)
            : parseCodexTomlMcpServerEntries(configurationText);

    for (const [serverId, serverEntry] of Object.entries(serverEntries)) {
        if (serverEntry.enabled === false || serverEntry.command === null) {
            continue;
        }

        if (!isGameMakerCliMcpCommand(serverEntry.command, serverEntry.args)) {
            continue;
        }

        const command = serverEntry.command;
        return Object.freeze({
            args: Object.freeze([...serverEntry.args]),
            command,
            displayName: [command, ...serverEntry.args].join(" ").trim(),
            env: Object.freeze({ ...serverEntry.env }),
            serverId,
            sourcePath: configurationPath
        });
    }

    return null;
}

function createMcpConfigurationCandidatePaths(projectRoot: string | null): ReadonlyArray<string> {
    const candidates = new Set<string>();
    const roots = [projectRoot, process.cwd()].filter((value): value is string => value !== null);

    for (const rootPath of roots) {
        candidates.add(path.join(rootPath, ".codex", "config.toml"));
        candidates.add(path.join(rootPath, ".mcp.json"));
        candidates.add(path.join(rootPath, "mcp.json"));
        candidates.add(path.join(rootPath, "docs", "examples", "example.mcp.json"));
    }

    return Object.freeze([...candidates]);
}

async function isReadableFile(filePath: string): Promise<boolean> {
    try {
        await access(filePath, constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

function parseJsonMcpServerEntries(configurationText: string): Record<string, ConfiguredMcpServerEntry> {
    const parsedValue = JSON.parse(configurationText) as unknown;
    if (!isRecord(parsedValue)) {
        return {};
    }

    const rawServers = isRecord(parsedValue.mcpServers) ? parsedValue.mcpServers : null;
    if (rawServers === null) {
        return {};
    }

    const servers: Record<string, ConfiguredMcpServerEntry> = {};
    for (const [serverId, rawServer] of Object.entries(rawServers)) {
        if (!isRecord(rawServer)) {
            continue;
        }

        const command = typeof rawServer.command === "string" ? rawServer.command.trim() : null;
        const args = Array.isArray(rawServer.args)
            ? rawServer.args.filter((entry): entry is string => typeof entry === "string")
            : [];
        const env = isRecord(rawServer.env)
            ? Object.fromEntries(
                  Object.entries(rawServer.env).filter(
                      (entry): entry is [string, string] => typeof entry[1] === "string"
                  )
              )
            : {};
        const type = typeof rawServer.type === "string" ? rawServer.type.trim() : null;
        const enabled = rawServer.enabled !== false;

        if (type !== null && type !== "stdio") {
            continue;
        }

        servers[serverId] = {
            args,
            command,
            enabled,
            env,
            type
        };
    }

    return servers;
}

function parseCodexTomlMcpServerEntries(configurationText: string): Record<string, ConfiguredMcpServerEntry> {
    const servers: Record<string, ConfiguredMcpServerEntry> = {};
    let activeServerId: string | null = null;
    let activeSection: "env" | "server" | null = null;

    for (const rawLine of configurationText.split(/\r?\n/u)) {
        const trimmedLine = stripTomlComment(rawLine).trim();
        if (trimmedLine.length === 0) {
            continue;
        }

        const sectionMatch = trimmedLine.match(/^\[\s*mcp_servers\.([A-Za-z0-9_-]+)(?:\.(env))?\s*\]$/u);
        if (sectionMatch !== null) {
            activeServerId = sectionMatch[1] ?? null;
            activeSection = sectionMatch[2] === "env" ? "env" : "server";
            if (activeServerId !== null && servers[activeServerId] === undefined) {
                servers[activeServerId] = {
                    args: [],
                    command: null,
                    enabled: true,
                    env: {},
                    type: null
                };
            }
            continue;
        }

        if (activeServerId === null || activeSection === null) {
            continue;
        }

        const entry = servers[activeServerId];
        if (entry === undefined) {
            continue;
        }

        const assignmentMatch = trimmedLine.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u);
        if (assignmentMatch === null) {
            continue;
        }

        const key = assignmentMatch[1] ?? "";
        const rawValue = assignmentMatch[2] ?? "";

        if (activeSection === "env") {
            const stringValue = parseTomlString(rawValue);
            if (stringValue !== null) {
                entry.env[key] = stringValue;
            }
            continue;
        }

        if (key === "args") {
            entry.args = parseTomlStringArray(rawValue);
            continue;
        }

        if (key === "command" || key === "type") {
            const stringValue = parseTomlString(rawValue);
            if (stringValue !== null) {
                entry[key] = stringValue;
            }
            continue;
        }

        if (key === "enabled") {
            const booleanValue = parseTomlBoolean(rawValue);
            if (booleanValue !== null) {
                entry.enabled = booleanValue;
            }
        }
    }

    return servers;
}

function stripTomlComment(line: string): string {
    let inString = false;
    let escaped = false;

    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === undefined) {
            break;
        }

        if (character === "\\" && inString) {
            escaped = !escaped;
            continue;
        }

        if (character === '"' && escaped === false) {
            inString = !inString;
            continue;
        }

        if (character === "#" && inString === false) {
            return line.slice(0, index);
        }

        escaped = false;
    }

    return line;
}

function parseTomlString(rawValue: string): string | null {
    const match = rawValue.trim().match(/^"((?:[^"\\]|\\.)*)"$/u);
    if (match === null) {
        return null;
    }

    return JSON.parse(`"${match[1] ?? ""}"`) as string;
}

function parseTomlStringArray(rawValue: string): Array<string> {
    const trimmedValue = rawValue.trim();
    const match = trimmedValue.match(/^\[(.*)\]$/u);
    if (match === null) {
        return [];
    }

    return [...(match[1] ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/gu)].map(
        (entry) => JSON.parse(`"${entry[1] ?? ""}"`) as string
    );
}

function parseTomlBoolean(rawValue: string): boolean | null {
    const normalizedValue = rawValue.trim();
    if (normalizedValue === "true") {
        return true;
    }

    if (normalizedValue === "false") {
        return false;
    }

    return null;
}

function isGameMakerCliMcpCommand(command: string, args: ReadonlyArray<string>): boolean {
    const normalizedCommand = path.basename(command).toLowerCase();

    if (normalizedCommand === "gm-cli" || normalizedCommand === "gm-cli.exe") {
        return args[0] === "resourcetool" && args[1] === "mcp";
    }

    if (normalizedCommand === "npx" || normalizedCommand === "npx.cmd") {
        return isPackagedGameMakerCliMcpCommand(args, 0);
    }

    if (normalizedCommand === "pnpm" || normalizedCommand === "pnpm.cmd") {
        return args[0] === "dlx" && isPackagedGameMakerCliMcpCommand(args, 1);
    }

    return false;
}

function isPackagedGameMakerCliMcpCommand(args: ReadonlyArray<string>, packageIndex: number): boolean {
    const packageSpecifier = args[packageIndex];
    return (
        typeof packageSpecifier === "string" &&
        packageSpecifier.startsWith("@gamemaker/gm-cli") &&
        args[packageIndex + 1] === "resourcetool" &&
        args[packageIndex + 2] === "mcp"
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && Array.isArray(value) === false;
}
