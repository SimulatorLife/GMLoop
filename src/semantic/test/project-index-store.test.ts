import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Core } from "@gmloop/core";

import { openGraphIndexDatabase } from "../src/graph-index/database.js";
import { buildSemanticFileManifest, type SemanticFileManifest } from "../src/project-index/semantic-manifest.js";
import { createSemanticSnapshotFromProjectIndex } from "../src/project-index/semantic-snapshot-codec.js";
import {
    getSemanticIndexDatabasePath,
    openSemanticIndexStore,
    publishSemanticTwoTierSnapshot
} from "../src/project-index/semantic-store.js";

void test("semantic store creates the normalized v6 tables without legacy record tables", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-v6-schema-"));
    const database = openGraphIndexDatabase(getSemanticIndexDatabasePath(projectRoot));
    try {
        const tables = new Set(
            database
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
                .all()
                .flatMap((row) => (typeof row.name === "string" ? [row.name] : []))
        );
        for (const tableName of [
            "semantic_projects",
            "semantic_slots",
            "semantic_files",
            "semantic_symbols",
            "semantic_occurrences",
            "semantic_scopes",
            "semantic_scope_files",
            "semantic_resources",
            "semantic_relationships",
            "semantic_dependencies",
            "semantic_unresolved_references",
            "semantic_navigation_projection",
            "semantic_generation_history"
        ]) {
            assert.equal(tables.has(tableName), true, `missing ${tableName}`);
        }
        assert.equal(tables.has("semantic_slot_records"), false);
        assert.equal(tables.has("semantic_state"), false);
        assert.equal(tables.has("semantic_records"), false);
    } finally {
        database.close();
    }
});

void test("semantic store exposes only canonical generation and projection read APIs", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-api-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        assert.equal(typeof store.readActiveSemanticSlots, "function");
        assert.equal(typeof store.readSemanticManifest, "function");
        assert.equal(typeof store.readSemanticNavigationProjection, "function");
        assert.equal(typeof store.readSemanticProjectHead, "function");
        for (const removedApi of [
            "readActiveSlots",
            "readFileContentHashes",
            "readIndexForTier",
            "readManifestForTier",
            "readProjectHead",
            "readStateForTier"
        ]) {
            assert.equal(removedApi in store, false, `${removedApi} must not remain as a compatibility API`);
        }
    } finally {
        await store.close();
    }
});

void test("semantic store flush and close lifecycle is awaitable and idempotent", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-close-"));
    const store = openSemanticIndexStore(projectRoot);
    publishSnapshot(store, { files: {}, projectRoot }, "definitions", "close-revision");

    await store.flush();
    await Promise.all([store.close(), store.close()]);

    const reopenedStore = openSemanticIndexStore(projectRoot);
    try {
        assert.equal(reopenedStore.readActiveSemanticSlots().definitions?.sourceSignature, "close-revision");
    } finally {
        await reopenedStore.close();
    }
});

void test("definitions publication persists structured symbols without reference occurrences", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-definitions-facts-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        publishSnapshot(
            store,
            {
                identifiers: {
                    functions: {
                        main: {
                            declarations: [
                                { filePath: "scripts/main.gml", location: { end: { index: 7 }, start: { index: 3 } } }
                            ],
                            documentation: {
                                additionalTags: [],
                                description: "Entry point",
                                normalizedText: "Entry point",
                                parameters: [],
                                returns: null
                            },
                            identifierId: "gml/function/main",
                            name: "main",
                            references: [
                                { filePath: "scripts/use.gml", location: { end: { index: 11 }, start: { index: 8 } } }
                            ]
                        }
                    }
                },
                projectRoot
            },
            "definitions",
            "definitions-facts"
        );
        const snapshot = store.readSemanticSnapshot("definitions");
        assert.equal(snapshot?.symbols[0]?.documentation.description, "Entry point");
        assert.deepEqual(
            snapshot?.occurrences.map((occurrence) => occurrence.role),
            ["definition"]
        );
        const database = openGraphIndexDatabase(getSemanticIndexDatabasePath(projectRoot));
        try {
            const symbol = database
                .prepare(
                    "SELECT documentation_json FROM semantic_symbols WHERE project_root = ? AND tier = 'definitions'"
                )
                .get(projectRoot) as { documentation_json: string } | undefined;
            const occurrences = database
                .prepare("SELECT role FROM semantic_occurrences WHERE project_root = ? AND tier = 'definitions'")
                .all(projectRoot)
                .flatMap((row) => (typeof row.role === "string" ? [{ role: row.role }] : []));
            assert.equal(JSON.parse(symbol?.documentation_json ?? "{}").description, "Entry point");
            assert.deepEqual(occurrences, [{ role: "definition" }]);
        } finally {
            database.close();
        }
    } finally {
        await store.close();
    }
});

