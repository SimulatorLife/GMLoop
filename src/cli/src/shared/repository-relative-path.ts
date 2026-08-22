import process from "node:process";

/**
 * Normalize a filesystem path to forward-slash separators.
 */
export function normalizeToForwardSlashes(value: string): string {
    return value.replaceAll("\\", "/");
}

/**
 * Convert an absolute or CWD-relative path into a path relative to the repository root.
 * Falls back to stripping a leading "./" if neither the current working directory nor a
 * "/GMLoop/" path segment can be located.
 */
export function normalizeRepositoryPath(value: string): string {
    const normalized = normalizeToForwardSlashes(value);
    const root = normalizeToForwardSlashes(process.cwd()).replace(/\/$/u, "");
    if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
    const marker = "/GMLoop/";
    const markerIndex = normalized.lastIndexOf(marker);
    return markerIndex === -1 ? normalized.replace(/^\.\//u, "") : normalized.slice(markerIndex + marker.length);
}
