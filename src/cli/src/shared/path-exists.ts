import fs from "node:fs";
import fsPromises from "node:fs/promises";

/**
 * Asynchronously check whether a path exists.
 *
 * This is the recommended modern equivalent for `fs.exists`, which Node.js
 * marked as deprecated in favor of `fs.stat`-based lookups that surface real
 * errors instead of silently returning `false` for permission problems or
 * other I/O issues. The predicate receives the resolved `fs.Stats` so callers
 * can chain the type check (file, directory, symlink) onto the same syscall
 * that confirmed existence, avoiding a TOCTOU race and a second stat call.
 *
 * @param filePath Absolute or relative path to inspect.
 * @param predicate Optional `fs.Stats` predicate that further qualifies the
 *   existence check. When omitted, any successful `stat` is treated as
 *   "exists".
 * @returns `true` when `stat` succeeds and the optional predicate passes;
 *   `false` for any error, including missing paths, broken symlinks, and
 *   insufficient permissions.
 */
export async function pathExists(
    filePath: string,
    predicate?: (stat: Awaited<ReturnType<typeof fsPromises.stat>>) => boolean
): Promise<boolean> {
    try {
        const stat = await fsPromises.stat(filePath);
        return predicate ? predicate(stat) : true;
    } catch {
        return false;
    }
}

/**
 * Synchronously check whether a path exists.
 *
 * This is the recommended modern equivalent for the deprecated
 * `fs.existsSync` API. Wrapping `fs.statSync` in a `try`/`catch` keeps
 * parity with the historical `fs.existsSync` contract (returns `false` for
 * missing or unreadable paths) while relying on the non-deprecated `stat`
 * primitive, which also exposes the `fs.Stats` payload through the optional
 * predicate for callers that need type information.
 *
 * @param filePath Absolute or relative path to inspect.
 * @param predicate Optional `fs.Stats` predicate that further qualifies the
 *   existence check. When omitted, any successful `stat` is treated as
 *   "exists".
 * @returns `true` when `stat` succeeds and the optional predicate passes;
 *   `false` for any error, including missing paths, broken symlinks, and
 *   insufficient permissions.
 */
export function pathExistsSync(
    filePath: string,
    predicate?: (stat: ReturnType<typeof fs.statSync>) => boolean
): boolean {
    try {
        const stat = fs.statSync(filePath);
        return predicate ? predicate(stat) : true;
    } catch {
        return false;
    }
}
