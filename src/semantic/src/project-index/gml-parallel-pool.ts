import os from "node:os";
import { Worker } from "node:worker_threads";

import { type AbortSignalLike, Core } from "@gmloop/core";

import { PROJECT_INDEX_BUILD_ABORT_MESSAGE } from "./abort-guard.js";
import type { ProjectIndexBuildProgress } from "./build-options.js";
import {
    PROJECT_INDEX_GML_WORKER_POOL_MIN_FILES,
    PROJECT_INDEX_GML_WORKER_POOL_MIN_FILES_PER_WORKER
} from "./constants.js";
import type { ProjectIndexFsFacade } from "./fs-facade.js";
import type {
    GmlParallelAccumulatorRecord,
    GmlParallelFileDescriptor,
    GmlParallelIdentifierCollectionEntry,
    GmlParallelIdentifierCollections,
    GmlParallelIdentifierOccurrenceRecord,
    GmlParallelResourceAnalysis,
    GmlParallelWorkerRequest,
    GmlParallelWorkerResponseMessage,
    GmlParallelWorkerResultMessage
} from "./gml-parallel-types.js";
import type { IdentifierSink } from "./identifier-sink.js";
import type { MetricsSnapshot, ProjectIndexMetricsRecording } from "./metrics.js";

/**
 * Worker-thread pool that parallelizes GML project-index file processing
 * across CPU cores.
 *
 * ## Why this is safe
 *
 * Per-file GML analysis (`processProjectGmlFile`) only *appends* to shared
 * accumulators and never reads back entries another file wrote — the
 * resource-metadata analysis (`gmlScopeMap`/`scriptNameToScopeId`/
 * `scriptNameToResourcePath`) it depends on is fully built and read-only
 * before any GML file is processed, and cross-file-deferred work
 * (constructor static-member references, script-call references) is already
 * split into a first pass that only appends to a pending list and a second,
 * strictly-sequential pass that runs once after every file has been
 * processed. Each GML file also maps to exactly one scope id (derived from
 * the object/event or script name), so `scopeMap`/`filesMap` entries never
 * collide across files. The one place multiple files genuinely share a
 * single identifier-collection entry — a macro or `global.` variable
 * referenced from many files — is handled by {@link mergeIdentifierCollections}
 * below, which unions the `declarations`/`references` arrays instead of
 * overwriting them.
 *
 * ## Architecture
 *
 * Each worker runs the exact same `processProjectGmlFilesForIndex` used by
 * the sequential path (see `gml-parallel-worker.ts`), against its own batch
 * of files and local, empty accumulators. This coordinator partitions the
 * file list, spawns one worker per batch, waits for every worker to finish,
 * and only then merges every worker's accumulators into the caller-supplied
 * shared ones — so a failure in any worker never leaves partially-merged
 * state behind and the caller can safely fall back to the sequential path.
 */

function isGmlParallelWorkerResultMessage(
    message: GmlParallelWorkerResponseMessage
): message is GmlParallelWorkerResultMessage {
    return message.type === "result";
}

export type GmlParallelPoolEligibilityParams = Readonly<{
    gmlFiles: ReadonlyArray<GmlParallelFileDescriptor>;
    fsFacade: ProjectIndexFsFacade;
    parseProjectSource: unknown;
    identifierSink: IdentifierSink | null;
    workerConcurrency: number;
}>;

/**
 * Decide whether the worker pool is eligible for this build.
 *
 * The pool is skipped (falling back to the sequential path) whenever it
 * cannot faithfully reproduce the sequential path's behavior:
 *
 * - `identifierSink` writes spill records with synchronous `appendFileSync`
 *   calls against a single file; concurrent workers would race/corrupt it.
 * - A non-default `fsFacade` (tests inject in-memory/mock facades) cannot
 *   cross the worker boundary — closures are not structured-clone-safe —
 *   so workers would silently read from the real filesystem instead.
 * - A custom `parseProjectSource` override is a function value and cannot
 *   cross the worker boundary either.
 * - Small file counts are not worth the spawn/serialize/merge overhead.
 */