function publishSnapshot(
    store: ReturnType<typeof openSemanticIndexStore>,
    index: Record<string, unknown>,
    tier: "definitions" | "full",
    sourceRevision: string,
    affectedFiles: ReadonlyArray<string> | null = null
) {
    const files = Core.isObjectLike(index.files) ? index.files : {};
    const entries = new Map(
        Object.entries(files)
            .filter((entry): entry is [string, Record<string, unknown>] => Core.isObjectLike(entry[1]))
            .map(([relativePath, file]) => [
                relativePath,
                Object.freeze({
                    contentHash: typeof file.contentHash === "string" ? file.contentHash : `hash:${relativePath}`,
                    fileKind: "gml" as const,
                    mtimeMs: null,
                    relativePath,
                    sizeBytes: 0,
                    sourceOrigin: "disk" as const,
                    sourceVersion: null
                })
            ])
    );
    const manifest: SemanticFileManifest = Object.freeze({
        entries,
        sourceRevision: sourceRevision as SemanticFileManifest["sourceRevision"]
    });
    const publicationRequest = {
        authoritative: tier === "full" && store.readActiveSemanticSlots().definitions === null,
        baseGeneration: store.readActiveSemanticSlots()[tier]?.generation ?? null,
        expectedHeadGeneration: store.readSemanticProjectHead().generation,
        manifest,
        navigationProjection: index,
        snapshot: createSemanticSnapshotFromProjectIndex(index, tier, manifest.sourceRevision),
        sourceRevision,
        tier
    } as const;
    const publication =
        affectedFiles === null
            ? store.publishSemanticSnapshot(publicationRequest)
            : store.applySemanticIncrement({ ...publicationRequest, affectedFiles });
    assert.equal(publication.status, "published");
    assert.ok(publication.state);
    return publication.state;
}

function createSemanticPublicationPayload(
    index: Record<string, unknown>,
    tier: "definitions" | "full",
    sourceRevision: string
) {
    const brandedRevision = sourceRevision as SemanticFileManifest["sourceRevision"];
    return {
        navigationProjection: index,
        snapshot: createSemanticSnapshotFromProjectIndex(index, tier, brandedRevision)
    } as const;
}

