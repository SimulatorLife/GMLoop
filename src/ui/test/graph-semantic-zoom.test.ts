import assert from "node:assert/strict";
import test from "node:test";

import { createGraphLayout } from "../src/graph/graph-layout.js";
import {
    projectGraphLayoutForSemanticZoom,
    resolveGraphSemanticZoomLevel
} from "../src/graph/graph-semantic-zoom.js";
import type { GraphVisualizationNodeKind, GraphVisualizationNodeRecord } from "../src/graph/types.js";

function createNode(id: string, kind: GraphVisualizationNodeKind, name: string): GraphVisualizationNodeRecord {
    return {
        displayName: name,
        filePath: null,
        graphId: "project",
        id,
        kind,
        lineEnd: null,
        lineStart: null,
        name,
        resourcePath: null,
        scopeId: null,
        scipSymbol: null,
        snippet: "",
        summary: ""
    };
}

void test("resolveGraphSemanticZoomLevel progressively reveals hierarchy detail", () => {
    assert.equal(resolveGraphSemanticZoomLevel(0.4), "overview");
    assert.equal(resolveGraphSemanticZoomLevel(1), "resource");
    assert.equal(resolveGraphSemanticZoomLevel(2), "symbol");
    assert.equal(resolveGraphSemanticZoomLevel(4), "detail");
});

void test("semantic overview collapses deep symbols and bundles their relationships", () => {
    const layout = createGraphLayout(
        [
            createNode("project", "project", "Game"),
            createNode("script-a", "script", "player"),
            createNode("fn-a", "function", "update_player"),
            createNode("local-a", "local_variable", "speed"),
            createNode("script-b", "script", "combat"),
            createNode("fn-b", "function", "apply_damage")
        ],
        [
            { source: "project", target: "script-a", type: "contains" },
            { source: "script-a", target: "fn-a", type: "defines" },
            { source: "fn-a", target: "local-a", type: "defines" },
            { source: "project", target: "script-b", type: "contains" },
            { source: "script-b", target: "fn-b", type: "defines" },
            { source: "fn-a", target: "fn-b", type: "calls" }
        ]
    );

    const projected = projectGraphLayoutForSemanticZoom({
        displayLayout: layout,
        focusNodeId: null,
        sourceLayout: layout,
        zoomScale: 0.4
    });

    assert.deepEqual(
        projected.nodes.map((node) => node.id),
        ["project", "script-a", "script-b"]
    );
    assert.ok(
        projected.edges.some(
            (edge) =>
                edge.source === "script-a" &&
                edge.target === "script-b" &&
                edge.type === "calls" &&
                edge.aggregateCount === 1
        )
    );
});

void test("semantic overview combines duplicate descendant relationships into one weighted edge", () => {
    const layout = createGraphLayout(
        [
            createNode("project", "project", "Game"),
            createNode("script-a", "script", "player"),
            createNode("fn-a-1", "function", "update_player"),
            createNode("fn-a-2", "function", "update_weapon"),
            createNode("script-b", "script", "combat"),
            createNode("fn-b", "function", "apply_damage")
        ],
        [
            { source: "project", target: "script-a", type: "contains" },
            { source: "script-a", target: "fn-a-1", type: "defines" },
            { source: "script-a", target: "fn-a-2", type: "defines" },
            { source: "project", target: "script-b", type: "contains" },
            { source: "script-b", target: "fn-b", type: "defines" },
            { source: "fn-a-1", target: "fn-b", type: "calls" },
            { source: "fn-a-2", target: "fn-b", type: "calls" }
        ]
    );

    const projected = projectGraphLayoutForSemanticZoom({
        displayLayout: layout,
        focusNodeId: null,
        sourceLayout: layout,
        zoomScale: 0.4
    });
    const callsEdges = projected.edges.filter((edge) => edge.type === "calls");

    assert.equal(callsEdges.length, 1);
    assert.equal(callsEdges[0]?.source, "script-a");
    assert.equal(callsEdges[0]?.target, "script-b");
    assert.equal(callsEdges[0]?.aggregateCount, 2);
});

void test("focused semantic zoom reveals one hierarchy branch while preserving project context", () => {
    const layout = createGraphLayout(
        [
            createNode("project", "project", "Game"),
            createNode("script-a", "script", "player"),
            createNode("fn-a", "function", "update_player"),
            createNode("local-a", "local_variable", "speed"),
            createNode("script-b", "script", "combat"),
            createNode("fn-b", "function", "apply_damage")
        ],
        [
            { source: "project", target: "script-a", type: "contains" },
            { source: "script-a", target: "fn-a", type: "defines" },
            { source: "fn-a", target: "local-a", type: "defines" },
            { source: "project", target: "script-b", type: "contains" },
            { source: "script-b", target: "fn-b", type: "defines" }
        ]
    );

    const projected = projectGraphLayoutForSemanticZoom({
        displayLayout: layout,
        focusNodeId: "script-a",
        sourceLayout: layout,
        zoomScale: 2.4
    });
    const visibleNodeIds = new Set(projected.nodes.map((node) => node.id));

    assert.ok(visibleNodeIds.has("project"));
    assert.ok(visibleNodeIds.has("script-a"));
    assert.ok(visibleNodeIds.has("fn-a"));
    assert.ok(visibleNodeIds.has("local-a"));
    assert.ok(visibleNodeIds.has("script-b"));
    assert.ok(!visibleNodeIds.has("fn-b"));
});

void test("detail semantic zoom exposes the complete filtered graph", () => {
    const layout = createGraphLayout(
        [
            createNode("project", "project", "Game"),
            createNode("script", "script", "player"),
            createNode("function", "function", "update_player"),
            createNode("local", "local_variable", "speed")
        ],
        [
            { source: "project", target: "script", type: "contains" },
            { source: "script", target: "function", type: "defines" },
            { source: "function", target: "local", type: "defines" }
        ]
    );

    const projected = projectGraphLayoutForSemanticZoom({
        displayLayout: layout,
        focusNodeId: null,
        sourceLayout: layout,
        zoomScale: 4
    });

    assert.deepEqual(
        projected.nodes.map((node) => node.id),
        ["project", "script", "function", "local"]
    );
});
