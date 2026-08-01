import path from "node:path";

import { listRelativeFilePathsRecursively } from "../fs/list-relative-file-paths-recursively.js";
import { DEFAULT_PROJECT_EXCLUDES } from "./project-excludes.js";

const EXCLUDED_DIRECTORY_NAMES = new Set(DEFAULT_PROJECT_EXCLUDES.directoryNames);
const GML_FILE_EXTENSION = ".gml";

/**
 * Recursively collect absolute `.gml` file paths beneath {@link rootPath},
 * skipping the shared {@link DEFAULT_PROJECT_EXCLUDES} directory names (such
 * as `node_modules`, `.git`, and `dist`).
 *
 * @param rootPath Directory tree to scan.
 * @returns Sorted absolute paths to every discovered `.gml` file.
 */
export async function listProjectGmlFilePaths(rootPath: string): Promise<ReadonlyArray<string>> {
    const relativeFilePaths = await listRelativeFilePathsRecursively(rootPath, {
        shouldEnterDirectory: ({ entryName }) => !EXCLUDED_DIRECTORY_NAMES.has(entryName),
        includeFile: ({ entryName }) => entryName.toLowerCase().endsWith(GML_FILE_EXTENSION)
    });

    return Object.freeze(relativeFilePaths.map((relativeFilePath) => path.join(rootPath, relativeFilePath)));
}
