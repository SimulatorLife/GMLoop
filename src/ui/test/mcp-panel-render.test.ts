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

function createMockModel(): GraphVisualizationUiModel {
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
                }
            ],
            workspaceRules: {
                formatOptions: [],
                lintRules: [],
                refactorCodemods: []
            }
        },
        isServerMode: true,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "running",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "MCP"
    };
}

function createMockState(): GraphVisualizationUiState {
    return {
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "mcp",
        errorMessage: null,
        fixErrorMessage: null,
        fixLogLines: [],
        fixStatus: "idle",
        isFixPending: false,
        isLiveReloadRefreshPending: false,
        isLiveReloadStartPending: false,
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: "auto",
        liveReloadErrorMessage: null,
        liveReloadStatus: null,
        mcpServerStatus: "running",
        searchQuery: ""
    };
}

void test("GmMcpPanel renders running status and live activity placeholders", () => {
    const panel = new TestableGmMcpPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="mcp-page"[\s\S]*class=page docs-page active/u);
    assert.match(rendered, /Runtime Status/u);
    assert.match(rendered, /Tool Call Feed/u);
    assert.match(rendered, /Connection Updates/u);
    assert.match(rendered, /Live MCP server status, connection health, and future activity updates\./u);
    assert.match(rendered, /No live MCP tool calls have been observed in this UI session yet\./u);
    assert.doesNotMatch(rendered, /Available Tools/u);
    assert.doesNotMatch(rendered, /Graph Visualize/u);
    assert.doesNotMatch(rendered, /connected tool/u);
    assert.match(rendered, /mcp-runtime-status-chip running/u);
});

void test("GmMcpPanel renders not-started server status without tool catalog fallback", () => {
    const panel = new TestableGmMcpPanel();
    panel.model = {
        ...createMockModel(),
        documentationCatalogs: null,
        mcpServerStatus: "not-started"
    };
    panel.state = {
        ...createMockState(),
        mcpServerStatus: "not-started"
    };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /The MCP bridge has not started in this session yet\./u);
    assert.doesNotMatch(rendered, /Connected tool details are not available right now\./u);
    assert.doesNotMatch(rendered, /No tools are available right now\./u);
    assert.doesNotMatch(rendered, /Available Tools/u);
});
