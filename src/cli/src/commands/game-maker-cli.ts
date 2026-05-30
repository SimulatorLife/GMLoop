import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { excludeCommandFromMcpTools } from "../cli-core/mcp-command-exclusion.js";
import { resolveFromRepoRoot } from "../shared/workspace-paths.js";

const ACTIVE_PROJECT_PATH_ENV_VAR = "GMLOOP_GM_CLI_PROJECT_PATH";
const ACTIVE_PROJECT_STATE_PATH_ENV_VAR = "GMLOOP_GM_CLI_PROJECT_STATE_PATH";
const DEFAULT_ACTIVE_PROJECT_STATE_PATH = resolveFromRepoRoot("tmp", "gm-cli-active-project.json");
const DEFAULT_GM_CLI_CACHE_DIR = resolveFromRepoRoot("tmp", "gm-cli-cache");
const DEFAULT_GM_CLI_NPM_CACHE_DIR = resolveFromRepoRoot("tmp", "gm-cli-npm-cache");

type GameMakerCliCommandEnvironment = Readonly<{
    env: NodeJS.ProcessEnv;
}>;

type ActiveProjectState = Readonly<{
    projectPath: string;
}>;

type GameMakerCliMcpCommandOptions = Readonly<{
    cacheDir?: string;
    npmCacheDir?: string;
    path?: string;
    projectState?: string;
}>;

type GameMakerCliActiveProjectSetOptions = Readonly<{
    projectState?: string;
}>;

function normalizeNonEmptyString(value: string | undefined): string | null {
    const trimmedValue = value?.trim();
    return trimmedValue && trimmedValue.length > 0 ? trimmedValue : null;
}

async function resolveFileStatsOrNull(filePath: string) {
    try {
        return await stat(filePath);
    } catch {
        return null;
    }
}

async function resolveSingleProjectFileFromDirectory(directoryPath: string): Promise<string> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const projectFiles = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".yyp"))
        .map((entry) => path.join(directoryPath, entry.name))
        .sort((left, right) => left.localeCompare(right));

    if (projectFiles.length === 1) {
        return projectFiles[0] ?? directoryPath;
    }

    if (projectFiles.length === 0) {
        throw new Error(`Could not find a .yyp project file in '${directoryPath}'.`);
    }

    throw new Error(`Found multiple .yyp project files in '${directoryPath}'. Pass an explicit .yyp path.`);
}

/**
 * Resolve a GameMaker project path from either a `.yyp` file or a directory
 * containing exactly one `.yyp` file.
 */
export async function resolveGameMakerProjectFilePath(targetPath: string): Promise<string> {
    const resolvedPath = path.resolve(targetPath);
    const stats = await resolveFileStatsOrNull(resolvedPath);
    if (stats === null) {
        throw new Error(`GameMaker project path does not exist: ${resolvedPath}`);
    }

    if (stats.isDirectory()) {
        return await resolveSingleProjectFileFromDirectory(resolvedPath);
    }

    if (stats.isFile() && resolvedPath.toLowerCase().endsWith(".yyp")) {
        return resolvedPath;
    }

    throw new Error(
        `GameMaker project path must be a .yyp file or directory containing one .yyp file: ${resolvedPath}`
    );
}

/**
 * Resolve the JSON state file shared by `gmloop gm-cli active-project` and
 * long-running GMLoop UI hosts.
 */
export function resolveGameMakerCliActiveProjectStatePath(parameters: {
    env: NodeJS.ProcessEnv;
    statePathOption?: string;
}): string {
    return path.resolve(
        normalizeNonEmptyString(parameters.statePathOption) ??
            normalizeNonEmptyString(parameters.env[ACTIVE_PROJECT_STATE_PATH_ENV_VAR]) ??
            DEFAULT_ACTIVE_PROJECT_STATE_PATH
    );
}

function parseActiveProjectState(contents: string, statePath: string): ActiveProjectState {
    const parsedState = Core.parseJsonObjectWithContext(contents, {
        source: statePath,
        description: "gm-cli active project state"
    });
    const projectPath = Core.getNonEmptyTrimmedString(parsedState.projectPath);
    if (projectPath === null) {
        throw new TypeError(`gm-cli active project state at ${statePath} must define a non-empty projectPath.`);
    }

    return Object.freeze({ projectPath });
}

/**
 * Read the active GameMaker project path from a gm-cli active-project state file.
 */
export async function readGameMakerCliActiveProjectStateProjectPath(parameters: {
    statePath: string;
}): Promise<string | null> {
    const stats = await resolveFileStatsOrNull(parameters.statePath);
    if (stats === null) {
        return null;
    }
    if (!stats.isFile()) {
        throw new Error(`gm-cli active project state path is not a file: ${parameters.statePath}`);
    }

    const state = parseActiveProjectState(await readFile(parameters.statePath, "utf8"), parameters.statePath);
    return state.projectPath;
}

/**
 * Resolve the project path used by the official gm-cli ResourceTool MCP server.
 *
 * Resolution order:
 * 1. explicit CLI `--path`
 * 2. `GMLOOP_GM_CLI_PROJECT_PATH`
 * 3. active-project state file
 * 4. current working directory when it contains exactly one `.yyp`
 */
