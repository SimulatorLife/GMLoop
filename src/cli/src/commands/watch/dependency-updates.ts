import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Core, type DebouncedFunction } from "@gmloop/core";

import type { DependencyTracker } from "../../modules/transpilation/dependency-tracker.js";
import {
    type RuntimeTranspilerPatch,
    type TranspilationContext,
    type TranspilationResult,
    transpileFile
} from "../../modules/transpilation/index.js";
import {
    getRuntimePathSegments,
    resolveScriptFileNameFromSegments
} from "../../modules/transpilation/runtime-identifiers.js";
import { countSourceLines } from "./source-analysis.js";

const { getErrorMessage } = Core;

interface FileChangeOptions {
    verbose?: boolean;
    quiet?: boolean;
}

interface DependencyUpdateRuntimeContext {
    dependencyTracker: DependencyTracker;
    dependentRetranspileConcurrency: number;
    scriptNames: Set<string>;
}

interface DependencyUpdateSummary {
    definitionsChanged: boolean;
    affectedDependents: ReadonlyArray<string>;
}

interface FileRemovalCleanupContext {
    scriptNames: Set<string>;
    dependencyTracker: DependencyTracker;
    fileSnapshots: Map<string, number>;
    fileContentHashes: Map<string, string>;
    fileContentLengths: Map<string, number>;
    lastSuccessfulPatches: Map<string, RuntimeTranspilerPatch>;
    sourcePathToPatchIds: Map<string, Set<string>>;
    debouncedHandlers: Map<string, DebouncedFunction<[string, string, FileChangeOptions]>>;
}

interface TranspileFileRuntimeContext
    extends Omit<TranspilationContext, "scriptNames">, DependencyUpdateRuntimeContext {}

/**
 * Apply dependency updates for a successful transpilation and retranspile the
 * files whose referenced definitions actually changed.
 */
export async function processTranspileResult(
    runtimeContext: TranspileFileRuntimeContext,
    filePath: string,
    result: TranspilationResult,
    fileChangeDetectedAt: number | undefined,
    verbose: boolean,
    quiet: boolean
): Promise<void> {
    if (!result.success || !result.patch) {
        return;
    }

    const dependencyUpdate = updateDependencyTrackerForTranspileResult(runtimeContext, filePath, result);

    if (verbose && !quiet) {
        const stats = runtimeContext.dependencyTracker.getStatistics();
        console.log(`  ↳ Dependency tracker: ${stats.totalSymbols} symbols tracked across ${stats.totalFiles} files`);
    }

    if (!dependencyUpdate.definitionsChanged) {
        if (verbose && !quiet && dependencyUpdate.affectedDependents.length > 0) {
            console.log("  ↳ Symbol definitions unchanged; skipping dependent retranspilation");
        }
        return;
    }

    const dependentFiles = dependencyUpdate.affectedDependents;
    if (dependentFiles.length === 0) {
        return;
    }

    if (!quiet) {
        console.log(`  ↳ Retranspiling ${dependentFiles.length} dependent file(s)...`);
    }

    await retranspileDependentFiles(runtimeContext, filePath, dependentFiles, fileChangeDetectedAt, verbose, quiet);
}

/**
 * Remove dependency, script-name, source snapshot, and patch-cache state for
 * deleted files that the watch loop previously tracked.
 */
export function removeDeletedCachedPatchSources(
    runtimeContext: FileRemovalCleanupContext,
    verbose: boolean,
    quiet: boolean
): void {
    const deletedSourcePaths = new Set<string>();

    for (const cachedPatch of runtimeContext.lastSuccessfulPatches.values()) {
        const metadata = Core.isObjectLike(cachedPatch.metadata) ? cachedPatch.metadata : null;
        const sourcePath = Core.isNonEmptyString(metadata?.sourcePath) ? metadata.sourcePath : null;

        if (sourcePath !== null && !existsSync(sourcePath)) {
            deletedSourcePaths.add(sourcePath);
        }
    }

    for (const sourcePath of deletedSourcePaths) {
        cleanupRemovedFile(runtimeContext, sourcePath, verbose, quiet);
    }
}

