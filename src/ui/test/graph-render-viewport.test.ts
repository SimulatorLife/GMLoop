import assert from "node:assert/strict";
import test from "node:test";

import type { GraphLayout, GraphLayoutEdge, GraphLayoutNode } from "../src/graph/graph-layout.js";
import {
    buildGraphEdgeBatches,
    calculateGraphViewportBounds,
    createGraphRenderBounds,
    cullGraphLayoutToViewport,
    isGraphViewportCovered,
    shouldBatchGraphEdges,
    shouldRenderGraphLabels
} from "../src/graph/graph-render-viewport.js";

function createNode(id: string, x: number, y: number): GraphLayoutNode {
    return {
        displayName: id,
        filePath: null,
        graphId: "project",
        id,
        kind: "script",
        lineEnd: null,
        lineStart: null,
        name: id,
        radius: 10,
        resourcePath: null,
        scopeId: null,
        scipSymbol: null,
        snippet: "",
        summary: "",
        x,
        y
    };
}

function createEdge(
    sourceNode: GraphLayoutNode,
    targetNode: GraphLayoutNode,
    type: GraphLayoutEdge["type"]
): GraphLayoutEdge {
    return {
        source: sourceNode.id,
        sourceNode,
        target: targetNode.id,
        targetNode,
        type
    };
}

void test("calculateGraphViewportBounds converts camera transforms into world bounds", () => {
    assert.deepEqual(calculateGraphViewportBounds({ panX: 0, panY: 0, zoomScale: 1 }), {
        bottom: 700,
        left: -900,
        right: 900,
        top: -700
    });

    assert.deepEqual(calculateGraphViewportBounds({ panX: 100, panY: -50, zoomScale: 2 }), {
        bottom: 375,
        left: -500,
        right: 400,
        top: -325
    });
});

void test("overscanned render bounds avoid rebuilding the graph for routine camera movement", () => {
    const renderBounds = createGraphRenderBounds({ panX: 0, panY: 0, zoomScale: 1 });

    assert.equal(isGraphViewportCovered({ panX: 500, panY: 300, zoomScale: 1 }, renderBounds), true);
    assert.equal(isGraphViewportCovered({ panX: 3000, panY: 0, zoomScale: 1 }, renderBounds), false);
});

void test("cullGraphLayoutToViewport removes off-screen primitives but keeps crossing relationships", () => {
    const leftNode = createNode("left", -1200, 0);
    const centerNode = createNode("center", 0, 0);
    const rightNode = createNode("right", 1200, 0);
    const farNode = createNode("far", 4000, 4000);
    const crossingEdge = createEdge(leftNode, rightNode, "references");
    const farEdge = createEdge(rightNode, farNode, "calls");
    const layout: GraphLayout = {
        edges: [crossingEdge, farEdge],
        nodes: [leftNode, centerNode, rightNode, farNode]
    };

    const culled = cullGraphLayoutToViewport(layout, {
        bottom: 500,
        left: -500,
        right: 500,
        top: -500
    });

    assert.deepEqual(
        culled.nodes.map((node) => node.id),
        ["center"]
    );
    assert.deepEqual(
        culled.edges.map((edge) => edge.type),
        ["references"]
    );
});

void test("automatic labels are suppressed only at unreadable overview scales", () => {
    assert.equal(shouldRenderGraphLabels("always", 0.1), true);
    assert.equal(shouldRenderGraphLabels("hidden", 8), false);
    assert.equal(shouldRenderGraphLabels("auto", 0.5), false);
    assert.equal(shouldRenderGraphLabels("auto", 1), true);
});

void test("edge batching groups relationships by visual type without degrading small detailed graphs", () => {
    const first = createNode("first", 0, 0);
    const second = createNode("second", 100, 0);
    const third = createNode("third", 0, 100);
    const batches = buildGraphEdgeBatches([
        createEdge(first, second, "references"),
        createEdge(first, third, "references"),
        createEdge(second, third, "calls")
    ]);

    assert.deepEqual(
        batches.map((batch) => ({ edgeCount: batch.edgeCount, type: batch.type })),
        [
            { edgeCount: 2, type: "references" },
            { edgeCount: 1, type: "calls" }
        ]
    );
    assert.ok(batches.every((batch) => batch.pathData.length > 0));
    assert.equal(shouldBatchGraphEdges(0.5, 10), false);
    assert.equal(shouldBatchGraphEdges(0.5, 200), true);
    assert.equal(shouldBatchGraphEdges(2, 100), false);
    assert.equal(shouldBatchGraphEdges(2, 1000), true);
});

void test("edge batching treats layout-simulation-jittered coincident nodes as touching, not directional", () => {
    // Force-directed layout can settle a self-referencing edge's source and
    // target at coordinates that differ by a sub-pixel floating-point residual
    // instead of landing on exactly the same value. A strict `distance === 0`
    // check would miss this near-zero case and normalize a direction vector
    // from that residual noise, so the fallback path (raw node coordinates,
    // no direction-dependent radius offset) must still be used here.
    const source = createNode("self", 12.000_000_000_000_002, 4.999_999_999_999_998);
    const target = createNode("self", 12, 5);
    const [batch] = buildGraphEdgeBatches([createEdge(source, target, "calls")]);

    assert.equal(batch.pathData, `M${String(source.x)},${String(source.y)}L${String(target.x)},${String(target.y)}`);
});
