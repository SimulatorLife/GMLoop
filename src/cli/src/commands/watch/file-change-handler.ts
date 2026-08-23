/* eslint-disable no-param-reassign, sonarjs/cognitive-complexity -- This module is a behavior-preserving extraction of pre-existing watch.ts logic; keep inherited baseline debt from being reclassified as new while the extraction remains scoped. */
/**
 * Per-file change-reaction pipeline for the watch command.
 *
 * Extracts the per-file reaction logic out of the monolithic watch command
 * so the command file can focus on lifecycle orchestration while this
 * module owns "what happens when the filesystem says a file changed".
 *
 * Three cohesive helpers live here:
 *
 * - {@link handleFileChange} — reconciles a single change event against the
 *   runtime-context snapshot, dedupes identical content via the
 *   source-content hash, and triggers a transpile (or resource patch for
 *   `.yy` files).
 * - {@link handleUnknownFileChanges} — coalesces bursts of watcher events
 *   with no resolvable filename into a bounded tree rescan.
 * - {@link scheduleUnknownFileChanges} — debounce/coalesce layer that
 *   collapses bursts into a single in-flight rescan.
 *
 * Each helper takes only the fields it actually needs through the shared
 * {@link FileChangeRuntimeContext} projection; that projection lets the
 * watch command keep its broader `RuntimeContext` private while still
 * letting this module read and mutate the parts it owns.
 */

