import { Core } from "@gmloop/core";

const { isNonEmptyString, toArrayFromIterable, walkAncestorDirectories } = Core;

export interface CollectUniqueAncestorDirectoriesOptions {
    includeSelf?: boolean;
}

/**
 * Collect the unique ancestor directories for the provided starting
 * directories. Ancestors are returned in the order they were discovered so
 * callers can maintain deterministic search paths when probing for
 * configuration files.
 *
 * The helper previously lived in the shared path utilities even though the CLI
 * was the only consumer. Co-locating it with the rest of the CLI helpers keeps
 * the shared bundle focused on cross-environment primitives while preserving
 * the behaviour relied upon by the command surface.
 *
 * @param {Iterable<string | null | undefined>} startingDirectories Starting
 *        directories whose ancestors should be collected.
 * @param {{ includeSelf?: boolean }} [options]
 * @returns {Array<string>} Ordered list of unique ancestor directories.
 */
export function collectUniqueAncestorDirectories(
    startingDirectories: Iterable<string | null | undefined> | string,
    { includeSelf = true }: CollectUniqueAncestorDirectoriesOptions = {}
): Array<string> {
    const directories = new Set<string>();
    const entries =
        typeof startingDirectories === "string" ? [startingDirectories] : toArrayFromIterable(startingDirectories);

    for (const start of entries) {
        if (!isNonEmptyString(start)) {
            continue;
        }

        for (const directory of walkAncestorDirectories(start, {
            includeSelf
        })) {
            directories.add(directory);
        }
    }

    return Array.from(directories);
}