export function isGmlParallelPoolEligible({
    gmlFiles,
    fsFacade,
    parseProjectSource,
    identifierSink,
    workerConcurrency
}: GmlParallelPoolEligibilityParams): boolean {
    if (identifierSink !== null) {
        return false;
    }

    if (fsFacade !== Core.defaultFsFacade) {
        return false;
    }

    if (typeof parseProjectSource === "function") {
        return false;
    }

    if (workerConcurrency < 2) {
        return false;
    }

    return gmlFiles.length >= PROJECT_INDEX_GML_WORKER_POOL_MIN_FILES;
}

function partitionGmlFiles(
    gmlFiles: ReadonlyArray<GmlParallelFileDescriptor>,
    workerCount: number
): GmlParallelFileDescriptor[][] {
    const effectiveWorkerCount = Core.clamp(workerCount, 1, gmlFiles.length);
    const baseSize = Math.floor(gmlFiles.length / effectiveWorkerCount);
    const remainder = gmlFiles.length % effectiveWorkerCount;
    const batches: GmlParallelFileDescriptor[][] = [];
    let cursor = 0;
    for (let index = 0; index < effectiveWorkerCount; index++) {
        const size = baseSize + (index < remainder ? 1 : 0);
        if (size > 0) {
            batches.push(gmlFiles.slice(cursor, cursor + size));
        }
        cursor += size;
    }
    return batches;
}

/**
 * Merge one identifier-collection entry from a worker into the shared entry.
 *
 * Scalar/metadata fields follow first-writer-wins semantics (matching
 * `assignIdentifierEntryMetadata`'s "only fill unset fields" behavior on the
 * sequential path); `declarations`/`references` are unioned by
 * concatenation; `declarationKinds` is unioned without duplicates.
 */
/** Union `incomingKinds` into `existingEntry.declarationKinds` without duplicates, matching `Core.pushUnique`'s semantics. */
function mergeDeclarationKinds(existingEntry: GmlParallelIdentifierCollectionEntry, incomingKinds: unknown[]): void {
    const existingKinds = Array.isArray(existingEntry.declarationKinds) ? existingEntry.declarationKinds : [];
    existingEntry.declarationKinds = existingKinds;
    for (const kind of incomingKinds as string[]) {
        if (!existingKinds.includes(kind)) {
            existingKinds.push(kind);
        }
    }
}

/**
 * Backfill scalar/metadata fields onto `existingEntry` from `incomingEntry`,
 * mirroring `assignIdentifierEntryMetadata`'s "only fill unset fields"
 * first-writer-wins semantics. `declarations`/`references` are handled
 * separately (concatenated, not overwritten) by the caller.
 */
function mergeIdentifierCollectionMetadataFields(
    existingEntry: GmlParallelIdentifierCollectionEntry,
    incomingEntry: GmlParallelIdentifierCollectionEntry
): void {
    for (const [field, value] of Object.entries(incomingEntry)) {
        if (field === "declarations" || field === "references" || value === undefined) {
            continue;
        }

        if (field === "declarationKinds" && Array.isArray(value)) {
            mergeDeclarationKinds(existingEntry, value);
            continue;
        }

        if (existingEntry[field] === undefined || existingEntry[field] === null) {
            existingEntry[field] = value;
        }
    }
}

function mergeIdentifierCollectionEntry(
    existingEntry: GmlParallelIdentifierCollectionEntry,
    incomingEntry: GmlParallelIdentifierCollectionEntry
): void {
    mergeIdentifierCollectionMetadataFields(existingEntry, incomingEntry);

    if (Array.isArray(incomingEntry.declarations) && incomingEntry.declarations.length > 0) {
        existingEntry.declarations = [...(existingEntry.declarations ?? []), ...incomingEntry.declarations];
    }
    if (Array.isArray(incomingEntry.references) && incomingEntry.references.length > 0) {
        existingEntry.references = [...(existingEntry.references ?? []), ...incomingEntry.references];
    }
}

function mergeIdentifierCollectionMap(
    target: Map<string, GmlParallelIdentifierCollectionEntry>,
    incoming: Map<string, GmlParallelIdentifierCollectionEntry>
): void {
    for (const [key, entry] of incoming) {
        const existing = target.get(key);
        if (!existing) {
            target.set(key, entry);
            continue;
        }
        mergeIdentifierCollectionEntry(existing, entry);
    }
}