async function retranspileDependentFiles(
    runtimeContext: TranspileFileRuntimeContext,
    filePath: string,
    dependentFiles: ReadonlyArray<string>,
    fileChangeDetectedAt: number | undefined,
    verbose: boolean,
    quiet: boolean
): Promise<void> {
    await Core.runInParallelWithLimit(
        dependentFiles,
        async (dependentFile) => {
            try {
                await retranspileDependentFile(
                    runtimeContext,
                    filePath,
                    dependentFile,
                    fileChangeDetectedAt,
                    verbose,
                    quiet
                );
            } catch (error) {
                const message = getErrorMessage(error, {
                    fallback: "Unknown file read error"
                });
                console.error(`  ↳ Error retranspiling dependent file ${dependentFile}: ${message}`);
            }
        },
        runtimeContext.dependentRetranspileConcurrency
    );
}

function areSymbolSetsEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
    if (left.length === 0 || right.length === 0) {
        return left.length === right.length;
    }

    if (left.length === right.length && left.every((symbol, index) => symbol === right[index])) {
        return true;
    }

    const leftSet = new Set(left);
    const rightSet = new Set(right);

    if (leftSet.size !== rightSet.size) {
        return false;
    }

    for (const symbol of leftSet) {
        if (!rightSet.has(symbol)) {
            return false;
        }
    }

    return true;
}

function updateDependencyTrackerForTranspileResult(
    runtimeContext: DependencyUpdateRuntimeContext,
    filePath: string,
    result: TranspilationResult
): DependencyUpdateSummary {
    const previousDefinitions = runtimeContext.dependencyTracker.getFileDefinitions(filePath);
    const nextDefinitions = result.symbols ?? [];
    const definitionsChanged = !areSymbolSetsEqual(previousDefinitions, nextDefinitions);

    runtimeContext.dependencyTracker.replaceFileDefines(filePath, nextDefinitions);
    runtimeContext.dependencyTracker.replaceFileReferences(filePath, result.references ?? []);

    if (!definitionsChanged) {
        return {
            definitionsChanged,
            affectedDependents: []
        };
    }

    const changedDefinitions = resolveChangedDefinitions(previousDefinitions, nextDefinitions);
    const affectedDependents = runtimeContext.dependencyTracker.getFilesReferencingSymbols(
        changedDefinitions,
        filePath
    );

    return {
        definitionsChanged,
        affectedDependents
    };
}

function resolveChangedDefinitions(
    previousDefinitions: ReadonlyArray<string>,
    nextDefinitions: ReadonlyArray<string>
): Array<string> {
    return mergeDependentFiles(
        subtractSymbolSets(previousDefinitions, nextDefinitions),
        subtractSymbolSets(nextDefinitions, previousDefinitions)
    );
}

function subtractSymbolSets(left: ReadonlyArray<string>, right: ReadonlyArray<string>): Array<string> {
    if (left.length === 0) {
        return [];
    }

    const rightSet = new Set(right);
    const difference: Array<string> = [];

    for (const symbol of left) {
        if (!rightSet.has(symbol)) {
            difference.push(symbol);
        }
    }

    return difference;
}

function mergeDependentFiles(
    previousDependents: ReadonlyArray<string>,
    updatedDependents: ReadonlyArray<string>
): Array<string> {
    return [...previousDependents, ...updatedDependents].filter((item, index, arr) => arr.indexOf(item) === index);
}

