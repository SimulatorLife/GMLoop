import assert from "node:assert/strict";
import test from "node:test";

import {
    buildProjectIndex,
    createSemanticSnapshotFromProjectIndex,
    type MetricsSnapshot,
    type SemanticSnapshot
} from "../../src/project-index/index.js";
import { createSyntheticScriptProjectWorkspace } from "../test-project-helpers.js";
import {
    createPersistedTierOneQueryHarness,
    measureQueryLatencyP95,
    type PersistedTierOneQueryHarness,
    type QueryLatencyMeasurement
} from "./semantic-query-workload-helpers.js";

type InstrumentedProjectIndex = Record<string, unknown> &
    Readonly<{
        metrics: MetricsSnapshot;
    }>;

type ExpectedBuildMeasurements = Readonly<{
    analysisTier: "definitions" | "full";
    buildMode: "incremental" | "project";
    incrementalSelectedFileCount: number;
    processedFileCount: number;
}>;

const SOURCE_REVISION = "synthetic-workload" as SemanticSnapshot["sourceRevision"];
const WARM_TIER_ONE_MAX_MS = 500;
const WARM_INDEXED_QUERY_MAX_P95_MS = 20;
const WARM_SEARCH_QUERY_MAX_P95_MS = 50;
const RETAINED_HEAP_GROWTH_LIMIT = 0.05;
const LEASE_STABILITY_CYCLE_COUNT = 100;
const LARGE_WORKLOAD_MAX_FULL_BUILD_MS = 30_000;
const LARGE_WORKLOAD_MAX_SAMPLED_PEAK_RSS_BYTES = 768 * 1024 * 1024;

function assertBuildMeasurements(index: InstrumentedProjectIndex, expected: ExpectedBuildMeasurements): void {
    assert.equal(index.metrics.counters["files.gmlRead"], expected.processedFileCount);
    assert.equal(index.metrics.counters["files.gmlParsed"], expected.processedFileCount);
    assert.equal(index.metrics.counters["files.gmlAnalysed"], expected.processedFileCount);
    assert.equal(index.metrics.counters["files.incrementalSelected"], expected.incrementalSelectedFileCount);
    assert.equal(index.metrics.metadata.buildMode, expected.buildMode);
    assert.equal(index.metrics.metadata.analysisTier, expected.analysisTier);
    assert.ok(Object.hasOwn(index.metrics.timings, "total"));
    assert.ok(Object.hasOwn(index.metrics.timings, "gml.parse"));
    assert.ok(Object.hasOwn(index.metrics.timings, "gml.analyse"));
    assert.ok(Number(index.metrics.metadata["memory.sampledPeakRssBytes"]) > 0);
    assert.ok(Number(index.metrics.metadata["memory.sampledPeakHeapUsedBytes"]) > 0);
}

function createFullSnapshot(index: InstrumentedProjectIndex): SemanticSnapshot {
    return createSemanticSnapshotFromProjectIndex(index, "full", SOURCE_REVISION);
}

function relationshipIdsOwnedByFile(snapshot: SemanticSnapshot, filePath: string): ReadonlyArray<string> {
    return snapshot.relationships
        .filter((relationship) => relationship.ownerFilePath === filePath)
        .map((relationship) => relationship.relationshipId);
}

function assertQueryLatencyGate(queryName: string, measurement: QueryLatencyMeasurement, maximumP95Ms: number): void {
    assert.ok(
        measurement.p95Ms <= maximumP95Ms,
        `${queryName} p95 was ${measurement.p95Ms.toFixed(3)}ms; expected at most ${maximumP95Ms.toFixed(1)}ms`
    );
}

