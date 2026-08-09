/**
 * Policy for classifying project-health signals from source file content.
 *
 * `project-health.ts` owns the mechanism: walking workspace directories,
 * reading files, and aggregating the classification results into a report.
 * This module owns the policy those mechanics defer to: which directories
 * to skip while walking, which files count as scannable source, what "large"
 * means for a file's line count, and what counts as a TODO-style marker.
 *
 * Keeping the classification rules here (as pure functions over strings and
 * numbers) means they can be unit-tested directly, without spinning up a
 * temp directory and writing fixture files through the filesystem mechanism
 * that consumes them.
 */

/**
 * Directory names that are never scanned for source-health signals, regardless
 * of depth. These hold generated, vendored, or build output rather than
 * hand-authored source.
 */
const IGNORED_SOURCE_DIRECTORIES = new Set(["node_modules", "dist", "generated", "vendor", "tmp"]);

const SOURCE_FILE_EXTENSION = ".ts";
const DECLARATION_FILE_SUFFIX = ".d.ts";
const BUILD_FILE_EXTENSION = ".js";

/**
 * Line-count threshold above which a source file is flagged as "large" in
 * the project-health report.
 */
const LARGE_FILE_LINE_THRESHOLD = 1000;

/** Matches TODO-style markers (`TODO`, `FIXME`, `HACK`) counted per source file. */
const TODO_PATTERN = /\b(?:TODO|FIXME|HACK)\b/g;

/**
 * Decide whether the directory walk should descend into a directory, given
 * its base name (e.g. `"node_modules"`, `"dist"`).
 */
export function shouldDescendIntoSourceDirectory(directoryBaseName: string): boolean {
    return !IGNORED_SOURCE_DIRECTORIES.has(directoryBaseName);
}

/**
 * Decide whether a file path should be counted as scannable TypeScript source.
 * Excludes declaration files (`.d.ts`) even though they share the `.ts` extension.
 */
export function isScannableSourceFile(filePath: string): boolean {
    return filePath.endsWith(SOURCE_FILE_EXTENSION) && !filePath.endsWith(DECLARATION_FILE_SUFFIX);
}

/**
 * Decide whether a build output file path should count toward workspace build size.
 */
export function isBuildOutputFile(filePath: string): boolean {
    return filePath.endsWith(BUILD_FILE_EXTENSION);
}

/**
 * Decide whether a source file's line count classifies it as "large" for the
 * project-health report.
 */
export function isLargeSourceFile(lineCount: number): boolean {
    return lineCount > LARGE_FILE_LINE_THRESHOLD;
}

/**
 * Count TODO-style markers (`TODO`, `FIXME`, `HACK`) present in file content.
 */
export function countTodoMarkers(content: string): number {
    return content.match(TODO_PATTERN)?.length ?? 0;
}