async function retranspileDependentFile(
    runtimeContext: TranspileFileRuntimeContext,
    filePath: string,
    dependentFile: string,
    fileChangeDetectedAt: number | undefined,
    verbose: boolean,
    quiet: boolean
): Promise<void> {
    ensureScriptNameRegistered(dependentFile, runtimeContext.scriptNames);

    const dependentContent = await readFile(dependentFile, "utf8");
    const dependentLines = countSourceLines(dependentContent);

    if (verbose && !quiet) {
        console.log(`  ↳ Retranspiling ${path.relative(path.dirname(filePath), dependentFile)}`);
    }

    const dependentResult = transpileFile(runtimeContext, dependentFile, dependentContent, dependentLines, {
        verbose: false,
        quiet,
        fileChangeDetectedAt
    });

    registerDependencyTrackerUpdates(runtimeContext, dependentFile, dependentResult);
}

function registerDependencyTrackerUpdates(
    runtimeContext: DependencyUpdateRuntimeContext,
    dependentFile: string,
    dependentResult: TranspilationResult
): void {
    if (!dependentResult.success) {
        return;
    }

    runtimeContext.dependencyTracker.replaceFileDefines(dependentFile, dependentResult.symbols ?? []);
    runtimeContext.dependencyTracker.replaceFileReferences(dependentFile, dependentResult.references ?? []);
}

function getScriptNameFromPath(filePath: string): string | null {
    const segments = getRuntimePathSegments(filePath);
    return resolveScriptFileNameFromSegments(segments);
}

function ensureScriptNameRegistered(filePath: string, scriptNames: Set<string>): void {
    const scriptName = getScriptNameFromPath(filePath);
    if (scriptName) {
        scriptNames.add(scriptName);
    }
}

function unregisterScriptName(filePath: string, scriptNames: Set<string>): void {
    const scriptName = getScriptNameFromPath(filePath);
    if (scriptName) {
        scriptNames.delete(scriptName);
    }
}

function getSymbolIdFromFilePath(filePath: string): string {
    const fileName = path.basename(filePath, path.extname(filePath));
    return `gml/script/${fileName}`;
}

function removeCachedPatchesForFile(
    runtimeContext: Pick<FileRemovalCleanupContext, "lastSuccessfulPatches" | "sourcePathToPatchIds">,
    filePath: string
): number {
    const symbolId = getSymbolIdFromFilePath(filePath);
    let removedCount = runtimeContext.lastSuccessfulPatches.delete(symbolId) ? 1 : 0;

    for (const [patchId, cachedPatch] of runtimeContext.lastSuccessfulPatches.entries()) {
        const metadata = Core.isObjectLike(cachedPatch.metadata) ? cachedPatch.metadata : null;
        const sourcePath = Core.isNonEmptyString(metadata?.sourcePath) ? metadata.sourcePath : null;

        if (sourcePath !== filePath) {
            continue;
        }

        runtimeContext.lastSuccessfulPatches.delete(patchId);
        removedCount += 1;
    }

    runtimeContext.sourcePathToPatchIds.delete(filePath);

    return removedCount;
}

export function cleanupRemovedFile(
    runtimeContext: FileRemovalCleanupContext,
    filePath: string,
    verbose: boolean,
    quiet: boolean
): void {
    unregisterScriptName(filePath, runtimeContext.scriptNames);
    runtimeContext.dependencyTracker.removeFile(filePath);
    runtimeContext.fileSnapshots.delete(filePath);
    runtimeContext.fileContentHashes.delete(filePath);
    runtimeContext.fileContentLengths.delete(filePath);
    const removedPatchCount = removeCachedPatchesForFile(runtimeContext, filePath);

    const debouncedHandler = runtimeContext.debouncedHandlers.get(filePath);
    if (debouncedHandler) {
        debouncedHandler.cancel();
        runtimeContext.debouncedHandlers.delete(filePath);
    }

    if (verbose && !quiet) {
        const patchMessage =
            removedPatchCount > 0 ? `cleared ${removedPatchCount} cached patch(es)` : "no cached patch found";
        console.log(`  ↳ Removed dependency tracking (${patchMessage})`);
    }
}
