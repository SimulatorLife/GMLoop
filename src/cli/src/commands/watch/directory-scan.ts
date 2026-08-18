/**
 * Directory traversal helpers for the watch command's initial scan and
 * unknown-event reconciliation passes.
 *
 * This module owns the file-system walk primitives and per-file heuristics
 * used to discover scripts, room resources, and source content during startup.
 * It is intentionally limited to stateless read operations and shared scan
 * accumulators (`Set<string>`, `Map<string, …>`) so the helpers stay cheap to
 * call from parallel workers and easy to test in isolation.
 *
 * Extracted from `watch.ts` to keep the command orchestration module focused
 * on lifecycle coordination. Each helper here runs during the directory scan
 * hot path, so allocations are kept tight (no `Set` copying on every entry,
 * no `path.join` inside predicates) and large trees still scan in seconds.
 */

import { type Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setImmediate as scheduleImmediate, setTimeout as scheduleTimeout } from "node:timers";

import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";
import type * as TranspilerTypes from "@gmloop/transpiler";
import { Transpiler } from "@gmloop/transpiler";

import { DEFAULT_WATCH_IGNORED_DIRECTORY_NAMES } from "./constants.js";
import { type ExtensionMatcher, getScriptNameFromPath, type InitialFileData } from "./source-analysis.js";

const { runInParallelWithLimit } = Core;

/**
 * Set form of {@link DEFAULT_WATCH_IGNORED_DIRECTORY_NAMES} for O(1) membership
 * checks during the directory walk. Populated once at module load; the value
 * itself never mutates.
 */
export const IGNORED_WATCH_DIRECTORY_NAMES: ReadonlySet<string> = new Set(DEFAULT_WATCH_IGNORED_DIRECTORY_NAMES);

/**
 * ANTLR can allocate hundreds of megabytes while parsing CannonFather-sized
 * resources. Keep parser-heavy startup work tightly bounded so directory
 * traversal parallelism cannot multiply that peak beyond the process memory
 * budget. Two workers preserve useful throughput without recreating the
 * unbounded parser concurrency that exhausted large projects.
 */
export const MAX_CONCURRENT_STARTUP_FILES = 2;

/**
 * Startup directory/file scans call `yieldToEventLoop` many thousands of
 * times for large GameMaker projects (once or twice per file, plus once per
 * directory). A real yield costs at least ~1ms (a `setImmediate` tick plus a
 * 1ms timer, chosen so the event loop's poll phase genuinely runs before
 * resuming), so paying that cost on every call serializes into seconds of
 * pure sleep for projects with thousands of files, directly inflating watch
 * startup latency. Only every Nth call performs the real yield; the rest
 * resolve immediately. This still bounds how long CPU-heavy ANTLR parsing
 * can run before ceding control to the event loop (I/O, the WebSocket
 * server, etc.), just less often than on every single file.
 */
export const EVENT_LOOP_YIELD_INTERVAL = 8;

let eventLoopYieldCounter = 0;

/**
 * Yields to the event loop on every {@link EVENT_LOOP_YIELD_INTERVAL}th call.
 *
 * Returns a `Promise.resolve()`-like microtask on all other calls so the
 * directory walk stays cheap for the majority of its invocations while still
 * ceding control periodically to the runtime (WebSocket server, status
 * server, filesystem events).
 */
export function yieldToEventLoop(): Promise<void> {
    eventLoopYieldCounter += 1;
    if (eventLoopYieldCounter % EVENT_LOOP_YIELD_INTERVAL !== 0) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        scheduleImmediate(() => {
            scheduleTimeout(resolve, 1);
        });
    });
}

/**
 * Splits a path or relative path into non-empty `/`-separated segments.
 *
 * Backslashes are normalized to forward slashes so this routine matches the
 * watch root regardless of the host operating system. Used to evaluate each
 * segment against {@link IGNORED_WATCH_DIRECTORY_NAMES} without allocating
 * intermediate arrays.
 */
export function normalizeWatchedPathSegments(candidatePath: string): Array<string> {
    return candidatePath
        .replaceAll("\\", "/")
        .split("/")
        .filter((segment) => segment.length > 0);
}

/**
 * Returns true when any segment of the candidate path (or its relative form
 * against `watchRoot`) matches an ignored directory name. When `watchRoot` is
 * supplied the path is relativized first so the check ignores the watch root
 * directory itself.
 */
export function shouldIgnoreWatchedPath(candidatePath: string, watchRoot: string | null = null): boolean {
    const pathToCheck = watchRoot === null ? candidatePath : path.relative(watchRoot, candidatePath);

    return normalizeWatchedPathSegments(pathToCheck).some((segment) => IGNORED_WATCH_DIRECTORY_NAMES.has(segment));
}

