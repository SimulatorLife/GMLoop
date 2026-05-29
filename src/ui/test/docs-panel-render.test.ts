import assert from "node:assert/strict";
import test from "node:test";

import { GmDocsPanel } from "../src/app/components/gm-docs-panel.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import type { GraphVisualizationDocumentationCatalogs } from "../src/graph/types.js";
import { createButtonAriaPressedPattern, renderTemplateValue } from "./render-template-helpers.js";

class TestableGmDocsPanel extends GmDocsPanel {
    public renderForTest(): unknown {
        return this.render();
    }

    public setDocsSearchQueryForTest(query: string): void {
        this.docsSearchQuery = query;
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
        activeDocsView: "rules",
        activeGraphView: "visual",
        activePage: "docs",
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
        mcpServerStatus: "not-started",
        pendingActionCount: 0,
        searchQuery: ""
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

    assert.match(rendered, /docs-view-rules/u);
    assert.match(rendered, createButtonAriaPressedPattern("docs-view-rules", true));
    assert.match(rendered, createButtonAriaPressedPattern("docs-view-cli", false));
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

    assert.match(rendered, /docs-view-rules/u);
    assert.match(rendered, createButtonAriaPressedPattern("docs-view-rules", true));
    assert.match(rendered, /Rules and code actions are not available right now\./u);
});

void test("GmDocsPanel renders an accessible search control for catalog browsing", () => {
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

    assert.match(rendered, /role="search" aria-label="Filter documentation catalog"/u);
    assert.match(
        rendered,
        /<label class="docs-search-label" for="docs-search-input">Search current docs view<\/label>/u
    );
    assert.match(rendered, /id="docs-search-input"/u);
    assert.match(rendered, /type="search"/u);
    assert.match(rendered, /aria-describedby="docs-meta docs-search-summary"/u);
    assert.match(rendered, /id="docs-search-summary"[^>]*aria-live="polite"/u);
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
    panel.state = createDocsPanelState();
    panel.setDocsSearchQueryForTest("normalize");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Showing 1 rule or option matching “normalize”\./u);
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
    panel.state = { ...createDocsPanelState(), activeDocsView: "cli" };
    panel.setDocsSearchQueryForTest("does-not-exist");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Showing 0 commands matching “does-not-exist”\./u);
    assert.match(rendered, /No commands match “does-not-exist”\./u);
    assert.doesNotMatch(rendered, /graph visualize/u);
});
