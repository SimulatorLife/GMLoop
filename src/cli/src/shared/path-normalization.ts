import process from "node:process";

import { Core } from "@gmloop/core";

const { toPosixPath } = Core;

/**
 * Convert an arbitrary separator-style path into a POSIX-style path.
 *
 * Both the GMLoop CI auto-merge pipeline and the CI report tooling used to
 * each ship their own private copies of this normalization helper, with
 * subtly different strategies (`replaceAll("\\", "/")` versus
 * `split(path.sep).join("/")`). The split-on-platform-separator variant is a
 * no-op on POSIX hosts, so cross-platform evidence paths rendered by
 * Windows-based runs would slip through unreplaced. The backslash replacement
 * variant handles both styles uniformly, which is what callers actually want.
 *
 * Centralizing the helper here removes that drift while delegating to
 * {@link Core.toPosixPath} so the conversion rule stays consistent with the
 * rest of the workspace.
 *
 * @param value Candidate path string.
 * @returns POSIX-style path string.
 */
export function normalizePath(value: string): string {
    return toPosixPath(value);
}

/**
 * Convert {@link value} into a POSIX path and trim the leading repository root
 * when the path lives underneath the current working directory.
 *
 * Used by the CI auto-merge and CI report commands to keep file paths inside
 * durable evidence compact and platform-independent. Paths that fall outside
 * the repository tree are normalized to POSIX form and stripped of any
 * leading `./` so the marker comparisons stay stable across hosts.
 *
 * @param value Candidate repository path string.
 * @returns POSIX-style path relative to the repository root when possible.
 */
export function normalizeRepositoryPath(value: string): string {
    const normalized = normalizePath(value);
    const root = normalizePath(process.cwd()).replace(/\/$/u, "");
    if (normalized.startsWith(`${root}/`)) {
        return normalized.slice(root.length + 1);
    }

    const marker = "/GMLoop/";
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex !== -1) {
        return normalized.slice(markerIndex + marker.length);
    }

    return normalized.replace(/^\.\//u, "");
}
