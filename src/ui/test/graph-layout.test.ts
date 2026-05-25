import assert from "node:assert/strict";
import test from "node:test";

import {
    createGraphLayout,
    filterGraphLayoutForDisplay,
    type GraphLayoutNode,
    listGraphNodeKinds
} from "../src/app/graph-layout.js";
import type {
    GraphVisualizationEdgeType,
    GraphVisualizationNodeKind,
    GraphVisualizationNodeRecord
} from "../src/graph/types.js";

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

function allNodesMatch(_node: GraphLayoutNode): boolean {
    return true;
}

void test("filterGraphLayoutForDisplay promotes visible symbols to the nearest visible hierarchy ancestor", () => {
    const layout = createGraphLayout(
        [
            createNode("project", "project", "Game"),
            createNode("script", "script", "configure_globals"),
            createNode("global", "global_variable", "enemy_limit")
        ],
        [
            { source: "project", target: "script", type: "contains" },
            { source: "script", target: "global", type: "defines" }
        ]
    );

    const filtered = filterGraphLayoutForDisplay({
        enabledEdgeTypes: new Set<GraphVisualizationEdgeType>(["contains", "defines"]),
        enabledNodeKinds: new Set<GraphVisualizationNodeKind>(["project", "global_variable"]),
        layout,
        matchesNode: allNodesMatch
    });

    assert.deepEqual(
        filtered.nodes.map((node) => node.id),
        ["project", "global"]
    );
    assert.deepEqual(
        filtered.edges.map((edge) => ({ source: edge.source, target: edge.target, type: edge.type })),
        [{ source: "project", target: "global", type: "defines" }]
    );
});

void test("filterGraphLayoutForDisplay keeps project nodes visible regardless of filters or search", () => {
    const layout = createGraphLayout(
        [createNode("project", "project", "Game"), createNode("script", "script", "hidden_script")],
        [{ source: "project", target: "script", type: "contains" }]
    );

    const filtered = filterGraphLayoutForDisplay({
        enabledEdgeTypes: new Set<GraphVisualizationEdgeType>(["contains"]),
        enabledNodeKinds: new Set<GraphVisualizationNodeKind>(["script"]),
        layout,
        matchesNode: () => false
    });

    assert.deepEqual(
        filtered.nodes.map((node) => node.id),
        ["project"]
    );
    assert.deepEqual(filtered.edges, []);
});

void test("filterGraphLayoutForDisplay uses the closest visible parent when intermediate hierarchy nodes are enabled", () => {
    const layout = createGraphLayout(
        [
            createNode("project", "project", "Game"),
            createNode("script", "script", "states"),
            createNode("enum", "enum", "CombatState"),
            createNode("member", "enum_member", "Attacking")
        ],
        [
            { source: "project", target: "script", type: "contains" },
            { source: "script", target: "enum", type: "defines" },
            { source: "enum", target: "member", type: "defines" }
        ]
    );

    const filtered = filterGraphLayoutForDisplay({
        enabledEdgeTypes: new Set<GraphVisualizationEdgeType>(["contains", "defines"]),
        enabledNodeKinds: new Set<GraphVisualizationNodeKind>(["project", "enum", "enum_member"]),
        layout,
        matchesNode: allNodesMatch
    });

    assert.deepEqual(
        filtered.edges.map((edge) => ({ source: edge.source, target: edge.target, type: edge.type })),
        [
            { source: "project", target: "enum", type: "defines" },
            { source: "enum", target: "member", type: "defines" }
        ]
    );
});

void test("listGraphNodeKinds excludes project nodes from filter controls", () => {
    const layout = createGraphLayout(
        [
            createNode("project", "project", "Game"),
            createNode("script", "script", "configure_globals"),
            createNode("global", "global_variable", "enemy_limit")
        ],
        []
    );

    assert.deepEqual(listGraphNodeKinds(layout.nodes), ["global_variable", "script"]);
});

void test("filterGraphLayoutForDisplay does not promote non-hierarchy relationships through hidden nodes", () => {
    const layout = createGraphLayout(
        [
            createNode("project", "project", "Game"),
            createNode("script", "script", "caller"),
            createNode("function", "function", "caller"),
            createNode("target", "script", "target")
        ],
        [
            { source: "project", target: "script", type: "contains" },
            { source: "script", target: "function", type: "defines" },
            { source: "function", target: "target", type: "calls" }
        ]
    );

    const filtered = filterGraphLayoutForDisplay({
        enabledEdgeTypes: new Set<GraphVisualizationEdgeType>(["calls", "contains", "defines"]),
        enabledNodeKinds: new Set<GraphVisualizationNodeKind>(["project", "script"]),
        layout,
        matchesNode: (node) => node.id !== "script"
    });

    assert.deepEqual(
        filtered.edges.map((edge) => ({ source: edge.source, target: edge.target, type: edge.type })),
        []
    );
});
