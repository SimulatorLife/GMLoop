import { parentPort, workerData } from "node:worker_threads";

import { Core } from "@gmloop/core";

import { createIdentifierCollections, processProjectGmlFilesForIndex } from "./builder.js";
import type {
    GmlParallelIdentifierOccurrenceRecord,
    GmlParallelWorkerErrorPayload,
    GmlParallelWorkerRequest,
    GmlParallelWorkerResponseMessage
} from "./gml-parallel-types.js";

/**
 * One-shot worker-thread entry point for the GML project-index worker pool.
 *
 * Deliberately thin: all real work happens inside the unmodified
 * `processProjectGmlFilesForIndex` (re-exported from builder.ts). This file
 * only wires that function to a local, empty set of accumulators — the same
 * shape `processProjectGmlFilesForIndex` already receives on the
 * single-threaded path — and reports the populated accumulators back to the
 * main thread once the worker's file batch is fully processed. No parsing or
 * semantic-analysis logic is duplicated here, so the parallel and sequential
 * paths can never drift from one another.
 *
 * The worker never receives an `AbortSignal`: the pool coordinator in
 * `gml-parallel-pool.ts` cancels in-flight work by calling `worker.terminate()`
 * directly, which is both simpler and more prompt than threading a signal
 * across the worker boundary and waiting for cooperative checks.
 */

if (parentPort === null) {
    throw new Error("GML project-index worker requires a parent thread.");
}

const activeParentPort = parentPort;

function normalizeWorkerError(error: unknown): GmlParallelWorkerErrorPayload {
    return {
        message: Core.isErrorLike(error) ? error.message : Core.getErrorMessageOrFallback(error),
        name: Core.isErrorLike(error) && typeof error.name === "string" ? error.name : "Error",
        stack: Core.isErrorLike(error) && typeof error.stack === "string" ? error.stack : undefined
    };
}

function postResponse(message: GmlParallelWorkerResponseMessage): void {
    activeParentPort.postMessage(message);
}

async function runGmlParallelWorker(request: GmlParallelWorkerRequest): Promise<void> {
    const scopeMap = new Map<string, Record<string, unknown>>();
    const filesMap = new Map<string, Record<string, unknown>>();
    const identifierCollections = createIdentifierCollections();
    const scriptCalls: GmlParallelIdentifierOccurrenceRecord[] = [];
    const relationships = { scriptCalls, assetReferences: [] as GmlParallelIdentifierOccurrenceRecord[] };
    const pendingConstructorStaticMemberReferences: GmlParallelIdentifierOccurrenceRecord[] = [];
    const metricsTracker = Core.createMetricsTracker({ category: "project-index-worker" });

    let peakRss = 0;
    let peakHeapUsed = 0;
    const recordMemorySample = (): void => {
        const snapshot = process.memoryUsage();
        peakRss = Math.max(peakRss, snapshot.rss);
        peakHeapUsed = Math.max(peakHeapUsed, snapshot.heapUsed);
    };

    await processProjectGmlFilesForIndex({
        gmlFiles: request.gmlFiles,
        gmlConcurrency: request.gmlConcurrency,
        parseProjectSource: undefined,
        fsFacade: Core.defaultFsFacade,
        metrics: metricsTracker.recording,
        ensureNotAborted: () => {},
        resourceAnalysis: request.resourceAnalysis,
        scopeMap,
        filesMap,
        identifierCollections,
        relationships,
        builtInNames: new Set(request.builtInNames),
        projectRoot: request.projectRoot,
        signal: undefined,
        identifierSink: null,
        constructorStaticMemberReferences: pendingConstructorStaticMemberReferences,
        recordMemorySample,
        onProgress: () => {
            postResponse({ type: "progress" });
        },
        definitionsOnly: request.definitionsOnly
    });

    postResponse({
        type: "result",
        scopeMap,
        filesMap,
        identifierCollections,
        scriptCalls,
        pendingConstructorStaticMemberReferences,
        metrics: metricsTracker.reporting.summary.finalize(),
        peakRss,
        peakHeapUsed
    });
}

void runGmlParallelWorker(workerData as GmlParallelWorkerRequest).catch((error: unknown) => {
    postResponse({ type: "error", error: normalizeWorkerError(error) });
});
