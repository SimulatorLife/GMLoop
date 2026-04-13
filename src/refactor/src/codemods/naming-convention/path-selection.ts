import path from "node:path";

import { Core } from "@gmloop/core";

function isPathInsideSelection(absoluteTargetPath: string, absoluteSelectionPath: string): boolean {
    return absoluteTargetPath === absoluteSelectionPath || Core.isPathInside(absoluteTargetPath, absoluteSelectionPath);
}

/**
 * Resolve a user-provided project path to an absolute path.
 * Relative paths are interpreted as being rooted at `projectRoot`.
 *
 * @param projectRoot - Project root used to resolve relative entries.
 * @param inputPath - Absolute or relative path.
 * @returns Absolute normalized path.
 */
export function resolveProjectPath(projectRoot: string, inputPath: string): string {
    return path.isAbsolute(inputPath) ? inputPath : path.resolve(projectRoot, inputPath);
}

/**
 * Compile allow/deny path lists into a reusable matcher for repeated candidate checks.
 *
 * The returned predicate caches resolved results by input path string so that
 * repeated checks for the same file path (common when many targets share the
 * same source file) pay the `path.resolve` cost at most once.
 *
 * @param projectRoot - Root path used to resolve relative entries.
 * @param allowedPaths - Optional allow list.
 * @param deniedPaths - Optional deny list.
 * @returns Predicate that reports whether a candidate path is selected.
 */
export function createPathSelectionMatcher(
    projectRoot: string,
    allowedPaths: ReadonlyArray<string>,
    deniedPaths: ReadonlyArray<string>
): (targetPath: string) => boolean {
    const absoluteAllowedPaths = allowedPaths.map((selectionPath) => resolveProjectPath(projectRoot, selectionPath));
    const absoluteDeniedPaths = deniedPaths.map((selectionPath) => resolveProjectPath(projectRoot, selectionPath));
    const resultCache = new Map<string, boolean>();

    return (targetPath: string): boolean => {
        const cached = resultCache.get(targetPath);
        if (cached !== undefined) {
            return cached;
        }

        const absoluteTargetPath = resolveProjectPath(projectRoot, targetPath);
        const isAllowed =
            absoluteAllowedPaths.length === 0 ||
            absoluteAllowedPaths.some((absoluteSelectionPath) =>
                isPathInsideSelection(absoluteTargetPath, absoluteSelectionPath)
            );
        if (!isAllowed) {
            resultCache.set(targetPath, false);
            return false;
        }

        const isDenied = absoluteDeniedPaths.some((absoluteSelectionPath) =>
            isPathInsideSelection(absoluteTargetPath, absoluteSelectionPath)
        );
        const result = !isDenied;
        resultCache.set(targetPath, result);
        return result;
    };
}

/**
 * Check whether a target path is selected by allow/deny path lists.
 *
 * Rules:
 * - Empty allow list means "allow everything".
 * - A path is allowed when it exactly matches an allow entry or is inside it.
 * - A denied path always wins over allow matches.
 *
 * @param projectRoot - Root path used to resolve relative entries.
 * @param targetPath - Path being checked.
 * @param allowedPaths - Optional allow list.
 * @param deniedPaths - Optional deny list.
 * @returns True when the path is selected by the allow/deny rules.
 */
export function isPathSelectedByLists(
    projectRoot: string,
    targetPath: string,
    allowedPaths: ReadonlyArray<string>,
    deniedPaths: ReadonlyArray<string>
): boolean {
    return createPathSelectionMatcher(projectRoot, allowedPaths, deniedPaths)(targetPath);
}