void test("scoped publication preserves unrelated normalized rows and generations", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-scoped-"));
    const store = openSemanticIndexStore(projectRoot);
    const createIndex = (displayName: string, includeA = true) => ({
        identifiers: {
            functions: {
                ...(includeA
                    ? {
                          a: {
                              declarations: [
                                  {
                                      filePath: "scripts/a.gml",
                                      location: { end: { index: 1 }, start: { index: 0 } }
                                  }
                              ],
                              displayName,
                              filePath: "scripts/a.gml",
                              identifierId: "gml/function/a",
                              name: "a"
                          }
                      }
                    : {}),
                b: {
                    declarations: [{ filePath: "scripts/b.gml", location: { end: { index: 1 }, start: { index: 0 } } }],
                    displayName: "b",
                    filePath: "scripts/b.gml",
                    identifierId: "gml/function/b",
                    name: "b"
                }
            }
        },
        scopes: {
            ...(includeA
                ? { "scope:a": { displayName: "a", filePaths: ["scripts/a.gml"], kind: "script", name: "a" } }
                : {}),
            "scope:b": { displayName: "b", filePaths: ["scripts/b.gml"], kind: "script", name: "b" }
        },
        projectRoot
    });
    try {
        publishSnapshot(store, createIndex("a"), "definitions", "scoped-r1");
        publishSnapshot(store, createIndex("a updated"), "definitions", "scoped-r2", ["scripts/a.gml"]);
        const database = openGraphIndexDatabase(getSemanticIndexDatabasePath(projectRoot));
        try {
            const rows = database
                .prepare(
                    "SELECT symbol_id, display_name, updated_generation FROM semantic_symbols WHERE project_root = ? AND tier = 'definitions' ORDER BY symbol_id"
                )
                .all(projectRoot)
                .flatMap((row) =>
                    typeof row.symbol_id === "string" &&
                    typeof row.display_name === "string" &&
                    typeof row.updated_generation === "number"
                        ? [
                              {
                                  displayName: row.display_name,
                                  generation: row.updated_generation,
                                  symbolId: row.symbol_id
                              }
                          ]
                        : []
                );
            assert.deepEqual(rows, [
                { displayName: "a updated", generation: 2, symbolId: "gml/function/a" },
                { displayName: "b", generation: 1, symbolId: "gml/function/b" }
            ]);
        } finally {
            database.close();
        }
        publishSnapshot(store, createIndex("unused", false), "definitions", "scoped-r3", ["scripts/a.gml"]);
        const afterDeleteDatabase = openGraphIndexDatabase(getSemanticIndexDatabasePath(projectRoot));
        try {
            const remainingSymbols = afterDeleteDatabase
                .prepare(
                    "SELECT symbol_id, updated_generation FROM semantic_symbols WHERE project_root = ? AND tier = 'definitions' ORDER BY symbol_id"
                )
                .all(projectRoot)
                .flatMap((row) =>
                    typeof row.symbol_id === "string" && typeof row.updated_generation === "number"
                        ? [{ generation: row.updated_generation, symbolId: row.symbol_id }]
                        : []
                );
            const remainingScopes = afterDeleteDatabase
                .prepare(
                    "SELECT scope_id, updated_generation FROM semantic_scopes WHERE project_root = ? AND tier = 'definitions' ORDER BY scope_id"
                )
                .all(projectRoot)
                .flatMap((row) =>
                    typeof row.scope_id === "string" && typeof row.updated_generation === "number"
                        ? [{ generation: row.updated_generation, scopeId: row.scope_id }]
                        : []
                );
            const scopeFiles = afterDeleteDatabase
                .prepare(
                    "SELECT scope_id, file_path, updated_generation FROM semantic_scope_files WHERE project_root = ? AND tier = 'definitions' ORDER BY scope_id, file_path"
                )
                .all(projectRoot)
                .flatMap((row) =>
                    typeof row.scope_id === "string" &&
                    typeof row.file_path === "string" &&
                    typeof row.updated_generation === "number"
                        ? [{ filePath: row.file_path, generation: row.updated_generation, scopeId: row.scope_id }]
                        : []
                );
            const history = afterDeleteDatabase
                .prepare(
                    "SELECT reason, affected_file_count FROM semantic_generation_history WHERE project_root = ? AND generation = 3"
                )
                .get(projectRoot);
            assert.deepEqual(remainingSymbols, [{ generation: 1, symbolId: "gml/function/b" }]);
            assert.deepEqual(remainingScopes, [{ generation: 1, scopeId: "scope:b" }]);
            assert.deepEqual(scopeFiles, [{ filePath: "scripts/b.gml", generation: 1, scopeId: "scope:b" }]);
            assert.equal(history?.affected_file_count, 1);
            assert.equal(history?.reason, "increment");
        } finally {
            afterDeleteDatabase.close();
        }
    } finally {
        await store.close();
    }
});

