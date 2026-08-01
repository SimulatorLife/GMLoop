import type { Stats } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Semantic } from "@gmloop/semantic";

import { runSemanticIndexOperation } from "../modules/runtime/semantic-index-operation.js";
import { resolveFromRepoRoot } from "../shared/workspace-paths.js";

const { findProjectRoot } = Semantic;

export const ACTIVE_PROJECT_PATH_ENV_VAR = "GMLOOP_GM_CLI_PROJECT_PATH";
export const ACTIVE_PROJECT_STATE_PATH_ENV_VAR = "GMLOOP_GM_CLI_PROJECT_STATE_PATH";
export const DEFAULT_ACTIVE_PROJECT_STATE_PATH = resolveFromRepoRoot("tmp", "gm-cli-active-project.json");

/** Persisted project/file context shared by CLI, UI, and agent workflows. */
export type ActiveProjectState = Readonly<{
    activeFilePath?: string;
    projectPath: string;
}>;

/**
 * Minimal shared options type for CLI commands that need to resolve a project
 * root and load its configuration. Individual command option types are
 * structurally compatible with this type via TypeScript's structural subtyping.
 */
export type SharedProjectContextOptions = Readonly<{
    config?: string;
    databasePath?: string;
    force?: boolean;
    path?: string;
    toolsetRoot?: string;
}>;

/**
 * Normalize an explicit workflow target path supplied via `--path`.
 *
 * Accepts a `.gml` file, directory, or `.yyp` file path. `.yyp` inputs are
 * normalized to their enclosing directory so downstream file discovery can
 * operate on the project root directly.
 */
export function resolveExplicitWorkflowTargetPath(pathOption: string | undefined): string | null {
    if (!pathOption) {
        return null;
    }

    const trimmedPathOption = pathOption.trim();
    if (trimmedPathOption.length === 0) {
        return null;
    }

    const resolvedPath = path.resolve(trimmedPathOption);
    return resolvedPath.toLowerCase().endsWith(".yyp") ? path.dirname(resolvedPath) : resolvedPath;
}

function normalizeNonEmptyString(value: string | undefined): string | null {
    const trimmedValue = value?.trim();
    return trimmedValue && trimmedValue.length > 0 ? trimmedValue : null;
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

    const activeFilePath = Core.getNonEmptyTrimmedString(parsedState.activeFilePath);
    return Object.freeze(activeFilePath === null ? { projectPath } : { activeFilePath, projectPath });
}

/** Read the complete active project/file context from its shared state file. */
export async function readGameMakerCliActiveProjectState(parameters: {
    statePath: string;
}): Promise<ActiveProjectState | null> {
    const stats = await resolveFileStatsOrNull(parameters.statePath);
    if (stats === null) {
        return null;
    }
    if (!stats.isFile()) {
        throw new Error(`gm-cli active project state path is not a file: ${parameters.statePath}`);
    }

    return parseActiveProjectState(await readFile(parameters.statePath, "utf8"), parameters.statePath);
}

/** Read only the active GameMaker project path from shared state. */
export async function readGameMakerCliActiveProjectStateProjectPath(parameters: {
    statePath: string;
}): Promise<string | null> {
    const state = await readGameMakerCliActiveProjectState(parameters);
    return state?.projectPath ?? null;
}

/** Read only the active GML file path from shared state. */
export async function readGameMakerCliActiveProjectStateFilePath(parameters: {
    statePath: string;
}): Promise<string | null> {
    const state = await readGameMakerCliActiveProjectState(parameters);
    return state?.activeFilePath ?? null;
}

/** Persist the active GameMaker project and optional active GML file. */
export async function writeGameMakerCliActiveProjectState(parameters: {
    activeFilePath?: string;
    env: NodeJS.ProcessEnv;
    projectPath: string;
    statePathOption?: string;
}): Promise<{ activeFilePath?: string; projectPath: string; statePath: string }> {
    const statePath = resolveGameMakerCliActiveProjectStatePath({
        env: parameters.env,
        statePathOption: parameters.statePathOption
    });
    const projectPath = await resolveGameMakerProjectFilePath(parameters.projectPath);
    const normalizedActiveFilePath = normalizeNonEmptyString(parameters.activeFilePath);
    const activeFilePath = normalizedActiveFilePath === null ? null : path.resolve(normalizedActiveFilePath);
    const state: ActiveProjectState = activeFilePath === null ? { projectPath } : { activeFilePath, projectPath };

    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return activeFilePath === null ? { projectPath, statePath } : { activeFilePath, projectPath, statePath };
}

