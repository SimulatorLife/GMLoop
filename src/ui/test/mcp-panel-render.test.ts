import assert from "node:assert/strict";
import test from "node:test";

import { GmMcpPanel } from "../src/app/components/gm-mcp-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmMcpPanel extends GmMcpPanel {
    public renderForTest(): unknown {
        return this.render();
    }
}

function createMockModel(overrides?: Partial<GraphVisualizationUiModel>): GraphVisualizationUiModel {
    return {
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/test"
        },
        documentationCatalogs: {
            cliCommands: [],
            mcpServer: {
                name: "gmloop-mcp",
                version: "0.2.0"
            },
            mcpTools: [
                {
                    commandDisplayName: "Graph Visualize",
                    description: "Builds graph visualization assets.",
                    fields: [
                        {
                            attributeName: "path",
                            choices: [],
                            description: "Path to project",
                            kind: "argument",
                            multiple: false,
                            name: "path",
                            required: true,
                            valueType: "string"
                        }
                    ],
                    toolName: "graph.visualize"
                },
                {
                    commandDisplayName: "Lint Project",
                    description: "Runs lint rules against a project.",
                    fields: [],
                    toolName: "lint.project"
                }
            ],
            workspaceRules: {
                formatOptions: [],
                lintRules: [],
                refactorCodemods: []
            }
        },
        isServerMode: true,
        lastFixRun: null,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "running",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "MCP",
        ...overrides
    };
}

function createMockState(overrides?: Partial<GraphVisualizationUiState>): GraphVisualizationUiState {
    return {
        activeConfigView: "rendered",
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "mcp",
        errorMessage: null,
        fixErrorMessage: null,
        fixLogLines: [],
        fixStatus: "idle",
        isFixPending: false,
        isLiveReloadStartPending: false,
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: "auto",
        liveReloadErrorMessage: null,
        mcpServerStatus: "running",
        pendingActionCount: 0,
        searchQuery: "",
        ...overrides
    };
}

void test("GmMcpPanel renders metadata, tool catalog, and activity feed", () => {
    const panel = new TestableGmMcpPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="mcp-page"[\s\S]*class=page content-page active/u);
    assert.match(rendered, /Server Information/u);
    assert.match(rendered, /gmloop-mcp/u);
    assert.match(rendered, /0\.2\.0/u);
    assert.match(rendered, /Available Tools \(2\)/u);
    assert.match(rendered, /Graph Visualize/u);
    assert.match(rendered, /Lint Project/u);
    assert.match(rendered, /Activity Feed/u);
    assert.match(rendered, /MCP lifecycle events/u);
});

void test("GmMcpPanel renders without server metadata when documentationCatalogs is null", () => {
    const panel = new TestableGmMcpPanel();
    panel.model = createMockModel({ documentationCatalogs: null });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="mcp-page"[\s\S]*class=page content-page active/u);
    assert.doesNotMatch(rendered, /Server Information/u);
    assert.doesNotMatch(rendered, /gmloop-mcp/u);
    assert.match(rendered, /Available Tools \(0\)/u);
    assert.match(rendered, /No tools are available right now/u);
});

void test("GmMcpPanel renders empty tools state", () => {
    const panel = new TestableGmMcpPanel();
    panel.model = createMockModel({
        documentationCatalogs: {
            cliCommands: [],
            mcpServer: { name: "gmloop-mcp", version: "0.2.0" },
            mcpTools: [],
            workspaceRules: { formatOptions: [], lintRules: [], refactorCodemods: [] }
        }
    });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Available Tools \(0\)/u);
    assert.match(rendered, /No tools are available right now/u);
});

void test("GmMcpPanel renders tool fields when present", () => {
    const panel = new TestableGmMcpPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Graph Visualize/u);
    assert.match(rendered, /Builds graph visualization assets\./u);
    assert.match(rendered, /path/u);
    assert.match(rendered, /Path to project/u);
});

void test("GmMcpPanel renders inactive page class when not on MCP page", () => {
    const panel = new TestableGmMcpPanel();
    panel.model = createMockModel();
    panel.state = createMockState({ activePage: "graph" });

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="mcp-page"[\s\S]*class=page content-page/u);
    assert.doesNotMatch(rendered, /class=page content-page active/u);
});
