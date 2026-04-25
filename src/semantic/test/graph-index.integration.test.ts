import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
    buildGraphIndex,
    doctorGraphIndex,
    exportGraphVisualizationData,
    getGraphContext,
    getGraphUsages,
    openExistingGraphIndexDatabase,
    openGraphIndexDatabase,
    resolveGraphIndexConfig,
    searchGraphIndex
} from "../src/graph-index/index.js";
import { createTempProjectWorkspace } from "./test-project-helpers.js";

async function createDualRootFixture(): Promise<{
    cleanup: () => Promise<void>;
    projectRoot: string;
    toolsetRoot: string;
}> {
    const project = await createTempProjectWorkspace("graph-index-project-");
    const toolset = await createTempProjectWorkspace("graph-index-toolset-");

    await project.writeProjectFile("Project.yyp", JSON.stringify({ name: "Project", resourceType: "GMProject" }));
    await toolset.writeProjectFile("Toolset.yyp", JSON.stringify({ name: "Toolset", resourceType: "GMProject" }));

    await toolset.writeProjectFile(
        "scripts/shared_toolset_fn/shared_toolset_fn.yy",
        JSON.stringify({ name: "shared_toolset_fn", resourceType: "GMScript" })
    );
    await toolset.writeProjectFile(
        "scripts/shared_toolset_fn/shared_toolset_fn.gml",
        ["function shared_toolset_fn() {", "    return 42;", "}", ""].join("\n")
    );

    await project.writeProjectFile(
        "scripts/player_update/player_update.yy",
        JSON.stringify({ name: "player_update", resourceType: "GMScript" })
    );
    await project.writeProjectFile(
        "scripts/player_update/player_update.gml",
        ["function player_update() {", "    return shared_toolset_fn();", "}", ""].join("\n")
    );

    return {
        cleanup: async () => {
            await project.cleanup();
            await toolset.cleanup();
        },
        projectRoot: project.projectRoot,
        toolsetRoot: toolset.projectRoot
    };
}

