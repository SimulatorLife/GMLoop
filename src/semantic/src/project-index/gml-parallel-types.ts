import { createIdentifierCollections } from "./builder.js";
import type { MetricsSnapshot } from "./metrics.js";

/**
 * Shared message/data contracts for the GML project-index worker-thread
 * pool. Kept in a dedicated module (rather than inline in the pool or worker
 * files) so neither side needs to import the other: `gml-parallel-worker.ts`
 * runs top-level side-effecting code as soon as it is imported (it wires up
 * `parentPort` and starts processing), so the main-thread pool must never
 * import it directly for types alone.
 *
 * The accumulator records exchanged with workers (scope/file/identifier
 * entries) are dynamic, heterogeneous record shapes that builder.ts itself
 * has never modeled with precise interfaces. Rather than fabricating a
 * parallel type hierarchy that could drift from the real shapes, these
 * contracts model them as `Record<string, unknown>` bags with the handful of
 * fields the merge logic actually needs (`declarations`, `references`,
 * `declarationKinds`) narrowed explicitly.
 */

/** Minimal file descriptor accepted by `processProjectGmlFilesForIndex`. */
export type GmlParallelFileDescriptor = Readonly<{
    absolutePath: string;
    relativePath: string;
}>;

/** Opaque per-occurrence record (declaration or reference) carried in an identifier collection entry. */
export type GmlParallelIdentifierOccurrenceRecord = Record<string, unknown>;

/** Opaque scope/file accumulator record produced by `ensureScopeRecord`/`ensureFileRecord`. */
export type GmlParallelAccumulatorRecord = Record<string, unknown>;

/** Opaque identifier-collection entry (one per script/macro/global/etc.). */
export type GmlParallelIdentifierCollectionEntry = {
    declarations?: GmlParallelIdentifierOccurrenceRecord[];
    references?: GmlParallelIdentifierOccurrenceRecord[];
    declarationKinds?: string[];
} & Record<string, unknown>;

/**
 * Subset of the project-wide resource analysis that per-file GML processing
 * actually reads. `resourcesMap` and `assetReferences` are intentionally
 * omitted: they are populated once up front from `.yy` metadata and are
 * never touched by `processProjectGmlFile`, so trimming them keeps the
 * structured-clone payload sent to each worker smaller.
 */
export type GmlParallelResourceAnalysis = Readonly<{
    gmlScopeMap: Map<string, GmlParallelAccumulatorRecord>;
    scriptNameToResourcePath: Map<string, string>;
    scriptNameToScopeId: Map<string, string>;
}>;

export type GmlParallelIdentifierCollections = ReturnType<typeof createIdentifierCollections>;

/** Immutable request payload delivered to a worker via `workerData`. */
export type GmlParallelWorkerRequest = Readonly<{
    gmlFiles: ReadonlyArray<GmlParallelFileDescriptor>;
    gmlConcurrency: number;
    resourceAnalysis: GmlParallelResourceAnalysis;
    builtInNames: ReadonlyArray<string>;
    projectRoot: string;
    definitionsOnly: boolean;
    recordReferences: boolean;
}>;

export type GmlParallelWorkerErrorPayload = Readonly<{
    message: string;
    name: string;
    stack: string | undefined;
}>;

export type GmlParallelWorkerProgressMessage = Readonly<{
    type: "progress";
}>;

export type GmlParallelWorkerErrorMessage = Readonly<{
    type: "error";
    error: GmlParallelWorkerErrorPayload;
}>;

/**
 * Terminal success payload posted by a worker once its batch is fully
 * processed. Every field is plain, structured-clone-safe data produced by
 * calling the unmodified `processProjectGmlFilesForIndex` against the
 * worker's own empty `scopeMap`/`filesMap`/`identifierCollections`/
 * `relationships`/pending-references accumulators.
 */
export type GmlParallelWorkerResultMessage = Readonly<{
    type: "result";
    scopeMap: Map<string, GmlParallelAccumulatorRecord>;
    filesMap: Map<string, GmlParallelAccumulatorRecord>;
    identifierCollections: GmlParallelIdentifierCollections;
    scriptCalls: GmlParallelIdentifierOccurrenceRecord[];
    pendingConstructorStaticMemberReferences: GmlParallelIdentifierOccurrenceRecord[];
    metrics: MetricsSnapshot;
    peakRss: number;
    peakHeapUsed: number;
}>;

export type GmlParallelWorkerResponseMessage =
    GmlParallelWorkerErrorMessage | GmlParallelWorkerProgressMessage | GmlParallelWorkerResultMessage;
