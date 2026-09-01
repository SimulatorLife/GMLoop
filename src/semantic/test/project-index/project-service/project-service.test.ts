import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { Core } from "@gmloop/core";

import { createProjectService } from "../../../src/project-index/project-service/index.js";
import { createProjectServiceWithBuilder } from "../../../src/project-index/project-service/project-service.js";
import type { SemanticProjectIndexBuilder } from "../../../src/project-index/project-service/project-session.js";
import type {
    SemanticCapability,
    SemanticSnapshotAcquireResult,
    SemanticSnapshotLease,
    SemanticSnapshotRequirements,
    SemanticTier
} from "../../../src/project-index/semantic-snapshot.js";
import { createTempProjectWorkspace } from "../../test-project-helpers.js";

const MAIN_FILE_PATH = "scripts/main.gml";
const MAIN_SYMBOL_ID = "gml/function/main";

function resolveNothing(): void {}

type Deferred = Readonly<{
    promise: Promise<void>;
    resolve: () => void;
}>;

type FakeBuilderCall = Readonly<{
    definitionsOnly: boolean;
    incrementalChangeCount: number;
    signal: AbortSignal;
    sourceText: string;
}>;

type FakeBuilderGate = Readonly<{
    entered: Deferred;
    released: Deferred;
}>;

function createDeferred(): Deferred {
    let resolvePromise = resolveNothing;
    const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
    });
    return Object.freeze({ promise, resolve: resolvePromise });
}

async function waitForBuildGate(gate: Deferred, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        throw new Error("Fake semantic build was aborted.");
    }
    await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
            signal.removeEventListener("abort", onAbort);
            reject(new Error("Fake semantic build was aborted."));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        void gate.promise.then(() => {
            signal.removeEventListener("abort", onAbort);
            return resolve();
        });
    });
}

function createFakeBuilder(): Readonly<{
    blockNextBuild: () => FakeBuilderGate;
    builder: SemanticProjectIndexBuilder;
    calls: ReadonlyArray<FakeBuilderCall>;
}> {
    const calls: FakeBuilderCall[] = [];
    let nextGate: FakeBuilderGate | null = null;
    const builder: SemanticProjectIndexBuilder = async (projectRoot, fsFacade = Core.defaultFsFacade, options = {}) => {
        const readFile = fsFacade.readFile ?? Core.defaultFsFacade.readFile;
        if (readFile === undefined || options.signal === undefined) {
            throw new Error("Fake semantic builder requires readFile and a session-owned signal.");
        }
        const sourceText = await readFile(path.join(projectRoot, MAIN_FILE_PATH), "utf8");
        calls.push(
            Object.freeze({
                definitionsOnly: options.definitionsOnly === true,
                incrementalChangeCount: options.incremental?.changes.length ?? 0,
                signal: options.signal,
                sourceText
            })
        );
        const gate = nextGate;
        nextGate = null;
        if (gate !== null) {
            gate.entered.resolve();
            await waitForBuildGate(gate.released, options.signal);
        }
        return {
            files: { [MAIN_FILE_PATH]: { contentHash: sourceText } },
            identifiers: {
                functions: {
                    main: {
                        declarations: [
                            {
                                filePath: MAIN_FILE_PATH,
                                location: { end: { index: 3 }, start: { index: 0 } }
                            }
                        ],
                        displayName: sourceText.trim(),
                        filePath: MAIN_FILE_PATH,
                        identifierId: MAIN_SYMBOL_ID,
                        name: "main",
                        references: [
                            {
                                filePath: MAIN_FILE_PATH,
                                location: { end: { index: 8 }, start: { index: 5 } }
                            }
                        ]
                    }
                }
            },
            projectRoot,
            resources: {},
            scopes: {}
        };
    };
    return Object.freeze({
        blockNextBuild: () => {
            if (nextGate !== null) {
                throw new Error("A fake semantic build is already blocked.");
            }
            const gate = Object.freeze({ entered: createDeferred(), released: createDeferred() });
            nextGate = gate;
            return gate;
        },
        builder,
        calls
    });
}

function createRequirements(
    tier: SemanticTier,
    overlayVersions: ReadonlyMap<string, number> = new Map()
): SemanticSnapshotRequirements {
    const capabilities: ReadonlySet<SemanticCapability> =
        tier === "definitions" ? new Set(["definition"]) : new Set(["references"]);
    return Object.freeze({
        capabilities,
        overlayVersions,
        projectRevision: "current",
        requireCompleteProjectRelationships: tier === "full",
        requiredFiles: new Set([MAIN_FILE_PATH]),
        requiredResources: new Set<string>(),
        tier
    });
}

function requireLease(result: SemanticSnapshotAcquireResult): SemanticSnapshotLease {
    if (result.kind !== "lease") {
        throw new Error(`Expected a semantic snapshot lease, received ${result.failure.kind}.`);
    }
    return result.lease;
}

