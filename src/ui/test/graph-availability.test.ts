import assert from "node:assert/strict";
import test from "node:test";

import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { hasGraphEdges, hasLoadedGraphIndex, hasLoadedGraphProject } from "../src/app/graph-availability.js";

function createUiModel(): GraphVisualizationUiModel {
    return {
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/test"
        },
        documentationCatalogs: null,
        isServerMode: true,
        lastFixRun: null,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Test GMLoop"
    };
}

void test("hasLoadedGraphIndex returns false when the model has no graph nodes", () => {
    const model = createUiModel();

    assert.equal(hasLoadedGraphIndex(model), false);
});

void test("hasLoadedGraphIndex returns true when the model includes graph nodes", () => {
    const model: GraphVisualizationUiModel = {
        ...createUiModel(),
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [
                {
                    displayName: "Player",
                    filePath: "/tmp/test/objects/obj_player/obj_player.gml",
                    graphId: "project",
                    id: "node-1",
                    kind: "object",
                    lineEnd: null,
                    lineStart: null,
                    name: "obj_player",
                    resourcePath: "objects/obj_player",
                    snippet: "",
                    summary: ""
                }
            ],
            projectRoot: "/tmp/test"
        }
    };

    assert.equal(hasLoadedGraphIndex(model), true);
});

void test("hasGraphEdges returns false when the model has no graph edges", () => {
    const model = createUiModel();

    assert.equal(hasGraphEdges(model), false);
});

void test("hasGraphEdges returns true when the model includes graph edges", () => {
    const model: GraphVisualizationUiModel = {
        ...createUiModel(),
        data: {
            edges: [
                {
                    source: "node-1",
                    target: "node-2",
                    type: "calls"
                }
            ],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [
                {
                    displayName: "Player",
                    filePath: "/tmp/test/objects/obj_player/obj_player.gml",
                    graphId: "project",
                    id: "node-1",
                    kind: "object",
                    lineEnd: null,
                    lineStart: null,
                    name: "obj_player",
                    resourcePath: "objects/obj_player",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "Controller",
                    filePath: "/tmp/test/scripts/scr_controller/scr_controller.gml",
                    graphId: "project",
                    id: "node-2",
                    kind: "script",
                    lineEnd: null,
                    lineStart: null,
                    name: "scr_controller",
                    resourcePath: "scripts/scr_controller",
                    snippet: "",
                    summary: ""
                }
            ],
            projectRoot: "/tmp/test"
        }
    };

    assert.equal(hasGraphEdges(model), true);
});

void test("hasLoadedGraphProject returns false when no target has been loaded", () => {
    const model = createUiModel();

    assert.equal(hasLoadedGraphProject(model), false);
});

void test("hasLoadedGraphProject returns true when a target is loaded", () => {
    const model: GraphVisualizationUiModel = {
        ...createUiModel(),
        loadedTarget: {
            activePath: "/tmp/test/project.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: [],
            source: "working-directory"
        }
    };

    assert.equal(hasLoadedGraphProject(model), true);
});
