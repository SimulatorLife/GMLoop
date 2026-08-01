import { readdir } from "node:fs/promises";
import path from "node:path";

import { toPosixPath } from "./path.js";

export type RelativeFilePathPredicate = (parameters: {
    absolutePath: string;
    entryName: string;
    relativePath: string;
}) => boolean | Promise<boolean>;

export type RelativeDirectoryPathPredicate = RelativeFilePathPredicate;

/**
 * Recursively collect file paths beneath {@link rootPath}, returning stable
 * POSIX-style relative paths suitable for cross-platform fixtures and test
 * assertions.
 *
 * Callers may provide an optional predicate to keep only the files relevant to
 * their workflow while reusing the shared traversal and path-normalization
 * logic. Results are always sorted lexicographically to avoid leaking
 * filesystem iteration order into higher-level behavior.
 *
 * @param {string} rootPath Directory tree to scan.
 * @param {{ includeFile?: RelativeFilePathPredicate, shouldEnterDirectory?: RelativeDirectoryPathPredicate }} [options]
 * @param {RelativeFilePathPredicate} [options.includeFile] Optional filter that
 *        receives each discovered file before it is added to the result.
 * @param {RelativeDirectoryPathPredicate} [options.shouldEnterDirectory]
 *        Optional filter that receives each discovered directory before the
 *        traversal descends into it.
 * @returns {Promise<Array<string>>} Sorted relative file paths using `/`
 *          separators on every platform.
 */
export async function listRelativeFilePathsRecursively(
    rootPath: string,
    options: {
        includeFile?: RelativeFilePathPredicate;
        shouldEnterDirectory?: RelativeDirectoryPathPredicate;
    } = {}
): Promise<Array<string>> {
    const relativePaths: Array<string> = [];

    async function walk(currentPath: string): Promise<void> {
        const directoryEntries = await readdir(currentPath, { withFileTypes: true });

        await Promise.all(
            directoryEntries.map(async (entry) => {
                const entryPath = path.join(currentPath, entry.name);
                const relativePath = toPosixPath(path.relative(rootPath, entryPath));
                if (entry.isDirectory()) {
                    if (
                        (await options.shouldEnterDirectory?.({
                            absolutePath: entryPath,
                            entryName: entry.name,
                            relativePath
                        })) === false
                    ) {
                        return;
                    }

                    await walk(entryPath);
                    return;
                }

                if (!entry.isFile()) {
                    return;
                }

                if (
                    (await options.includeFile?.({ absolutePath: entryPath, entryName: entry.name, relativePath })) ===
                    false
                ) {
                    return;
                }

                relativePaths.push(relativePath);
            })
        );
    }

    await walk(rootPath);
    return relativePaths.toSorted((left, right) => left.localeCompare(right));
}
