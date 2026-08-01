import assert from "node:assert/strict";
import test from "node:test";

import { Core } from "@gmloop/core";

import {
    buildProjectIndex,
    createSemanticSnapshotFromProjectIndex,
    type MetricsSnapshot,
    type SemanticSnapshot
} from "../src/project-index/index.js";
import { createSyntheticScriptProjectWorkspace } from "./test-project-helpers.js";

/**
 * Verifies that parallelizing `processProjectGmlFilesForIndex` across the
 * worker-thread pool (`gml-parallel-pool.ts`/`gml-parallel-worker.ts`)
 * produces the same semantic facts as the sequential single-threaded path,
 * including for the identifier collections that are genuinely shared across
 * files (macros, `global.` variables, and constructor static members) and
 * therefore require the pool's cross-worker merge logic to run correctly.
 *
 * Uses `worker: 1` to force the sequential fallback (workers require
 * `workerConcurrency >= 2`, see `isGmlParallelPoolEligible`) and a larger
 * worker concurrency to force the pool path, then asserts the resulting
 * `ProjectIndexSnapshot`s are equivalent after the normal `full` semantic
 * snapshot's deterministic sort/normalization
 * (`createSemanticSnapshotFromProjectIndex` sorts every occurrence via
 * `compareSemanticOccurrences`), plus a handful of direct, human-readable
 * assertions against the raw project index so a broken merge cannot pass
 * merely by having both runs agree with each other while both being wrong.
 */

type InstrumentedProjectIndex = Record<string, unknown> &
    Readonly<{
        metrics: MetricsSnapshot;
    }>;

type IdentifierOccurrenceRecord = Readonly<{ filePath?: string; name?: string }>;

type IdentifierCollectionEntry = Readonly<{
    name?: string;
    constructorName?: string;
    declarations?: ReadonlyArray<IdentifierOccurrenceRecord>;
    references?: ReadonlyArray<IdentifierOccurrenceRecord>;
}>;

type RawProjectIndexIdentifiers = Readonly<{
    macros: Record<string, IdentifierCollectionEntry>;
    globalVariables: Record<string, IdentifierCollectionEntry>;
    constructorStaticMembers: Record<string, IdentifierCollectionEntry>;
    scripts: Record<string, IdentifierCollectionEntry>;
}>;

type RawProjectIndex = InstrumentedProjectIndex &
    Readonly<{
        identifiers: RawProjectIndexIdentifiers;
    }>;

const SOURCE_REVISION = "worker-pool-equivalence" as SemanticSnapshot["sourceRevision"];

const SCRIPT_COUNT = 48;
// Spread the "referencer" scripts across the file list so a >=32-file worker
// pool (batches of roughly equal size) is guaranteed to split them across
// more than one worker/batch, exercising the cross-worker merge path for
// the macro/global/constructor-static-member identifier collections.
const REFERENCER_SCRIPT_INDEXES = [1, 12, 24, 36, 47];
const DECLARING_SCRIPT_INDEX = 0;

// The exact shapes below (receiver stored as `self.<field> = new X()` inside
// a constructor, then called as `<field>.<member>()` from another method of
// that SAME constructor) were verified empirically against this analyzer's
// actual constructor-static-member and global-variable resolution rules
// (see `tmp/repro-static2.mjs` used during development): a bare local
// `var counter = new SharedCounter(); counter.increment();` inside a plain
// function does NOT resolve as a constructor-static-member reference, and a
// bare macro identifier used outside its declaring file is never classified
// as a macro reference at all. Only the instance-field-receiver pattern
// resolves, and only global-variable occurrences are always references
// (this analyzer never treats `global.x = value` as a canonical
// "declaration" — every `global.` occurrence, including the assignment, is
// recorded as a reference).
function createDeclaringScriptSource(): string {
    return [
        "#macro SHARED_LIMIT 100",
        "",
        "function SharedCounter() constructor {",
        "    static increment = function() {",
        "        global.shared_tally += 1;",
        "        return global.shared_tally;",
        "    };",
        "}",
        ""
    ].join("\n");
}

function createReferencerScriptSource(scriptName: string): string {
    return [
        `function ${scriptName}() constructor {`,
        "    self.counter = new SharedCounter();",
        "",
        "    static run = function() {",
        "        counter.increment();",
        "        var limited = min(5, SHARED_LIMIT);",
        "        global.shared_tally += limited;",
        "        return counter;",
        "    };",
        "}",
        ""
    ].join("\n");
}

