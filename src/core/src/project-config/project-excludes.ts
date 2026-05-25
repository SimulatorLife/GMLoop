import { toPosixPath } from "../fs/path.js";

export interface ProjectExcludeRules {
    directoryNames?: ReadonlyArray<string>;
    fileNames?: ReadonlyArray<string>;
    relativePaths?: ReadonlyArray<string>;
    extensions?: ReadonlyArray<string>;
}

/**
 * Default exclusions for project-wide operations, such as file discovery,
 * indexing, and copying.
 *
 * This constant consolidates common exclusions from various parts of the
 * codebase, including:
 * - `.git` (version control)
 * - `.gmcache` (GameMaker cache)
 * - `.gmloop` (project-specific GMLoop files)
 * - `.gradle` (Gradle build files)
 * - `.idea` (IntelliJ IDEA project files)
 * - `.vscode` (VS Code project files)
 * - `dist` (build output)
 * - `node_modules` (npm dependencies)
 * - `reports` (generated reports)
 * - `tmp` (temporary files)
 * - `.gml-hot-reload` (hot reload artifacts)
 * - `.DS_Store` (macOS metadata)
 * - `Thumbs.db` (Windows thumbnail cache)
 * - `.log` (log files)
 * - `.tmp` (temporary files)
 */
export const DEFAULT_PROJECT_EXCLUDES: Required<ProjectExcludeRules> = Object.freeze({
    directoryNames: Object.freeze([
        ".git",
        ".gmcache",
        ".gmloop",
        ".gradle",
        ".idea",
        ".vscode",
        "dist",
        "node_modules",
        "reports",
        "tmp",
        ".gml-hot-reload"
    ]),
    fileNames: Object.freeze([".DS_Store", "Thumbs.db"]),
    relativePaths: Object.freeze([]),
    extensions: Object.freeze([".log", ".tmp"])
});

export function mergeExcludeRules(
    sourceExcludes: ProjectExcludeRules = {},
    newExcludes: ProjectExcludeRules = {}
): Required<ProjectExcludeRules> {
    const mergedDirectoryNames = new Set<string>();
    const mergedFileNames = new Set<string>();
    const mergedRelativePaths = new Set<string>();
    const mergedExtensions = new Set<string>();

    for (const name of sourceExcludes.directoryNames ?? []) {
        mergedDirectoryNames.add(name);
    }
    for (const name of newExcludes.directoryNames ?? []) {
        mergedDirectoryNames.add(name);
    }

    for (const name of sourceExcludes.fileNames ?? []) {
        mergedFileNames.add(name);
    }
    for (const name of newExcludes.fileNames ?? []) {
        mergedFileNames.add(name);
    }

    for (const name of sourceExcludes.relativePaths ?? []) {
        mergedRelativePaths.add(toPosixPath(name));
    }
    for (const name of newExcludes.relativePaths ?? []) {
        mergedRelativePaths.add(toPosixPath(name));
    }

    for (const name of sourceExcludes.extensions ?? []) {
        mergedExtensions.add(name);
    }
    for (const name of newExcludes.extensions ?? []) {
        mergedExtensions.add(name);
    }

    return Object.freeze({
        directoryNames: Object.freeze([...mergedDirectoryNames].sort()),
        fileNames: Object.freeze([...mergedFileNames].sort()),
        relativePaths: Object.freeze([...mergedRelativePaths].sort()),
        extensions: Object.freeze([...mergedExtensions].sort())
    });
}
