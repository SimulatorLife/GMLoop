import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { Semantic } from "@gmloop/semantic";

const { findProjectRoot } = Semantic;

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

/**
 * Discover a GameMaker project root from explicit CLI inputs or the cwd.
 *
 * Resolution priority:
 * 1. `explicitProjectPath`
 * 2. `configPath`
 * 3. nearest `.yyp` discovered from the current working directory
 */
export async function discoverProjectRoot(parameters: {
    explicitProjectPath?: string;
    configPath?: string;
}): Promise<string> {
    const explicitTargetPath = resolveExplicitWorkflowTargetPath(parameters.explicitProjectPath);
    if (explicitTargetPath) {
        return await resolveProjectRootFromExplicitTargetPath(explicitTargetPath);
    }

    if (parameters.configPath) {
        return path.dirname(path.resolve(parameters.configPath));
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

async function resolveFileStatsOrNull(filePath: string): Promise<Stats | null> {
    try {
        return await stat(filePath);
    } catch {
        return null;
    }
}

async function resolveProjectRootFromExplicitTargetPath(explicitTargetPath: string): Promise<string> {
    const explicitTargetStats = await resolveFileStatsOrNull(explicitTargetPath);
    if (explicitTargetStats?.isFile()) {
        const discoveredProjectRoot = await findProjectRoot({
            filepath: explicitTargetPath
        });

        return discoveredProjectRoot ?? path.dirname(explicitTargetPath);
    }

    return explicitTargetPath;
}
