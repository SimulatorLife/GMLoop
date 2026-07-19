import assert from "node:assert/strict";
import test from "node:test";

import { buildGraphHierarchy, seedInitialGraphPositions } from "../src/graph/graph-layout-hierarchy.js";
import type { GraphVisualizationNodeRecord } from "../src/graph/types.js";

function createNode(
    id: string,
    kind: GraphVisualizationNodeRecord["kind"],
    graphId: GraphVisualizationNodeRecord["graphId"] = "project"
): GraphVisualizationNodeRecord {
    return {
        displayName: id,
        filePath: null,
        graphId,
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

void test("graph hierarchy prefers and centers the game project root ahead of toolset roots", () => {
    const toolsetRoot = createNode("toolset-root", "project", "toolset");
    const gameRoot = createNode("game-root", "project", "project");
    const script = createNode("script", "script");
    const nodes = [toolsetRoot, gameRoot, script];
    const hierarchy = buildGraphHierarchy(nodes, [{ source: gameRoot.id, target: script.id, type: "contains" }]);
    const positions = seedInitialGraphPositions(nodes, hierarchy);

    assert.deepEqual(
        hierarchy.projectNodes.map((node) => node.id),
        [gameRoot.id, toolsetRoot.id]
    );
    assert.deepEqual(positions.get(gameRoot.id), { angle: 0, x: 0, y: 0 });
    assert.notDeepEqual(positions.get(toolsetRoot.id), { angle: 0, x: 0, y: 0 });
});

void test("top-level game branches surround the project root instead of occupying one side", () => {
    const gameRoot = createNode("game-root", "project");
    const children = Array.from({ length: 8 }, (_, index) => createNode(`script-${String(index)}`, "script"));
    const nodes = [gameRoot, ...children];
    const hierarchy = buildGraphHierarchy(
        nodes,
        children.map((node) => ({ source: gameRoot.id, target: node.id, type: "contains" as const }))
    );
    const positions = seedInitialGraphPositions(nodes, hierarchy);
    const childPositions = children.map((node) => positions.get(node.id));

    assert.ok(childPositions.every((position) => position !== undefined));
    const xValues = childPositions.map((position) => position?.x ?? 0);
    const yValues = childPositions.map((position) => position?.y ?? 0);
    const averageX = xValues.reduce((sum, value) => sum + value, 0) / xValues.length;
    const averageY = yValues.reduce((sum, value) => sum + value, 0) / yValues.length;

    assert.ok(Math.min(...xValues) < 0);
    assert.ok(Math.max(...xValues) > 0);
    assert.ok(Math.min(...yValues) < 0);
    assert.ok(Math.max(...yValues) > 0);
    assert.ok(Math.abs(averageX) < 1e-9);
    assert.ok(Math.abs(averageY) < 1e-9);
});