void test("scoped deletion preserves a canonical symbol still defined by an unaffected file", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-shared-symbol-"));
    const store = openSemanticIndexStore(projectRoot);
    const createIndex = (includeFirstDefinition: boolean) => ({
        files: {
            ...(includeFirstDefinition ? { "scripts/a.gml": { contentHash: "hash-a" } } : {}),
            "scripts/b.gml": { contentHash: "hash-b" }
        },
        identifiers: {
            functions: {
                shared: {
                    declarations: [
                        ...(includeFirstDefinition
                            ? [
                                  {
                                      filePath: "scripts/a.gml",
                                      location: { end: { index: 6 }, start: { index: 0 } }
                                  }
                              ]
                            : []),
                        {
                            filePath: "scripts/b.gml",
                            location: { end: { index: 6 }, start: { index: 0 } }
                        }
                    ],
                    displayName: "shared",
                    filePath: includeFirstDefinition ? "scripts/a.gml" : "scripts/b.gml",
                    identifierId: "gml/function/shared",
                    name: "shared"
                }
            }
        },
        projectRoot
    });
    try {
        publishSnapshot(store, createIndex(true), "definitions", "shared-r1");
        publishSnapshot(store, createIndex(false), "definitions", "shared-r2", ["scripts/a.gml"]);

        const snapshot = store.readSemanticSnapshot("definitions");
        assert.equal(
            snapshot?.symbols.some((symbol) => symbol.symbolId === "gml/function/shared"),
            true
        );
        assert.deepEqual(
            snapshot?.occurrences
                .filter((occurrence) => occurrence.symbolId === "gml/function/shared")
                .map((occurrence) => occurrence.filePath),
            ["scripts/b.gml"]
        );
    } finally {
        await store.close();
    }
});

void test("scoped publication preserves unaffected ownership of a shared scope", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-shared-scope-"));
    const store = openSemanticIndexStore(projectRoot);
    const createIndex = (includeFirstFile: boolean) => ({
        files: {
            ...(includeFirstFile ? { "scripts/a.gml": { contentHash: "hash-a", scopeId: "global" } } : {}),
            "scripts/b.gml": { contentHash: "hash-b", scopeId: "global" }
        },
        projectRoot,
        scopes: {
            global: {
                displayName: "global",
                filePaths: [...(includeFirstFile ? ["scripts/a.gml"] : []), "scripts/b.gml"],
                kind: "global",
                name: "global"
            }
        }
    });
    try {
        publishSnapshot(store, createIndex(true), "definitions", "scope-r1");
        publishSnapshot(store, createIndex(false), "definitions", "scope-r2", ["scripts/a.gml"]);

        const database = openGraphIndexDatabase(getSemanticIndexDatabasePath(projectRoot));
        try {
            const ownershipRows = database
                .prepare(
                    "SELECT file_path, updated_generation FROM semantic_scope_files WHERE project_root = ? AND tier = 'definitions' AND scope_id = 'global' ORDER BY file_path"
                )
                .all(projectRoot)
                .map((row) => ({ filePath: row.file_path, generation: row.updated_generation }));
            assert.deepEqual(ownershipRows, [{ filePath: "scripts/b.gml", generation: 1 }]);
            assert.equal(
                database
                    .prepare(
                        "SELECT COUNT(*) AS count FROM semantic_scopes WHERE project_root = ? AND tier = 'definitions' AND scope_id = 'global'"
                    )
                    .get(projectRoot)?.count,
                1
            );
        } finally {
            database.close();
        }
    } finally {
        await store.close();
    }
});

