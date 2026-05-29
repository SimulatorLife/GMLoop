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
    assert.match(rendered, /global\.score = 0;/u);
});

void test("graph panel keeps clicked node details visible when filters hide the node", () => {
    const panel = new TestableGmGraphPanel();
    panel.model = createGraphModel();
    panel.state = createGraphState();

    panel.renderForTest();
    panel.selectNodeForTest("script-node");
    panel.toggleNodeKindForTest("script");

    const rendered = renderTemplateValue(panel.renderForTest());
    assert.match(rendered, /id="tooltip" class="visible"/u);
    assert.match(rendered, /data-selected-node-id=script-node/u);
    assert.match(rendered, /configure_globals/u);
    assert.doesNotMatch(rendered, /<circle[^>]+script-node/u);
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
                },
                {
                    displayName: "MAX_SPEED",
                    filePath: "scripts/configure_globals/configure_globals.gml",
                    graphId: "project",
                    id: "macro-node",
                    kind: "macro",
                    lineEnd: 1,
                    lineStart: 1,
                    name: "MAX_SPEED",
                    resourcePath: "scripts/configure_globals/configure_globals.yy",
                    scopeId: null,
                    scipSymbol: "gml/macro/MAX_SPEED",
                    snippet: "",
                    summary: "Project speed limit macro."
                }
            ]
        }
    };
    panel.state = createGraphState();

    const rendered = renderTemplateValue(panel.renderForTest());
    assert.doesNotMatch(rendered, /instance-var-node/u);
    assert.doesNotMatch(rendered, /local-var-node/u);
    assert.doesNotMatch(rendered, /enum-member-node/u);
    assert.match(rendered, /macro-node/u);
    assert.match(rendered, /script-node/u);
});

void test("graph panel legend nests child node filters under semantic parent filters", () => {
    const panel = new TestableGmGraphPanel();
    const model = createGraphModel();
    panel.model = {
        ...model,
        data: {
            ...model.data,
            nodes: [
                ...model.data.nodes,
                {
                    displayName: "Create_0",
                    filePath: "objects/obj_player/obj_player_Create_0.gml",
                    graphId: "project",
                    id: "object-event-node",
                    kind: "object_event",
                    lineEnd: null,
                    lineStart: null,
                    name: "obj_player.Create_0",
                    resourcePath: "objects/obj_player/obj_player.yy",
                    scopeId: "scope:object:obj_player:Create_0",
                    scipSymbol: null,
                    snippet: "",
                    summary: "Create event."
                }
            ]
        }
    };
    panel.state = createGraphState();

    const rendered = renderTemplateValue(panel.renderForTest());
    assert.match(rendered, /data-kind=object/u);
    assert.match(rendered, /data-kind=object_event/u);
    assert.match(rendered, /class=(?:"filter-item child-filter-item"|filter-item child-filter-item)/u);
});

void test("graph panel legend renders the full node-kind catalog even when kinds are absent from the graph", () => {
    const panel = new TestableGmGraphPanel();
    panel.model = createGraphModel();
    panel.state = createGraphState();

    const rendered = renderTemplateValue(panel.renderForTest());

    for (const label of [
        "Anim Curve",
        "Data File",
        "Enum",
        "Enum Member",
        "Extension",
        "Font",
        "Function",
        "Global Variable",
        "Macro",
        "Note",
        "Particle System",
        "Path",
        "Resource",
        "Room Layer",
        "Sequence",
        "Shader",
        "Sound",
        "Struct",
        "Struct Variable",
        "Tileset",
        "Timeline"
    ]) {
        assert.match(rendered, new RegExp(`>${label}<`, "u"), `expected ${label} in the node legend`);
    }

    assert.match(rendered, /data-kind=resource/u);
    assert.match(rendered, /legend-swatch-group/u);
    assert.doesNotMatch(rendered, />Constructor</u);
    assert.doesNotMatch(rendered, />File</u);
    assert.doesNotMatch(rendered, />Project</u);
});

