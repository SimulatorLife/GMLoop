import assert from "node:assert/strict";
import test from "node:test";

import { GmDocsPanel } from "../src/app/components/gm-docs-panel.js";
import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import type { GraphVisualizationDocumentationCatalogs } from "../src/graph/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmDocsPanel extends GmDocsPanel {
    public renderForTest(): unknown {
        return this.render();
    }
}

function createDocumentationCatalogs(): GraphVisualizationDocumentationCatalogs {
    return {
        cliCommands: [
            {
                arguments: [
                    {
                        choices: [],
                        description: "Path to the project to inspect.",
                        name: "path",
                        required: true,
                        variadic: false
                    }
                ],
                commandPath: ["graph", "visualize"],
                description: "Generate a project graph.",
                displayName: "graph visualize",
                options: [
                    {
                        attributeName: "out",
                        boolean: false,
                        choices: [],
                        description: "Write the bundle to disk.",
                        flags: "--out",
                        long: "out",
                        short: undefined,
                        variadic: false
                    }
                ],
                usage: "gmloop graph visualize <path>"
            },
            {
                arguments: [],
                commandPath: ["format"],
                description: "Apply formatting to a project.",
                displayName: "format",
                options: [],
                usage: "gmloop format"
            }
        ],
        mcpServer: {
            name: "gmloop-mcp",
            version: "0.0.1"
        },
        mcpTools: [
            {
                commandDisplayName: "project status",
                description: "Read the current project status.",
                fields: [
                    {
                        attributeName: "path",
                        choices: [],
                        description: "Project path to inspect.",
                        kind: "argument",
                        multiple: false,
                        name: "path",
                        required: true,
                        valueType: "string"
                    }
                ],
                toolName: "project_status"
            },
            {
                commandDisplayName: "manual read",
                description: "Read GameMaker manual entries.",
                fields: [],
                toolName: "manual_read"
            }
        ],
        workspaceRules: {
            formatOptions: [
                {
                    defaultValue: 100,
                    description: "Preferred print width.",
                    name: "printWidth"
                }
            ],
            lintRules: [
                {
                    description: "Normalize legacy operator aliases.",
                    fixable: "code",
                    ruleId: "gml/normalize-operators"
                }
            ],
            refactorCodemods: [
                {
                    description: "Rename globalvar references.",
                    id: "refactor/globalvar-to-global",
                    requiresSemanticProjectIndex: true
                }
            ]
        }
    };
}

function createDocsPanelState(): GraphVisualizationUiState {
    return {
        ...createInitialGraphVisualizationUiState(),
        activeConfigView: "rendered",
        activeDocsView: "rules",
        activeGraphView: "visual",
        activePage: "docs",
        labelMode: "auto"
    };
}

void test("GmDocsPanel renders the Rules subview and project-facing rule content", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/project"
        },
        documentationCatalogs: createDocumentationCatalogs(),
        isServerMode: false,
        lastFixRun: null,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Rules Catalog"
    };
    panel.state = createDocsPanelState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="docs-page"[\s\S]*class=page content-page docs-page active/u);
    assert.doesNotMatch(rendered, /docs-view-rules/u);
    assert.doesNotMatch(rendered, /docs-search-input/u);
    assert.match(rendered, /Format Options/u);
    assert.match(rendered, /Lint Rules/u);
    assert.match(rendered, /Refactor Codemods/u);
    assert.match(rendered, /printWidth/u);
    assert.match(rendered, /gml\/normalize-operators/u);
    assert.match(rendered, /refactor\/globalvar-to-global/u);
    assert.match(rendered, /<gm-badge[^>]*\.label=fixable/u);
    assert.doesNotMatch(rendered, /fixable:code/u);
});

void test("GmDocsPanel renders an empty rules state when rule data is unavailable", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/project"
        },
        documentationCatalogs: null,
        isServerMode: false,
        lastFixRun: null,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Rules Empty State"
    };
    panel.state = createDocsPanelState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.doesNotMatch(rendered, /docs-view-rules/u);
    assert.match(rendered, /Rules and code actions are not available right now\./u);
});

void test("GmDocsPanel leaves docs controls to the shared page toolbar", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/project"
        },
        documentationCatalogs: createDocumentationCatalogs(),
        isServerMode: false,
        lastFixRun: null,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Docs Search"
    };
    panel.state = { ...createDocsPanelState(), activeDocsView: "cli" };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.doesNotMatch(rendered, /role="search" aria-label="Filter documentation catalog"/u);
    assert.doesNotMatch(rendered, /id="docs-search-input"/u);
    assert.doesNotMatch(rendered, /Documentation view selector/u);
});

void test("GmDocsPanel filters rules catalog entries by the current search query", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/project"
        },
        documentationCatalogs: createDocumentationCatalogs(),
        isServerMode: false,
        lastFixRun: null,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Rules Search"
    };
    panel.state = { ...createDocsPanelState(), searchQuery: "normalize" };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /gml\/normalize-operators/u);
    assert.doesNotMatch(rendered, /printWidth/u);
    assert.doesNotMatch(rendered, /refactor\/globalvar-to-global/u);
});

void test("GmDocsPanel shows an active-view empty state when search has no matches", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/project"
        },
        documentationCatalogs: createDocumentationCatalogs(),
        isServerMode: false,
        lastFixRun: null,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "CLI Search"
    };
    panel.state = { ...createDocsPanelState(), activeDocsView: "cli", searchQuery: "does-not-exist" };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /No commands match “does-not-exist”\./u);
    assert.doesNotMatch(rendered, /graph visualize/u);
});

void test("GmDocsPanel renders the MCP tools subview and tool metadata when selected", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/project"
        },
        documentationCatalogs: createDocumentationCatalogs(),
        isServerMode: false,
        lastFixRun: null,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Docs MCP View"
    };
    panel.state = { ...createDocsPanelState(), activeDocsView: "mcp" };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="docs-page"[\s\S]*class=page content-page docs-page active/u);
    assert.match(rendered, /project status/u);
    assert.match(rendered, /Read the current project status\./u);
    assert.match(rendered, /path/u);
    assert.match(rendered, /Project path to inspect\./u);
    assert.match(rendered, /manual read/u);
    assert.match(rendered, /Read GameMaker manual entries\./u);
});