async function createWorkerPoolFixtureWorkspace() {
    const workspace = await createSyntheticScriptProjectWorkspace({
        prefix: "semantic-worker-pool-equivalence-",
        projectName: "SyntheticWorkerPoolEquivalence",
        scriptCount: SCRIPT_COUNT,
        statementsPerScript: 6
    });

    await workspace.writeProjectFile(
        workspace.scriptRelativePaths[DECLARING_SCRIPT_INDEX],
        createDeclaringScriptSource()
    );
    for (const scriptIndex of REFERENCER_SCRIPT_INDEXES) {
        await workspace.writeProjectFile(
            workspace.scriptRelativePaths[scriptIndex],
            createReferencerScriptSource(workspace.scriptNames[scriptIndex])
        );
    }

    return workspace;
}

function createFullSnapshot(index: InstrumentedProjectIndex): SemanticSnapshot {
    return createSemanticSnapshotFromProjectIndex(index, "full", SOURCE_REVISION);
}

void test("worker-pool parallel GML processing matches the sequential path exactly", async () => {
    assert.ok(SCRIPT_COUNT >= 32, "fixture must exceed PROJECT_INDEX_GML_WORKER_POOL_MIN_FILES to engage the pool");

    const workspace = await createWorkerPoolFixtureWorkspace();

    try {
        const sequentialIndex = (await buildProjectIndex(workspace.projectRoot, undefined, {
            concurrency: { gml: 4, gmlParsing: 4, worker: 1 }
        })) as RawProjectIndex;
        const parallelIndex = (await buildProjectIndex(workspace.projectRoot, undefined, {
            concurrency: { gml: 4, gmlParsing: 4, worker: 6 }
        })) as RawProjectIndex;

        // Confirm the two builds actually exercised different code paths —
        // otherwise an equivalence assertion below would be vacuous.
        assert.equal(
            sequentialIndex.metrics.metadata["gmlWorkerPool.batchCount"],
            undefined,
            "worker: 1 must stay under the pool's workerConcurrency >= 2 eligibility threshold"
        );
        const parallelBatchCount = parallelIndex.metrics.metadata["gmlWorkerPool.batchCount"];
        assert.equal(typeof parallelBatchCount, "number");
        assert.ok(Number(parallelBatchCount) >= 1, "the worker pool must have run at least one batch");
        assert.equal(sequentialIndex.metrics.counters["gmlWorkerPool.fallbackToSequential"], undefined);
        assert.equal(parallelIndex.metrics.counters["gmlWorkerPool.fallbackToSequential"], undefined);

        // Direct, explicit assertions against the genuinely cross-file-shared
        // identifier collections: both builds must see the SAME declaration/
        // reference counts, not merely agree with each other by coincidence.
        // Expected counts were verified empirically against this analyzer's
        // actual resolution rules (see the fixture builders above).
        const declaringFilePath = workspace.scriptRelativePaths[DECLARING_SCRIPT_INDEX];
        const referencerFilePaths = REFERENCER_SCRIPT_INDEXES.map(
            (scriptIndex) => workspace.scriptRelativePaths[scriptIndex]
        );

        for (const [label, index] of [
            ["sequential", sequentialIndex],
            ["parallel", parallelIndex]
        ] as const) {
            const macro = index.identifiers.macros.SHARED_LIMIT;
            assert.ok(macro, `${label}: SHARED_LIMIT macro must be indexed`);
            assert.equal(macro.declarations?.length, 1, `${label}: macro declared exactly once`);
            assert.deepEqual(
                new Set(macro.declarations?.map((declaration) => declaration.filePath)),
                new Set([declaringFilePath]),
                `${label}: macro declaration must be attributed to the declaring file`
            );

            // This analyzer never resolves a bare macro identifier used
            // outside its declaring file as a "macro reference" (confirmed
            // empirically), so there is nothing cross-file to merge here —
            // this assertion exists to catch a regression that starts
            // fabricating spurious macro references under the pool, not to
            // claim macro references are a genuinely shared collection.
            assert.equal(macro.references?.length, 0, `${label}: macro has no resolved cross-file references`);

            const globalVariable = index.identifiers.globalVariables.shared_tally;
            assert.ok(globalVariable, `${label}: global.shared_tally must be indexed`);
            assert.equal(
                globalVariable.declarations?.length,
                0,
                `${label}: global variables are always recorded as references, never declarations`
            );
            assert.equal(
                globalVariable.references?.length,
                2 + REFERENCER_SCRIPT_INDEXES.length,
                `${label}: 2 occurrences in the declaring file (+=1, return) plus 1 per referencer file`
            );
            assert.deepEqual(
                new Set(globalVariable.references?.map((reference) => reference.filePath)),
                new Set([declaringFilePath, ...referencerFilePaths]),
                `${label}: global references must span the declaring file and every referencer file`
            );

            const staticMember = index.identifiers.constructorStaticMembers["SharedCounter.increment"];
            assert.ok(staticMember, `${label}: SharedCounter.increment must be indexed`);
            assert.equal(staticMember.declarations?.length, 1, `${label}: static member declared exactly once`);
            assert.deepEqual(
                new Set(staticMember.declarations?.map((declaration) => declaration.filePath)),
                new Set([declaringFilePath]),
                `${label}: static member declaration must be attributed to the declaring file`
            );
            assert.equal(
                staticMember.references?.length,
                REFERENCER_SCRIPT_INDEXES.length,
                `${label}: static member referenced once per referencer script`
            );
            assert.deepEqual(
                new Set(staticMember.references?.map((reference) => reference.filePath)),
                new Set(referencerFilePaths),
                `${label}: static member references must be attributed to every referencer file`
            );

            assert.equal(Object.keys(index.identifiers.scripts).length, SCRIPT_COUNT);
        }

        const sequentialSnapshot = createFullSnapshot(sequentialIndex);
        const parallelSnapshot = createFullSnapshot(parallelIndex);
        assert.deepEqual(
            parallelSnapshot,
            sequentialSnapshot,
            "the worker pool must not change normalized semantic output relative to the sequential path"
        );
    } finally {
        await workspace.cleanup();
    }
});

