import assert from "node:assert/strict";
import test from "node:test";

import { GmGraphPanel } from "../src/app/components/gm-graph-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
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
}

function createGraphModel(): GraphVisualizationUiModel {
    return {
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
                    snippet: "",
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

void test("graph panel keeps selected node details visible until another node is selected", () => {
    const panel = new TestableGmGraphPanel();
    panel.model = createGraphModel();
    panel.state = createGraphState();

    panel.selectNodeForTest("script-node");
    panel.selectNodeForTest("script-node");

    const rendered = renderTemplateValue(panel.renderForTest());
    assert.match(rendered, /id="tooltip" class="visible"/u);
    assert.match(rendered, /configure_globals/u);
    assert.match(rendered, /symbol: gml\/script\/configure_globals/u);
    assert.match(rendered, /scope: project\/scripts\/configure_globals/u);
    assert.match(rendered, /lines 10-14/u);
    assert.match(rendered, /Script that configures global values\./u);
});

void test("graph panel renders directional edge markers for non-call relationships", () => {
    const panel = new TestableGmGraphPanel();
    panel.model = createGraphModel();
    panel.state = createGraphState();

    const rendered = renderTemplateValue(panel.renderForTest());
    assert.match(rendered, /id=arrow-references/u);
    assert.match(rendered, /marker-end=url\(#arrow-references\)/u);
});

void test("graph panel legend preserves edge line style metadata for readability", () => {
    const panel = new TestableGmGraphPanel();
    const model = createGraphModel();
    panel.model = {
        ...model,
        data: {
            ...model.data,
            edges: [
                { source: "script-node", target: "object-node", type: "calls" },
                { source: "script-node", target: "object-node", type: "contains" },
                { source: "script-node", target: "object-node", type: "references" }
            ]
        }
    };
    panel.state = createGraphState();

    const rendered = renderTemplateValue(panel.renderForTest());
    assert.match(rendered, /border-top:\s*2px solid #1f77b4;?/u);
    assert.match(rendered, /border-top:\s*2px dotted #2ca02c;?/u);
    assert.match(rendered, /border-top:\s*1px dashed #999;?/u);
    assert.match(rendered, /Calls/u);
    assert.match(rendered, /Contains/u);
    assert.match(rendered, /References/u);
});

void test("graph panel starts with noisy variable categories disabled for clearer default readability", () => {
    const panel = new TestableGmGraphPanel();
    const model = createGraphModel();
    panel.model = {
        ...model,
        data: {
            ...model.data,
            nodes: [
                ...model.data.nodes,
                {
                    displayName: "hp",
                    filePath: "objects/obj_player/obj_player.gml",
                    graphId: "project",
                    id: "instance-var-node",
                    kind: "instance_variable",
                    lineEnd: 24,
                    lineStart: 24,
                    name: "hp",
                    resourcePath: "objects/obj_player/obj_player.yy",
                    scopeId: "project/objects/obj_player",
                    scipSymbol: "gml/object/obj_player#hp",
                    snippet: "",
                    summary: "Player hit points."
                },
                {
                    displayName: "speedLimit",
                    filePath: "scripts/configure_globals/configure_globals.gml",
                    graphId: "project",
                    id: "local-var-node",
                    kind: "local_variable",
                    lineEnd: 11,
                    lineStart: 11,
                    name: "speedLimit",
                    resourcePath: "scripts/configure_globals/configure_globals.yy",
                    scopeId: "project/scripts/configure_globals",
                    scipSymbol: "gml/script/configure_globals#speedLimit",
                    snippet: "",
                    summary: "Per-script temporary speed cap."
                },
                {
                    displayName: "StateIdle",
                    filePath: "scripts/configure_globals/configure_globals.gml",
                    graphId: "project",
                    id: "enum-member-node",
                    kind: "enum_member",
                    lineEnd: 7,
                    lineStart: 7,
                    name: "StateIdle",
                    resourcePath: "scripts/configure_globals/configure_globals.yy",
                    scopeId: "project/scripts/configure_globals",
                    scipSymbol: "gml/enum/PlayerState#StateIdle",
                    snippet: "",
                    summary: "Enum member for idle state."
                }
            ]
        }
    };
    panel.state = createGraphState();

    const rendered = renderTemplateValue(panel.renderForTest());
    assert.doesNotMatch(rendered, /instance-var-node/u);
    assert.doesNotMatch(rendered, /local-var-node/u);
    assert.doesNotMatch(rendered, /enum-member-node/u);
    assert.match(rendered, /script-node/u);
});