void test("buildGraphIndex creates dual-root graphs and cross-graph toolset edges", async () => {
    const fixture = await createDualRootFixture();

    try {
        const result = await buildGraphIndex({
            projectRoot: fixture.projectRoot,
            toolsetRoot: fixture.toolsetRoot
        });

        const search = searchGraphIndex({
            projectRoot: fixture.projectRoot,
            query: "shared_toolset_fn",
            toolsetRoot: fixture.toolsetRoot
        });
        assert.equal(search.results[0]?.id, "toolset::gml/script/shared_toolset_fn");

        const context = getGraphContext({
            nodeId: "toolset::gml/script/shared_toolset_fn",
            projectRoot: fixture.projectRoot,
            toolsetRoot: fixture.toolsetRoot
        });
        assert.ok(context);
        assert.equal(context?.target.id, "toolset::gml/script/shared_toolset_fn");
        assert.ok((context?.summary.length ?? 0) > 0);

        const database = openGraphIndexDatabase(result.databasePath);
        try {
            const graphRows = database.prepare("SELECT id FROM graphs ORDER BY id").all() as Array<{ id: string }>;
            assert.deepEqual(
                graphRows.map((entry) => entry.id),
                ["project", "toolset"]
            );

            const edgeRows = database
                .prepare("SELECT from_id AS fromId, to_id AS toId, type FROM edges WHERE type = 'uses_toolset'")
                .all() as Array<{ fromId: string; toId: string; type: string }>;
            assert.ok(
                edgeRows.some(
                    (entry) =>
                        entry.fromId ===
                            "project::gml/function/function:scripts/player_update/player_update.gml::1:9:9" &&
                        entry.toId === "toolset::gml/script/shared_toolset_fn"
                )
            );
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("graph config resolves relative database and model paths under the project root", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-config-");

    try {
        const config = resolveGraphIndexConfig({
            projectConfig: {
                graph: {
                    databasePath: ".gmloop/custom.sqlite",
                    embeddings: {
                        modelCacheDir: ".gmloop/models"
                    },
                    toolsetRoot: "../toolset"
                }
            },
            projectRoot: fixture.projectRoot
        });

        assert.equal(config.databasePath, path.join(fixture.projectRoot, ".gmloop/custom.sqlite"));
        assert.equal(config.embeddings.modelCacheDir, path.join(fixture.projectRoot, ".gmloop/models"));
        assert.equal(config.toolsetRoot, path.resolve(fixture.projectRoot, "../toolset"));
    } finally {
        await fixture.cleanup();
    }
});

void test("buildGraphIndex honors disabled embeddings and doctor reports stale files", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-embeddings-");

    try {
        await fixture.writeProjectFile("Project.yyp", JSON.stringify({ name: "Project", resourceType: "GMProject" }));
        await fixture.writeProjectFile(
            "scripts/no_embeddings/no_embeddings.yy",
            JSON.stringify({ name: "no_embeddings", resourceType: "GMScript" })
        );
        await fixture.writeProjectFile(
            "scripts/no_embeddings/no_embeddings.gml",
            ["function no_embeddings() {", "    return 1;", "}", ""].join("\n")
        );

        const result = await buildGraphIndex({
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: fixture.projectRoot
        });

        const database = openGraphIndexDatabase(result.databasePath);
        try {
            const embeddingCount = database.prepare("SELECT COUNT(*) AS count FROM embeddings").get() as {
                count: number;
            };
            assert.equal(embeddingCount.count, 0);
        } finally {
            database.close();
        }

        await fixture.writeProjectFile(
            "scripts/no_embeddings/no_embeddings.gml",
            ["function no_embeddings() {", "    return 2;", "}", ""].join("\n")
        );

        const report = doctorGraphIndex({
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: fixture.projectRoot
        });
        assert.ok(report.issues.some((issue) => issue.code === "GRAPH_DB_STALE"));
        assert.ok(!report.issues.some((issue) => issue.code === "GRAPH_EMBEDDINGS_MISSING"));
        assert.equal(report.runtime?.driver, "node:sqlite");
        assert.equal(report.runtime?.experimental, true);
        assert.equal(report.integrity?.ok, true);
    } finally {
        await fixture.cleanup();
    }
});

void test("openExistingGraphIndexDatabase migrates a v1 database to the current schema", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-migration-");

    try {
        const databasePath = path.join(fixture.projectRoot, ".gmloop", "graph-index.sqlite");
        const database = openGraphIndexDatabase(databasePath);
        try {
            database.exec("DROP TABLE IF EXISTS index_state");
            database.exec("DROP TABLE IF EXISTS embeddings");
            database.exec("DROP TABLE IF EXISTS aliases");
            database.exec("DROP TABLE IF EXISTS edges");
            database.exec("DROP TABLE IF EXISTS node_fts");
            database.exec("DROP TABLE IF EXISTS nodes");
            database.exec("DROP TABLE IF EXISTS files");
            database.exec("DROP TABLE IF EXISTS graphs");
            database.exec("UPDATE schema_meta SET value = '1' WHERE key = 'schema_version'");
            database.exec(`
                CREATE TABLE graphs (
                    id TEXT PRIMARY KEY,
                    scope TEXT NOT NULL,
                    root_path TEXT NOT NULL,
                    manifest_path TEXT,
                    last_indexed_at TEXT NOT NULL,
                    schema_version INTEGER NOT NULL
                );
                CREATE TABLE files (
                    graph_id TEXT NOT NULL,
                    relative_path TEXT NOT NULL,
                    content_hash TEXT,
                    mtime_ms INTEGER,
                    indexed_at TEXT NOT NULL,
                    PRIMARY KEY (graph_id, relative_path)
                );
                CREATE TABLE nodes (
                    id TEXT PRIMARY KEY,
                    graph_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    name TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    scip_symbol TEXT,
                    relative_path TEXT,
                    resource_path TEXT,
                    scope_id TEXT,
                    line_start INTEGER,
                    line_end INTEGER,
                    summary TEXT NOT NULL,
                    snippet TEXT NOT NULL,
                    content_hash TEXT
                );
                CREATE TABLE edges (
                    from_id TEXT NOT NULL,
                    to_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    ordinal INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (from_id, to_id, type, ordinal)
                );
                CREATE TABLE aliases (
                    alias TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    PRIMARY KEY (alias, node_id, source)
                );
                CREATE TABLE embeddings (
                    node_id TEXT PRIMARY KEY,
                    model_id TEXT NOT NULL,
                    dimensions INTEGER NOT NULL,
                    vector_blob BLOB NOT NULL,
                    content_hash TEXT NOT NULL
                );
                CREATE TABLE index_state (
                    graph_id TEXT PRIMARY KEY,
                    file_count INTEGER NOT NULL,
                    node_count INTEGER NOT NULL,
                    edge_count INTEGER NOT NULL,
                    embedding_model TEXT NOT NULL,
                    build_duration_ms INTEGER NOT NULL
                );
                CREATE VIRTUAL TABLE node_fts USING fts5(
                    id UNINDEXED,
                    name,
                    display_name,
                    summary,
                    content
                );
            `);
            database
                .prepare(
                    "INSERT INTO graphs(id, scope, root_path, manifest_path, last_indexed_at, schema_version) VALUES (?, ?, ?, ?, ?, ?)"
                )
                .run("project", "project", fixture.projectRoot, null, new Date().toISOString(), 1);
            database
                .prepare(
                    "INSERT INTO nodes(id, graph_id, kind, name, display_name, summary, snippet) VALUES (?, ?, ?, ?, ?, ?, ?)"
                )
                .run("project::gml/script/example", "project", "script", "example", "example", "script 'example'.", "");
            database
                .prepare("INSERT INTO node_fts(id, name, display_name, summary, content) VALUES (?, ?, ?, ?, ?)")
                .run("project::gml/script/example", "example", "example", "script 'example'.", "script 'example'.");
        } finally {
            database.close();
        }

        const migrated = openExistingGraphIndexDatabase(databasePath);
        try {
            const schemaVersion = migrated
                .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
                .get() as { value: string } | undefined;
            assert.equal(schemaVersion?.value, "2");
            const nodeCount = migrated.prepare("SELECT COUNT(*) AS count FROM nodes").get() as { count: number };
            assert.equal(nodeCount.count, 1);
            const foreignKeys = migrated.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
            assert.equal(foreignKeys.foreign_keys, 1);
        } finally {
            migrated.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("buildGraphIndex preserves unchanged graph slices across incremental rebuilds", async () => {
    const fixture = await createDualRootFixture();

    try {
        const result = await buildGraphIndex({
            projectRoot: fixture.projectRoot,
            toolsetRoot: fixture.toolsetRoot
        });

        const database = openGraphIndexDatabase(result.databasePath);
        const initialRows = database
            .prepare("SELECT id, last_indexed_at AS lastIndexedAt FROM graphs ORDER BY id")
            .all() as Array<{ id: string; lastIndexedAt: string }>;
        database.close();

        await fs.writeFile(
            path.join(fixture.projectRoot, "scripts/player_update/player_update.gml"),
            ["function player_update() {", "    return shared_toolset_fn() + 1;", "}", ""].join("\n"),
            "utf8"
        );

        await buildGraphIndex({
            projectRoot: fixture.projectRoot,
            toolsetRoot: fixture.toolsetRoot
        });

        const rebuiltDatabase = openGraphIndexDatabase(result.databasePath);
        try {
            const rebuiltRows = rebuiltDatabase
                .prepare("SELECT id, last_indexed_at AS lastIndexedAt FROM graphs ORDER BY id")
                .all() as Array<{ id: string; lastIndexedAt: string }>;
            const initialProject = initialRows.find((row) => row.id === "project");
            const initialToolset = initialRows.find((row) => row.id === "toolset");
            const rebuiltProject = rebuiltRows.find((row) => row.id === "project");
            const rebuiltToolset = rebuiltRows.find((row) => row.id === "toolset");

            assert.notEqual(initialProject?.lastIndexedAt, rebuiltProject?.lastIndexedAt);
            assert.equal(initialToolset?.lastIndexedAt, rebuiltToolset?.lastIndexedAt);
        } finally {
            rebuiltDatabase.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("project-local scripts shadow same-named toolset scripts", async () => {
    const fixture = await createDualRootFixture();

    try {
        await fs.mkdir(path.join(fixture.projectRoot, "scripts/shared_toolset_fn"), { recursive: true });
        await fs.writeFile(
            path.join(fixture.projectRoot, "scripts/shared_toolset_fn/shared_toolset_fn.yy"),
            JSON.stringify({ name: "shared_toolset_fn", resourceType: "GMScript" }),
            "utf8"
        );
        await fs.writeFile(
            path.join(fixture.projectRoot, "scripts/shared_toolset_fn/shared_toolset_fn.gml"),
            ["function shared_toolset_fn() {", "    return 7;", "}", ""].join("\n"),
            "utf8"
        );

        const result = await buildGraphIndex({
            projectRoot: fixture.projectRoot,
            toolsetRoot: fixture.toolsetRoot
        });
        const database = openGraphIndexDatabase(result.databasePath);
        try {
            const toolsetEdgeCount = database
                .prepare("SELECT COUNT(*) AS count FROM edges WHERE type = 'uses_toolset'")
                .get() as { count: number };
            assert.equal(toolsetEdgeCount.count, 0);
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("graph usages return incoming usage records with source and target nodes", async () => {
    const fixture = await createDualRootFixture();

    try {
        await buildGraphIndex({
            projectRoot: fixture.projectRoot,
            toolsetRoot: fixture.toolsetRoot
        });

        const usages = getGraphUsages({
            nodeId: "toolset::gml/script/shared_toolset_fn",
            projectRoot: fixture.projectRoot,
            toolsetRoot: fixture.toolsetRoot
        });

        assert.equal(
            usages[0]?.from.id,
            "project::gml/function/function:scripts/player_update/player_update.gml::1:9:9"
        );
        assert.equal(usages[0]?.to.id, "toolset::gml/script/shared_toolset_fn");
    } finally {
        await fixture.cleanup();
    }
});

void test("doctorGraphIndex reports a missing database before the graph is built", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-doctor-");

    try {
        await fixture.writeProjectFile(
            "DoctorProject.yyp",
            JSON.stringify({ name: "DoctorProject", resourceType: "GMProject" })
        );

        const report = doctorGraphIndex({
            projectRoot: fixture.projectRoot
        });

        assert.ok(report.issues.some((issue) => issue.code === "GRAPH_DB_MISSING"));
    } finally {
        await fixture.cleanup();
    }
});

void test("buildGraphIndex projects structs, variables, functions, and concrete resource types", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-node-kinds-");

    try {
        await fixture.writeProjectFile("Project.yyp", JSON.stringify({ name: "Project", resourceType: "GMProject" }));
        await fixture.writeProjectFile(
            "scripts/graph_nodes/graph_nodes.yy",
            JSON.stringify({ name: "graph_nodes", resourceType: "GMScript" })
        );
        await fixture.writeProjectFile(
            "scripts/graph_nodes/graph_nodes.gml",
            [
                "function Player() constructor {",
                "    var struct_health = 100;",
                "    function heal(amount) {",
                "        var healed = amount;",
                "        struct_health += healed;",
                "    }",
                "}",
                "function helper() {",
                "    var local_value = 1;",
                "    return local_value;",
                "}",
                ""
            ].join("\n")
        );
        await fixture.writeProjectFile(
            "objects/obj_player/obj_player.yy",
            JSON.stringify({
                name: "obj_player",
                resourceType: "GMObject",
                eventList: [
                    {
                        eventType: 0,
                        eventNum: 0,
                        name: "Create_0",
                        eventId: {
                            path: "objects/obj_player/obj_player_Create_0.gml"
                        }
                    }
                ]
            })
        );
        await fixture.writeProjectFile(
            "objects/obj_player/obj_player_Create_0.gml",
            ["speed_bonus = 1;", "speed_bonus += 1;", ""].join("\n")
        );

        const resourceFixtures = [
            ["sounds/snd_hit/snd_hit.yy", "snd_hit", "GMSound"],
            ["paths/pth_patrol/pth_patrol.yy", "pth_patrol", "GMPath"],
            ["sequences/seq_intro/seq_intro.yy", "seq_intro", "GMSequence"],
            ["notes/note_design/note_design.yy", "note_design", "GMNotes"],
            ["particles/ps_sparks/ps_sparks.yy", "ps_sparks", "GMParticleSystem"],
            ["datafiles/config/config.yy", "config", "GMIncludedFile"]
        ] as const;

        for (const [resourcePath, name, resourceType] of resourceFixtures) {
            await fixture.writeProjectFile(resourcePath, JSON.stringify({ name, resourceType }));
        }

        const result = await buildGraphIndex({
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: fixture.projectRoot
        });

        const database = openGraphIndexDatabase(result.databasePath);
        try {
            const nodeRows = database.prepare("SELECT kind, name FROM nodes").all() as Array<{
                kind: string;
                name: string;
            }>;
            const nodeKinds = new Set(nodeRows.map((row) => row.kind));
            const nodeNamesByKind = new Map<string, Set<string>>();
            for (const row of nodeRows) {
                const names = nodeNamesByKind.get(row.kind) ?? new Set<string>();
                names.add(row.name);
                nodeNamesByKind.set(row.kind, names);
            }

            for (const expectedKind of [
                "data_file",
                "function",
                "instance_variable",
                "local_variable",
                "note",
                "particle_system",
                "path",
                "script",
                "sequence",
                "sound",
                "struct",
                "struct_variable"
            ]) {
                assert.ok(nodeKinds.has(expectedKind), `expected graph node kind ${expectedKind}`);
            }

            assert.ok(nodeNamesByKind.get("struct")?.has("Player"));
            assert.ok(nodeNamesByKind.get("function")?.has("helper"));
            assert.ok(nodeNamesByKind.get("local_variable")?.has("local_value"));
            assert.ok(nodeNamesByKind.get("struct_variable")?.has("struct_health"));
            assert.ok(nodeNamesByKind.get("instance_variable")?.has("speed_bonus"));
            assert.equal(nodeKinds.has("resource"), false);
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("buildGraphIndex connects macro, global, and local variable symbols to visible owners", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-variable-owners-");

    try {
        await fixture.writeProjectFile("Project.yyp", JSON.stringify({ name: "Project", resourceType: "GMProject" }));
        await fixture.writeProjectFile(
            "scripts/identifier_ownership/identifier_ownership.yy",
            JSON.stringify({ name: "identifier_ownership", resourceType: "GMScript" })
        );
        await fixture.writeProjectFile(
            "scripts/identifier_ownership/identifier_ownership.gml",
            [
                "#macro MAX_ENEMIES 3",
                "globalvar enemy_limit;",
                "function identifier_ownership() {",
                "    var local_value = MAX_ENEMIES;",
                "    enemy_limit = enemy_limit + local_value;",
                "    return local_value;",
                "}",
                ""
            ].join("\n")
        );

        const result = await buildGraphIndex({
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: fixture.projectRoot
        });

        const database = openGraphIndexDatabase(result.databasePath);
        try {
            const symbolRows = database
                .prepare(
                    `
                        SELECT id, kind, name
                        FROM nodes
                        WHERE kind IN ('macro', 'global_variable', 'local_variable')
                        ORDER BY kind, name
                    `
                )
                .all() as Array<{ id: string; kind: string; name: string }>;

            const macroNode = symbolRows.find((row) => row.kind === "macro" && row.name === "MAX_ENEMIES");
            const globalNode = symbolRows.find((row) => row.kind === "global_variable" && row.name === "enemy_limit");
            const localNode = symbolRows.find((row) => row.kind === "local_variable" && row.name === "local_value");

            assert.ok(macroNode, "expected macro node to be indexed");
            assert.ok(globalNode, "expected global variable node to be indexed");
            assert.ok(localNode, "expected local variable node to be indexed");

            for (const node of [macroNode, globalNode, localNode]) {
                const incomingEdges = database
                    .prepare("SELECT from_id AS fromId, type FROM edges WHERE to_id = ? ORDER BY from_id, type")
                    .all(node.id) as Array<{ fromId: string; type: string }>;

                assert.ok(
                    incomingEdges.some((edge) => edge.fromId.startsWith("project::gml/")),
                    `expected ${node.kind} ${node.name} to be connected from a visible semantic owner`
                );
            }
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("graph visualization data keeps top-level language symbols connected without file nodes", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-visible-symbol-owners-");

    try {
        await fixture.writeProjectFile("Project.yyp", JSON.stringify({ name: "Project", resourceType: "GMProject" }));
        await fixture.writeProjectFile(
            "scripts/visible_symbols/visible_symbols.yy",
            JSON.stringify({ name: "visible_symbols", resourceType: "GMScript" })
        );
        await fixture.writeProjectFile(
            "scripts/visible_symbols/visible_symbols.gml",
            [
                "#macro STARTING_SCORE 10",
                "globalvar visible_global_score;",
                "enum VisibleState {",
                "    Ready,",
                "    Active",
                "}",
                "function visible_symbols() {",
                "    visible_global_score = STARTING_SCORE;",
                "    return VisibleState.Active;",
                "}",
                ""
            ].join("\n")
        );

        const result = await buildGraphIndex({
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: fixture.projectRoot
        });

        const database = openGraphIndexDatabase(result.databasePath);
        try {
            const visualizationData = exportGraphVisualizationData(database, fixture.projectRoot);
            const visibleNodeIds = new Set(
                visualizationData.nodes.filter((node) => node.kind !== "file").map((node) => node.id)
            );
            const visibleEdges = visualizationData.edges.filter(
                (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
            );
            const connectedVisibleNodeIds = new Set<string>();
            for (const edge of visibleEdges) {
                connectedVisibleNodeIds.add(edge.source);
                connectedVisibleNodeIds.add(edge.target);
            }

            for (const expectedNode of [
                { kind: "macro", name: "STARTING_SCORE" },
                { kind: "global_variable", name: "visible_global_score" },
                { kind: "enum", name: "VisibleState" },
                { kind: "enum_member", name: "Ready" },
                { kind: "enum_member", name: "Active" },
                { kind: "function", name: "visible_symbols" }
            ]) {
                const node = visualizationData.nodes.find(
                    (candidate) => candidate.kind === expectedNode.kind && candidate.name === expectedNode.name
                );
                assert.ok(node, `expected ${expectedNode.kind} ${expectedNode.name} node`);
                assert.ok(
                    connectedVisibleNodeIds.has(node.id),
                    `expected ${expectedNode.kind} ${expectedNode.name} to have a visible non-file edge`
                );
            }

            assert.ok(
                visibleEdges.some(
                    (edge) =>
                        edge.source.includes("gml/enum/enum:scripts/visible_symbols/visible_symbols.gml") &&
                        edge.target.includes(
                            "gml/enum-member/enum-member:scripts/visible_symbols/visible_symbols.gml"
                        ) &&
                        edge.type === "defines"
                ),
                "expected enum members to be directly connected to their enum"
            );
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("buildGraphIndex keeps same-named enum members distinct across different enums", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-enum-member-collisions-");

    try {
        await fixture.writeProjectFile("Project.yyp", JSON.stringify({ name: "Project", resourceType: "GMProject" }));
        await fixture.writeProjectFile(
            "scripts/state_graph/state_graph.yy",
            JSON.stringify({ name: "state_graph", resourceType: "GMScript" })
        );
        await fixture.writeProjectFile(
            "scripts/state_graph/state_graph.gml",
            [
                "enum MoveState {",
                "    Idle,",
                "    Run",
                "}",
                "",
                "enum CombatState {",
                "    Idle,",
                "    Attack",
                "}",
                "",
                "function state_graph() {",
                "    return [MoveState.Idle, CombatState.Idle];",
                "}",
                ""
            ].join("\n")
        );

        const result = await buildGraphIndex({
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: fixture.projectRoot
        });

        const database = openGraphIndexDatabase(result.databasePath);
        try {
            const idleMemberNodes = database
                .prepare(
                    `
                        SELECT id, scip_symbol AS scipSymbol
                        FROM nodes
                        WHERE kind = 'enum_member' AND name = 'Idle'
                        ORDER BY id
                    `
                )
                .all() as Array<{ id: string; scipSymbol: string }>;

            assert.equal(idleMemberNodes.length, 2);
            assert.notEqual(idleMemberNodes[0]?.id, idleMemberNodes[1]?.id);
            assert.notEqual(idleMemberNodes[0]?.scipSymbol, idleMemberNodes[1]?.scipSymbol);

            const enumOwnershipEdges = database
                .prepare(
                    `
                        SELECT from_id AS fromId, to_id AS toId, type
                        FROM edges
                        WHERE type = 'defines' AND from_id IN (
                            SELECT id FROM nodes WHERE kind = 'enum'
                        ) AND to_id IN (
                            SELECT id FROM nodes WHERE kind = 'enum_member' AND name = 'Idle'
                        )
                        ORDER BY from_id, to_id
                    `
                )
                .all() as Array<{ fromId: string; toId: string; type: string }>;

            assert.equal(enumOwnershipEdges.length, 2);
            assert.notEqual(enumOwnershipEdges[0]?.fromId, enumOwnershipEdges[1]?.fromId);
            assert.notEqual(enumOwnershipEdges[0]?.toId, enumOwnershipEdges[1]?.toId);
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("buildGraphIndex connects function call edges for script-local and object-local functions", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-function-calls-");

    try {
        await fixture.writeProjectFile("Project.yyp", JSON.stringify({ name: "Project", resourceType: "GMProject" }));
        await fixture.writeProjectFile(
            "scripts/graph_functions/graph_functions.yy",
            JSON.stringify({ name: "graph_functions", resourceType: "GMScript" })
        );
        await fixture.writeProjectFile(
            "scripts/graph_functions/graph_functions.gml",
            [
                "function graph_functions() {",
                "    return helper();",
                "}",
                "",
                "function helper() {",
                "    return 42;",
                "}",
                ""
            ].join("\n")
        );
        await fixture.writeProjectFile(
            "objects/obj_player/obj_player.yy",
            JSON.stringify({
                name: "obj_player",
                resourceType: "GMObject",
                eventList: [
                    {
                        eventType: 0,
                        eventNum: 0,
                        name: "Create_0",
                        eventId: {
                            path: "objects/obj_player/obj_player_Create_0.gml"
                        }
                    }
                ]
            })
        );
        await fixture.writeProjectFile(
            "objects/obj_player/obj_player_Create_0.gml",
            ["function local_helper() {", "    return 1;", "}", "", "local_helper();", ""].join("\n")
        );

        const result = await buildGraphIndex({
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: fixture.projectRoot
        });

        const database = openGraphIndexDatabase(result.databasePath);
        try {
            const functionNodes = database
                .prepare("SELECT id, kind, name, scope_id AS scopeId FROM nodes WHERE kind = 'function' ORDER BY name")
                .all() as Array<{ id: string; kind: string; name: string; scopeId: string | null }>;
            const helperNode = functionNodes.find((node) => node.name === "helper");
            const localHelperNode = functionNodes.find((node) => node.name === "local_helper");
            const graphFunctionsNode = functionNodes.find((node) => node.name === "graph_functions");

            assert.ok(graphFunctionsNode);
            assert.ok(helperNode);
            assert.ok(localHelperNode);
            assert.ok(helperNode.scopeId);
            assert.ok(localHelperNode.scopeId);

            const callEdges = database
                .prepare(
                    `
                        SELECT from_id AS fromId, to_id AS toId, type
                        FROM edges
                        WHERE type = 'calls'
                        ORDER BY from_id, to_id
                    `
                )
                .all() as Array<{ fromId: string; toId: string; type: string }>;

            assert.ok(
                callEdges.some((edge) => edge.fromId === graphFunctionsNode.id && edge.toId === helperNode.id),
                "expected the top-level function node to call the helper function node"
            );
            assert.ok(
                callEdges.some((edge) => edge.fromId !== localHelperNode.id && edge.toId === localHelperNode.id),
                "expected object-event calls to resolve to local function nodes"
            );
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("buildGraphIndex connects global variables to their defining and referencing owners", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-global-variables-");

    try {
        await fixture.writeProjectFile("Project.yyp", JSON.stringify({ name: "Project", resourceType: "GMProject" }));
        await fixture.writeProjectFile(
            "scripts/configure_globals/configure_globals.yy",
            JSON.stringify({ name: "configure_globals", resourceType: "GMScript" })
        );
        await fixture.writeProjectFile(
            "scripts/configure_globals/configure_globals.gml",
            ["globalvar enemy_limit;", "function configure_globals() {", "    enemy_limit = 4;", "}", ""].join("\n")
        );
        const result = await buildGraphIndex({
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: fixture.projectRoot
        });

        const database = openGraphIndexDatabase(result.databasePath);
        try {
            const globalNode = database
                .prepare("SELECT id FROM nodes WHERE kind = 'global_variable' AND name = 'enemy_limit'")
                .get() as { id: string } | undefined;
            const configureFunctionNode = database
                .prepare("SELECT id FROM nodes WHERE kind = 'function' AND name = 'configure_globals'")
                .get() as { id: string } | undefined;

            assert.ok(globalNode);
            assert.ok(configureFunctionNode);

            const edges = database
                .prepare(
                    `
                        SELECT from_id AS fromId, to_id AS toId, type
                        FROM edges
                        WHERE to_id = ?
                        ORDER BY from_id, type
                    `
                )
                .all(globalNode.id) as Array<{ fromId: string; toId: string; type: string }>;

            assert.ok(
                edges.some(
                    (edge) =>
                        edge.fromId === "project::file::scripts/configure_globals/configure_globals.gml" &&
                        edge.type === "defines"
                ),
                "expected the global variable node to stay connected to its defining file"
            );
            assert.ok(
                edges.some(
                    (edge) => edge.fromId === "project::gml/script/configure_globals" && edge.type === "references"
                ),
                "expected the owning script to reference the global variable node"
            );
            assert.ok(
                edges.some(
                    (edge) => edge.fromId === "project::gml/script/configure_globals" && edge.type === "references"
                ),
                "expected tracked global references to connect to the global variable node"
            );
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("buildGraphIndex skips dangling edges from stale project references instead of failing the build", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-dangling-edges-");

    try {
        await fixture.writeProjectFile(
            "InterplanetaryFootball.yyp",
            JSON.stringify({
                name: "InterplanetaryFootball",
                resourceType: "GMProject",
                resources: [
                    {
                        id: {
                            name: "kickoff",
                            path: "scripts/kickoff/kickoff.yy"
                        }
                    },
                    {
                        id: {
                            name: "missing_script",
                            path: "scripts/missing_script/missing_script.yy"
                        }
                    }
                ]
            })
        );
        await fixture.writeProjectFile(
            "scripts/kickoff/kickoff.yy",
            JSON.stringify({
                name: "kickoff",
                resourceType: "GMScript"
            })
        );
        await fixture.writeProjectFile(
            "scripts/kickoff/kickoff.gml",
            ["function kickoff() {", "    return 1;", "}", ""].join("\n")
        );

        const result = await buildGraphIndex({
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: fixture.projectRoot
        });

        const database = openGraphIndexDatabase(result.databasePath);
        try {
            const kickoffNode = database
                .prepare("SELECT id FROM nodes WHERE kind = 'script' AND name = 'kickoff'")
                .get() as { id: string } | undefined;
            assert.ok(
                kickoffNode,
                "expected graph indexing to succeed even when the project manifest references stale resources"
            );

            const missingResourceNode = database
                .prepare("SELECT id FROM nodes WHERE resource_path = ?")
                .get("scripts/missing_script/missing_script.yy") as { id: string } | undefined;
            assert.equal(missingResourceNode, undefined);

            const danglingEdgeCount = database
                .prepare(
                    `
                        SELECT COUNT(*) AS count
                        FROM edges
                        WHERE from_id = ? OR to_id = ?
                    `
                )
                .get(
                    "project::resource::scripts/missing_script/missing_script.yy",
                    "project::resource::scripts/missing_script/missing_script.yy"
                ) as {
                count: number;
            };
            assert.equal(danglingEdgeCount.count, 0);
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("buildGraphIndex projects the project manifest as the connected project root", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-project-root-");

    try {
        await fixture.writeProjectFile(
            "InterplanetaryFootball.yyp",
            JSON.stringify({
                name: "InterplanetaryFootball",
                resourceType: "GMProject",
                resources: [
                    {
                        id: {
                            name: "kickoff",
                            path: "scripts/kickoff/kickoff.yy"
                        }
                    },
                    {
                        id: {
                            name: "config",
                            path: "datafiles/config/config.yy"
                        }
                    },
                    {
                        id: {
                            name: "mystery_resource",
                            path: "extensions/mystery_resource/mystery_resource.yy"
                        }
                    }
                ]
            })
        );
        await fixture.writeProjectFile(
            "scripts/kickoff/kickoff.yy",
            JSON.stringify({ name: "kickoff", resourceType: "GMScript" })
        );
        await fixture.writeProjectFile(
            "scripts/kickoff/kickoff.gml",
            ["function kickoff() {", "    return 1;", "}", ""].join("\n")
        );
        await fixture.writeProjectFile(
            "datafiles/config/config.yy",
            JSON.stringify({ name: "config", resourceType: "GMIncludedFile" })
        );
        await fixture.writeProjectFile(
            "extensions/mystery_resource/mystery_resource.yy",
            JSON.stringify({ name: "mystery_resource", resourceType: "GMMysteryResource" })
        );

        const result = await buildGraphIndex({
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: fixture.projectRoot
        });

        const database = openGraphIndexDatabase(result.databasePath);
        try {
            const projectNode = database
                .prepare(
                    `
                        SELECT id, kind, name, resource_path AS resourcePath, summary
                        FROM nodes
                        WHERE resource_path = ?
                    `
                )
                .get("InterplanetaryFootball.yyp") as
                | { id: string; kind: string; name: string; resourcePath: string; summary: string }
                | undefined;
            assert.ok(projectNode);
            assert.equal(projectNode.id, "project::resource::InterplanetaryFootball.yyp");
            assert.equal(projectNode.kind, "project");
            assert.equal(projectNode.name, "InterplanetaryFootball");
            assert.equal(projectNode.resourcePath, "InterplanetaryFootball.yyp");
            assert.equal(
                projectNode.summary,
                "project 'InterplanetaryFootball'. Defined in InterplanetaryFootball.yyp."
            );

            const dataFileRows = database
                .prepare("SELECT name FROM nodes WHERE kind = 'data_file' ORDER BY name")
                .all() as Array<{ name: string }>;
            assert.deepEqual(
                dataFileRows.map((row) => row.name),
                ["config"]
            );

            const genericResourceNode = database
                .prepare("SELECT kind FROM nodes WHERE resource_path = ?")
                .get("extensions/mystery_resource/mystery_resource.yy") as { kind: string } | undefined;
            assert.equal(genericResourceNode?.kind, "resource");

            const rootEdges = database
                .prepare(
                    `
                        SELECT to_id AS toId, type
                        FROM edges
                        WHERE from_id = ?
                        ORDER BY to_id
                    `
                )
                .all("project::resource::InterplanetaryFootball.yyp") as Array<{ toId: string; type: string }>;
            assert.deepEqual(
                rootEdges.map((row) => ({ toId: row.toId, type: row.type })),
                [
                    {
                        toId: "project::resource::datafiles/config/config.yy",
                        type: "contains"
                    },
                    {
                        toId: "project::resource::extensions/mystery_resource/mystery_resource.yy",
                        type: "contains"
                    },
                    {
                        toId: "project::resource::scripts/kickoff/kickoff.yy",
                        type: "contains"
                    }
                ]
            );
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});