void test("project services deduplicate normalized roots and reopen closed sessions without exposing internals", async () => {
    const workspace = await createTempProjectWorkspace("gmloop-semantic-project-service-roots-");
    const fakeBuilder = createFakeBuilder();
    const service = createProjectServiceWithBuilder({}, fakeBuilder.builder);
    try {
        assert.equal(typeof createProjectService, "function");
        const session = service.openProject(workspace.projectRoot);
        assert.equal(service.openProject(path.join(workspace.projectRoot, ".")), session);
        assert.deepEqual(Object.keys(session).toSorted(), [
            "acquireSnapshot",
            "applyDiskChanges",
            "applyOverlayChanges",
            "close",
            "projectRoot"
        ]);
        assert.equal("store" in session, false);
        assert.equal("projectIndex" in session, false);
        await session.close();
        assert.notEqual(service.openProject(workspace.projectRoot), session);
    } finally {
        await service.close();
        await workspace.cleanup();
    }
});

void test("overlay versions are atomic, isolated, and republished without rebuilding identical content", async () => {
    const workspace = await createTempProjectWorkspace("gmloop-semantic-project-service-overlay-");
    await workspace.writeProjectFile(MAIN_FILE_PATH, "disk");
    const fakeBuilder = createFakeBuilder();
    const service = createProjectServiceWithBuilder({}, fakeBuilder.builder);
    try {
        const session = service.openProject(workspace.projectRoot);
        session.applyOverlayChanges({
            changes: [{ documentVersion: 1, filePath: MAIN_FILE_PATH, kind: "upsert", sourceText: "overlay" }]
        });
        const firstLease = requireLease(
            await session.acquireSnapshot(
                createRequirements("definitions", new Map([[MAIN_FILE_PATH, 1]])),
                new AbortController().signal
            )
        );
        assert.equal(firstLease.queries.findSymbol(MAIN_SYMBOL_ID)?.displayName, "overlay");
        const firstGeneration = firstLease.identity.generation;
        firstLease.release();
        assert.equal(fakeBuilder.calls.length, 1);

        session.applyOverlayChanges({
            changes: [{ documentVersion: 2, filePath: MAIN_FILE_PATH, kind: "upsert", sourceText: "overlay" }]
        });
        const secondLease = requireLease(
            await session.acquireSnapshot(
                createRequirements("definitions", new Map([[MAIN_FILE_PATH, 2]])),
                new AbortController().signal
            )
        );
        assert.equal(secondLease.identity.overlayVersions.get(MAIN_FILE_PATH), 2);
        assert.equal(secondLease.identity.generation > firstGeneration, true);
        assert.equal(secondLease.queries.findSymbol(MAIN_SYMBOL_ID)?.displayName, "overlay");
        secondLease.release();
        assert.equal(fakeBuilder.calls.length, 1, "version-only updates must reuse canonical facts");

        assert.throws(
            () =>
                session.applyOverlayChanges({
                    changes: [
                        {
                            documentVersion: 1,
                            filePath: "scripts/other.gml",
                            kind: "upsert",
                            sourceText: "other"
                        },
                        { documentVersion: 2, filePath: MAIN_FILE_PATH, kind: "upsert", sourceText: "stale" }
                    ]
                }),
            /stale/
        );
        const unchangedLease = requireLease(
            await session.acquireSnapshot(
                createRequirements("definitions", new Map([[MAIN_FILE_PATH, 2]])),
                new AbortController().signal
            )
        );
        unchangedLease.release();
        await session.close();

        const restoredBuilder = createFakeBuilder();
        const restoredService = createProjectServiceWithBuilder({}, restoredBuilder.builder);
        try {
            const restoredLease = requireLease(
                await restoredService
                    .openProject(workspace.projectRoot)
                    .acquireSnapshot(createRequirements("definitions"), new AbortController().signal)
            );
            assert.equal(restoredLease.queries.findSymbol(MAIN_SYMBOL_ID)?.displayName, "disk");
            restoredLease.release();
        } finally {
            await restoredService.close();
        }
    } finally {
        await service.close();
        await workspace.cleanup();
    }
});

void test("explicit disk batches advance the session and use the previous file-owned baseline", async () => {
    const workspace = await createTempProjectWorkspace("gmloop-semantic-project-service-disk-");
    await workspace.writeProjectFile(MAIN_FILE_PATH, "disk-one");
    const fakeBuilder = createFakeBuilder();
    const service = createProjectServiceWithBuilder({}, fakeBuilder.builder);
    try {
        const session = service.openProject(workspace.projectRoot);
        const firstLease = requireLease(
            await session.acquireSnapshot(createRequirements("definitions"), new AbortController().signal)
        );
        firstLease.release();
        await workspace.writeProjectFile(MAIN_FILE_PATH, "disk-two");
        session.applyDiskChanges({ changes: [{ filePath: MAIN_FILE_PATH, kind: "modified" }] });
        const secondLease = requireLease(
            await session.acquireSnapshot(createRequirements("definitions"), new AbortController().signal)
        );
        assert.equal(secondLease.queries.findSymbol(MAIN_SYMBOL_ID)?.displayName, "disk-two");
        secondLease.release();
        assert.equal(fakeBuilder.calls.length, 2);
        assert.equal(fakeBuilder.calls[1]?.incrementalChangeCount, 1);
    } finally {
        await service.close();
        await workspace.cleanup();
    }
});