import type { Dirent, Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { Core, type DebouncedFunction } from "@gmloop/core";

import { transpileFile, type ResourcePatch } from "../../modules/transpilation/index.js";
import type { PatchBroadcaster } from "../../modules/websocket/server.js";
import {
    DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_COUNT,
    DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS,
    DEFAULT_WATCH_IGNORED_DIRECTORY_NAMES
} from "./constants.js";
import {
    cleanupRemovedFile,
    processTranspileResult,
    retranspileDependentFiles,
    type TranspileFileRuntimeContext
} from "./dependency-updates.js";
import { handleResourceFileChange } from "./resource-change-handler.js";
import {
    countSourceLines,
    ensureScriptNameRegistered,
    type ExtensionMatcher,
    hashSourceContent,
    readSourceFileWithTransientEmptyRetry
} from "./source-analysis.js";

const { getErrorMessage, isErrorWithCode, runInParallelWithLimit } = Core;
const IGNORED_WATCH_DIRECTORY_NAMES = new Set(DEFAULT_WATCH_IGNORED_DIRECTORY_NAMES);

/**
 * Minimal logger flags shared by the file-change helpers.
 *
 * Mirrors the `LoggingConfig` shape used elsewhere in the watch module
 * without forcing this module to depend on the command-level type.
 */
export interface FileChangeLogging {
    verbose?: boolean;
    quiet?: boolean;
}

/**
 * Options for {@link handleFileChange}.
 *
 * Mirrors the command-level `FileChangeOptions` but is parameterized on a
 * narrower runtime context (see {@link FileChangeRuntimeContext}) so the
 * helper does not have to import the watch command's full
 * `RuntimeContext`.
 */
export interface FileChangeOptions extends FileChangeLogging {
    runtimeContext?: FileChangeRuntimeContext;
    fileStats?: Stats | null;
    abortSignal?: AbortSignal;
    /** Wall-clock timestamp (Date.now()) when the filesystem change event was first detected. */
    fileChangeDetectedAt?: number;
}

/**
 * Narrow snapshot of the watch command's runtime context consumed by the
 * file-change pipeline.
 *
 * Every field corresponds to a real need inside one of the helpers in this
 * module; the projection lets the watch command keep its broader
 * `RuntimeContext` private while still letting this module read and mutate
 * the parts it owns.
 */
export interface FileChangeRuntimeContext {
    roomResources: Map<string, Record<string, unknown>>;
    fileSnapshots: Map<string, number>;
    fileContentHashes: Map<string, string>;
    fileContentLengths: Map<string, number>;
    scriptNames: Set<string>;
    resourcePatches: Map<string, ResourcePatch>;
    totalPatchCount: number;
    websocketServer: PatchBroadcaster | null;
    debouncedHandlers: Map<string, DebouncedFunction<[string, string, FileChangeOptions]>>;
    lastSuccessfulPatches: Map<string, unknown>;
    sourcePathToPatchIds: Map<string, Set<string>>;
    macroDefinitionsBySourcePath: Map<string, unknown>;
    macroDefinitions: Map<string, unknown>;
    watchRoot: string;
    extensionMatcher: ExtensionMatcher;
    maxConcurrentDirs: number;
    transientEmptyFileReadRetryCount: number;
    transientEmptyFileReadRetryDelayMs: number;
    unknownScanConcurrency: number;
    unknownScanPromise: Promise<void> | null;
    unknownScanQueued: boolean;
    unknownScanDetectedAt: number | null;
    scanComplete: boolean;
    verbose: boolean;
    quiet: boolean;
}

/**
 * Snapshot-only writer for {@link updateFileSnapshot}.
 *
 * Keeps the helper callable from anywhere with a plain `Map<string, number>`
 * rather than the full `FileChangeRuntimeContext`.
 */
export interface FileSnapshotWriter {
    fileSnapshots: Map<string, number>;
}

/**
 * Read file stats and return null when the file no longer exists.
 *
 * Errors other than `ENOENT` are deliberately swallowed: the helper exists
 * to ask "is this file still here?", and any failure to stat is treated as
 * "no" so the caller can route the path through the removed-file cleanup
 * path.
 */
export async function readFileStats(filePath: string): Promise<Stats | null> {
    try {
        return await stat(filePath);
    } catch {
        return null;
    }
}

/**
 * Refresh the stored mtime snapshot for a single file.
 *
 * On stat failure the entry is removed entirely so subsequent reads treat
 * the path as unknown and re-discover it through the watcher's
 * change-detection path.
 */
export async function updateFileSnapshot(runtimeContext: FileSnapshotWriter, filePath: string): Promise<void> {
    try {
        const stats = await stat(filePath);
        runtimeContext.fileSnapshots.set(filePath, stats.mtimeMs);
    } catch {
        runtimeContext.fileSnapshots.delete(filePath);
    }
}

/**
 * Apply dependency-cleanup for a removed file and retranspile any direct
 * dependents that the cleanup determined were affected.
 */
export async function processRemovedWatchedFile(
    runtimeContext: FileChangeRuntimeContext,
    filePath: string,
    fileChangeDetectedAt: number
): Promise<void> {
    // `cleanupRemovedFile` and `retranspileDependentFiles` accept narrower
    // context interfaces (`FileRemovalCleanupContext`, `TranspileFileRuntimeContext`).
    // Both projections are subsets of `FileChangeRuntimeContext`, which already
    // carries every field they read.
    const removalContext = runtimeContext as unknown as Parameters<typeof cleanupRemovedFile>[0];
    const transpileContext = runtimeContext as unknown as TranspileFileRuntimeContext;
    const affectedDependents = cleanupRemovedFile(removalContext, filePath);
    if (affectedDependents.length > 0) {
        await retranspileDependentFiles(transpileContext, filePath, affectedDependents, fileChangeDetectedAt);
    }
}

/**
 * Handle a single filesystem change event for one watched file.
 *
 * The helper reconciles the change with the runtime-context snapshot,
 * dedupes identical content via the source-content hash, and triggers a
 * transpile (or, for `.yy` files, a resource-patch) on actionable changes.
 * Unactionable changes (unchanged mtime, identical content, missing files)
 * exit early without producing a patch.
 */
export async function handleFileChange(
    filePath: string,
    eventType: string,
    {
        verbose = false,
        quiet = false,
        runtimeContext,
        fileStats,
        abortSignal,
        fileChangeDetectedAt
    }: FileChangeOptions = {}
): Promise<void> {
    if (path.extname(filePath).toLowerCase() === ".yy") {
        if (runtimeContext) {
            await handleResourceFileChange(filePath, runtimeContext, runtimeContext.roomResources, {
                verbose,
                quiet,
                fileStats,
                abortSignal
            });
        }
        return;
    }

    let shouldTranspile = false;
    let resolvedFileStats: Stats | null = fileStats ?? null;

    if (eventType === "rename") {
        if (resolvedFileStats) {
            shouldTranspile = true;
            if (verbose && !quiet) {
                console.log(`  ↳ File exists (created or renamed)`);
            }
        } else {
            try {
                resolvedFileStats = await stat(filePath);
                shouldTranspile = true;
                if (verbose && !quiet) {
                    console.log(`  ↳ File exists (created or renamed)`);
                }
            } catch {
                if (verbose && !quiet) {
                    console.log(`  ↳ File removed (deleted or renamed away)`);
                }
                if (runtimeContext) {
                    await processRemovedWatchedFile(runtimeContext, filePath, fileChangeDetectedAt ?? Date.now());
                }
                return;
            }
        }
    }

    if (eventType === "change" || shouldTranspile) {
        if (runtimeContext) {
            if (!resolvedFileStats) {
                resolvedFileStats = await readFileStats(filePath);
            }

            if (!resolvedFileStats) {
                if (verbose && !quiet) {
                    console.log("  ↳ File removed before change event could be processed");
                }
                await processRemovedWatchedFile(runtimeContext, filePath, fileChangeDetectedAt ?? Date.now());
                return;
            }

            const lastModified = runtimeContext.fileSnapshots.get(filePath);
            if (lastModified !== undefined && resolvedFileStats.mtimeMs <= lastModified) {
                if (verbose && !quiet) {
                    console.log("  ↳ Skipping unchanged file");
                }
                return;
            }
        }

        try {
            const content = await readSourceFileWithTransientEmptyRetry(
                filePath,
                runtimeContext?.transientEmptyFileReadRetryCount ?? DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_COUNT,
                runtimeContext?.transientEmptyFileReadRetryDelayMs ?? DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS,
                abortSignal
            );
            if (content === null) {
                return;
            }
            const lines = countSourceLines(content);
            if (runtimeContext) {
                if (resolvedFileStats) {
                    runtimeContext.fileSnapshots.set(filePath, resolvedFileStats.mtimeMs);
                } else {
                    await updateFileSnapshot(runtimeContext, filePath);
                }
            }

            if (verbose && !quiet) {
                console.log(`  ↳ Read ${lines} lines`);
            }

            if (!runtimeContext) {
                return;
            }

            const contentLength = content.length;
            const previousContentLength = runtimeContext.fileContentLengths.get(filePath);
            const lastContentHash = runtimeContext.fileContentHashes.get(filePath);
            const shouldCheckHash =
                previousContentLength !== undefined &&
                lastContentHash !== undefined &&
                previousContentLength === contentLength;
            const contentHash = shouldCheckHash ? hashSourceContent(content) : undefined;
            if (contentHash !== undefined && lastContentHash === contentHash) {
                if (verbose && !quiet) {
                    console.log("  ↳ Skipping transpilation: content unchanged");
                }
                return;
            }

            runtimeContext.fileContentHashes.set(filePath, contentHash ?? hashSourceContent(content));
            runtimeContext.fileContentLengths.set(filePath, contentLength);

            ensureScriptNameRegistered(filePath, runtimeContext.scriptNames);

            const runtimeContextWithTranspiler = runtimeContext as unknown as TranspileFileRuntimeContext;
            const result = transpileFile(runtimeContextWithTranspiler, filePath, content, lines, {
                verbose,
                quiet,
                fileChangeDetectedAt
            });

            await processTranspileResult(runtimeContextWithTranspiler, filePath, result, fileChangeDetectedAt);
        } catch (error) {
            if (runtimeContext && isErrorWithCode(error, "ENOENT")) {
                await processRemovedWatchedFile(runtimeContext, filePath, fileChangeDetectedAt ?? Date.now());
                if (verbose && !quiet) {
                    console.log("  ↳ File missing during read (deleted before processing)");
                }
                return;
            }

            const message = getErrorMessage(error, {
                fallback: "Unknown file read error"
            });

            const formattedMessage =
                verbose && !quiet
                    ? `  ↳ Error reading file: ${message}`
                    : `Error reading ${path.basename(filePath)}: ${message}`;

            console.error(formattedMessage);
        }
    }
}

/**
 * Reconcile the runtime context against the current watched tree when the
 * watcher fires an event with no resolvable filename (some platforms emit
 * these during high-churn periods).
 */
export async function handleUnknownFileChanges(
    runtimeContext: FileChangeRuntimeContext,
    abortSignal: AbortSignal | undefined,
    fileChangeDetectedAt: number
): Promise<void> {
    const discoveredFilePaths = await collectWatchedFilePaths(
        runtimeContext.watchRoot,
        runtimeContext.extensionMatcher,
        runtimeContext.maxConcurrentDirs
    );
    const discoveredFiles = new Set(discoveredFilePaths);

    const removedFilePaths = [...runtimeContext.fileSnapshots.keys()].filter(
        (filePath) => !discoveredFiles.has(filePath)
    );
    await runInParallelWithLimit(
        removedFilePaths,
        (filePath) => processRemovedWatchedFile(runtimeContext, filePath, fileChangeDetectedAt),
        runtimeContext.unknownScanConcurrency
    );

    const changedEntries = await runInParallelWithLimit(
        discoveredFilePaths,
        async (filePath) => {
            const lastModified = runtimeContext.fileSnapshots.get(filePath);
            try {
                const stats = await stat(filePath);
                if (lastModified !== undefined && stats.mtimeMs <= lastModified) {
                    return null;
                }

                return {
                    filePath,
                    stats,
                    eventType: lastModified === undefined ? "rename" : "change"
                };
            } catch {
                await processRemovedWatchedFile(runtimeContext, filePath, fileChangeDetectedAt);
                return null;
            }
        },
        runtimeContext.unknownScanConcurrency
    );

    const pendingChanges = changedEntries.filter(
        (entry): entry is { filePath: string; stats: Stats; eventType: string } => entry !== null
    );

    await runInParallelWithLimit(
        pendingChanges,
        async (entry) => {
            await handleFileChange(entry.filePath, entry.eventType, {
                verbose: runtimeContext.verbose,
                quiet: runtimeContext.quiet,
                runtimeContext,
                fileStats: entry.stats,
                abortSignal,
                fileChangeDetectedAt
            });
        },
        runtimeContext.unknownScanConcurrency
    );
}

/**
 * Drain queued unknown-file scan work, looping until the queue empties.
 */
function processQueuedUnknownFileChanges(
    runtimeContext: FileChangeRuntimeContext,
    abortSignal?: AbortSignal
): Promise<void> {
    runtimeContext.unknownScanQueued = false;
    const fileChangeDetectedAt = runtimeContext.unknownScanDetectedAt ?? Date.now();
    runtimeContext.unknownScanDetectedAt = null;

    return handleUnknownFileChanges(runtimeContext, abortSignal, fileChangeDetectedAt).then(() =>
        runtimeContext.unknownScanQueued
            ? processQueuedUnknownFileChanges(runtimeContext, abortSignal)
            : Promise.resolve()
    );
}

/**
 * Schedule a coalesced unknown-file scan.
 *
 * Bursts of unknown-filename events (common on macOS during high-churn
 * periods and during watcher startup) collapse into a single rescan; the
 * caller only ever receives the in-flight promise. The early `scanComplete`
 * guard avoids racing the startup scanner against itself.
 */
export function scheduleUnknownFileChanges(
    runtimeContext: FileChangeRuntimeContext,
    abortSignal?: AbortSignal,
    fileChangeDetectedAt: number = Date.now()
): Promise<void> {
    if (!runtimeContext.scanComplete) {
        return Promise.resolve();
    }

    if (runtimeContext.unknownScanDetectedAt === null || fileChangeDetectedAt < runtimeContext.unknownScanDetectedAt) {
        runtimeContext.unknownScanDetectedAt = fileChangeDetectedAt;
    }

    if (runtimeContext.unknownScanPromise !== null) {
        runtimeContext.unknownScanQueued = true;
        return runtimeContext.unknownScanPromise;
    }

    const unknownScanPromise = processQueuedUnknownFileChanges(runtimeContext, abortSignal).finally(() => {
        runtimeContext.unknownScanPromise = null;
    });

    runtimeContext.unknownScanPromise = unknownScanPromise;
    return unknownScanPromise;
}

/**
 * Recursively walk `rootPath`, returning every file whose extension matches
 * the matcher. Package-private to this module: nothing outside the
 * file-change pipeline consumes it directly.
 */
async function collectWatchedFilePaths(
    rootPath: string,
    extensionMatcher: ExtensionMatcher,
    maxConcurrentDirs: number
): Promise<Array<string>> {
    const discoveredFiles: Array<string> = [];

    async function scan(currentPath: string): Promise<void> {
        try {
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
 * Partition a directory listing into matched files, subdirectories, and a
 * pass-through list for the secondary matcher.
 *
 * The matcher's owned extension set keeps the partition logic narrow: this
 * helper does not consult user-supplied glob patterns.
 */
function partitionScannedDirectoryEntries(
    currentPath: string,
    entries: Array<Dirent>,
    extensionMatcher: ExtensionMatcher,
    watchRoot: string,
    secondaryExtensionMatcher?: ExtensionMatcher
): {
    files: Array<string>;
    directories: Array<string>;
    secondaryFiles: Array<string>;
} {
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
        } else if (entry.isFile()) {
            if (extensionMatcher.matches(entry.name)) {
                files.push(candidatePath);
            } else if (secondaryExtensionMatcher?.matches(entry.name) && isRoomResourcePath(candidatePath)) {
                secondaryFiles.push(candidatePath);
            }
        }
    }

    return { files, directories, secondaryFiles };
}

/** Return true when the path lives anywhere under a `rooms/` directory. */
export function isRoomResourcePath(filePath: string): boolean {
    return path.normalize(filePath).split(path.sep).includes("rooms");
}
