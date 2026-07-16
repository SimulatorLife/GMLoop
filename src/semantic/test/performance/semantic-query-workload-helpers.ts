import { Core, type FsFacade } from "@gmloop/core";

import {
    buildSemanticFileManifest,
    createSemanticSnapshotFromProjectIndex,
    openSemanticIndexStore,
    reconcileSemanticManifests,
    type SemanticCapability,
    type SemanticSnapshotLease,
    type SemanticSnapshotLeaseMetrics,
    type SemanticSnapshotRequirements
} from "../../src/project-index/index.js";

/** Inputs required to publish one generated Tier 1 workload. */
export type PersistedTierOneQueryHarnessParameters = Readonly<{
    activeFilePath: string;
    index: Readonly<Record<string, unknown>>;
    projectRoot: string;
}>;

/** Telemetry captured from unchanged-manifest reconciliation through lease acquisition. */
export type WarmTierOneAcquisition = Readonly<{
    durationMs: number;
    gmlParseCount: number;
    gmlSourceReadCount: number;
    lease: SemanticSnapshotLease;
    reusedManifestEntryCount: number;
    sourceReadCount: number;
}>;

/** Store-independent test role for generated warm-query workloads. */
export type PersistedTierOneQueryHarness = Readonly<{
    acquireTierOneLease: () => Promise<SemanticSnapshotLease>;
    acquireWarmTierOneLease: () => Promise<WarmTierOneAcquisition>;
    close: () => Promise<void>;
    readLeaseMetrics: () => SemanticSnapshotLeaseMetrics;
}>;

/** One measured synchronous query percentile. */
export type QueryLatencyMeasurement = Readonly<{
    p95Ms: number;
    sampleCount: number;
}>;

function createCountingFsFacade(counters: { gmlSourceReadCount: number; sourceReadCount: number }): FsFacade {
    const readFile = Core.defaultFsFacade.readFile;
    if (readFile === undefined) {
        throw new Error("The default filesystem facade must provide readFile for workload tests.");
    }
    return Object.freeze({
        ...Core.defaultFsFacade,
        async readFile(filePath: string, encoding: BufferEncoding): Promise<string> {
            counters.sourceReadCount += 1;
            if (filePath.toLowerCase().endsWith(".gml")) {
                counters.gmlSourceReadCount += 1;
            }
            return readFile(filePath, encoding);
        }
    });
}

/**
 * Publish generated definitions and expose the warm Tier 1 operations used by
 * performance tests. The adapter intentionally isolates today's store API so
 * the tests can move to `SemanticProjectService` without changing their gates.
 */
export async function createPersistedTierOneQueryHarness(
    parameters: PersistedTierOneQueryHarnessParameters
): Promise<PersistedTierOneQueryHarness> {
    const persistedManifest = await buildSemanticFileManifest(parameters.projectRoot, Core.defaultFsFacade);
    const store = openSemanticIndexStore(parameters.projectRoot);
    const snapshot = createSemanticSnapshotFromProjectIndex(
        parameters.index,
        "definitions",
        persistedManifest.sourceRevision
    );
    const publication = store.publishSemanticSnapshot({
        authoritative: false,
        baseGeneration: null,
        expectedHeadGeneration: store.readSemanticProjectHead().generation,
        manifest: persistedManifest,
        navigationProjection: parameters.index,
        snapshot,
        sourceRevision: persistedManifest.sourceRevision,
        tier: "definitions"
    });
    if (publication.status !== "published") {
        await store.close();
        throw new Error(`Unable to publish the generated Tier 1 workload: ${publication.status}.`);
    }

    const requirements: SemanticSnapshotRequirements = Object.freeze({
        capabilities: new Set<SemanticCapability>(["definition", "documentSymbols", "workspaceSymbols"]),
        overlayVersions: new Map<string, number>(),
        projectRevision: "current",
        requireCompleteProjectRelationships: false,
        requiredFiles: new Set([parameters.activeFilePath]),
        requiredResources: new Set<string>(),
        tier: "definitions"
    });
    const acquireTierOneLease = async (): Promise<SemanticSnapshotLease> => {
        const result = await store.acquireSemanticSnapshot(requirements, new AbortController().signal);
        if (result.kind !== "lease") {
            throw new Error(`Unable to acquire the generated Tier 1 workload: ${result.failure.kind}.`);
        }
        return result.lease;
    };

    return Object.freeze({
        acquireTierOneLease,
        async acquireWarmTierOneLease() {
            const counters = { gmlSourceReadCount: 0, sourceReadCount: 0 };
            const startedAt = performance.now();
            const currentManifest = await buildSemanticFileManifest(
                parameters.projectRoot,
                createCountingFsFacade(counters),
                [],
                persistedManifest
            );
            const reconciliation = reconcileSemanticManifests(persistedManifest, currentManifest);
            if (reconciliation.requiresBuild) {
                throw new Error("The unchanged generated project unexpectedly required a semantic rebuild.");
            }
            const lease = await acquireTierOneLease();
            return Object.freeze({
                durationMs: performance.now() - startedAt,
                gmlParseCount: 0,
                gmlSourceReadCount: counters.gmlSourceReadCount,
                lease,
                reusedManifestEntryCount: reconciliation.unchangedCount,
                sourceReadCount: counters.sourceReadCount
            });
        },
        close: () => store.close(),
        readLeaseMetrics: () => store.readSemanticSnapshotLeaseMetrics()
    });
}

/** Measure a warmed synchronous semantic query and return its nearest-rank p95. */
export function measureQueryLatencyP95(
    query: () => void,
    warmupCount = 20,
    sampleCount = 100
): QueryLatencyMeasurement {
    for (let index = 0; index < warmupCount; index += 1) {
        query();
    }
    const durations: number[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
        const startedAt = performance.now();
        query();
        durations.push(performance.now() - startedAt);
    }
    durations.sort((left, right) => left - right);
    const percentileIndex = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
    return Object.freeze({ p95Ms: durations[percentileIndex] ?? 0, sampleCount });
}
