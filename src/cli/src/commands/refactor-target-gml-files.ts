import path from "node:path";

import { Core } from "@gmloop/core";

import { isRefactorResourcePath } from "../modules/refactor/gml-resource-path.js";

type SemanticProjectIndex = {
    files?: Record<string, unknown>;
};

function listIndexedGmlFilePaths(projectIndex: unknown): Array<string> {
    if (!Core.isObjectLike(projectIndex)) {
        return [];
    }

    const files = (projectIndex as SemanticProjectIndex).files;
    if (!Core.isObjectLike(files)) {
        return [];
    }

    return Object.keys(files)
        .filter((filePath) => isRefactorResourcePath(filePath))
        .toSorted();
}

function allTargetsResolveToProjectRoot(projectRoot: string, targetPaths: ReadonlyArray<string>): boolean {
    const normalizedProjectRoot = path.resolve(projectRoot);
    return targetPaths.every((targetPath) => path.resolve(targetPath) === normalizedProjectRoot);
}

/**
 * Reuse semantic index file paths when codemods target the full project root.
 *
 * This avoids a second recursive disk walk immediately after `buildProjectIndex`
 * already discovered the same files.
 */
export function resolveIndexedRootTargetGmlFiles(
    projectRoot: string,
    targetPaths: ReadonlyArray<string>,
    projectIndex: unknown
): Array<string> | null {
    if (targetPaths.length === 0 || !allTargetsResolveToProjectRoot(projectRoot, targetPaths)) {
        return null;
    }

    const indexedGmlFilePaths = listIndexedGmlFilePaths(projectIndex);
    return indexedGmlFilePaths.length > 0 ? indexedGmlFilePaths : null;
}