void test("semantic index store persists records and generation state in SQLite", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        const first = publishSnapshot(
            store,
            {
                projectRoot,
                files: {
                    "scripts/main.gml": { filePath: "scripts/main.gml", declarations: [] }
                },
                identifiers: { functions: { main: { displayName: "main" } } }
            },
            "definitions",
            "revision-definitions-1"
        );
        assert.equal(first.generation, 1);
        assert.equal(first.tier, "definitions");

        const restored = store.readSemanticNavigationProjection("definitions");
        assert.deepEqual(restored?.files, {
            "scripts/main.gml": { filePath: "scripts/main.gml", declarations: [] }
        });
        assert.equal(store.readActiveSemanticSlots().definitions?.generation, 1);

        const second = publishSnapshot(store, { projectRoot, files: {} }, "full", "revision-definitions-1");
        assert.equal(second.generation, 2);
        assert.equal(store.readActiveSemanticSlots().full?.tier, "full");

        const definitionsAfterFull = publishSnapshot(
            store,
            { projectRoot, files: { current: {} } },
            "definitions",
            "revision-definitions-2"
        );
        assert.equal(definitionsAfterFull.generation, 3);
        assert.equal(definitionsAfterFull.tier, "definitions");
        assert.deepEqual(store.readSemanticNavigationProjection("full")?.files, {});
        assert.deepEqual(store.readSemanticNavigationProjection("definitions")?.files, { current: {} });
        assert.equal(store.readActiveSemanticSlots().full?.generation, 2);
        assert.equal(store.readActiveSemanticSlots().definitions?.generation, 3);
        assert.deepEqual(store.readActiveSemanticSlots(), {
            definitions: definitionsAfterFull,
            full: second,
            hasMatchingFull: false,
            newestDefinitionsRevision: "revision-definitions-2"
        });
    } finally {
        await store.close();
    }
});

void test("semantic index store rejects stale generation publications without changing either slot", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-cas-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        const initialHead = store.readSemanticProjectHead();
        const fullPublication = store.publishSemanticSnapshot({
            authoritative: true,
            baseGeneration: null,
            expectedHeadGeneration: initialHead.generation,
            ...createSemanticPublicationPayload(
                { files: { "scripts/main.gml": { filePath: "scripts/main.gml" } }, projectRoot },
                "full",
                "revision-full"
            ),
            manifest: null,
            sourceRevision: "revision-full",
            tier: "full"
        });
        assert.equal(fullPublication.status, "published");
        assert.equal(fullPublication.state?.generation, 1);

        const staleDefinitionsPublication = store.publishSemanticSnapshot({
            authoritative: false,
            baseGeneration: null,
            expectedHeadGeneration: initialHead.generation,
            ...createSemanticPublicationPayload(
                { files: { "scripts/main.gml": { filePath: "scripts/main.gml" } }, projectRoot },
                "definitions",
                "revision-definitions"
            ),
            manifest: null,
            sourceRevision: "revision-definitions",
            tier: "definitions"
        });
        assert.deepEqual(staleDefinitionsPublication, { state: null, status: "superseded" });
        assert.equal(store.readSemanticProjectHead().generation, 1);
        assert.equal(store.readActiveSemanticSlots().definitions, null);
        assert.equal(store.readActiveSemanticSlots().full?.sourceSignature, "revision-full");
        assert.equal(store.readActiveSemanticSlots().hasMatchingFull, true);
        assert.equal(store.readActiveSemanticSlots().newestDefinitionsRevision, "revision-full");
    } finally {
        await store.close();
    }
});

void test("semantic index store rejects a mismatched typed snapshot without advancing generations", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-snapshot-boundary-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        const index = { files: {}, projectRoot };
        const rejected = store.publishSemanticSnapshot({
            authoritative: false,
            baseGeneration: null,
            expectedHeadGeneration: 0,
            manifest: null,
            navigationProjection: index,
            snapshot: createSemanticSnapshotFromProjectIndex(
                index,
                "full",
                "revision-other" as SemanticFileManifest["sourceRevision"]
            ),
            sourceRevision: "revision-definitions",
            tier: "definitions"
        });

        assert.deepEqual(rejected, { state: null, status: "superseded" });
        assert.equal(store.readSemanticProjectHead().generation, 0);
        assert.deepEqual(store.readActiveSemanticSlots(), {
            definitions: null,
            full: null,
            hasMatchingFull: false,
            newestDefinitionsRevision: null
        });
    } finally {
        await store.close();
    }
});