/** Merge every sub-collection (scripts, macros, globals, …) from a worker into the shared identifier collections. */
function mergeIdentifierCollections(
    target: GmlParallelIdentifierCollections,
    incoming: GmlParallelIdentifierCollections
): void {
    for (const collectionName of Object.keys(target) as Array<keyof GmlParallelIdentifierCollections>) {
        mergeIdentifierCollectionMap(target[collectionName], incoming[collectionName]);
    }
}

/**
 * Fold one worker's finalized metrics snapshot into the main thread's shared
 * tracker: counters and cache metrics are additive by construction, and
 * timings are folded through `recordDuration` (when the underlying tracker
 * supports it — the default `Core.createMetricsTracker`-backed recorder
 * always does) so per-phase labels like `gml.parse`/`gml.analyse` keep
 * showing up in the final snapshot exactly as they would on the sequential
 * path, just summed across every worker instead of every file.
 */
function mergeWorkerMetricsSnapshot(metrics: ProjectIndexMetricsRecording, snapshot: MetricsSnapshot): void {
    for (const [label, amount] of Object.entries(snapshot.counters)) {
        metrics.counters.increment(label, amount);
    }
    for (const [cacheName, cacheStats] of Object.entries(snapshot.caches)) {
        for (const [key, amount] of Object.entries(cacheStats)) {
            metrics.caches.recordMetric(cacheName, key, amount);
        }
    }
    for (const [label, durationMs] of Object.entries(snapshot.timings)) {
        metrics.timers.recordDuration?.(label, durationMs);
    }
}

/**
 * Spawn a single worker for one file batch. Resolves with the worker's
 * result (or rejects on any worker-reported error, worker-thread error, or
 * non-zero exit). Progress messages are forwarded via `onProgress` and do
 * not settle the returned promise.
 */
function runGmlParallelWorker(
    request: GmlParallelWorkerRequest,
    onFileProcessed: () => void
): { promise: Promise<GmlParallelWorkerResultMessage>; worker: Worker } {
    const worker = new Worker(new URL("gml-parallel-worker.js", import.meta.url), {
        workerData: request satisfies GmlParallelWorkerRequest
    });

    const promise = new Promise<GmlParallelWorkerResultMessage>((resolve, reject) => {
        let settled = false;
        const settleResolve = (value: GmlParallelWorkerResultMessage): void => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(value);
        };
        const settleReject = (error: unknown): void => {
            if (settled) {
                return;
            }
            settled = true;
            reject(Core.isErrorLike(error) ? error : new Error(Core.getErrorMessageOrFallback(error)));
        };

        worker.on("message", (message: GmlParallelWorkerResponseMessage) => {
            if (message.type === "progress") {
                onFileProcessed();
                return;
            }
            if (message.type === "error") {
                settleReject(new Error(message.error.message));
                return;
            }
            if (isGmlParallelWorkerResultMessage(message)) {
                settleResolve(message);
            }
        });
        worker.on("error", settleReject);
        worker.on("exit", (code) => {
            if (code !== 0) {
                settleReject(new Error(`GML project-index worker exited with code ${String(code)}.`));
            }
        });
    });

    return { promise, worker };
}

export type RunGmlFilesWithWorkerPoolParams = Readonly<{
    gmlFiles: ReadonlyArray<GmlParallelFileDescriptor>;
    workerConcurrency: number;
    gmlConcurrency: number;
    resourceAnalysis: GmlParallelResourceAnalysis;
    scopeMap: Map<string, GmlParallelAccumulatorRecord>;
    filesMap: Map<string, GmlParallelAccumulatorRecord>;
    identifierCollections: GmlParallelIdentifierCollections;
    relationships: { scriptCalls: GmlParallelIdentifierOccurrenceRecord[] };
    builtInNames: ReadonlySet<string>;
    projectRoot: string;
    signal?: AbortSignalLike;
    metrics: ProjectIndexMetricsRecording;
    pendingConstructorStaticMemberReferences: GmlParallelIdentifierOccurrenceRecord[];
    onProgress?: (progress: ProjectIndexBuildProgress) => void;
    definitionsOnly: boolean;
    recordReferences?: boolean;
}>;

