import { promises as fs } from "node:fs";

import { Core } from "@gmloop/core";

export type ProjectIndexFsFacade = {
    readFile?: (...args: any[]) => Promise<any>;
    writeFile?: (...args: any[]) => Promise<any>;
    rename?: (...args: any[]) => Promise<any>;
    unlink?: (...args: any[]) => Promise<any>;
    mkdir?: (...args: any[]) => Promise<any>;
    stat?: (...args: any[]) => Promise<{ mtimeMs?: number } | null>;
    readDir?: (path: string) => Promise<Iterable<string>>;
};

export const defaultFsFacade: Required<ProjectIndexFsFacade> = {
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    rename: fs.rename,
    unlink: fs.unlink,
    mkdir: fs.mkdir,
    stat: fs.stat,
    readDir: fs.readdir
};

/**
 * Run an async filesystem operation and recover only from missing-path errors
 * (`ENOENT`). All non-missing-path failures are rethrown so callers preserve
 * existing error semantics while keeping ENOENT fallback handling centralized.
 */
export async function runWithMissingPathFallback<TResult>(
    operation: () => Promise<TResult>,
    onMissingPath: () => TResult
): Promise<TResult> {
    try {
        return await operation();
    } catch (error) {
        if (!Core.isErrorWithCode(error, "ENOENT")) {
            throw error;
        }

        return onMissingPath();
    }
}
