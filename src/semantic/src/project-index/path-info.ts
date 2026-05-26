import path from "node:path";

import { Core } from "@gmloop/core";

const PARENT_SEGMENT_PATTERN = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

function resolveContainedRelativePathWithPath(
    pathApi: typeof path,
    childPath: string,
    parentPath: string
): string | null {
    const relative = pathApi.relative(parentPath, childPath);

    if (relative === "") {
        return "";
    }

    if (PARENT_SEGMENT_PATTERN.test(relative) || pathApi.isAbsolute(relative)) {
        return null;
    }

    return relative;
}

/**
 * Resolve high-level metadata about how {@link filePath} relates to
 * {@link projectRoot}.
 *
 * The helper is specific to the project index and identifier-case workflows,
 * normalizing absolute/relative paths alongside containment checks. Keeping it
 * within the project-index module avoids leaking formatter-specific semantics
 * into the shared path utilities.
 *
 * @param {string | null | undefined} filePath Candidate file path to
 *        normalize.
 * @param {string | null | undefined} projectRoot Optional project root used
 *        when computing relative paths.
 * @returns {{
 *   absolutePath: string,
 *   hasProjectRoot: boolean,
 *   inputWasAbsolute: boolean,
 *   isInsideProjectRoot: boolean,
 *   projectRoot: string | null,
 *   relativePath: string
 * } | null}
 */
export function resolveProjectPathInfo(filePath, projectRoot?: string | null) {
    if (!Core.isNonEmptyString(filePath)) {
        return null;
    }

    const useWin32 = Core.isWin32Path(filePath) || Core.isWin32Path(projectRoot);
    const pathApi = useWin32 ? path.win32 : path;

    const absolutePath = pathApi.resolve(filePath);
    const inputWasAbsolute = pathApi.isAbsolute(filePath);

    if (!Core.isNonEmptyString(projectRoot)) {
        return {
            absolutePath,
            hasProjectRoot: false,
            inputWasAbsolute,
            isInsideProjectRoot: false,
            projectRoot: null,
            relativePath: absolutePath
        };
    }

    const absoluteProjectRoot = pathApi.resolve(projectRoot);
    const containedRelative = resolveContainedRelativePathWithPath(pathApi, absolutePath, absoluteProjectRoot);
    const isInsideProjectRoot = containedRelative !== null;

    return {
        absolutePath,
        hasProjectRoot: true,
        inputWasAbsolute,
        isInsideProjectRoot,
        projectRoot: absoluteProjectRoot,
        relativePath: isInsideProjectRoot ? containedRelative : pathApi.relative(absoluteProjectRoot, absolutePath)
    };
}