/**
 * Resolve the active project or file target without consulting the working
 * directory. Explicit command paths remain the caller's responsibility.
 */
export async function resolveGameMakerCliActiveTargetPath(parameters: {
    env: NodeJS.ProcessEnv;
    scope: "file" | "project";
    statePathOption?: string;
}): Promise<string | null> {
    const environmentProjectPath = normalizeNonEmptyString(parameters.env[ACTIVE_PROJECT_PATH_ENV_VAR]);
    if (environmentProjectPath !== null) {
        return path.resolve(environmentProjectPath);
    }

    const statePath = resolveGameMakerCliActiveProjectStatePath({
        env: parameters.env,
        statePathOption: parameters.statePathOption
    });
    const state = await readGameMakerCliActiveProjectState({ statePath });
    if (state === null) {
        return null;
    }

    const targetPath = parameters.scope === "file" ? (state.activeFilePath ?? state.projectPath) : state.projectPath;
    return path.resolve(targetPath);
}

/**
 * Resolve a command target using an explicit path, the active project/file
 * context, and finally a command-specific working-directory fallback.
 */
export async function resolveWorkflowTargetPath(parameters: {
    env?: NodeJS.ProcessEnv;
    explicitPath?: string;
    fallbackPath: string;
    scope: "file" | "project";
    statePathOption?: string;
}): Promise<string> {
    const explicitTargetPath = resolveExplicitWorkflowTargetPath(parameters.explicitPath);
    if (explicitTargetPath !== null) {
        return explicitTargetPath;
    }

    const activeTargetPath = await resolveGameMakerCliActiveTargetPath({
        env: parameters.env ?? process.env,
        scope: parameters.scope,
        statePathOption: parameters.statePathOption
    });
    return activeTargetPath ?? path.resolve(parameters.fallbackPath);
}

/**
 * Discover a GameMaker project root from explicit CLI inputs or the cwd.
 *
 * Resolution priority:
 * 1. `explicitProjectPath`
 * 2. `configPath`
 * 3. active project environment override or shared active-project state
 * 4. nearest `.yyp` discovered from the current working directory
 */
export async function discoverProjectRoot(parameters: {
    env?: NodeJS.ProcessEnv;
    explicitProjectPath?: string;
    configPath?: string;
    statePathOption?: string;
}): Promise<string> {
    const explicitTargetPath = resolveExplicitWorkflowTargetPath(parameters.explicitProjectPath);
    if (explicitTargetPath) {
        return await resolveProjectRootFromExplicitTargetPath(explicitTargetPath);
    }

    if (parameters.configPath) {
        return path.dirname(path.resolve(parameters.configPath));
    }

    const activeProjectPath = await resolveGameMakerCliActiveTargetPath({
        env: parameters.env ?? process.env,
        scope: "project",
        statePathOption: parameters.statePathOption
    });
    if (activeProjectPath !== null) {
        return await resolveProjectRootFromExplicitTargetPath(activeProjectPath);
    }

    const discoveredProjectRoot = await findProjectRoot({
        filepath: path.resolve(process.cwd(), "gmloop.json")
    });
    if (!discoveredProjectRoot) {
        throw new Error("Could not locate a GameMaker project root. Pass --path or run inside a project tree.");
    }

    return discoveredProjectRoot;
}

/**
 * Resolve a `gmloop.json` path and assert that it exists as a file.
 */
export async function resolveExistingGmloopConfigPath(
    projectRoot: string,
    configPathOption: string | undefined
): Promise<string> {
    const resolvedPath = configPathOption ? path.resolve(configPathOption) : path.resolve(projectRoot, "gmloop.json");
    const stats = await resolveFileStatsOrNull(resolvedPath);
    if (!stats || !stats.isFile()) {
        throw new Error(`Could not find gmloop config file at ${resolvedPath}`);
    }

    return resolvedPath;
}