void test("request cancellation leaves a shared semantic build alive for remaining waiters", async () => {
    const workspace = await createTempProjectWorkspace("gmloop-semantic-project-service-cancel-");
    await workspace.writeProjectFile(MAIN_FILE_PATH, "shared");
    const fakeBuilder = createFakeBuilder();
    const gate = fakeBuilder.blockNextBuild();
    const service = createProjectServiceWithBuilder({}, fakeBuilder.builder);
    try {
        const session = service.openProject(workspace.projectRoot);
        const cancelledController = new AbortController();
        const cancelledAcquire = session.acquireSnapshot(createRequirements("definitions"), cancelledController.signal);
        await gate.entered.promise;
        const survivingAcquire = session.acquireSnapshot(
            createRequirements("definitions"),
            new AbortController().signal
        );
        cancelledController.abort();
        assert.deepEqual(await cancelledAcquire, { failure: { kind: "cancelled" }, kind: "failure" });
        assert.equal(fakeBuilder.calls.length, 1);
        assert.equal(fakeBuilder.calls[0]?.signal.aborted, false);
        gate.released.resolve();
        const survivingLease = requireLease(await survivingAcquire);
        assert.equal(survivingLease.queries.findSymbol(MAIN_SYMBOL_ID)?.displayName, "shared");
        survivingLease.release();
    } finally {
        await service.close();
        await workspace.cleanup();
    }
});

void test("definitions publish before full and remain reference-free when rebased from a full raw baseline", async () => {
    const workspace = await createTempProjectWorkspace("gmloop-semantic-project-service-tier-");
    await workspace.writeProjectFile(MAIN_FILE_PATH, "tier-one");
    const fakeBuilder = createFakeBuilder();
    const service = createProjectServiceWithBuilder({}, fakeBuilder.builder);
    try {
        const session = service.openProject(workspace.projectRoot);
        const fullLease = requireLease(
            await session.acquireSnapshot(createRequirements("full"), new AbortController().signal)
        );
        assert.equal(fullLease.queries.findReferences(MAIN_SYMBOL_ID, false).length, 1);
        fullLease.release();
        assert.deepEqual(
            fakeBuilder.calls.map((call) => call.definitionsOnly),
            [true, false]
        );

        await workspace.writeProjectFile(MAIN_FILE_PATH, "tier-two");
        session.applyDiskChanges({ changes: [{ filePath: MAIN_FILE_PATH, kind: "modified" }] });
        const definitionsLease = requireLease(
            await session.acquireSnapshot(createRequirements("definitions"), new AbortController().signal)
        );
        assert.equal(definitionsLease.queries.findReferences(MAIN_SYMBOL_ID, false).length, 0);
        definitionsLease.release();
        assert.deepEqual(
            fakeBuilder.calls.map((call) => call.definitionsOnly),
            [true, false, true]
        );
        assert.equal(fakeBuilder.calls[2]?.incrementalChangeCount, 1);
    } finally {
        await service.close();
        await workspace.cleanup();
    }
});

void test("session close preserves active leases until explicit release and aborts unfinished session work", async () => {
    const workspace = await createTempProjectWorkspace("gmloop-semantic-project-service-close-");
    await workspace.writeProjectFile(MAIN_FILE_PATH, "leased");
    const fakeBuilder = createFakeBuilder();
    const service = createProjectServiceWithBuilder({}, fakeBuilder.builder);
    try {
        const session = service.openProject(workspace.projectRoot);
        const lease = requireLease(
            await session.acquireSnapshot(createRequirements("definitions"), new AbortController().signal)
        );
        let closeResolved = false;
        const closePromise = session.close().then(() => {
            closeResolved = true;
            return closeResolved;
        });
        await Promise.resolve();
        assert.equal(closeResolved, false);
        assert.equal(lease.queries.findSymbol(MAIN_SYMBOL_ID)?.displayName, "leased");
        assert.throws(() => session.applyDiskChanges({ changes: [] }), /closed/);
        const reopenedSession = service.openProject(workspace.projectRoot);
        assert.notEqual(reopenedSession, session);
        lease.release();
        await closePromise;

        const gate = fakeBuilder.blockNextBuild();
        const unfinishedAcquire = reopenedSession.acquireSnapshot(
            createRequirements("full"),
            new AbortController().signal
        );
        await gate.entered.promise;
        const unfinishedCall = fakeBuilder.calls.at(-1);
        const reopenedClose = reopenedSession.close();
        await assert.rejects(unfinishedAcquire, /closed/);
        assert.equal(unfinishedCall?.signal.aborted, true);
        await reopenedClose;
    } finally {
        await service.close();
        await workspace.cleanup();
    }
});
