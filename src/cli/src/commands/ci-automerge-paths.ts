import path from "node:path";
import process from "node:process";

/** Converts platform path separators to `/` so paths compare consistently across OSes. */
export function normalizePath(value: string): string {
    return value.split(path.sep).join("/");
}

/** Normalizes an absolute or repo-relative path to a repo-root-relative POSIX path. */
export function normalizeRepositoryPath(value: string): string {
    const normalized = normalizePath(value);
    const root = normalizePath(process.cwd()).replace(/\/$/u, "");
    if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
    const marker = "/GMLoop/";
    const markerIndex = normalized.lastIndexOf(marker);
    return markerIndex === -1 ? normalized.replace(/^\.\//u, "") : normalized.slice(markerIndex + marker.length);
}