/**
 * Shared project-context resolution used by command action handlers.
 *
 * Discovers the project root from the provided {@link options}, loads the
 * optional `gmloop.json` configuration (returning an empty object on failure),
 * and returns the resolved pair for downstream graph or refactor operations.
 *
 * Callers that previously held a private `resolveProjectContext`/
 * `resolveResourceContext`/`resolvePlannedSurfaceProjectContext` variant should
 * delegate here instead.
 *
 * @param options.config - Optional explicit config file path (passed via `--config`).
 * @param options.path   - Optional explicit project directory or GML file path (passed via `--path`).
 */
export async function resolveCommandProjectContext(options: {
    config?: string;
    path?: string;
    projectState?: string;
}): Promise<{ projectConfig: Record<string, unknown>; projectRoot: string }> {
    const projectRoot = await discoverProjectRoot({
        configPath: options.config,
        explicitProjectPath: options.path,
        statePathOption: options.projectState
    });
    const configPath = options.config ?? path.join(projectRoot, "gmloop.json");
    const loadedConfig = await Core.loadGmloopProjectConfig(configPath).catch(() => ({}));
    return {
        projectConfig: Core.isObjectLike(loadedConfig) ? loadedConfig : {},
        projectRoot
    };
}

/**
 * Build or refresh the semantic graph index and return the resolved project
 * context. Passes `rebuild: true` to the index builder when the caller's
 * `--force` flag is set.
 *
 * @param {SharedProjectContextOptions} options CLI option bag. `force` triggers
 *        a full graph rebuild.
 * @returns {{ projectConfig: Record<string, unknown>, projectRoot: string }}
 *          Resolved project context.
 */
export async function ensureProjectGraphIndex(options: SharedProjectContextOptions): Promise<{
    projectConfig: Record<string, unknown>;
    projectRoot: string;
}> {
    const context = await resolveCommandProjectContext(options);
    await runSemanticIndexOperation(context.projectRoot, (onProgress) =>
        Semantic.buildGraphIndex({
            databasePath: options.databasePath,
            onProgress,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            rebuild: options.force === true,
            toolsetRoot: options.toolsetRoot
        })
    );
    return context;
}

/**
 * Filter a graph index search result set to entries of a single resource kind.
 *
 * Eliminates the repeated `.results.filter((entry) => entry.kind === "X")`
 * pattern that appeared across room.ts, object.ts, and validate.ts.
 *
 * @param results  Raw search results from Semantic.searchGraphIndex.
 * @param kind     The resource kind to keep (e.g. "room", "object").
 * @returns Filtered array containing only entries of the requested kind.
 */
export function filterGraphIndexResultsByKind<T extends { kind: string }>(results: readonly T[], kind: string): T[] {
    return results.filter((entry) => entry.kind === kind);
}

/**
 * Serialize a command result payload as pretty-printed JSON and write it to
 * stdout. All graph-backed commands use this single consistent format so that
 * machine consumers and MCP clients can rely on a stable output shape.
 *
 * @param {unknown} payload Serializable value to emit.
 */
export function printProjectPayload(payload: unknown): void {
    console.log(JSON.stringify(payload, null, 2));
}

async function resolveFileStatsOrNull(filePath: string): Promise<Stats | null> {
    try {
        return await stat(filePath);
    } catch {
        return null;
    }
}

async function resolveProjectRootFromExplicitTargetPath(explicitTargetPath: string): Promise<string> {
    const explicitTargetStats = await resolveFileStatsOrNull(explicitTargetPath);
    if (explicitTargetStats === null) {
        throw new Error(`GameMaker project target path does not exist: ${explicitTargetPath}`);
    }

    if (explicitTargetStats.isFile()) {
        const discoveredProjectRoot = await findProjectRoot({
            filepath: explicitTargetPath
        });

        return discoveredProjectRoot ?? path.dirname(explicitTargetPath);
    }

    return explicitTargetPath;
}