void test("semantic index store rejects a publication derived from an older slot generation", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-base-generation-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        const initial = publishSnapshot(store, { files: {}, projectRoot }, "definitions", "revision-one");
        const advanced = publishSnapshot(store, { files: {}, projectRoot }, "definitions", "revision-two");
        const rejected = store.publishSemanticSnapshot({
            authoritative: false,
            baseGeneration: initial.generation,
            expectedHeadGeneration: store.readSemanticProjectHead().generation,
            ...createSemanticPublicationPayload({ files: {}, projectRoot }, "definitions", "revision-three"),
            manifest: null,
            sourceRevision: "revision-three",
            tier: "definitions"
        });

        assert.deepEqual(rejected, { state: null, status: "superseded" });
        assert.equal(store.readActiveSemanticSlots().definitions?.generation, advanced.generation);
    } finally {
        await store.close();
    }
});

void test("semantic active slots keep newer definitions authoritative over an older full revision", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-slot-revision-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        const olderFull = publishSnapshot(store, { files: {}, projectRoot }, "full", "revision-full-old");
        const definitions = publishSnapshot(store, { files: {}, projectRoot }, "definitions", "revision-definitions");
        assert.deepEqual(store.readActiveSemanticSlots(), {
            definitions,
            full: olderFull,
            hasMatchingFull: false,
            newestDefinitionsRevision: "revision-definitions"
        });
    } finally {
        await store.close();
    }
});

void test("semantic index store rejects authoritative full publication when definitions exist", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-authoritative-full-gate-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        const definitions = publishSnapshot(store, { files: {}, projectRoot }, "definitions", "revision-current");
        const rejected = store.publishSemanticSnapshot({
            authoritative: true,
            baseGeneration: null,
            expectedHeadGeneration: definitions.generation,
            ...createSemanticPublicationPayload({ files: {}, projectRoot }, "full", "revision-current"),
            manifest: null,
            sourceRevision: "revision-current",
            tier: "full"
        });

        assert.deepEqual(rejected, { state: null, status: "superseded" });
        assert.equal(store.readSemanticProjectHead().generation, definitions.generation);
        assert.equal(store.readActiveSemanticSlots().full, null);
    } finally {
        await store.close();
    }
});

void test("two-tier publication advances stale definitions before publishing matching full facts", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-two-tier-publication-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        publishSnapshot(store, { files: {}, projectRoot }, "definitions", "revision-old");
        const index = { files: { "scripts/current.gml": {} }, projectRoot };
        const publication = publishSemanticTwoTierSnapshot(store, {
            definitionsSnapshot: createSemanticSnapshotFromProjectIndex(
                index,
                "definitions",
                "revision-current" as SemanticFileManifest["sourceRevision"]
            ),
            fullSnapshot: createSemanticSnapshotFromProjectIndex(
                index,
                "full",
                "revision-current" as SemanticFileManifest["sourceRevision"]
            ),
            manifest: null,
            navigationProjection: index,
            sourceRevision: "revision-current"
        });

        assert.equal(publication.status, "published");
        assert.deepEqual(store.readActiveSemanticSlots(), {
            definitions: {
                baseGeneration: 1,
                generation: 2,
                projectRoot,
                sourceSignature: "revision-current",
                tier: "definitions"
            },
            full: {
                baseGeneration: null,
                generation: 3,
                projectRoot,
                sourceSignature: "revision-current",
                tier: "full"
            },
            hasMatchingFull: true,
            newestDefinitionsRevision: "revision-current"
        });
    } finally {
        await store.close();
    }
});

void test("semantic index store rejects a non-authoritative full publication with another revision", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-full-gate-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        const definitions = publishSnapshot(store, { files: {}, projectRoot }, "definitions", "revision-definitions");
        const rejected = store.publishSemanticSnapshot({
            authoritative: false,
            baseGeneration: null,
            expectedHeadGeneration: definitions.generation,
            ...createSemanticPublicationPayload({ files: {}, projectRoot }, "full", "revision-other"),
            manifest: null,
            sourceRevision: "revision-other",
            tier: "full"
        });

        assert.deepEqual(rejected, { state: null, status: "superseded" });
        assert.equal(store.readSemanticProjectHead().generation, definitions.generation);
        assert.equal(store.readActiveSemanticSlots().full, null);
    } finally {
        await store.close();
    }
});

