import { spawn } from "node:child_process";
import path from "node:path";

import { Command } from "commander";

import type { CliCatalogEntry } from "../cli-core/command-catalog.js";
import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { excludeCommandFromMcpTools } from "../cli-core/mcp-command-exclusion.js";
import type { McpToolCatalogEntry } from "../cli-core/mcp-tool-catalog.js";
import {
    createGameMakerCapabilityBoundaryAudit,
    loadGameMakerCliCompanionCatalog
} from "../modules/game-maker-cli/index.js";
import { resolveFromRepoRoot } from "../shared/workspace-paths.js";
import {
    ACTIVE_PROJECT_PATH_ENV_VAR,
    ACTIVE_PROJECT_STATE_PATH_ENV_VAR,
    DEFAULT_ACTIVE_PROJECT_STATE_PATH,
    printProjectPayload,
    resolveExplicitWorkflowTargetPath,
    resolveGameMakerCliActiveTargetPath,
    resolveGameMakerProjectFilePath,
    writeGameMakerCliActiveProjectState
} from "../workflow/project-root.js";

const DEFAULT_GM_CLI_CACHE_DIR = resolveFromRepoRoot("tmp", "gm-cli-cache");
const DEFAULT_GM_CLI_NPM_CACHE_DIR = resolveFromRepoRoot("tmp", "gm-cli-npm-cache");

type GameMakerCliCommandEnvironment = Readonly<{
    env: NodeJS.ProcessEnv;
}>;

type GameMakerCliMcpCommandOptions = Readonly<{
    cacheDir?: string;
    npmCacheDir?: string;
    path?: string;
    projectState?: string;
}>;

type GameMakerCliCapabilityAuditOptions = Readonly<{
    json?: boolean;
    path?: string;
    toolPath?: string;
}>;

type GameMakerCliActiveProjectSetOptions = Readonly<{
    projectState?: string;
}>;

type GameMakerCliCommandDependencies = Readonly<{
    getCliCommandCatalog: () => ReadonlyArray<CliCatalogEntry>;
    getMcpToolCatalogEntries: () => ReadonlyArray<McpToolCatalogEntry>;
}>;

function createEmptyCliCatalog(): ReadonlyArray<CliCatalogEntry> {
    return Object.freeze([]);
}

function createEmptyMcpToolCatalog(): ReadonlyArray<McpToolCatalogEntry> {
    return Object.freeze([]);
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
    const explicitPath = parameters.pathOption?.trim();
    const candidatePath =
        (explicitPath && explicitPath.length > 0 ? explicitPath : null) ??
        (await resolveGameMakerCliActiveTargetPath({
            env: parameters.env,
            scope: "project",
            statePathOption: parameters.statePathOption
        })) ??
        process.cwd();

    return await resolveGameMakerProjectFilePath(candidatePath);
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
    env = process.env,
    getCliCommandCatalog = createEmptyCliCatalog,
    getMcpToolCatalogEntries = createEmptyMcpToolCatalog
}: Partial<GameMakerCliCommandEnvironment & GameMakerCliCommandDependencies> = {}): Command {
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

    command
        .command("capability-audit")
        .description("Compare GMLoop companion commands with the official gm-cli and ResourceTool MCP catalog.")
        .option("--path <path>", "GameMaker .yyp file or project directory used for ResourceTool MCP discovery.")
        .option("--tool-path <path>", "Explicit gm-cli executable path.")
        .option("--json", "Emit JSON output.")
        .action(async (options: GameMakerCliCapabilityAuditOptions) => {
            const projectRoot = resolveExplicitWorkflowTargetPath(options.path);
            const companionCatalog = await loadGameMakerCliCompanionCatalog({
                projectRoot,
                toolPath: options.toolPath ?? null
            });
            const audit = createGameMakerCapabilityBoundaryAudit({
                cliCatalog: getCliCommandCatalog(),
                companionCatalog,
                mcpCatalog: getMcpToolCatalogEntries()
            });
            printProjectPayload({
                ok: true,
                payload: audit
            });
        });

    return excludeCommandFromMcpTools(command);
}
