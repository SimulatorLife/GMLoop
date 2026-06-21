import assert from "node:assert/strict";
import test from "node:test";

import { GmGraphPanel } from "../src/app/components/gm-graph-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import type { GraphLegendNodeKind } from "../src/app/graph-layout.js";
import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmGraphPanel extends GmGraphPanel {
    public renderForTest(): unknown {
        return this.render();
    }

    public selectNodeForTest(nodeId: string): void {
        this.selectNode(nodeId);
    }

    public toggleNodeKindForTest(kind: GraphLegendNodeKind): void {
        this.toggleNodeKind(kind);
    }
}

function createGraphModel(): GraphVisualizationUiModel {
    return {
        autoGamePipeline: null,
        data: {
            edges: [
                {
                    source: "script-node",
                    target: "object-node",
                    type: "references"
                }
            ],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [
                {
                    displayName: "configure_globals",
                    filePath: "scripts/configure_globals/configure_globals.gml",
                    graphId: "project",
                    id: "script-node",
                    kind: "script",
                    lineEnd: 14,
                    lineStart: 10,
                    name: "configure_globals",
                    resourcePath: "scripts/configure_globals/configure_globals.yy",
                    scopeId: "project/scripts/configure_globals",
                    scipSymbol: "gml/script/configure_globals",
                    snippet: "global.score = 0;",
                    summary: "Script that configures global values."
                },
                {
                    displayName: "obj_player",
                    filePath: null,
                    graphId: "project",
                    id: "object-node",
                    kind: "object",
                    lineEnd: null,
                    lineStart: null,
                    name: "obj_player",
                    resourcePath: "objects/obj_player/obj_player.yy",
                    scopeId: null,
                    scipSymbol: null,
                    snippet: "",
                    summary: "Player object."
                }
            ],
            projectRoot: "/tmp/project"
        },
        documentationCatalogs: null,
        isServerMode: true,
        lastFixRun: null,
        loadedTarget: {
            activePath: "/tmp/project/Game.yyp",
            projectRoot: "/tmp/project",
            selectedPaths: [],
            source: "working-directory"
        },
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Test Graph"
    };
}

function createGraphState(): GraphVisualizationUiState {
    return {
        ...createInitialGraphVisualizationUiState(),
        activeGraphView: "visual",
        activePage: "graph"
    };
}

void test("graph panel caches layout and filtering calculations during navigation and selection", () => {
    const panel = new TestableGmGraphPanel();
    panel.model = createGraphModel();
    panel.state = createGraphState();

    // First render should trigger initial layout and filtering calculations
    renderTemplateValue(panel.renderForTest());
    assert.equal(panel.layoutCalculationCount, 1);
    assert.equal(panel.filterCalculationCount, 1);

    // Second render with no changes should reuse cached layout and filtering
    renderTemplateValue(panel.renderForTest());
    assert.equal(panel.layoutCalculationCount, 1);
    assert.equal(panel.filterCalculationCount, 1);

    // Selecting a node should trigger a re-render but reuse cached layout and filtering
    panel.selectNodeForTest("script-node");
    renderTemplateValue(panel.renderForTest());
    assert.equal(panel.layoutCalculationCount, 1);
    assert.equal(panel.filterCalculationCount, 1);

    // Modifying search query should re-trigger filtering but reuse cached layout
    panel.state = {
        ...panel.state,
        searchQuery: "obj"
    };
    renderTemplateValue(panel.renderForTest());
    assert.equal(panel.layoutCalculationCount, 1);
    assert.equal(panel.filterCalculationCount, 2);

    // Toggling node kinds should re-trigger filtering but reuse cached layout
    panel.toggleNodeKindForTest("script");
    renderTemplateValue(panel.renderForTest());
    assert.equal(panel.layoutCalculationCount, 1);
    assert.equal(panel.filterCalculationCount, 3);

    // Changing model reference should recalculate layout and filtering
    panel.model = createGraphModel();
    renderTemplateValue(panel.renderForTest());
    assert.equal(panel.layoutCalculationCount, 2);
    assert.equal(panel.filterCalculationCount, 4);
});
