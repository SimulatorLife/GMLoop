import assert from "node:assert/strict";
import test from "node:test";

import type { GraphLayoutEdge, GraphLayoutNode } from "../src/graph/graph-layout.js";
import { buildGraphEdgeBatches } from "../src/graph/graph-render-viewport.js";

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

void test("batched relationships sharing endpoints are routed into distinct curved lanes", () => {
    const left = createNode("left", 0, 0);
    const right = createNode("right", 200, 0);
    const batches = buildGraphEdgeBatches([
        createEdge(left, right, "calls"),
        createEdge(left, right, "references")
    ]).toSorted((leftBatch, rightBatch) => leftBatch.type.localeCompare(rightBatch.type));

    assert.equal(batches.length, 2);
    assert.ok(batches.every((batch) => batch.pathData.includes("Q")));
    assert.notEqual(batches[0]?.pathData, batches[1]?.pathData);
});

void test("reciprocal relationships are routed onto opposite sides instead of overlapping", () => {
    const left = createNode("left", 0, 0);
    const right = createNode("right", 200, 0);
    const batches = buildGraphEdgeBatches([
        createEdge(left, right, "references"),
        createEdge(right, left, "calls")
    ]);

    assert.equal(batches.length, 2);
    assert.ok(batches.every((batch) => batch.pathData.includes("Q")));
    assert.notEqual(batches[0]?.pathData, batches[1]?.pathData);
});

void test("single batched relationships remain straight", () => {
    const left = createNode("left", 0, 0);
    const right = createNode("right", 200, 0);
    const [batch] = buildGraphEdgeBatches([createEdge(left, right, "calls")]);

    assert.ok(batch);
    assert.ok(batch.pathData.includes("L"));
    assert.ok(!batch.pathData.includes("Q"));
});
