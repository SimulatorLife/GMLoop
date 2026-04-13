import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
    buildGraphIndex,
    doctorGraphIndex,
    getGraphContext,
    getGraphUsages,
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
                        entry.fromId === "project::gml/script/player_update" &&
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

        assert.equal(usages[0]?.from.id, "project::gml/script/player_update");
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
