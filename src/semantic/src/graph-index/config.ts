import path from "node:path";

import { Core } from "@gmloop/core";

import type { GraphEmbeddingsConfig, GraphIndexBuildOptions, GraphIndexConfig } from "./types.js";

const DEFAULT_GRAPH_DIRECTORY_NAME = ".gmloop";
const DEFAULT_GRAPH_DATABASE_NAME = "graph-index.sqlite";
const DEFAULT_EMBEDDING_PROVIDER = "local-mini-lm";
const DEFAULT_EMBEDDING_DIMENSIONS = 64;
const DEFAULT_MODEL_CACHE_DIRECTORY = "models";

function getGraphConfigSection(projectConfig: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!Core.isObjectLike(projectConfig?.graph)) {
        return {};
    }

    return projectConfig.graph as Record<string, unknown>;
}

function getEmbeddingConfigSection(graphConfig: Record<string, unknown>): Record<string, unknown> {
    if (!Core.isObjectLike(graphConfig.embeddings)) {
        return {};
    }

    return graphConfig.embeddings as Record<string, unknown>;
}

function resolveProjectRelativePath(projectRoot: string, candidatePath: string): string {
    return path.isAbsolute(candidatePath) ? path.resolve(candidatePath) : path.resolve(projectRoot, candidatePath);
}

/**
 * Resolve the graph-index runtime configuration from explicit options and an
 * optional `gmloop.json` payload.
 */
export function resolveGraphIndexConfig({
    databasePath,
    projectConfig = null,
    projectRoot,
    toolsetRoot = null
}: GraphIndexBuildOptions): GraphIndexConfig {
    const resolvedProjectRoot = path.resolve(projectRoot);
    const graphConfig = getGraphConfigSection(projectConfig);
    const embeddingConfig = getEmbeddingConfigSection(graphConfig);
    const configuredToolsetRoot = Core.getNonEmptyTrimmedString(toolsetRoot ?? graphConfig.toolsetRoot);
    const graphDirectory = path.join(resolvedProjectRoot, DEFAULT_GRAPH_DIRECTORY_NAME);
    const configuredDatabasePath =
        databasePath ??
        Core.getNonEmptyTrimmedString(graphConfig.databasePath) ??
        path.join(graphDirectory, DEFAULT_GRAPH_DATABASE_NAME);
    const configuredModelCacheDir =
        Core.getNonEmptyTrimmedString(embeddingConfig.modelCacheDir) ??
        path.join(graphDirectory, DEFAULT_MODEL_CACHE_DIRECTORY);
    const embeddings: GraphEmbeddingsConfig = Object.freeze({
        dimensions: Core.toFiniteNumber(embeddingConfig.dimensions) ?? DEFAULT_EMBEDDING_DIMENSIONS,
        enabled: embeddingConfig.enabled !== false,
        modelCacheDir: resolveProjectRelativePath(resolvedProjectRoot, configuredModelCacheDir),
        provider: Core.getNonEmptyTrimmedString(embeddingConfig.provider) ?? DEFAULT_EMBEDDING_PROVIDER
    });

    return Object.freeze({
        databasePath: resolveProjectRelativePath(resolvedProjectRoot, configuredDatabasePath),
        embeddings,
        projectRoot: resolvedProjectRoot,
        toolsetRoot: configuredToolsetRoot ? path.resolve(resolvedProjectRoot, configuredToolsetRoot) : null
    });
}