async function readRetainedHeapAfterExplicitGc(): Promise<number | null> {
    const collectGarbage = typeof globalThis.gc === "function" ? globalThis.gc : null;
    if (collectGarbage === null) {
        return null;
    }
    for (let pass = 0; pass < 3; pass += 1) {
        collectGarbage();
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return process.memoryUsage().heapUsed;
}

async function runAcquireQueryReleaseCycles(
    harness: PersistedTierOneQueryHarness,
    activeFilePath: string,
    cycleCount: number
): Promise<Readonly<{ acquireCount: number; queryCount: number; releaseCount: number }>> {
    let acquireCount = 0;
    let queryCount = 0;
    let releaseCount = 0;
    for (let cycle = 0; cycle < cycleCount; cycle += 1) {
        const lease = await harness.acquireTierOneLease();
        acquireCount += 1;
        try {
            const documentSymbols = lease.queries.listDocumentSymbols(activeFilePath);
            const target = documentSymbols[0];
            if (target === undefined) {
                throw new Error("The generated active file must retain at least one document symbol.");
            }
            lease.queries.findDefinitions(target.symbol.symbolId);
            lease.queries.findSymbolAtPosition(activeFilePath, target.occurrence.start);
            lease.queries.searchWorkspaceSymbols("synthetic_script_0", 25);
            queryCount += 1;
        } finally {
            lease.release();
            releaseCount += 1;
        }
    }
    return Object.freeze({ acquireCount, queryCount, releaseCount });
}

void test("project index workload is deterministic and limits incremental parsing to selected files", async () => {
    const scriptCount = 40;
    const workspace = await createSyntheticScriptProjectWorkspace({
        prefix: "semantic-project-index-workload-",
        projectName: "SyntheticWorkload",
        scriptCount,
        statementsPerScript: 24
    });

    try {
        const definitionsIndex: InstrumentedProjectIndex = await buildProjectIndex(workspace.projectRoot, undefined, {
            concurrency: { gml: 1, gmlParsing: 1 },
            definitionsOnly: true
        });
        assertBuildMeasurements(definitionsIndex, {
            analysisTier: "definitions",
            buildMode: "project",
            incrementalSelectedFileCount: 0,
            processedFileCount: scriptCount
        });

        const serialFullIndex: InstrumentedProjectIndex = await buildProjectIndex(workspace.projectRoot, undefined, {
            concurrency: { gml: 1, gmlParsing: 1 }
        });
        assertBuildMeasurements(serialFullIndex, {
            analysisTier: "full",
            buildMode: "project",
            incrementalSelectedFileCount: 0,
            processedFileCount: scriptCount
        });

        const concurrentFullIndex: InstrumentedProjectIndex = await buildProjectIndex(
            workspace.projectRoot,
            undefined,
            {
                concurrency: { gml: 4, gmlParsing: 4 }
            }
        );
        assertBuildMeasurements(concurrentFullIndex, {
            analysisTier: "full",
            buildMode: "project",
            incrementalSelectedFileCount: 0,
            processedFileCount: scriptCount
        });
        const serialSnapshot = createFullSnapshot(serialFullIndex);
        const concurrentSnapshot = createFullSnapshot(concurrentFullIndex);
        assert.equal(serialSnapshot.symbols.filter((symbol) => symbol.kind === "localVariable").length, scriptCount);
        assert.equal(serialSnapshot.symbols.filter((symbol) => symbol.kind === "parameter").length, scriptCount);
        assert.equal(
            new Set(serialSnapshot.symbols.map((symbol) => symbol.symbolId)).size,
            serialSnapshot.symbols.length
        );
        assert.deepEqual(
            concurrentSnapshot,
            serialSnapshot,
            "bounded concurrency must not change normalized semantic output"
        );

        const changedScriptIndex = 0;
        const changedFilePath = await workspace.writeSyntheticScriptRevision(changedScriptIndex, 1);
        const incrementalIndex: InstrumentedProjectIndex = await buildProjectIndex(workspace.projectRoot, undefined, {
            concurrency: { gml: 4, gmlParsing: 4 },
            incremental: {
                changes: [{ filePath: changedFilePath, kind: "modified" }],
                existingIndex: concurrentFullIndex
            }
        });
        assertBuildMeasurements(incrementalIndex, {
            analysisTier: "full",
            buildMode: "incremental",
            incrementalSelectedFileCount: 1,
            processedFileCount: 1
        });
        const incrementalSnapshot = createFullSnapshot(incrementalIndex);
        assert.notDeepEqual(
            incrementalSnapshot,
            concurrentSnapshot,
            "the synthetic revision must change canonical semantic facts"
        );
        const unchangedFilePath = workspace.scriptRelativePaths[1];
        assert.deepEqual(
            relationshipIdsOwnedByFile(incrementalSnapshot, unchangedFilePath),
            relationshipIdsOwnedByFile(concurrentSnapshot, unchangedFilePath),
            "adding a call in an earlier file must not change relationship IDs owned by an untouched file"
        );

        const rebuiltFullIndex: InstrumentedProjectIndex = await buildProjectIndex(workspace.projectRoot, undefined, {
            concurrency: { gml: 2, gmlParsing: 2 }
        });
        assert.deepEqual(
            incrementalSnapshot,
            createFullSnapshot(rebuiltFullIndex),
            "one-file incremental analysis must match a fresh full rebuild"
        );
    } finally {
        await workspace.cleanup();
    }
});

void test("serial 500-file workload stays within warm Tier 1, query, retention, Tier 2, and RSS gates", async (context) => {
    const scriptCount = 500;
    const statementsPerScript = 195;
    const workspace = await createSyntheticScriptProjectWorkspace({
        prefix: "semantic-project-index-large-workload-",
        projectName: "SyntheticLargeWorkload",
        scriptCount,
        statementsPerScript
    });
    assert.equal(workspace.scriptFilePaths.length, 500);
    assert.equal(scriptCount * (statementsPerScript + 5), 100_000);

    try {
        const definitionsStartedAt = performance.now();
        const definitionsIndex: InstrumentedProjectIndex = await buildProjectIndex(workspace.projectRoot, undefined, {
            concurrency: { gml: 1, gmlParsing: 1 },
            definitionsOnly: true
        });
        const definitionsDurationMs = performance.now() - definitionsStartedAt;
        assertBuildMeasurements(definitionsIndex, {
            analysisTier: "definitions",
            buildMode: "project",
            incrementalSelectedFileCount: 0,
            processedFileCount: scriptCount
        });

        const activeFilePath = workspace.scriptRelativePaths[0];
        const queryHarness = await createPersistedTierOneQueryHarness({
            activeFilePath,
            index: definitionsIndex,
            projectRoot: workspace.projectRoot
        });
        try {
            const warmAcquisition = await queryHarness.acquireWarmTierOneLease();
            try {
                assert.equal(warmAcquisition.gmlSourceReadCount, 0);
                assert.equal(warmAcquisition.sourceReadCount, 0);
                assert.equal(warmAcquisition.gmlParseCount, 0);
                assert.ok(warmAcquisition.reusedManifestEntryCount >= scriptCount * 2);
                assert.equal(warmAcquisition.lease.identity.tier, "definitions");
                assert.equal(warmAcquisition.lease.identity.coverage.status, "complete");
                assert.ok(
                    warmAcquisition.durationMs <= WARM_TIER_ONE_MAX_MS,
                    `warm Tier 1 acquisition took ${warmAcquisition.durationMs.toFixed(1)}ms; expected at most ${String(WARM_TIER_ONE_MAX_MS)}ms`
                );

                const queries = warmAcquisition.lease.queries;
                const documentSymbols = queries.listDocumentSymbols(activeFilePath);
                const target = documentSymbols.find((match) => match.symbol.kind === "function") ?? documentSymbols[0];
                assert.ok(target, "the generated active file must expose a document symbol");
                assert.ok(queries.findSymbolAtPosition(activeFilePath, target.occurrence.start));
                assert.ok(queries.findDefinitions(target.symbol.symbolId).length > 0);
                assert.ok(queries.searchWorkspaceSymbols("synthetic_script_04", 100).length > 0);
                assert.ok(queries.searchWorkspaceSymbols("synthetic_script_0", 100).length > 0);

                const positionLatency = measureQueryLatencyP95(() => {
                    queries.findSymbolAtPosition(activeFilePath, target.occurrence.start);
                });
                const definitionLatency = measureQueryLatencyP95(() => {
                    queries.findDefinitions(target.symbol.symbolId);
                });
                const documentSymbolLatency = measureQueryLatencyP95(() => {
                    queries.listDocumentSymbols(activeFilePath);
                });
                const workspaceSearchLatency = measureQueryLatencyP95(() => {
                    queries.searchWorkspaceSymbols("synthetic_script_04", 100);
                });
                const completionSearchLatency = measureQueryLatencyP95(() => {
                    queries.searchWorkspaceSymbols("synthetic_script_0", 100);
                });

                assertQueryLatencyGate("position query", positionLatency, WARM_INDEXED_QUERY_MAX_P95_MS);
                assertQueryLatencyGate("definition query", definitionLatency, WARM_INDEXED_QUERY_MAX_P95_MS);
                assertQueryLatencyGate("document-symbol query", documentSymbolLatency, WARM_INDEXED_QUERY_MAX_P95_MS);
                assertQueryLatencyGate("workspace search", workspaceSearchLatency, WARM_SEARCH_QUERY_MAX_P95_MS);
                assertQueryLatencyGate("completion search", completionSearchLatency, WARM_SEARCH_QUERY_MAX_P95_MS);
                context.diagnostic(
                    `warm Tier 1=${warmAcquisition.durationMs.toFixed(1)}ms, position p95=${positionLatency.p95Ms.toFixed(3)}ms, definition p95=${definitionLatency.p95Ms.toFixed(3)}ms, document symbols p95=${documentSymbolLatency.p95Ms.toFixed(3)}ms, workspace p95=${workspaceSearchLatency.p95Ms.toFixed(3)}ms, completion p95=${completionSearchLatency.p95Ms.toFixed(3)}ms`
                );
            } finally {
                warmAcquisition.lease.release();
            }
            assert.deepEqual(queryHarness.readLeaseMetrics(), { activeLeaseCount: 0 });

            await runAcquireQueryReleaseCycles(queryHarness, activeFilePath, 10);
            const retainedHeapBeforeCycles = await readRetainedHeapAfterExplicitGc();
            const cycleCounts = await runAcquireQueryReleaseCycles(
                queryHarness,
                activeFilePath,
                LEASE_STABILITY_CYCLE_COUNT
            );
            assert.deepEqual(cycleCounts, {
                acquireCount: LEASE_STABILITY_CYCLE_COUNT,
                queryCount: LEASE_STABILITY_CYCLE_COUNT,
                releaseCount: LEASE_STABILITY_CYCLE_COUNT
            });
            assert.deepEqual(queryHarness.readLeaseMetrics(), { activeLeaseCount: 0 });
            const retainedHeapAfterCycles = await readRetainedHeapAfterExplicitGc();
            if (retainedHeapBeforeCycles === null || retainedHeapAfterCycles === null) {
                context.diagnostic(
                    "explicit GC is unavailable; lease/resource stability passed and the retained-heap percentage assertion was skipped"
                );
            } else {
                const retainedHeapGrowth = Math.max(0, retainedHeapAfterCycles - retainedHeapBeforeCycles);
                const retainedHeapGrowthRatio = retainedHeapGrowth / retainedHeapBeforeCycles;
                context.diagnostic(
                    `100-cycle retained heap growth=${(retainedHeapGrowthRatio * 100).toFixed(2)}% (${String(retainedHeapGrowth)} bytes)`
                );
                assert.ok(
                    retainedHeapGrowthRatio <= RETAINED_HEAP_GROWTH_LIMIT,
                    `retained heap grew ${(retainedHeapGrowthRatio * 100).toFixed(2)}%; expected at most ${(RETAINED_HEAP_GROWTH_LIMIT * 100).toFixed(1)}%`
                );
            }
        } finally {
            await queryHarness.close();
        }

        const fullStartedAt = performance.now();
        const fullIndex: InstrumentedProjectIndex = await buildProjectIndex(workspace.projectRoot, undefined, {
            concurrency: { gml: 1, gmlParsing: 1 }
        });
        const fullDurationMs = performance.now() - fullStartedAt;
        assertBuildMeasurements(fullIndex, {
            analysisTier: "full",
            buildMode: "project",
            incrementalSelectedFileCount: 0,
            processedFileCount: scriptCount
        });
        const sampledPeakRssBytes = Number(fullIndex.metrics.metadata["memory.sampledPeakRssBytes"]);
        context.diagnostic(
            `500 files/~100k lines: definitions=${definitionsDurationMs.toFixed(1)}ms, full=${fullDurationMs.toFixed(1)}ms, sampledPeakRss=${String(Math.round(sampledPeakRssBytes / (1024 * 1024)))}MiB`
        );
        assert.ok(
            fullDurationMs <= LARGE_WORKLOAD_MAX_FULL_BUILD_MS,
            `full Tier 2 build took ${fullDurationMs.toFixed(1)}ms; expected at most ${String(LARGE_WORKLOAD_MAX_FULL_BUILD_MS)}ms`
        );
        assert.ok(
            sampledPeakRssBytes <= LARGE_WORKLOAD_MAX_SAMPLED_PEAK_RSS_BYTES,
            `sampled peak RSS was ${String(sampledPeakRssBytes)} bytes; expected at most ${String(LARGE_WORKLOAD_MAX_SAMPLED_PEAK_RSS_BYTES)} bytes`
        );
    } finally {
        await workspace.cleanup();
    }
});
