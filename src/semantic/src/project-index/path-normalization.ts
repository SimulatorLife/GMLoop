import path from "node:path";

import { Core } from "@gmloop/core";

import { isWin32Path, resolveProjectPathInfo } from "./path-info.js";

/**
 * Normalize a raw resource path into a POSIX-style path relative to the
 * current project root when available.
 *
 * @param {string | null | undefined} rawPath Path provided by the caller.
 * @param {{ projectRoot?: string | null }} [options]
 * @returns {string | null} Normalized resource path or `null` when the input is
 *          empty or outside the project tree.
 */
export function normalizeProjectResourcePath(
    rawPath: string | null | undefined,
    { projectRoot }: { projectRoot?: string | null } = {}
) {
    if (!Core.isNonEmptyString(rawPath)) {
        return null;
    }

    const normalized = Core.toPosixPath(rawPath).replace(/^\.\//, "");
    if (!projectRoot) {
        return normalized;
    }

    const useWin32 = isWin32Path(normalized) || isWin32Path(projectRoot);
    const pathApi = useWin32 ? path.win32 : path;
    const absoluteCandidate = pathApi.isAbsolute(normalized) ? normalized : pathApi.join(projectRoot, normalized);

    const info = resolveProjectPathInfo(absoluteCandidate, projectRoot);
    if (!info) {
        return null;
    }

    return Core.toPosixPath(info.relativePath);
}

/**
 * Resolve the path to {@link absoluteFilePath} relative to {@link projectRoot}
 * when the file resides inside the project directory tree.
 *
 * @param {string | null | undefined} projectRoot Root directory of the project.
 * @param {string | null | undefined} absoluteFilePath Absolute file path to
 *        normalize.
 * @returns {string | null} POSIX path relative to {@link projectRoot}, or the
 *          normalized absolute path when no relationship exists.
 */
export function resolveProjectRelativeFilePath(projectRoot, absoluteFilePath) {
    const info = resolveProjectPathInfo(absoluteFilePath, projectRoot);
    if (!info) {
        return null;
    }

    return Core.toPosixPath(info.hasProjectRoot ? info.relativePath : info.absolutePath);
}

/**
 * Format {@link filePath} for display within logs or diagnostics, collapsing
 * the path to a project-relative string when the file sits inside
 * {@link projectRoot}.
 *
 * @param {string | null | undefined} filePath Candidate path to display.
 * @param {string | null | undefined} projectRoot Root directory of the project
 *        used for relative resolution.
 * @returns {string | null} Display-friendly path or `null` when the input is
 *          missing.
 */
export function resolveProjectDisplayPath(filePath, projectRoot) {
    const normalizedFilePath = Core.getNonEmptyString(filePath);
    if (!normalizedFilePath) {
        return null;
    }

    const info = resolveProjectPathInfo(normalizedFilePath, projectRoot);
    if (!info) {
        return null;
    }

    if (!info.inputWasAbsolute || !info.hasProjectRoot || !info.isInsideProjectRoot) {
        return normalizedFilePath;
    }

    return info.relativePath || normalizedFilePath;
}
