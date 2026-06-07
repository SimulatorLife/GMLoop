import assert from "node:assert";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";

import { openGraphIndexDatabase } from "../src/graph-index/database.js";
import { exportGraphVisualizationData } from "../src/graph-index/export-visualization-data.js";

void describe("exportGraphVisualizationData", () => {
    void test("exports empty visualization data correctly", async () => {
        const dbPath = path.join(os.tmpdir(), `test-empty-export-${String(Date.now())}.db`);
        const db = openGraphIndexDatabase(dbPath);

        const data = exportGraphVisualizationData(db, "/fake/root");

        db.close();

        assert.strictEqual(data.projectRoot, "/fake/root");
        assert.deepStrictEqual(data.graphs, []);
        assert.deepStrictEqual(data.edges, []);
        assert.deepStrictEqual(data.nodes, []);
        assert.ok(data.generatedAt);
    });

    void test("exports nodes, edges and graphs properly mapped", async () => {
        const dbPath = path.join(os.tmpdir(), `test-export-${String(Date.now())}.db`);
        const db = openGraphIndexDatabase(dbPath);

        db.exec("BEGIN");

        db.prepare(
            "INSERT INTO graphs (id, scope, root_path, last_indexed_at, schema_version) VALUES (?, ?, ?, ?, ?)"
        ).run("project1", "project", "/fake/root", "2023-01-01", 1);

        db.prepare(
            "INSERT INTO index_state (graph_id, file_count, node_count, edge_count, embedding_model, build_duration_ms) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("project1", 10, 2, 1, "test-model", 100);

        db.prepare(
            `
            INSERT INTO nodes (id, graph_id, kind, name, display_name, line_start, line_end, relative_path, resource_path, summary, snippet)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
            "node1",
            "project1",
            "script",
            "test_script",
            "test_script()",
            10,
            14,
            "scripts/test_script/test_script.gml",
            "scripts/test_script/test_script.yy",
            "A test",
            "function test_script() {}"
        );

        db.prepare(
            `
            INSERT INTO nodes (id, graph_id, kind, name, display_name, line_start, line_end, relative_path, resource_path, summary, snippet)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
            "node2",
            "project1",
            "object",
            "obj_test",
            "obj_test",
            null,
            null,
            null,
            "objects/obj_test/obj_test.yy",
            "Test obj",
            "/* snippet */"
        );

        db.prepare(
            `
            INSERT INTO edges (from_id, to_id, type, ordinal)
            VALUES (?, ?, ?, ?)
        `
        ).run("node2", "node1", "calls", 0);

        db.exec("COMMIT");

        const data = exportGraphVisualizationData(db, "/fake/root");

        db.close();

        assert.strictEqual(data.graphs.length, 1);
        assert.strictEqual(data.graphs[0]?.graphId, "project1");
        assert.strictEqual(data.graphs[0]?.nodeCount, 2);
        assert.strictEqual(data.graphs[0]?.edgeCount, 1);
        assert.strictEqual(data.graphs[0]?.rootPath, "/fake/root");

        assert.strictEqual(data.nodes.length, 2);
        assert.strictEqual(data.nodes[0]?.id, "node1");
        assert.strictEqual(data.nodes[0]?.kind, "script");
        assert.strictEqual(data.nodes[0]?.displayName, "test_script()");
        assert.strictEqual(data.nodes[0]?.lineStart, 10);
        assert.strictEqual(data.nodes[0]?.lineEnd, 14);
        assert.strictEqual(data.nodes[0]?.filePath, "scripts/test_script/test_script.gml");
        assert.strictEqual(data.nodes[0]?.resourcePath, "scripts/test_script/test_script.yy");
        assert.strictEqual(data.nodes[1]?.id, "node2");
        assert.strictEqual(data.nodes[1]?.lineStart, null);
        assert.strictEqual(data.nodes[1]?.lineEnd, null);
        assert.strictEqual(data.nodes[1]?.filePath, null);
        assert.strictEqual(data.nodes[1]?.resourcePath, "objects/obj_test/obj_test.yy");

        assert.strictEqual(data.edges.length, 1);
        assert.strictEqual(data.edges[0]?.source, "node2");
        assert.strictEqual(data.edges[0]?.target, "node1");
        assert.strictEqual(data.edges[0]?.type, "calls");
    });

    void test("excludes generic file and options nodes from visualization exports", async () => {
        const dbPath = path.join(os.tmpdir(), `test-export-filter-${String(Date.now())}.db`);
        const db = openGraphIndexDatabase(dbPath);

        db.exec("BEGIN");

        db.prepare(
            "INSERT INTO graphs (id, scope, root_path, last_indexed_at, schema_version) VALUES (?, ?, ?, ?, ?)"
        ).run("project", "project", "/fake/root", "2023-01-01", 2);
        db.prepare(
            "INSERT INTO index_state (graph_id, file_count, node_count, edge_count, embedding_model, build_duration_ms) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("project", 3, 5, 4, "disabled", 100);

        const insertNode = db.prepare(
            `
                INSERT INTO nodes (
                    id, graph_id, kind, name, display_name, relative_path, resource_path, summary, snippet
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
        );

        insertNode.run("project-node", "project", "project", "Game", "Game", null, "Project.yyp", "Project", "");
        insertNode.run(
            "script-node",
            "project",
            "script",
            "scr_player",
            "scr_player",
            "scripts/scr_player/scr_player.gml",
            "scripts/scr_player/scr_player.yy",
            "Script",
            ""
        );
        insertNode.run(
            "file-node",
            "project",
            "file",
            "Project.yyp",
            "Project.yyp",
            "Project.yyp",
            null,
            "Generic file",
            ""
        );
        insertNode.run(
            "options-node",
            "project",
            "resource",
            "options_windows",
            "options_windows",
            null,
            "options/windows/options_windows.yy",
            "Options",
            ""
        );
        insertNode.run(
            "generic-resource-node",
            "project",
            "resource",
            "mystery_resource",
            "mystery_resource",
            null,
            "extensions/mystery_resource/mystery_resource.yy",
            "Generic resource",
            ""
        );

        db.prepare("INSERT INTO edges (from_id, to_id, type, ordinal) VALUES (?, ?, ?, ?)").run(
            "project-node",
            "script-node",
            "contains",
            0
        );
        db.prepare("INSERT INTO edges (from_id, to_id, type, ordinal) VALUES (?, ?, ?, ?)").run(
            "project-node",
            "file-node",
            "contains",
            0
        );
        db.prepare("INSERT INTO edges (from_id, to_id, type, ordinal) VALUES (?, ?, ?, ?)").run(
            "project-node",
            "options-node",
            "contains",
            0
        );
        db.prepare("INSERT INTO edges (from_id, to_id, type, ordinal) VALUES (?, ?, ?, ?)").run(
            "project-node",
            "generic-resource-node",
            "contains",
            0
        );

        db.exec("COMMIT");

        const data = exportGraphVisualizationData(db, "/fake/root");

        db.close();

        assert.deepStrictEqual(data.nodes.map((node) => node.id).toSorted(), ["project-node", "script-node"]);
        assert.deepStrictEqual(data.edges, [{ source: "project-node", target: "script-node", type: "contains" }]);
    });
});