void test("graph panel parent node filters override enabled child node filters", () => {
    const panel = new TestableGmGraphPanel();
    const model = createGraphModel();
    panel.model = {
        ...model,
        data: {
            ...model.data,
            edges: [...model.data.edges, { source: "object-node", target: "object-event-node", type: "contains" }],
            nodes: [
                ...model.data.nodes,
                {
                    displayName: "Create_0",
                    filePath: "objects/obj_player/obj_player_Create_0.gml",
                    graphId: "project",
                    id: "object-event-node",
                    kind: "object_event",
                    lineEnd: null,
                    lineStart: null,
                    name: "obj_player.Create_0",
                    resourcePath: "objects/obj_player/obj_player.yy",
                    scopeId: "scope:object:obj_player:Create_0",
                    scipSymbol: null,
                    snippet: "",
                    summary: "Create event."
                }
            ]
        }
    };
    panel.state = createGraphState();

    panel.renderForTest();
    panel.toggleNodeKindForTest("object");

    const renderedWithParentDisabled = renderTemplateValue(panel.renderForTest());
    assert.doesNotMatch(renderedWithParentDisabled, /object-node/u);
    assert.doesNotMatch(renderedWithParentDisabled, /object-event-node/u);

    panel.toggleNodeKindForTest("object");

    const renderedWithParentEnabled = renderTemplateValue(panel.renderForTest());
    assert.match(renderedWithParentEnabled, /object-node/u);
    assert.match(renderedWithParentEnabled, /object-event-node/u);
});

void test("graph panel resource filter overrides concrete resource node filters", () => {
    const panel = new TestableGmGraphPanel();
    panel.model = createGraphModel();
    panel.state = createGraphState();

    panel.renderForTest();
    panel.toggleNodeKindForTest("resource");

    const rendered = renderTemplateValue(panel.renderForTest());
    assert.doesNotMatch(rendered, /script-node/u);
    assert.doesNotMatch(rendered, /object-node/u);
});

void test("graph panel script filter does not override standalone function, global, or macro filters", () => {
    const panel = new TestableGmGraphPanel();
    const model = createGraphModel();
    panel.model = {
        ...model,
        data: {
            ...model.data,
            nodes: [
                ...model.data.nodes,
                {
                    displayName: "configure_globals",
                    filePath: "scripts/configure_globals/configure_globals.gml",
                    graphId: "project",
                    id: "function-node",
                    kind: "function",
                    lineEnd: 12,
                    lineStart: 10,
                    name: "configure_globals",
                    resourcePath: "scripts/configure_globals/configure_globals.yy",
                    scopeId: "scope:function:configure_globals",
                    scipSymbol: "gml/function/configure_globals",
                    snippet: "",
                    summary: "Function symbol."
                },
                {
                    displayName: "MAX_SPEED",
                    filePath: "scripts/configure_globals/configure_globals.gml",
                    graphId: "project",
                    id: "macro-node",
                    kind: "macro",
                    lineEnd: 1,
                    lineStart: 1,
                    name: "MAX_SPEED",
                    resourcePath: "scripts/configure_globals/configure_globals.yy",
                    scopeId: null,
                    scipSymbol: "gml/macro/MAX_SPEED",
                    snippet: "",
                    summary: "Macro symbol."
                },
                {
                    displayName: "global_score",
                    filePath: "scripts/configure_globals/configure_globals.gml",
                    graphId: "project",
                    id: "global-node",
                    kind: "global_variable",
                    lineEnd: 2,
                    lineStart: 2,
                    name: "global_score",
                    resourcePath: "scripts/configure_globals/configure_globals.yy",
                    scopeId: null,
                    scipSymbol: "gml/var/global::global_score",
                    snippet: "",
                    summary: "Global variable symbol."
                }
            ]
        }
    };
    panel.state = createGraphState();

    panel.renderForTest();
    panel.toggleNodeKindForTest("script");

    const rendered = renderTemplateValue(panel.renderForTest());
    assert.doesNotMatch(rendered, /script-node/u);
    assert.match(rendered, /function-node/u);
    assert.match(rendered, /macro-node/u);
    assert.match(rendered, /global-node/u);
});
