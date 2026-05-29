import path from "node:path";

import { Core } from "@gmloop/core";

/**
 * Resolve a user-provided project path to an absolute path.
 * Relative paths are interpreted as being rooted at `projectRoot`.
 *
 * @param projectRoot - Project root used to resolve relative entries.
 * @param inputPath - Absolute or relative path.
 * @returns Absolute normalized path.
 */
export function resolveProjectPath(projectRoot: string, inputPath: string): string {
    if (Core.isPortableAbsolutePath(inputPath)) {
        return Core.resolvePortableAbsolutePath(inputPath);
    }

    return Core.resolvePortableAbsolutePath(path.join(projectRoot, inputPath));
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
                Core.isPathWithinBoundary(absoluteTargetPath, absoluteSelectionPath)
            );
        if (!isAllowed) {
            resultCache.set(targetPath, false);
            return false;
        }

        const isDenied = absoluteDeniedPaths.some((absoluteSelectionPath) =>
            Core.isPathWithinBoundary(absoluteTargetPath, absoluteSelectionPath)
        );
        const result = !isDenied;
        resultCache.set(targetPath, result);
        return result;
    };
}