/**
 * Run every file in `gmlFiles` across a pool of worker threads and merge the
 * results into the caller-supplied shared accumulators.
 *
 * Nothing is merged into the caller's accumulators until every worker has
 * finished successfully — if any worker fails (or the build is aborted) this
 * throws without having mutated anything, so callers can safely fall back to
 * the sequential path without risk of double-counting partially-merged data.
 */
export async function runProjectGmlFilesWithWorkerPool({
    gmlFiles,
    workerConcurrency,
    gmlConcurrency,
    resourceAnalysis,
    scopeMap,
    filesMap,
    identifierCollections,
    relationships,
    builtInNames,
    projectRoot,
    signal,
    metrics,
    pendingConstructorStaticMemberReferences,
    onProgress,
    definitionsOnly,
    recordReferences = false
}: RunGmlFilesWithWorkerPoolParams): Promise<void> {
    Core.throwIfAborted(signal, PROJECT_INDEX_BUILD_ABORT_MESSAGE);

    const cpuCount = Core.toFiniteNumber(os.cpus().length) ?? 1;
    const maxWorkersForFileCount = Math.max(
        1,
        Math.floor(gmlFiles.length / PROJECT_INDEX_GML_WORKER_POOL_MIN_FILES_PER_WORKER)
    );
    const effectiveWorkerCount = Core.clamp(
        workerConcurrency,
        1,
        Math.min(Math.max(1, cpuCount), maxWorkersForFileCount)
    );
    const batches = partitionGmlFiles(gmlFiles, effectiveWorkerCount);
    metrics.metadata.setMetadata("gmlWorkerPool.batchCount", batches.length);

    const total = gmlFiles.length;
    let processedGlobal = 0;
    const reportProgress = (): void => {
        processedGlobal += 1;
        onProgress?.({ stage: "gml-parse", current: processedGlobal, total });
    };

    const requestBase = {
        gmlConcurrency,
        resourceAnalysis,
        builtInNames: [...builtInNames],
        projectRoot,
        definitionsOnly,
        recordReferences
    };

    const workers: Worker[] = [];
    const abortListener = (): void => {
        for (const worker of workers) {
            void worker.terminate();
        }
    };
    signal?.addEventListener?.("abort", abortListener, { once: true });

    try {
        const outcomes = await Promise.all(
            batches.map((batch) => {
                const request: GmlParallelWorkerRequest = { ...requestBase, gmlFiles: batch };
                const { promise, worker } = runGmlParallelWorker(request, reportProgress);
                workers.push(worker);
                return promise;
            })
        );

        Core.throwIfAborted(signal, PROJECT_INDEX_BUILD_ABORT_MESSAGE);

        const workerPeakMemory: Array<{ peakRss: number; peakHeapUsed: number }> = [];
        for (const outcome of outcomes) {
            for (const [key, value] of outcome.scopeMap) {
                scopeMap.set(key, value);
            }
            for (const [key, value] of outcome.filesMap) {
                filesMap.set(key, value);
            }
            mergeIdentifierCollections(identifierCollections, outcome.identifierCollections);
            relationships.scriptCalls.push(...outcome.scriptCalls);
            pendingConstructorStaticMemberReferences.push(...outcome.pendingConstructorStaticMemberReferences);
            mergeWorkerMetricsSnapshot(metrics, outcome.metrics);
            workerPeakMemory.push({ peakRss: outcome.peakRss, peakHeapUsed: outcome.peakHeapUsed });
        }
        metrics.metadata.setMetadata("gmlWorkerPool.workerPeakMemory", workerPeakMemory);
    } finally {
        signal?.removeEventListener?.("abort", abortListener);
        await Promise.all(
            workers.map(async (worker) => {
                try {
                    await worker.terminate();
                } catch {
                    // Best-effort cleanup: the worker may have already exited normally.
                }
            })
        );
    }
}
