import assert from "node:assert/strict";
import test from "node:test";

import { GmAutoGamePanel } from "../src/app/components/gm-auto-game-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmAutoGamePanel extends GmAutoGamePanel {
    public renderForTest(): unknown {
        return this.render();
    }
}

function createMockModel(overrides?: Partial<GraphVisualizationUiModel>): GraphVisualizationUiModel {
    return {
        autoGamePipeline: null,
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
        title: "Auto-Game",
        ...overrides
    };
}

function createMockState(overrides?: Partial<GraphVisualizationUiState>): GraphVisualizationUiState {
    return {
        ...createInitialGraphVisualizationUiState(),
        activeConfigView: "rendered",
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "auto-game",
        labelMode: "auto",
        mcpServerStatus: "running",
        ...overrides
    };
}

void test("GmAutoGamePanel renders empty pipeline slots and MCP bridge metadata", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="auto-game-page"[\s\S]*class=page content-page active/u);
    assert.match(rendered, /Auto-game creation pipeline, AI skill readiness, MCP bridge status/u);
    assert.match(rendered, /Pipeline Controls/u);
    assert.match(rendered, /No auto-game pipeline controller is connected/u);
    assert.match(rendered, /Pipeline Feed/u);
    assert.match(rendered, /\.gmloop\/agent-log\.jsonl/u);
    assert.match(rendered, /AI Skills/u);
    assert.match(rendered, /LLM Output/u);
    assert.match(rendered, /MCP Bridge/u);
    assert.match(rendered, /gmloop-mcp/u);
    assert.match(rendered, /0\.2\.0/u);
    assert.match(rendered, /MCP lifecycle events/u);
});

void test("GmAutoGamePanel renders host-provided pipeline details", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel({
        autoGamePipeline: {
            actions: [
                {
                    description: "Create a playable vertical slice.",
                    disabled: false,
                    id: "start",
                    label: "Start Pipeline"
                }
            ],
            events: [
                {
                    detail: "Defined core loop and player verbs.",
                    id: "event-1",
                    status: "success",
                    timestamp: "2026-01-01T00:00:00.000Z",
                    title: "Design pass complete"
                }
            ],
            llmOutputs: [
                {
                    content: "Keep the first playable slice small.",
                    id: "llm-1",
                    role: "thought",
                    timestamp: "2026-01-01T00:00:01.000Z",
                    title: "Scope note"
                }
            ],
            skills: [
                {
                    description: "Defines core loop and playable-slice constraints.",
                    id: "game-design",
                    name: "game-design",
                    sourcePath: ".agents/skills/game-design/SKILL.md",
                    status: "ready"
                }
            ],
            status: "running",
            statusText: "Creating the first playable slice."
        }
    });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Start Pipeline/u);
    assert.match(rendered, /Design pass complete/u);
    assert.match(rendered, /game-design/u);
    assert.match(rendered, /Scope note/u);
    assert.match(rendered, /Keep the first playable slice small\./u);
});

void test("GmAutoGamePanel renders without server metadata when documentationCatalogs is null", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel({ documentationCatalogs: null });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="auto-game-page"[\s\S]*class=page content-page active/u);
    assert.match(rendered, /MCP Bridge/u);
    assert.doesNotMatch(rendered, /gmloop-mcp/u);
});

void test("GmAutoGamePanel renders inactive page class when not on Auto-Game page", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel();
    panel.state = createMockState({ activePage: "graph" });

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="auto-game-page"[\s\S]*class=page content-page/u);
    assert.doesNotMatch(rendered, /class=page content-page active/u);
});