/**
 * Result of partitioning a single directory's entries into the categories the
 * scanner tracks. `secondaryFiles` carry paths for an additional extension
 * matcher (for example `.yy` room resources) so callers do not need a second
 * full scan to rediscover them.
 */
export interface ScannedDirectoryEntries {
    files: Array<string>;
    directories: Array<string>;
    secondaryFiles: Array<string>;
}

/**
 * Splits one directory's `Dirent` listing into the categories used by both
 * the startup scan and the unknown-event reconciliation pass.
 *
 * The recursion-blocking {@link IGNORED_WATCH_DIRECTORY_NAMES} check fires
 * before the per-file `shouldIgnoreWatchedPath` check; the per-file check is
 * still required so relative paths inside an allowed directory can still be
 * discarded (e.g. `.git` is a default-ignored directory name but a stray
 * top-level `.git` match against the watch root should also be ignored).
 */
export function partitionScannedDirectoryEntries(
    currentPath: string,
    entries: Array<Dirent>,
    extensionMatcher: ExtensionMatcher,
    watchRoot: string,
    secondaryExtensionMatcher?: ExtensionMatcher
): ScannedDirectoryEntries {
    const files: Array<string> = [];
    const directories: Array<string> = [];
    const secondaryFiles: Array<string> = [];

    for (const entry of entries) {
        const candidatePath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
            if (IGNORED_WATCH_DIRECTORY_NAMES.has(entry.name)) {
                continue;
            }
            directories.push(candidatePath);
        } else if (entry.isFile() && !shouldIgnoreWatchedPath(candidatePath, watchRoot)) {
            if (extensionMatcher.matches(entry.name)) {
                files.push(candidatePath);
            } else if (secondaryExtensionMatcher?.matches(entry.name) && isRoomResourcePath(candidatePath)) {
                secondaryFiles.push(candidatePath);
            }
        }
    }

    return { files, directories, secondaryFiles };
}

/**
 * Returns true when any path segment is exactly `rooms`, regardless of
 * platform path separator. Used to gate the secondary `.yy` matcher so a
 * stray `yy` file outside the `rooms/` tree cannot accidentally enter the
 * room resource channel.
 */
export function isRoomResourcePath(filePath: string): boolean {
    return path.normalize(filePath).split(path.sep).includes("rooms");
}

/**
 * Aggregates startup scan output that downstream watchers consume without
 * re-reading the source tree.
 *
 * - `scriptNames` — accumulated script identifiers used to seed runtime
 *   script awareness.
 * - `fileDataCache` — pre-read source text and metadata consumed by the
 *   parallel scan; deleted as soon as downstream stages consume each entry
 *   to bound peak memory.
 * - `macroDefinitionsBySourcePath` — `#macro`/`#define` declarations parsed
 *   during the lexical pass so the runtime can resolve macros without a
 *   second traversal.
 * - `secondaryFilePaths` — paths discovered for the secondary extension
 *   matcher (e.g. room `.yy` files) so later passes can attach metadata
 *   without repeating the walk.
 */
export interface InitialFileScanResult {
    scriptNames: Set<string>;
    fileDataCache: Map<string, InitialFileData>;
    macroDefinitionsBySourcePath: TranspilerTypes.MacroDefinitionsBySourcePath;
    secondaryFilePaths: Array<string>;
}

/**
 * Breadth-first walk that collects runtime script identifiers, source text,
 * and macro definitions for a watched project root.
 *
 * The walk drains one BFS level per parallel batch: child directories are
 * pushed onto a shared `pendingDirectories` array only after their parent's
 * scan completes, so each iteration's await is a genuine sequential
 * dependency rather than accidental serialization. File-level work shares
 * the same worker cap as directory traversal to keep ANTLR parser pressure
 * bounded.
 */
