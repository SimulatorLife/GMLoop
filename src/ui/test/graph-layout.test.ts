import assert from "node:assert/strict";
import test from "node:test";

import {
    createGraphLayout,
    filterGraphLayoutForDisplay,
    type GraphLayoutNode,
    type GraphLegendNodeKind,
    type GraphNodeKindLegendItem,
    listGraphNodeKindLegendItems,
    listGraphNodeKinds,
    resolveEffectiveGraphNodeKinds
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

function collectLegendChildrenByKind(
    items: ReadonlyArray<GraphNodeKindLegendItem>
): Map<GraphLegendNodeKind, ReadonlyArray<GraphLegendNodeKind>> {
    const childKindsByParent = new Map<GraphLegendNodeKind, ReadonlyArray<GraphLegendNodeKind>>();

    for (const item of items) {
        childKindsByParent.set(
            item.kind,
            item.children.map((child) => child.kind)
        );
        for (const [kind, children] of collectLegendChildrenByKind(item.children)) {
            childKindsByParent.set(kind, children);
        }
    }

    return childKindsByParent;
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

    const nodeKinds = listGraphNodeKinds(layout.nodes);

    assert.ok(nodeKinds.includes("global_variable"));
    assert.ok(nodeKinds.includes("resource"));
    assert.ok(nodeKinds.includes("script"));
    assert.ok(nodeKinds.includes("sound"));
    assert.ok(nodeKinds.includes("particle_system"));
    assert.ok(nodeKinds.includes("timeline"));
    assert.ok(!nodeKinds.map(String).includes("constructor"));
    assert.ok(!nodeKinds.includes("project"));
    assert.ok(!nodeKinds.includes("file"));
});

void test("listGraphNodeKindLegendItems nests child kinds under semantic parent kinds", () => {
    const items = listGraphNodeKindLegendItems([
        createNode("project", "project", "Game"),
        createNode("object", "object", "obj_player"),
        createNode("event", "object_event", "Create_0"),
        createNode("room", "room", "rm_test"),
        createNode("layer", "room_layer", "Instances"),
        createNode("macro", "macro", "MAX_SPEED"),
        createNode("enum", "enum", "CombatState"),
        createNode("member", "enum_member", "Idle")
    ]);

    const childKindsByParent = collectLegendChildrenByKind(items);
    const rootKinds = new Set(items.map((item) => item.kind));

    assert.deepEqual(childKindsByParent.get("enum"), ["enum_member"]);
    assert.ok(childKindsByParent.get("object")?.includes("instance_variable"));
    assert.ok(childKindsByParent.get("object")?.includes("object_event"));
    assert.ok(childKindsByParent.get("room")?.includes("room_layer"));
    assert.ok(rootKinds.has("function"));
    assert.ok(rootKinds.has("global_variable"));
    assert.ok(rootKinds.has("macro"));
    assert.ok(rootKinds.has("resource"));
    assert.deepEqual(childKindsByParent.get("resource"), [
        "anim_curve",
        "data_file",
        "extension",
        "font",
        "note",
        "object",
        "particle_system",
        "path",
        "room",
        "script",
        "sequence",
        "shader",
        "sound",
        "sprite",
        "tileset",
        "timeline"
    ]);
    assert.ok(![...rootKinds].map(String).includes("constructor"));
    assert.ok(!rootKinds.has("file"));
});

void test("resolveEffectiveGraphNodeKinds hides child kinds when their legend parent is disabled", () => {
    const nodes = [
        createNode("script", "script", "constants"),
        createNode("function", "function", "configure_globals"),
        createNode("macro", "macro", "MAX_SPEED"),
        createNode("global", "global_variable", "enemy_limit"),
        createNode("local", "local_variable", "temporary_total"),
        createNode("enum", "enum", "CombatState"),
        createNode("member", "enum_member", "Idle")
    ];
    const enabledKinds = new Set<GraphVisualizationNodeKind>([
        "function",
        "global_variable",
        "macro",
        "local_variable",
        "enum",
        "enum_member"
    ]);

    assert.deepEqual([...resolveEffectiveGraphNodeKinds(nodes, enabledKinds)].toSorted(), [
        "enum",
        "enum_member",
        "function",
        "global_variable",
        "local_variable",
        "macro"
    ]);
});

void test("resolveEffectiveGraphNodeKinds lets the resource legend parent override concrete resource kinds", () => {
    const nodes = [
        createNode("object", "object", "obj_player"),
        createNode("sound", "sound", "snd_hit"),
        createNode("macro", "macro", "MAX_SPEED")
    ];
    const enabledKinds = new Set<GraphLegendNodeKind>(["object", "sound", "macro"]);

    assert.deepEqual([...resolveEffectiveGraphNodeKinds(nodes, enabledKinds)].toSorted(), ["macro"]);
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

void test("createGraphLayout keeps dense sibling nodes separated for readable labels", () => {
    const nodes = [
        createNode("project", "project", "Game"),
        ...Array.from({ length: 12 }, (_, index) =>
            createNode(`script-${String(index)}`, "script", `script_with_long_label_${String(index)}`)
        )
    ];
    const edges = nodes
        .filter((node) => node.id !== "project")
        .map((node) => ({ source: "project", target: node.id, type: "contains" as const }));

    const layout = createGraphLayout(nodes, edges);
    const scriptNodes = layout.nodes.filter((node) => node.kind === "script");
    const distances: Array<number> = [];

    for (let leftIndex = 0; leftIndex < scriptNodes.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < scriptNodes.length; rightIndex++) {
            const left = scriptNodes[leftIndex];
            const right = scriptNodes[rightIndex];
            if (left && right) {
                distances.push(Math.hypot(left.x - right.x, left.y - right.y));
            }
        }
    }

    assert.ok(Math.min(...distances) >= 70);
});