void test("semantic index store persists and restores the generation-bound manifest", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-manifest-"));
    await writeFile(path.join(projectRoot, "main.gml"), "return 1;", "utf8");
    const manifest = await buildSemanticFileManifest(projectRoot, Core.defaultFsFacade);
    const store = openSemanticIndexStore(projectRoot);
    try {
        const publication = store.publishSemanticSnapshot({
            authoritative: false,
            baseGeneration: null,
            expectedHeadGeneration: 0,
            ...createSemanticPublicationPayload(
                {
                    files: { "main.gml": { contentHash: manifest.entries.get("main.gml")?.contentHash } },
                    projectRoot
                },
                "definitions",
                manifest.sourceRevision
            ),
            manifest,
            sourceRevision: manifest.sourceRevision,
            tier: "definitions"
        });
        assert.equal(publication.status, "published");
        assert.deepEqual(store.readSemanticManifest("definitions"), manifest);
        const database = openGraphIndexDatabase(getSemanticIndexDatabasePath(projectRoot));
        try {
            const history = database
                .prepare(
                    "SELECT tier, source_revision, affected_file_count, result FROM semantic_generation_history WHERE project_root = ?"
                )
                .get(projectRoot) as
                | { affected_file_count: number; result: string; source_revision: string; tier: string }
                | undefined;
            assert.equal(history?.affected_file_count, manifest.entries.size);
            assert.equal(history?.result, "published");
            assert.equal(history?.source_revision, manifest.sourceRevision);
            assert.equal(history?.tier, "definitions");
        } finally {
            database.close();
        }
    } finally {
        await store.close();
    }
});

void test("semantic index store rejects a corrupt navigation projection until normalized reconstruction", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-projection-"));
    const databasePath = getSemanticIndexDatabasePath(projectRoot);
    const store = openSemanticIndexStore(projectRoot);
    publishSnapshot(
        store,
        {
            files: { "scripts/main.gml": { contentHash: "main-hash", filePath: "scripts/main.gml" } },
            identifiers: { functions: { main: { displayName: "main", filePath: "scripts/main.gml" } } },
            projectRoot
        },
        "definitions",
        "projection-revision"
    );
    await store.close();

    const database = openGraphIndexDatabase(databasePath);
    try {
        const projection = database
            .prepare(
                "SELECT generation, payload FROM semantic_navigation_projection WHERE project_root = ? AND tier = 'definitions'"
            )
            .get(projectRoot) as { generation: number; payload: string } | undefined;
        assert.equal(projection?.generation, 1);
        assert.deepEqual(JSON.parse(projection?.payload ?? "null"), {
            files: { "scripts/main.gml": { contentHash: "main-hash", filePath: "scripts/main.gml" } },
            identifiers: { functions: { main: { displayName: "main", filePath: "scripts/main.gml" } } },
            projectRoot
        });
        database
            .prepare(
                "UPDATE semantic_navigation_projection SET payload = 'not-json' WHERE project_root = ? AND tier = 'definitions'"
            )
            .run(projectRoot);
    } finally {
        database.close();
    }

    const restoredStore = openSemanticIndexStore(projectRoot);
    try {
        assert.equal(restoredStore.readSemanticNavigationProjection("definitions"), null);
    } finally {
        await restoredStore.close();
    }
});

void test("semantic index store hard-resets pre-v6 derived cache data", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-v3-migration-"));
    const databasePath = getSemanticIndexDatabasePath(projectRoot);
    const database = openGraphIndexDatabase(databasePath);
    try {
        database.exec(`
            DROP TABLE semantic_navigation_projection;
            DROP TABLE semantic_dependencies;
            DROP TABLE semantic_slots;
            DROP TABLE semantic_projects;
            CREATE TABLE semantic_state (project_root TEXT PRIMARY KEY, generation INTEGER NOT NULL);
        `);
        database.prepare("UPDATE schema_meta SET value = '3' WHERE key = 'schema_version'").run();
    } finally {
        database.close();
    }

    const store = openSemanticIndexStore(projectRoot);
    try {
        assert.deepEqual(store.readSemanticProjectHead(), { generation: 0, projectRoot });
        assert.equal(store.readActiveSemanticSlots().full, null);
        assert.equal(store.readActiveSemanticSlots().definitions, null);
        assert.equal(store.readSemanticManifest("full"), null);
        assert.deepEqual(store.findImmediateDownstreamFiles("scripts/main.gml"), []);
    } finally {
        await store.close();
    }
});

