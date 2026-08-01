import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openExistingGraphIndexDatabase } from "../src/graph-index/database.js";
import type { SemanticFileManifest } from "../src/project-index/semantic-manifest.js";
import type { SemanticCapability, SemanticSnapshotRequirements } from "../src/project-index/semantic-snapshot.js";
import { createSemanticSnapshotFromProjectIndex } from "../src/project-index/semantic-snapshot-codec.js";
import { getSemanticIndexDatabasePath, openSemanticIndexStore } from "../src/project-index/semantic-store.js";
import { publishSnapshot } from "./semantic-store-test-helpers.js";

void test("persisted semantic leases expose indexed snapshot queries", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-queries-"));
    const store = openSemanticIndexStore(projectRoot);
    const index = {
        files: {
            "scripts/main.gml": { contentHash: "main-hash" },
            "scripts/use.gml": { contentHash: "use-hash" }
        },
        identifiers: {
            enumMembers: {
                right: {
                    declarations: [
                        { filePath: "scripts/main.gml", location: { end: { index: 14 }, start: { index: 10 } } }
                    ],
                    enumKey: "direction",
                    filePath: "scripts/main.gml",
                    identifierId: "gml/enum-member/direction/right",
                    name: "Right",
                    order: 0,
                    value: "1"
                }
            },
            enums: {
                direction: {
                    declarations: [
                        { filePath: "scripts/main.gml", location: { end: { index: 8 }, start: { index: 0 } } }
                    ],
                    filePath: "scripts/main.gml",
                    identifierId: "gml/enum/direction",
                    name: "Direction"
                }
            },
            functions: {
                main: {
                    declarations: [
                        { filePath: "scripts/main.gml", location: { end: { index: 23 }, start: { index: 20 } } }
                    ],
                    displayName: "main",
                    filePath: "scripts/main.gml",
                    identifierId: "gml/function/main",
                    name: "main",
                    references: [{ filePath: "scripts/use.gml", location: { end: { index: 8 }, start: { index: 5 } } }]
                }
            }
        },
        projectRoot,
        resources: {
            "sprites/spr_player.yy": { name: "spr_player", resourceType: "sprite" }
        },
        scopes: {
            "scope:resource:spr_player": {
                displayName: "spr_player",
                filePaths: ["objects/obj_player/Create_0.gml"],
                kind: "resource",
                name: "spr_player",
                resourcePath: "sprites/spr_player.yy"
            }
        }
    };
    try {
        publishSnapshot(store, index, "definitions", "query-revision");
        publishSnapshot(store, index, "full", "query-revision");
        const result = await store.acquireSemanticSnapshot(
            {
                capabilities: new Set<SemanticCapability>(["references", "renameSafety"]),
                overlayVersions: new Map(),
                projectRevision: "current",
                requireCompleteProjectRelationships: true,
                requiredFiles: new Set(["scripts/main.gml", "scripts/use.gml"]),
                requiredResources: new Set(["sprites/spr_player.yy"]),
                tier: "full"
            },
            new AbortController().signal
        );
        if (result.kind !== "lease") {
            throw new Error("expected a persisted full snapshot lease");
        }
        const queries = result.lease.queries;
        assert.equal(queries.findSymbol("gml/function/main")?.displayName, "main");
        assert.equal(queries.resolveSymbolId("main"), "gml/function/main");
        assert.equal(queries.hasSymbol("gml/function/main"), true);
        assert.equal(
            queries.findSymbolAtPosition(path.join(projectRoot, "scripts/main.gml"), 21)?.symbol.symbolId,
            "gml/function/main"
        );
        assert.deepEqual(
            queries.findDefinitions("gml/function/main").map((match) => match.occurrence.filePath),
            ["scripts/main.gml"]
        );
        assert.deepEqual(
            queries.findReferences("gml/function/main", false).map((match) => match.occurrence.filePath),
            ["scripts/use.gml"]
        );
        assert.equal(queries.findReferences("gml/function/main", true).length, 2);
        assert.deepEqual(
            queries.listDocumentSymbols("scripts/main.gml").map((match) => match.symbol.symbolId),
            ["gml/enum/direction", "gml/enum-member/direction/right", "gml/function/main"]
        );
        assert.deepEqual(
            queries.searchWorkspaceSymbols("MAIN", 1).map((symbol) => symbol.symbolId),
            ["gml/function/main"]
        );
        assert.deepEqual(
            queries.listFileOccurrences("scripts/use.gml").map((match) => match.symbol.symbolId),
            ["gml/function/main"]
        );
        assert.deepEqual(queries.listResources(), [
            {
                filePaths: ["objects/obj_player/Create_0.gml"],
                name: "spr_player",
                resourcePath: "sprites/spr_player.yy",
                resourceType: "sprite"
            }
        ]);
        assert.deepEqual(queries.findResourcesByNames(["spr_player"]), queries.listResources());
        assert.deepEqual(queries.findResourcesByNames(["missing_resource"]), []);
        assert.deepEqual(queries.findResourcesByNames([]), []);
        assert.equal(queries.findEnumOwner("gml/enum-member/direction/right")?.symbolId, "gml/enum/direction");
        assert.equal(queries.findEnumOwner("gml/enum/direction")?.symbolId, "gml/enum/direction");
        assert.deepEqual(queries.listEnumMembers("gml/enum/direction"), [
            { name: "Right", order: 0, symbolId: "gml/enum-member/direction/right", value: "1" }
        ]);
        assert.equal(queries.refactor.getSymbolAtPosition("scripts/main.gml", 21)?.symbolId, "gml/function/main");
        assert.deepEqual(queries.refactor.getRenameSafetyGaps("gml/function/main"), []);
        result.lease.release();
    } finally {
        await store.close();
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("overlay and persisted semantic queries use byte-identical deterministic ordering", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-query-ordering-"));
    const store = openSemanticIndexStore(projectRoot);
    const sourceRevision = "query-ordering-revision" as SemanticFileManifest["sourceRevision"];
    const index = {
        files: {
            "Scripts/Beta.gml": { contentHash: "beta" },
            "scripts/alpha.gml": { contentHash: "alpha" }
        },
        identifiers: {
            functions: {
                alpha: {
                    declarations: [
                        { filePath: "scripts/alpha.gml", location: { end: { index: 11 }, start: { index: 0 } } }
                    ],
                    displayName: "alphaNeedle",
                    filePath: "scripts/alpha.gml",
                    identifierId: "gml/function/zeta",
                    name: "alpha"
                },
                beta: {
                    declarations: [
                        { filePath: "Scripts/Beta.gml", location: { end: { index: 10 }, start: { index: 0 } } }
                    ],
                    displayName: "BetaNEEDLE",
                    filePath: "Scripts/Beta.gml",
                    identifierId: "gml/function/alpha",
                    name: "beta"
                }
            }
        },
        projectRoot,
        resources: {
            "Sprites/Zeta.yy": { name: "spr_zeta", resourceType: "sprite" },
            "sprites/alpha.yy": { name: "spr_alpha", resourceType: "sprite" }
        },
        scopes: {
            "scope:resource:spr_alpha": {
                displayName: "spr_alpha",
                filePaths: ["scripts/alpha.gml", "Scripts/Beta.gml"],
                kind: "resource",
                name: "spr_alpha",
                resourcePath: "sprites/alpha.yy"
            },
            "scope:resource:spr_zeta": {
                displayName: "spr_zeta",
                filePaths: ["scripts/alpha.gml", "Scripts/Beta.gml"],
                kind: "resource",
                name: "spr_zeta",
                resourcePath: "Sprites/Zeta.yy"
            }
        }
    };
    const manifest: SemanticFileManifest = Object.freeze({
        entries: new Map(
            Object.entries(index.files).map(([relativePath, file]) => [
                relativePath,
                Object.freeze({
                    contentHash: file.contentHash,
                    fileKind: "gml" as const,
                    mtimeMs: null,
                    relativePath,
                    sizeBytes: 1,
                    sourceOrigin: "openBuffer" as const,
                    sourceVersion: 1
                })
            ])
        ),
        sourceRevision
    });
    const requirements: SemanticSnapshotRequirements = Object.freeze({
        capabilities: new Set<SemanticCapability>(["workspaceSymbols"]),
        overlayVersions: new Map<string, number>(),
        projectRevision: "current",
        requireCompleteProjectRelationships: false,
        requiredFiles: new Set(Object.keys(index.files)),
        requiredResources: new Set(Object.keys(index.resources)),
        tier: "definitions"
    });
    try {
        publishSnapshot(store, index, "definitions", sourceRevision);
        const queryDatabase = openExistingGraphIndexDatabase(getSemanticIndexDatabasePath(projectRoot));
        try {
            const symbolSearchPlan = queryDatabase
                .prepare(
                    "EXPLAIN QUERY PLAN WITH candidates AS MATERIALIZED (" +
                        "SELECT project_root, tier, symbol_id FROM semantic_symbol_search_ngrams " +
                        "INDEXED BY idx_semantic_symbol_search_ngram " +
                        "WHERE project_root = ? AND tier = ? AND search_ngram = ?) " +
                        "SELECT symbols.symbol_id FROM candidates " +
                        "JOIN semantic_symbols AS symbols ON symbols.project_root = candidates.project_root " +
                        "AND symbols.tier = candidates.tier AND symbols.symbol_id = candidates.symbol_id " +
                        "WHERE instr(symbols.normalized_display_name, ?) > 0 " +
                        "ORDER BY symbols.normalized_display_name COLLATE BINARY, symbols.symbol_id COLLATE BINARY " +
                        "LIMIT ?"
                )
                .all(projectRoot, "definitions", "nee", "needle", 100) as Array<{ detail: string }>;
            const resourceSearchPlan = queryDatabase
                .prepare(
                    "EXPLAIN QUERY PLAN SELECT resource_path FROM semantic_resources " +
                        "WHERE project_root = ? AND tier = ? AND name = ? ORDER BY resource_path COLLATE BINARY"
                )
                .all(projectRoot, "definitions", "spr_alpha") as Array<{ detail: string }>;
            const readPlanDetails = (rows: ReadonlyArray<Readonly<{ detail: string }>>) =>
                rows.map((row) => row.detail).join("\n");
            assert.match(readPlanDetails(symbolSearchPlan), /idx_semantic_symbol_search_ngram/u);
            assert.match(readPlanDetails(resourceSearchPlan), /idx_semantic_resources_name/u);
        } finally {
            queryDatabase.close();
        }
        const persisted = await store.acquireSemanticSnapshot(requirements, new AbortController().signal);
        if (persisted.kind !== "lease") {
            throw new Error("expected a persisted semantic snapshot lease");
        }

        const snapshot = createSemanticSnapshotFromProjectIndex(index, "definitions", sourceRevision);
        assert.equal(store.publishSessionSemanticSnapshot({ manifest, snapshot }).kind, "published");
        const overlay = await store.acquireSemanticSnapshot(
            {
                ...requirements,
                overlayVersions: new Map(Object.keys(index.files).map((filePath) => [filePath, 1]))
            },
            new AbortController().signal
        );
        if (overlay.kind !== "lease") {
            throw new Error("expected an overlay semantic snapshot lease");
        }

        const readOrderedResults = (queries: typeof persisted.lease.queries) => ({
            filteredSymbols: queries.searchWorkspaceSymbols("NEEDLE", 100),
            refactorFileSymbols: queries.refactor.getFileSymbols("scripts/alpha.gml"),
            refactorResolvedSymbol: queries.refactor.resolveSymbolId("alphaNeedle"),
            resources: queries.listResources(),
            selectedResources: queries.findResourcesByNames(["spr_alpha", "spr_zeta", "spr_alpha"]),
            symbols: queries.searchWorkspaceSymbols("", 100)
        });
        const persistedResults = readOrderedResults(persisted.lease.queries);
        const overlayResults = readOrderedResults(overlay.lease.queries);
        assert.equal(JSON.stringify(persistedResults), JSON.stringify(overlayResults));
        assert.deepEqual(
            persistedResults.symbols.map((symbol) => symbol.displayName),
            ["alphaNeedle", "BetaNEEDLE"]
        );
        assert.deepEqual(
            persistedResults.resources.map((resource) => resource.resourcePath),
            ["Sprites/Zeta.yy", "sprites/alpha.yy"]
        );
        persisted.lease.release();
        overlay.lease.release();
    } finally {
        await store.close();
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("a persisted lease retains its generation after a newer publication", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-pinned-generation-"));
    const store = openSemanticIndexStore(projectRoot);
    const createIndex = (displayName: string) => ({
        files: { "scripts/main.gml": { contentHash: displayName } },
        identifiers: {
            functions: {
                main: {
                    declarations: [
                        { filePath: "scripts/main.gml", location: { end: { index: 3 }, start: { index: 0 } } }
                    ],
                    displayName,
                    filePath: "scripts/main.gml",
                    identifierId: "gml/function/main",
                    name: "main"
                }
            }
        },
        projectRoot
    });
    try {
        publishSnapshot(store, createIndex("old main"), "definitions", "pinned-revision-a");
        const requirements: SemanticSnapshotRequirements = Object.freeze({
            capabilities: new Set<SemanticCapability>(["definition"]),
            overlayVersions: new Map(),
            projectRevision: "current",
            requireCompleteProjectRelationships: false,
            requiredFiles: new Set(["scripts/main.gml"]),
            requiredResources: new Set<string>(),
            tier: "definitions"
        });
        const generationAController = new AbortController();
        const generationA = await store.acquireSemanticSnapshot(requirements, generationAController.signal);
        if (generationA.kind !== "lease") {
            throw new Error("expected generation A lease");
        }
        generationAController.abort();
        assert.deepEqual(store.readSemanticSnapshotLeaseMetrics(), { activeLeaseCount: 1 });
        assert.equal(generationA.lease.queries.findSymbol("gml/function/main")?.displayName, "old main");

        publishSnapshot(store, createIndex("new main"), "definitions", "pinned-revision-b");
        const generationB = await store.acquireSemanticSnapshot(requirements, new AbortController().signal);
        if (generationB.kind !== "lease") {
            throw new Error("expected generation B lease");
        }

        assert.equal(generationA.lease.identity.generation, 1);
        assert.equal(generationB.lease.identity.generation, 2);
        assert.equal(generationA.lease.queries.findSymbol("gml/function/main")?.displayName, "old main");
        assert.equal(generationB.lease.queries.findSymbol("gml/function/main")?.displayName, "new main");
        assert.deepEqual(store.readSemanticSnapshotLeaseMetrics(), { activeLeaseCount: 2 });
        generationB.lease.release();
        assert.deepEqual(store.readSemanticSnapshotLeaseMetrics(), { activeLeaseCount: 1 });
        assert.equal(generationA.lease.queries.findSymbol("gml/function/main")?.displayName, "old main");
        generationA.lease.release();
        assert.deepEqual(store.readSemanticSnapshotLeaseMetrics(), { activeLeaseCount: 0 });
    } finally {
        await store.close();
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("the bounded persisted-reader pool cancels queued acquisition without cancelling active leases", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-reader-pool-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        publishSnapshot(
            store,
            {
                files: { "scripts/main.gml": { contentHash: "reader-pool" } },
                identifiers: {
                    functions: {
                        main: {
                            declarations: [
                                {
                                    filePath: "scripts/main.gml",
                                    location: { end: { index: 3 }, start: { index: 0 } }
                                }
                            ],
                            identifierId: "gml/function/main",
                            name: "main"
                        }
                    }
                },
                projectRoot
            },
            "definitions",
            "reader-pool-revision"
        );
        const requirements: SemanticSnapshotRequirements = Object.freeze({
            capabilities: new Set<SemanticCapability>(["definition"]),
            overlayVersions: new Map(),
            projectRevision: "current",
            requireCompleteProjectRelationships: false,
            requiredFiles: new Set(["scripts/main.gml"]),
            requiredResources: new Set<string>(),
            tier: "definitions"
        });
        const activeResults = await Promise.all(
            Array.from({ length: 4 }, () => store.acquireSemanticSnapshot(requirements, new AbortController().signal))
        );
        assert.equal(
            activeResults.every((result) => result.kind === "lease"),
            true
        );
        assert.deepEqual(store.readSemanticSnapshotLeaseMetrics(), { activeLeaseCount: 4 });

        const queuedController = new AbortController();
        const queuedAcquisition = store.acquireSemanticSnapshot(requirements, queuedController.signal);
        queuedController.abort();
        assert.deepEqual(await queuedAcquisition, { failure: { kind: "cancelled" }, kind: "failure" });
        assert.deepEqual(store.readSemanticSnapshotLeaseMetrics(), { activeLeaseCount: 4 });

        for (const result of activeResults) {
            if (result.kind === "lease") {
                result.lease.release();
            }
        }
        const reusedReader = await store.acquireSemanticSnapshot(requirements, new AbortController().signal);
        if (reusedReader.kind !== "lease") {
            throw new Error("expected a lease after returning a pooled reader");
        }
        reusedReader.lease.release();
        assert.deepEqual(store.readSemanticSnapshotLeaseMetrics(), { activeLeaseCount: 0 });
    } finally {
        await store.close();
        await rm(projectRoot, { force: true, recursive: true });
    }
});