export async function resolveGameMakerCliMcpProjectPath(parameters: {
    env: NodeJS.ProcessEnv;
    pathOption?: string;
    statePathOption?: string;
}): Promise<string> {
    const statePath = resolveGameMakerCliActiveProjectStatePath({
        env: parameters.env,
        statePathOption: parameters.statePathOption
    });
    const candidatePath =
        normalizeNonEmptyString(parameters.pathOption) ??
        normalizeNonEmptyString(parameters.env[ACTIVE_PROJECT_PATH_ENV_VAR]) ??
        (await readGameMakerCliActiveProjectStateProjectPath({ statePath })) ??
        process.cwd();

    return await resolveGameMakerProjectFilePath(candidatePath);
}

/**
 * Persist the active GameMaker project path used by `gmloop gm-cli mcp`.
 */
export async function writeGameMakerCliActiveProjectState(parameters: {
    env: NodeJS.ProcessEnv;
    projectPath: string;
    statePathOption?: string;
}): Promise<{ projectPath: string; statePath: string }> {
    const statePath = resolveGameMakerCliActiveProjectStatePath({
        env: parameters.env,
        statePathOption: parameters.statePathOption
    });
    const projectPath = await resolveGameMakerProjectFilePath(parameters.projectPath);
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify({ projectPath }, null, 2)}\n`, "utf8");
    return { projectPath, statePath };
}

async function runGameMakerCliMcpSubprocess(options: {
    cacheDir: string;
    env: NodeJS.ProcessEnv;
    npmCacheDir: string;
    projectPath: string;
}): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const childProcess = spawn(
            "npx",
            [
                "--yes",
                "@gamemaker/gm-cli@latest",
                "resourcetool",
                "mcp",
                "--cache-dir",
                options.cacheDir,
                options.projectPath
            ],
            {
                env: {
                    ...process.env,
                    ...options.env,
                    CI: "true",
                    GAMEMAKER_CLI_CACHE_DIR: options.cacheDir,
                    NPM_CONFIG_CACHE: options.npmCacheDir,
                    npm_config_cache: options.npmCacheDir
                },
                stdio: "inherit"
            }
        );

        childProcess.once("error", reject);
        childProcess.once("exit", (code, signal) => {
            if (typeof code === "number" && code === 0) {
                resolve();
                return;
            }

            if (signal) {
                reject(new Error(`gm-cli ResourceTool MCP server stopped by signal ${signal}.`));
                return;
            }

            reject(new Error(`gm-cli ResourceTool MCP server exited with code ${String(code)}.`));
        });
    });
}

/**
 * Create the `gmloop gm-cli` command group for official GameMaker CLI integration.
 */
export function createGameMakerCliCommand({
    env = process.env
}: Partial<GameMakerCliCommandEnvironment> = {}): Command {
    const command = applyStandardCommandOptions(new Command("gm-cli")).description(
        "Manage official GameMaker CLI integration helpers."
    );

    command
        .command("mcp")
        .description("Start the official gm-cli ResourceTool MCP server for the active GameMaker project.")
        .option("--path <path>", "GameMaker .yyp file or project directory.")
        .option("--project-state <path>", "Active-project state file written by GMLoop UI.")
        .option("--cache-dir <path>", "gm-cli cache directory.", DEFAULT_GM_CLI_CACHE_DIR)
        .option("--npm-cache-dir <path>", "npm cache directory for npx.", DEFAULT_GM_CLI_NPM_CACHE_DIR)
        .addHelpText("after", () =>
            [
                "",
                "Project path resolution:",
                `  1. --path`,
                `  2. ${ACTIVE_PROJECT_PATH_ENV_VAR}`,
                `  3. ${ACTIVE_PROJECT_STATE_PATH_ENV_VAR} or ${DEFAULT_ACTIVE_PROJECT_STATE_PATH}`,
                "  4. current working directory"
            ].join("\n")
        )
        .action(async (options: GameMakerCliMcpCommandOptions) => {
            const projectPath = await resolveGameMakerCliMcpProjectPath({
                env,
                pathOption: options.path,
                statePathOption: options.projectState
            });
            await runGameMakerCliMcpSubprocess({
                cacheDir: path.resolve(options.cacheDir ?? DEFAULT_GM_CLI_CACHE_DIR),
                env,
                npmCacheDir: path.resolve(options.npmCacheDir ?? DEFAULT_GM_CLI_NPM_CACHE_DIR),
                projectPath
            });
        });

    const activeProjectCommand = command.command("active-project").description("Manage the gm-cli MCP active project.");

    activeProjectCommand
        .command("set")
        .description("Set the active GameMaker project used by `gmloop gm-cli mcp`.")
        .argument("<path>", "GameMaker .yyp file or project directory.")
        .option("--project-state <path>", "Active-project state file written by GMLoop UI.")
        .action(async (projectPath: string, options: GameMakerCliActiveProjectSetOptions) => {
            const result = await writeGameMakerCliActiveProjectState({
                env,
                projectPath,
                statePathOption: options.projectState
            });
            console.log(JSON.stringify(result, null, 2));
        });

    return excludeCommandFromMcpTools(command);
}