void test("semantic index store persists file hashes and immediate reverse dependencies", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-store-dependencies-"));
    const store = openSemanticIndexStore(projectRoot);
    try {
        publishSnapshot(
            store,
            {
                projectRoot,
                files: {
                    "scripts/a/a.gml": { contentHash: "hash-a", filePath: "scripts/a/a.gml" },
                    "scripts/b/b.gml": { contentHash: "hash-b", filePath: "scripts/b/b.gml" },
                    "scripts/c/c.gml": { contentHash: "hash-c", filePath: "scripts/c/c.gml" },
                    "scripts/d/d.gml": {
                        contentHash: "hash-d",
                        filePath: "scripts/d/d.gml",
                        ignoredIdentifiers: [
                            { end: { index: 12 }, name: "newly_defined", start: { index: 0 } },
                            { end: { index: 19 }, name: "show_debug_message", reason: "built-in", start: { index: 1 } }
                        ]
                    }
                },
                identifiers: {
                    functions: {
                        "function:resolved": {
                            declarations: [
                                {
                                    filePath: "scripts/c/c.gml",
                                    location: { end: { index: 7 }, start: { index: 0 } }
                                }
                            ],
                            references: [
                                {
                                    filePath: "scripts/d/d.gml",
                                    location: { end: { index: 7 }, start: { index: 0 } }
                                }
                            ]
                        }
                    }
                },
                scopes: {
                    "script:a": { filePaths: ["scripts/a/a.gml"] },
                    "script:b": { filePaths: ["scripts/b/b.gml"] }
                },
                relationships: {
                    scriptCalls: [
                        {
                            from: { filePath: "scripts/b/b.gml" },
                            target: { scopeId: "script:a" }
                        }
                    ]
                }
            },
            "full",
            "dependency-revision"
        );

        assert.deepEqual(
            new Map(
                [...(store.readSemanticManifest("full")?.entries ?? [])].map(([relativePath, entry]) => [
                    relativePath,
                    entry.contentHash
                ])
            ),
            new Map([
                ["scripts/a/a.gml", "hash-a"],
                ["scripts/b/b.gml", "hash-b"],
                ["scripts/c/c.gml", "hash-c"],
                ["scripts/d/d.gml", "hash-d"]
            ])
        );
        assert.deepEqual(store.findImmediateDownstreamFiles("scripts/a/a.gml"), ["scripts/b/b.gml"]);
        assert.deepEqual(store.findImmediateDownstreamFiles(path.join(projectRoot, "scripts/a/a.gml")), [
            "scripts/b/b.gml"
        ]);
        assert.deepEqual(store.findImmediateDownstreamFiles("scripts/c/c.gml"), ["scripts/d/d.gml"]);
        assert.deepEqual(store.findUnresolvedDependents(["newly_defined"]), ["scripts/d/d.gml"]);
        assert.deepEqual(store.findUnresolvedDependents(["show_debug_message"]), []);
        assert.deepEqual(store.readSemanticSnapshot("full")?.unresolvedReferences, [
            { end: 13, filePath: "scripts/d/d.gml", name: "newly_defined", start: 0 }
        ]);
        assert.deepEqual(store.findImmediateDownstreamFiles("scripts/b/b.gml"), []);
        assert.deepEqual(
            store.readSemanticSnapshot("full")?.relationships.map((relationship) => relationship.kind),
            ["scriptCall"]
        );
    } finally {
        await store.close();
    }
});
