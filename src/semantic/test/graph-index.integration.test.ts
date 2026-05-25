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

const SHARED_TOOLSET_SCRIPT_NODE_ID = "toolset::resource::scripts/shared_toolset_fn/shared_toolset_fn.yy";
const PLAYER_UPDATE_SCRIPT_RESOURCE_NODE_ID = "project::resource::scripts/player_update/player_update.yy";

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
        assert.equal(search.results[0]?.id, SHARED_TOOLSET_SCRIPT_NODE_ID);

        const context = getGraphContext({
            nodeId: SHARED_TOOLSET_SCRIPT_NODE_ID,
            projectRoot: fixture.projectRoot,
            toolsetRoot: fixture.toolsetRoot
        });
        assert.ok(context);
        assert.equal(context?.target.id, SHARED_TOOLSET_SCRIPT_NODE_ID);
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
                        entry.fromId === PLAYER_UPDATE_SCRIPT_RESOURCE_NODE_ID &&
                        entry.toId === SHARED_TOOLSET_SCRIPT_NODE_ID
                )
            );
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("buildGraphIndex includes macro, enum, and enum member symbol nodes", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-symbol-kinds-");

    try {
        await fixture.writeProjectFile("Project.yyp", JSON.stringify({ name: "Project", resourceType: "GMProject" }));
        await fixture.writeProjectFile(
            "scripts/combat_state/combat_state.yy",
            JSON.stringify({ name: "combat_state", resourceType: "GMScript" })
        );
        await fixture.writeProjectFile(
            "scripts/combat_state/combat_state.gml",
            [
                "#macro MAX_ENEMIES 8",
                "enum CombatState {",
                "    Idle,",
                "    Attacking",
                "}",
                "",
                "function combat_state() {",
                "    return CombatState.Attacking + MAX_ENEMIES;",
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
            const symbolRows = (
                database
                    .prepare(
                        "SELECT kind, name FROM nodes WHERE kind IN ('macro', 'enum', 'enum_member') ORDER BY kind, name"
                    )
                    .all() as Array<{ kind: string; name: string }>
            ).map((row) => ({ kind: row.kind, name: row.name }));

            assert.deepEqual(symbolRows, [
                { kind: "enum", name: "CombatState" },
                { kind: "enum_member", name: "Attacking" },
                { kind: "enum_member", name: "Idle" },
                { kind: "macro", name: "MAX_ENEMIES" }
            ]);
        } finally {
            database.close();
        }

        const macroSearch = searchGraphIndex({
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: fixture.projectRoot,
            query: "MAX_ENEMIES"
        });
        assert.equal(macroSearch.results[0]?.kind, "macro");

        const enumMemberSearch = searchGraphIndex({
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: fixture.projectRoot,
            query: "Attacking"
        });
        assert.equal(enumMemberSearch.results[0]?.kind, "enum_member");
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
        assert.equal(report.runtime?.runtimeStability, "stable");
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
            nodeId: SHARED_TOOLSET_SCRIPT_NODE_ID,
            projectRoot: fixture.projectRoot,
            toolsetRoot: fixture.toolsetRoot
        });

        assert.equal(usages[0]?.from.id, PLAYER_UPDATE_SCRIPT_RESOURCE_NODE_ID);
        assert.equal(usages[0]?.to.id, SHARED_TOOLSET_SCRIPT_NODE_ID);
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

void test("buildGraphIndex exports object parent metadata as inherits relationships", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-object-inheritance-");

    try {
        await fixture.writeProjectFile(
            "Project.yyp",
            JSON.stringify({
                name: "Project",
                resourceType: "GMProject",
                resources: [
                    { id: { name: "obj_parent", path: "objects/obj_parent/obj_parent.yy" } },
                    { id: { name: "obj_child", path: "objects/obj_child/obj_child.yy" } }
                ]
            })
        );
        await fixture.writeProjectFile(
            "objects/obj_parent/obj_parent.yy",
            JSON.stringify({ name: "obj_parent", resourceType: "GMObject" })
        );
        await fixture.writeProjectFile(
            "objects/obj_child/obj_child.yy",
            JSON.stringify({
                name: "obj_child",
                resourceType: "GMObject",
                parentObjectId: {
                    name: "obj_parent",
                    path: "objects/obj_parent/obj_parent.yy"
                }
            })
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
            const inheritanceEdges = database
                .prepare(
                    `
                        SELECT from_id AS fromId, to_id AS toId, type
                        FROM edges
                        WHERE type = 'inherits'
                    `
                )
                .all() as Array<{ fromId: string; toId: string; type: string }>;

            assert.deepEqual(
                inheritanceEdges.map((edge) => ({ fromId: edge.fromId, toId: edge.toId, type: edge.type })),
                [
                    {
                        fromId: "project::resource::objects/obj_child/obj_child.yy",
                        toId: "project::resource::objects/obj_parent/obj_parent.yy",
                        type: "inherits"
                    }
                ]
            );

            const visualizationData = exportGraphVisualizationData(database, fixture.projectRoot);
            assert.ok(
                visualizationData.edges.some(
                    (edge) =>
                        edge.source === "project::resource::objects/obj_child/obj_child.yy" &&
                        edge.target === "project::resource::objects/obj_parent/obj_parent.yy" &&
                        edge.type === "inherits"
                ),
                "expected graph visualization export to preserve object inheritance edge semantics"
            );
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
                    .prepare(
                        `
                            SELECT edges.from_id AS fromId, edges.type, nodes.kind AS fromKind
                            FROM edges
                            LEFT JOIN nodes ON nodes.id = edges.from_id
                            WHERE edges.to_id = ?
                            ORDER BY edges.from_id, edges.type
                        `
                    )
                    .all(node.id) as Array<{ fromId: string; fromKind: string | null; type: string }>;

                assert.ok(
                    incomingEdges.some((edge) => edge.fromKind !== "file" && edge.fromId.startsWith("project::")),
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
            const visibleNodeIds = new Set(visualizationData.nodes.map((node) => node.id));
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
                    node.scipSymbol === null || typeof node.scipSymbol === "string",
                    `expected ${expectedNode.kind} to include optional scipSymbol metadata`
                );
                assert.ok(
                    node.scopeId === null || typeof node.scopeId === "string",
                    `expected ${expectedNode.kind} to include optional scopeId metadata`
                );
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
                callEdges.some(
                    (edge) =>
                        (edge.fromId === graphFunctionsNode.id ||
                            edge.fromId === "project::resource::scripts/graph_functions/graph_functions.yy") &&
                        edge.toId === helperNode.id
                ),
                "expected the top-level script owner to call the helper function node"
            );
            assert.ok(
                callEdges.some((edge) => edge.fromId !== localHelperNode.id && edge.toId === localHelperNode.id),
                "expected object-event calls to resolve to local function nodes"
            );

            const ownershipEdges = database
                .prepare(
                    `
                        SELECT from_id AS fromId, to_id AS toId, type
                        FROM edges
                        WHERE to_id = ?
                        ORDER BY from_id, type
                    `
                )
                .all(localHelperNode.id) as Array<{ fromId: string; toId: string; type: string }>;

            assert.ok(
                ownershipEdges.some(
                    (edge) =>
                        edge.fromId === "project::resource::objects/obj_player/obj_player.yy" && edge.type === "defines"
                ),
                "expected object-defined functions to stay connected to their owning object resource"
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

            assert.ok(globalNode);

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
                        edge.fromId === "project::resource::scripts/configure_globals/configure_globals.yy" &&
                        edge.type === "defines"
                ),
                "expected the global variable node to stay connected to its defining script resource"
            );
            assert.ok(
                edges.some(
                    (edge) =>
                        edge.fromId === "project::resource::scripts/configure_globals/configure_globals.yy" &&
                        edge.type === "references"
                ),
                "expected the owning script to reference the global variable node"
            );
            assert.ok(
                edges.some(
                    (edge) =>
                        edge.type === "references" &&
                        edge.fromId !== "project::file::scripts/configure_globals/configure_globals.gml"
                ),
                "expected at least one visible owner to reference the global variable node"
            );

            const visualizationData = exportGraphVisualizationData(database, fixture.projectRoot);
            const visibleNodeIds = new Set(visualizationData.nodes.map((node) => node.id));
            const visibleGlobalEdges = visualizationData.edges.filter(
                (edge) =>
                    visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target) && edge.target === globalNode.id
            );
            assert.ok(
                visibleGlobalEdges.some(
                    (edge) =>
                        edge.source === "project::resource::scripts/configure_globals/configure_globals.yy" &&
                        edge.type === "defines"
                ),
                "expected top-level global declarations to remain visibly connected without file nodes"
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
                Options: [
                    {
                        id: {
                            name: "Windows",
                            path: "options/windows/options_windows.yy"
                        }
                    },
                    {
                        id: {
                            name: "HTML5",
                            path: "options/html5/options_html5.yy"
                        }
                    }
                ],
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

void test("buildGraphIndex merges script scope identifiers into the script resource node instead of creating duplicates", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-script-dedup-");

    try {
        await fixture.writeProjectFile(
            "InterplanetaryFootball.yyp",
            JSON.stringify({
                name: "InterplanetaryFootball",
                resourceType: "GMProject",
                resources: [
                    {
                        id: {
                            name: "macros",
                            path: "scripts/macros/macros.yy"
                        }
                    }
                ]
            })
        );
        await fixture.writeProjectFile(
            "scripts/macros/macros.yy",
            JSON.stringify({
                name: "macros",
                resourceType: "GMScript"
            })
        );
        await fixture.writeProjectFile(
            "scripts/macros/macros.gml",
            ["/// @description Macro helpers.", "function macros() {", "    return 1;", "}", ""].join("\n")
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
            const scriptNodes = database
                .prepare(
                    `
                        SELECT
                            id,
                            display_name AS displayName,
                            relative_path AS filePath,
                            resource_path AS resourcePath,
                            scip_symbol AS scipSymbol,
                            summary
                        FROM nodes
                        WHERE kind = 'script'
                        ORDER BY id
                    `
                )
                .all() as Array<{
                displayName: string;
                filePath: string | null;
                id: string;
                resourcePath: string | null;
                scipSymbol: string | null;
                summary: string;
            }>;

            assert.deepEqual(
                scriptNodes.map((node) => ({
                    displayName: node.displayName,
                    filePath: node.filePath,
                    id: node.id,
                    resourcePath: node.resourcePath,
                    summary: node.summary
                })),
                [
                    {
                        displayName: "macros",
                        filePath: "scripts/macros/macros.gml",
                        id: "project::resource::scripts/macros/macros.yy",
                        resourcePath: "scripts/macros/macros.yy",
                        summary: "script 'macros'. Defined in scripts/macros/macros.gml."
                    }
                ]
            );
            assert.equal(scriptNodes[0]?.scipSymbol, "gml/script/macros");

            const duplicateScopeNodeCount = database
                .prepare("SELECT COUNT(*) AS count FROM nodes WHERE kind = 'script' AND display_name = 'script.macros'")
                .get() as {
                count: number;
            };
            assert.equal(duplicateScopeNodeCount.count, 0);

            const standaloneScriptSymbolNodeCount = database
                .prepare("SELECT COUNT(*) AS count FROM nodes WHERE id LIKE '%::gml/script/%'")
                .get() as {
                count: number;
            };
            assert.equal(standaloneScriptSymbolNodeCount.count, 0);

            const functionNode = database
                .prepare("SELECT id FROM nodes WHERE kind = 'function' AND name = 'macros'")
                .get() as { id: string } | undefined;
            assert.ok(functionNode);

            const functionOwnershipEdge = database
                .prepare(
                    `
                        SELECT COUNT(*) AS count
                        FROM edges
                        WHERE from_id = ? AND to_id = ? AND type = 'defines'
                    `
                )
                .get("project::resource::scripts/macros/macros.yy", functionNode.id) as {
                count: number;
            };
            assert.equal(functionOwnershipEdge.count, 1);
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
        await fixture.writeProjectFile(
            "options/windows/options_windows.yy",
            JSON.stringify({ name: "Windows", resourceType: "GMWindowsOptions" })
        );
        await fixture.writeProjectFile(
            "options/html5/options_html5.yy",
            JSON.stringify({ name: "HTML5", resourceType: "GMHtml5Options" })
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

            const fileNodeCount = database.prepare("SELECT COUNT(*) AS count FROM nodes WHERE kind = 'file'").get() as {
                count: number;
            };
            assert.equal(fileNodeCount.count, 0);

            const optionNodeCount = database
                .prepare("SELECT COUNT(*) AS count FROM nodes WHERE resource_path LIKE 'options/%'")
                .get() as {
                count: number;
            };
            assert.equal(optionNodeCount.count, 0);

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

void test("buildGraphIndex projects object event scopes as readable visualization nodes", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-object-event-");

    try {
        await fixture.writeProjectFile("Project.yyp", JSON.stringify({ name: "Project", resourceType: "GMProject" }));
        await fixture.writeProjectFile(
            "scripts/target_script/target_script.yy",
            JSON.stringify({ name: "target_script", resourceType: "GMScript" })
        );
        await fixture.writeProjectFile(
            "scripts/target_script/target_script.gml",
            ["function target_script() {", "    return 1;", "}", ""].join("\n")
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
                        eventContents: "objects/obj_player/obj_player_Create_0.gml"
                    }
                ]
            })
        );
        await fixture.writeProjectFile(
            "objects/obj_player/obj_player_Create_0.gml",
            ["score = target_script();", ""].join("\n")
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

        const eventNodeId = "project::scope::scope:object:obj_player::0_0";
        const objectNodeId = "project::resource::objects/obj_player/obj_player.yy";
        const targetScriptNodeId = "project::resource::scripts/target_script/target_script.yy";

        const database = openGraphIndexDatabase(result.databasePath);
        try {
            const eventNode = database
                .prepare(
                    "SELECT id, kind, name, display_name AS displayName, relative_path AS filePath, resource_path AS resourcePath, summary FROM nodes WHERE id = ?"
                )
                .get(eventNodeId) as
                | {
                      displayName: string;
                      filePath: string;
                      id: string;
                      kind: string;
                      name: string;
                      resourcePath: string;
                      summary: string;
                  }
                | undefined;

            assert.ok(eventNode, "expected object event scope to become a graph node");
            assert.equal(eventNode.kind, "object_event");
            assert.equal(eventNode.name, "obj_player.0_0");
            assert.equal(eventNode.displayName, "object.obj_player.0_0");
            assert.equal(eventNode.filePath, "objects/obj_player/obj_player_Create_0.gml");
            assert.equal(eventNode.resourcePath, "objects/obj_player/obj_player.yy");
            assert.match(eventNode.summary, /object event 'obj_player\.0_0'/u);

            const edgeRows = database
                .prepare("SELECT from_id AS fromId, to_id AS toId, type FROM edges ORDER BY from_id, to_id, type")
                .all() as Array<{ fromId: string; toId: string; type: string }>;
            assert.ok(
                edgeRows.some(
                    (edge) => edge.fromId === objectNodeId && edge.toId === eventNodeId && edge.type === "contains"
                ),
                "expected object resources to contain their event nodes"
            );
            assert.ok(
                !edgeRows.some((edge) => edge.fromId.includes("::file::") || edge.toId.includes("::file::")),
                "expected object event graph edges to exclude backing file nodes"
            );
            assert.ok(
                edgeRows.some(
                    (edge) => edge.fromId === eventNodeId && edge.toId === targetScriptNodeId && edge.type === "calls"
                ),
                "expected event-owned calls to originate from the object event node"
            );

            const visualizationData = exportGraphVisualizationData(database, fixture.projectRoot);
            const visualizationEventNode = visualizationData.nodes.find((node) => node.id === eventNodeId);
            assert.equal(visualizationEventNode?.kind, "object_event");
            assert.equal(visualizationEventNode?.displayName, "object.obj_player.0_0");
            assert.ok(
                visualizationData.edges.some(
                    (edge) => edge.source === eventNodeId && edge.target === targetScriptNodeId && edge.type === "calls"
                ),
                "expected visualization export to preserve event-to-script call ownership"
            );
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("graph visualization keeps object events connected when YY metadata omits explicit event file paths", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-object-event-file-ownership-");

    try {
        await fixture.writeProjectFile(
            "ConnectedProject.yyp",
            JSON.stringify({ name: "ConnectedProject", resourceType: "GMProject" })
        );
        await fixture.writeProjectFile(
            "objects/oSpider/oSpider.yy",
            JSON.stringify({
                name: "oSpider",
                resourceType: "GMObject",
                eventList: [
                    { eventNum: 0, eventType: 0, resourceType: "GMEvent" },
                    { eventNum: 0, eventType: 3, resourceType: "GMEvent" },
                    { eventNum: 27, eventType: 9, resourceType: "GMEvent" }
                ]
            })
        );
        await fixture.writeProjectFile("objects/oSpider/Create_0.gml", "hp = 100;\n");
        await fixture.writeProjectFile("objects/oSpider/Step_0.gml", "hp -= 1;\n");
        await fixture.writeProjectFile("objects/oSpider/KeyPress_27.gml", 'show_debug_message("pressed");\n');

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
            const objectResourceNodeId = "project::resource::objects/oSpider/oSpider.yy";
            const projectNodeId = "project::resource::ConnectedProject.yyp";

            const fileNodes = visualizationData.nodes.filter((node) => node.kind === "file");
            assert.deepEqual(fileNodes.map((node) => node.filePath).sort(), [
                "objects/oSpider/Create_0.gml",
                "objects/oSpider/KeyPress_27.gml",
                "objects/oSpider/Step_0.gml"
            ]);

            const objectEventNodes = visualizationData.nodes.filter((node) => node.kind === "object_event");
            assert.deepEqual(objectEventNodes.map((node) => node.displayName).sort(), [
                "object.oSpider.Create_0",
                "object.oSpider.KeyPress_27",
                "object.oSpider.Step_0"
            ]);

            for (const objectEventNode of objectEventNodes) {
                assert.ok(
                    visualizationData.edges.some(
                        (edge) =>
                            edge.source === objectResourceNodeId &&
                            edge.target === objectEventNode.id &&
                            edge.type === "contains"
                    ),
                    `expected ${objectEventNode.displayName} to stay connected to the object resource node`
                );
            }

            assert.ok(
                visualizationData.edges.some(
                    (edge) =>
                        edge.source === projectNodeId &&
                        edge.target === objectResourceNodeId &&
                        edge.type === "contains"
                ),
                "expected the object resource to remain connected to the central project node"
            );

            for (const fileNode of fileNodes) {
                assert.ok(
                    visualizationData.edges.some(
                        (edge) =>
                            edge.source === objectResourceNodeId &&
                            edge.target === fileNode.id &&
                            edge.type === "contains"
                    ),
                    `expected file node ${fileNode.displayName} to stay connected to its owning resource`
                );
            }
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

void test("buildGraphIndex projects room layers as distinct room_layer nodes with containment edges", async () => {
    const fixture = await createTempProjectWorkspace("graph-index-room-layers-");

    try {
        await fixture.writeProjectFile(
            "GameProject.yyp",
            JSON.stringify({
                name: "GameProject",
                resourceType: "GMProject",
                resources: [
                    { id: { name: "rmArena", path: "rooms/rmArena/rmArena.yy" } },
                    { id: { name: "oKnight", path: "objects/oKnight/oKnight.yy" } },
                    { id: { name: "oDragon", path: "objects/oDragon/oDragon.yy" } }
                ]
            })
        );

        await fixture.writeProjectFile(
            "rooms/rmArena/rmArena.yy",
            JSON.stringify({
                name: "rmArena",
                resourceType: "GMRoom",
                layers: [
                    {
                        $GMRBackgroundLayer: "",
                        name: "Background",
                        resourceType: "GMRBackgroundLayer",
                        colour: 1,
                        visible: true
                    },
                    {
                        $GMRInstanceLayer: "",
                        name: "Instances",
                        resourceType: "GMRInstanceLayer",
                        instances: [
                            {
                                name: "inst_1",
                                objectId: { name: "oKnight", path: "objects/oKnight/oKnight.yy" },
                                resourceType: "GMRInstance"
                            },
                            {
                                name: "inst_2",
                                objectId: { name: "oDragon", path: "objects/oDragon/oDragon.yy" },
                                resourceType: "GMRInstance"
                            }
                        ]
                    },
                    {
                        $GMRAssetLayer: "",
                        name: "Decor",
                        resourceType: "GMRAssetLayer",
                        assets: []
                    },
                    {
                        $GMRTileLayer: "",
                        name: "Tiles",
                        resourceType: "GMRTileLayer",
                        tiles: {}
                    }
                ]
            })
        );

        await fixture.writeProjectFile(
            "objects/oKnight/oKnight.yy",
            JSON.stringify({ name: "oKnight", resourceType: "GMObject" })
        );
        await fixture.writeProjectFile(
            "objects/oDragon/oDragon.yy",
            JSON.stringify({ name: "oDragon", resourceType: "GMObject" })
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
            const roomLayerNodes = database
                .prepare(
                    "SELECT id, kind, name, display_name AS displayName, resource_path AS resourcePath FROM nodes WHERE kind = 'room_layer' ORDER BY name"
                )
                .all() as Array<{
                displayName: string;
                id: string;
                kind: string;
                name: string;
                resourcePath: string | null;
            }>;

            assert.equal(
                roomLayerNodes.length,
                4,
                "expected four room_layer nodes for background, instance, asset, and tile layers"
            );
            assert.deepEqual(
                roomLayerNodes.map((node) => node.name),
                ["Background", "Decor", "Instances", "Tiles"]
            );
            assert.deepEqual(
                roomLayerNodes.map((node) => node.displayName),
                [
                    "Background (Background Layer)",
                    "Decor (Asset Layer)",
                    "Instances (Instance Layer)",
                    "Tiles (Tile Layer)"
                ]
            );
            assert.ok(
                roomLayerNodes.every((node) => node.kind === "room_layer"),
                "expected all room_layer nodes to have kind 'room_layer'"
            );

            const roomNodeId = "project::resource::rooms/rmArena/rmArena.yy";
            const backgroundLayerNodeId = roomLayerNodes.find((node) => node.name === "Background")?.id;
            const decorLayerNodeId = roomLayerNodes.find((node) => node.name === "Decor")?.id;
            const instancesLayerNodeId = roomLayerNodes.find((node) => node.name === "Instances")?.id;
            const tilesLayerNodeId = roomLayerNodes.find((node) => node.name === "Tiles")?.id;

            const edgeRows = database
                .prepare("SELECT from_id AS fromId, to_id AS toId, type FROM edges ORDER BY from_id, to_id, type")
                .all() as Array<{ fromId: string; toId: string; type: string }>;

            assert.ok(
                edgeRows.some(
                    (edge) =>
                        edge.fromId === roomNodeId && edge.toId === backgroundLayerNodeId && edge.type === "contains"
                ),
                "expected room to contain the background layer node"
            );
            assert.ok(
                edgeRows.some(
                    (edge) =>
                        edge.fromId === roomNodeId && edge.toId === instancesLayerNodeId && edge.type === "contains"
                ),
                "expected room to contain the instances layer node"
            );
            assert.ok(
                edgeRows.some(
                    (edge) => edge.fromId === roomNodeId && edge.toId === decorLayerNodeId && edge.type === "contains"
                ),
                "expected room to contain the asset layer node"
            );
            assert.ok(
                edgeRows.some(
                    (edge) => edge.fromId === roomNodeId && edge.toId === tilesLayerNodeId && edge.type === "contains"
                ),
                "expected room to contain the tile layer node"
            );

            const visualizationData = exportGraphVisualizationData(database, fixture.projectRoot);
            const vizRoomLayerNodes = visualizationData.nodes.filter((node) => node.kind === "room_layer");
            assert.equal(vizRoomLayerNodes.length, 4, "expected visualization export to include all room_layer nodes");
            assert.ok(
                vizRoomLayerNodes.every(
                    (node) =>
                        node.name === "Background" ||
                        node.name === "Instances" ||
                        node.name === "Decor" ||
                        node.name === "Tiles"
                ),
                "expected room_layer nodes to be present with correct names"
            );

            const vizBackgroundNode = vizRoomLayerNodes.find((node) => node.name === "Background");
            const vizInstancesNode = vizRoomLayerNodes.find((node) => node.name === "Instances");
            const vizDecorNode = vizRoomLayerNodes.find((node) => node.name === "Decor");
            const vizTilesNode = vizRoomLayerNodes.find((node) => node.name === "Tiles");
            assert.ok(vizBackgroundNode, "expected Background room_layer in visualization");
            assert.ok(vizInstancesNode, "expected Instances room_layer in visualization");
            assert.ok(vizDecorNode, "expected Decor room_layer in visualization");
            assert.ok(vizTilesNode, "expected Tiles room_layer in visualization");

            assert.ok(
                visualizationData.edges.some(
                    (edge) =>
                        edge.source === roomNodeId && edge.target === vizBackgroundNode?.id && edge.type === "contains"
                ),
                "expected visualization to include room→background containment edge"
            );
            assert.ok(
                visualizationData.edges.some(
                    (edge) =>
                        edge.source === roomNodeId && edge.target === vizInstancesNode?.id && edge.type === "contains"
                ),
                "expected visualization to include room→instances containment edge"
            );
            assert.ok(
                visualizationData.edges.some(
                    (edge) => edge.source === roomNodeId && edge.target === vizDecorNode?.id && edge.type === "contains"
                ),
                "expected visualization to include room→decor containment edge"
            );
            assert.ok(
                visualizationData.edges.some(
                    (edge) => edge.source === roomNodeId && edge.target === vizTilesNode?.id && edge.type === "contains"
                ),
                "expected visualization to include room→tiles containment edge"
            );
        } finally {
            database.close();
        }
    } finally {
        await fixture.cleanup();
    }
});
