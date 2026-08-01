import assert from "node:assert/strict";
import test from "node:test";

import { listGraphNodeKindLegendItems } from "../src/graph/graph-layout.js";
import type { GraphVisualizationNodeRecord } from "../src/graph/types.js";

function createNode(kind: GraphVisualizationNodeRecord["kind"], id: string): GraphVisualizationNodeRecord {
    return {
        displayName: id,
        filePath: null,
        graphId: "project",
        id,
        kind,
        lineEnd: null,
        lineStart: null,
        name: id,
        resourcePath: `${id}.yy`,
        scopeId: null,
        scipSymbol: null,
        snippet: "",
        summary: `${kind} ${id}`
    };
}

void test("graph node legend groups GameMaker folder resources under Resources", () => {
    const legendItems = listGraphNodeKindLegendItems([createNode("project", "Project"), createNode("folder", "Rooms")]);
    const resourceItem = legendItems.find((item) => item.kind === "resource");

    assert.ok(resourceItem, "expected Resources legend group to be present");
    assert.ok(
        resourceItem.children.some((child) => child.kind === "folder"),
        "expected GameMaker folder resources to be readable as a resource filter"
    );
});