void test("the worker pool is skipped below the file-count threshold", async () => {
    const workspace = await createSyntheticScriptProjectWorkspace({
        prefix: "semantic-worker-pool-below-threshold-",
        projectName: "SyntheticWorkerPoolBelowThreshold",
        scriptCount: 4,
        statementsPerScript: 4
    });

    try {
        const index = (await buildProjectIndex(workspace.projectRoot, undefined, {
            concurrency: { gml: 4, gmlParsing: 4, worker: 8 }
        })) as InstrumentedProjectIndex;
        assert.equal(index.metrics.metadata["gmlWorkerPool.batchCount"], undefined);
    } finally {
        await workspace.cleanup();
    }
});

void test("the worker pool is skipped when the identifier sink is enabled", async () => {
    const workspace = await createSyntheticScriptProjectWorkspace({
        prefix: "semantic-worker-pool-identifier-sink-",
        projectName: "SyntheticWorkerPoolIdentifierSink",
        scriptCount: SCRIPT_COUNT,
        statementsPerScript: 4
    });

    try {
        const index = (await buildProjectIndex(workspace.projectRoot, undefined, {
            concurrency: { gml: 4, gmlParsing: 4, worker: 8 },
            identifierSink: { enabled: true }
        })) as InstrumentedProjectIndex;
        assert.equal(
            index.metrics.metadata["gmlWorkerPool.batchCount"],
            undefined,
            "the identifier sink appends synchronously to a single spill file and is not safe under concurrent workers"
        );
    } finally {
        await workspace.cleanup();
    }
});

void test("the worker pool is skipped for a non-default fsFacade", async () => {
    const workspace = await createSyntheticScriptProjectWorkspace({
        prefix: "semantic-worker-pool-custom-fsfacade-",
        projectName: "SyntheticWorkerPoolCustomFsFacade",
        scriptCount: SCRIPT_COUNT,
        statementsPerScript: 4
    });

    try {
        const passthroughFsFacade = { ...Core.defaultFsFacade };
        const index = (await buildProjectIndex(workspace.projectRoot, passthroughFsFacade, {
            concurrency: { gml: 4, gmlParsing: 4, worker: 8 }
        })) as InstrumentedProjectIndex;
        assert.equal(
            index.metrics.metadata["gmlWorkerPool.batchCount"],
            undefined,
            "a custom fsFacade cannot cross the worker-thread boundary, so the pool must stay disabled"
        );
    } finally {
        await workspace.cleanup();
    }
});
