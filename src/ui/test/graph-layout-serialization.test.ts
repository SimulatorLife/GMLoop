import assert from "node:assert/strict";
import test from "node:test";

import { createGraphLayout, filterGraphLayoutForDisplay } from "../src/graph/graph-layout.js";
import type {
    GraphVisualizationEdgeType,
    GraphVisualizationNodeKind,
    GraphVisualizationNodeRecord
} from "../src/graph/types.js";

function createNode(id: string, kind: GraphVisualizationNodeKind): GraphVisualizationNodeRecord {
    return {
        displayName: id,
        filePath: null,
        graphId: "project",
        id,
        kind,
        lineEnd: null,
        lineStart: null,
        name: id,
        resourcePath: null,
        scopeId: null,
        scipSymbol: null,
        snippet: "",
        summary: ""
    };
}

void test("graph layout JSON does not duplicate renderer-only edge endpoint nodes", () => {
    const layout = createGraphLayout(
        [createNode("project", "project"), createNode("script", "script")],
        [{ source: "project", target: "script", type: "contains" }]
    );
    const edge = layout.edges[0];

    assert.ok(edge);
    assert.equal(edge.sourceNode.id, "project");
    assert.equal(edge.targetNode.id, "script");
    assert.deepEqual(JSON.parse(JSON.stringify(edge)), {
        source: "project",
        target: "script",
        type: "contains"
    });
});

void test("filtered promoted edges keep endpoint references non-enumerable", () => {
    const layout = createGraphLayout(
        [
            createNode("project", "project"),
            createNode("script", "script"),
            createNode("function", "function")
        ],
        [
            { source: "project", target: "script", type: "contains" },
            { source: "script", target: "function", type: "defines" }
        ]
    );
    const filtered = filterGraphLayoutForDisplay({
        enabledEdgeTypes: new Set<GraphVisualizationEdgeType>(["contains", "defines"]),
        enabledNodeKinds: new Set<GraphVisualizationNodeKind>(["project", "function"]),
        layout,
        matchesNode: () => true
    });
    const edge = filtered.edges[0];

    assert.ok(edge);
    assert.equal(edge.sourceNode.id, "project");
    assert.equal(edge.targetNode.id, "function");
    assert.deepEqual(JSON.parse(JSON.stringify(edge)), {
        source: "project",
        target: "function",
        type: "defines"
    });
});