export async function collectScriptNames(
    rootPath: string,
    extensionMatcher: ExtensionMatcher,
    maxConcurrentDirs: number,
    secondaryExtensionMatcher?: ExtensionMatcher
): Promise<InitialFileScanResult> {
    const scriptNames = new Set<string>();
    const fileDataCache = new Map<string, InitialFileData>();
    const macroDefinitionsBySourcePath: TranspilerTypes.MacroDefinitionsBySourcePath = new Map();
    const secondaryFilePaths: Array<string> = [];

    let pendingDirectories: Array<string> = [rootPath];
    while (pendingDirectories.length > 0) {
        const currentBatch = pendingDirectories;
        pendingDirectories = [];

        // Each iteration processes one BFS level of the directory tree; the next
        // level's `pendingDirectories` isn't known until this level's scan finishes,
        // so the await is a genuine sequential dependency, not an accidental serialization.
        // eslint-disable-next-line no-await-in-loop -- level-by-level BFS traversal; see comment above
        await runInParallelWithLimit(
            currentBatch,
            async (currentPath) => {
                await yieldToEventLoop();

                try {
                    const entries = await readdir(currentPath, { withFileTypes: true });
                    const { files, directories, secondaryFiles } = partitionScannedDirectoryEntries(
                        currentPath,
                        entries,
                        extensionMatcher,
                        rootPath,
                        secondaryExtensionMatcher
                    );

                    // Keep lexer and source-directive work globally bounded by
                    // the same worker limit as directory traversal.
                    for (const filePath of files) {
                        // eslint-disable-next-line no-await-in-loop -- intentionally serialized to respect maxConcurrentDirs; see comment above
                        await addScriptNamesFromFile(
                            filePath,
                            scriptNames,
                            fileDataCache,
                            macroDefinitionsBySourcePath
                        );
                    }

                    // Capture paths discovered for the secondary matcher without
                    // re-walking the tree during watch startup.
                    secondaryFilePaths.push(...secondaryFiles);
                    pendingDirectories.push(...directories);
                } catch {
                    // Ignore per-directory read errors; the watcher can still use
                    // file-name fallback and process later change events.
                }
            },
            Math.min(maxConcurrentDirs, MAX_CONCURRENT_STARTUP_FILES)
        );
    }

    return { scriptNames, fileDataCache, macroDefinitionsBySourcePath, secondaryFilePaths };
}

/**
 * Depth-first walk that returns every tracked file path for a watched project
 * root. Used by the unknown-event reconciliation pass to probe `stat` results
 * against previously known file lists.
 *
 * Per-directory read failures are swallowed so an inaccessible subtree never
 * crashes the watcher.
 */
export async function collectWatchedFilePaths(
    rootPath: string,
    extensionMatcher: ExtensionMatcher,
    maxConcurrentDirs: number
): Promise<Array<string>> {
    const discoveredFiles: Array<string> = [];

    async function scan(currentPath: string): Promise<void> {
        try {
            await yieldToEventLoop();
            const entries = await readdir(currentPath, { withFileTypes: true });
            const { files, directories } = partitionScannedDirectoryEntries(
                currentPath,
                entries,
                extensionMatcher,
                rootPath
            );

            discoveredFiles.push(...files);

            await runInParallelWithLimit(
                directories,
                async (subDirPath) => {
                    await scan(subDirPath);
                },
                maxConcurrentDirs
            );
        } catch {
            // Ignore per-directory read errors; the unknown scan should never
            // crash the watcher just because one subdirectory is inaccessible.
        }
    }

    try {
        await scan(rootPath);
    } catch {
        // Fail silently; unknown filename scans should never crash the watcher.
    }

    return discoveredFiles;
}

/**
 * Reads one file, extracts `gml_Script_<name>` identifiers via the lexer
 * fast-path, and (when the source contains macro declarations) parses the
 * macro table for the runtime macro channel.
 *
 * Falls back to the file-name-based script identifier when parsing fails so
 * the watcher can still register the script even if a file has invalid GML.
 */
export async function addScriptNamesFromFile(
    filePath: string,
    scriptNames: Set<string>,
    fileDataCache: Map<string, InitialFileData>,
    macroDefinitionsBySourcePath: TranspilerTypes.MacroDefinitionsBySourcePath
): Promise<void> {
    const beforeSize = scriptNames.size;

    try {
        // `readFile` and `stat` are independent I/O operations; pipeline them so
        // the per-file startup cost tracks the slower of the two instead of the
        // sum. The pipelined `try` still catches a stat failure alongside the
        // read failure, preserving the original "ignore parse errors" fallback
        // behavior used by the directory walk.
        const [content, stats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
        await yieldToEventLoop();
        for (const functionName of Parser.extractGmlFunctionNames(content)) {
            scriptNames.add(`gml_Script_${functionName}`);
        }

        if (sourceCanDeclareMacroMetadata(content)) {
            macroDefinitionsBySourcePath.set(filePath, Transpiler.extractMacroDefinitionsFromSource(content, filePath));
        }

        fileDataCache.set(filePath, { content, mtimeMs: stats.mtimeMs, symbols: [], references: [] });
        await yieldToEventLoop();
    } catch {
        // Ignore parse errors; fallback to file-name based script
    }

    if (scriptNames.size === beforeSize) {
        const scriptName = getScriptNameFromPath(filePath);
        if (scriptName) {
            scriptNames.add(scriptName);
        }
    }
}

/**
 * Quick pre-check used to skip the macro extraction pass entirely for files
 * that contain neither `#macro` nor `#define` directives. Cheap enough to run
 * on every source file during the initial scan.
 */
export function sourceCanDeclareMacroMetadata(content: string): boolean {
    return content.includes("#macro") || content.includes("#define");
}
