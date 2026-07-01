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
                },
                {
                    defaultValue: "always",
                    description: "Trailing comma strategy.",
                    name: "trailingComma"
                }
            ],
            lintRules: [
                {
                    description: "Normalize legacy operator aliases.",
                    fixable: "code",
                    ruleId: "gml/normalize-operators"
                },
                {
                    description: "Disallow globalvar declarations.",
                    fixable: null,
                    ruleId: "gml/no-globalvar"
                }
            ],
            refactorCodemods: [
                {
                    description: "Rename globalvar references.",
                    id: "refactor/globalvar-to-global",
                    requiresSemanticProjectIndex: true
                },
                {
                    description: "Convert legacy event numbers to event constants.",
                    id: "refactor/event-numbers-to-constants",
                    requiresSemanticProjectIndex: false
                }
            ]
        }
    };
}

function createDocsPanelState(
    activeDocsView: GraphVisualizationUiState["activeDocsView"] = "linting"
): GraphVisualizationUiState {
    return {
        ...createInitialGraphVisualizationUiState(),
        activeConfigView: "rendered",
        activeDocsView,
        activeGraphView: "visual",
        activePage: "docs",
        labelMode: "auto"
    };
}

void test("GmDocsPanel renders the Linting subview and project-facing rule content", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        autoGamePipeline: null,
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
    panel.state = createDocsPanelState("linting");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="docs-page"[\s\S]*class=page content-page docs-page active/u);
    assert.match(rendered, /id=docs-view-linting[\s\S]*class=docs-nav-button active/u);
    assert.doesNotMatch(rendered, /id="docs-search-input"/u);
    assert.match(
        rendered,
        /id=linting-page[\s\S]*?class=docs-subpage[\s\S]*role="tabpanel"[\s\S]*aria-labelledby=docs-view-linting/u
    );
    assert.match(rendered, /id=formatting-page[\s\S]*?class=docs-subpage hidden[\s\S]*role="tabpanel"/u);
    assert.match(rendered, /id=codemods-page[\s\S]*?class=docs-subpage hidden[\s\S]*role="tabpanel"/u);
    assert.match(rendered, /gml\/normalize-operators/u);
    assert.match(rendered, /gml\/no-globalvar/u);
    assert.match(rendered, /<gm-badge[^>]*\.label=fixable/u);
    assert.match(rendered, /accessibleLabel=Copy gml\/normalize-operators identifier/u);
    assert.match(rendered, /label="Copy"/u);
    assert.doesNotMatch(rendered, /fixable:code/u);
});

void test("GmDocsPanel renders the Formatting subview and option entries", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        autoGamePipeline: null,
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
    panel.state = createDocsPanelState("formatting");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id=formatting-page[\s\S]*?class=docs-subpage[\s\S]*role="tabpanel"/u);
    assert.match(rendered, /id=linting-page[\s\S]*?class=docs-subpage hidden[\s\S]*role="tabpanel"/u);
    assert.match(rendered, /id=codemods-page[\s\S]*?class=docs-subpage hidden[\s\S]*role="tabpanel"/u);
    assert.match(rendered, /printWidth/u);
    assert.match(rendered, /trailingComma/u);
});

void test("GmDocsPanel renders the Codemods subview and refactor entries", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        autoGamePipeline: null,
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
    panel.state = createDocsPanelState("codemods");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id=codemods-page[\s\S]*?class=docs-subpage[\s\S]*role="tabpanel"/u);
    assert.match(rendered, /id=linting-page[\s\S]*?class=docs-subpage hidden[\s\S]*role="tabpanel"/u);
    assert.match(rendered, /id=formatting-page[\s\S]*?class=docs-subpage hidden[\s\S]*role="tabpanel"/u);
    assert.match(rendered, /refactor\/globalvar-to-global/u);
    assert.match(rendered, /refactor\/event-numbers-to-constants/u);
});

void test("GmDocsPanel renders per-subview empty states when rule data is unavailable", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        autoGamePipeline: null,
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
    panel.state = createDocsPanelState("linting");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Linting rules are not available right now\./u);
});

void test("GmDocsPanel owns docs navigation controls", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        autoGamePipeline: null,
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
    panel.state = createDocsPanelState("cli");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.doesNotMatch(rendered, /role="search" aria-label="Filter documentation catalog"/u);
    assert.doesNotMatch(rendered, /id="docs-search-input"/u);
    assert.match(rendered, /class="docs-nav" role="tablist" aria-label="Documentation view selector"/u);
    assert.match(
        rendered,
        /id=docs-view-cli[\s\S]*class=docs-nav-button active[\s\S]*role="tab"[\s\S]*aria-selected=true[\s\S]*aria-controls=cli-page[\s\S]*tabindex=0/u
    );
    assert.match(
        rendered,
        /id=docs-view-mcp[\s\S]*role="tab"[\s\S]*aria-selected=false[\s\S]*aria-controls=docs-mcp-page[\s\S]*tabindex=-1/u
    );
    assert.match(rendered, /id=docs-view-linting/u);
    assert.match(rendered, /id=docs-view-formatting/u);
    assert.match(rendered, /id=docs-view-codemods/u);
});

void test("GmDocsPanel exposes copy actions for CLI command usage", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        autoGamePipeline: null,
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
        title: "Docs CLI View"
    };
    panel.state = createDocsPanelState("cli");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /gmloop graph visualize <path>/u);
    assert.match(rendered, /class="docs-reference-entry"/u);
    assert.match(rendered, /class="docs-usage-shell"[\s\S]*class="docs-usage">gmloop graph visualize <path><\/code>/u);
    assert.match(rendered, /<details class="docs-detail-container">[\s\S]*<summary>Arguments and options<\/summary>/u);
    assert.doesNotMatch(rendered, /<details class="docs-detail-container" open/u);
    assert.match(rendered, /class="docs-detail-row"[\s\S]*<code>path<\/code>[\s\S]*Path to the project to inspect\./u);
    assert.match(rendered, /class="docs-detail-row"[\s\S]*<code>--out<\/code>[\s\S]*Write the bundle to disk\./u);
    assert.match(
        rendered,
        /<gm-copy-button[\s\S]*class="docs-usage-copy-button"[\s\S]*\.value=gmloop graph visualize <path>/u
    );
    assert.match(rendered, /accessibleLabel=Copy runnable graph visualize command/u);
    assert.match(rendered, /label="Copy"/u);
    assert.match(rendered, /\?hideLabel=true/u);
});

void test("GmDocsPanel copies runnable CLI commands when a project is open", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        autoGamePipeline: null,
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
        loadedTarget: {
            activePath: "/Users/henrykirk/GMLoop/vendor/3DSpider",
            projectRoot: "/Users/henrykirk/GMLoop/vendor/3DSpider",
            selectedPaths: ["/Users/henrykirk/GMLoop/vendor/3DSpider"],
            source: "cli-path"
        },
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Docs CLI View"
    };
    panel.state = createDocsPanelState("cli");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /gmloop graph visualize --path \/Users\/henrykirk\/GMLoop\/vendor\/3DSpider/u);
    assert.match(rendered, /gmloop format --path \/Users\/henrykirk\/GMLoop\/vendor\/3DSpider/u);
    assert.match(rendered, /\.value=gmloop format --path \/Users\/henrykirk\/GMLoop\/vendor\/3DSpider/u);
});

void test("GmDocsPanel filters the Linting subview by the current search query", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        autoGamePipeline: null,
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
    panel.state = { ...createDocsPanelState("linting"), searchQuery: "normalize" };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /gml\/normalize-operators/u);
    assert.doesNotMatch(rendered, /gml\/no-globalvar/u);
});

void test("GmDocsPanel shows a per-subview empty state when search has no matches", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        autoGamePipeline: null,
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
    panel.state = { ...createDocsPanelState("cli"), searchQuery: "does-not-exist" };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /No commands match “does-not-exist”\./u);
    assert.doesNotMatch(rendered, /accessibleLabel=Copy runnable graph visualize command/u);
    assert.doesNotMatch(rendered, /graph visualize/u);
});

void test("GmDocsPanel shows a per-subview empty state when linting search has no matches", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        autoGamePipeline: null,
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
        title: "Linting Search"
    };
    panel.state = { ...createDocsPanelState("linting"), searchQuery: "does-not-exist" };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /No lint rules match “does-not-exist”\./u);
    assert.doesNotMatch(rendered, /gml\/normalize-operators/u);
});

void test("GmDocsPanel renders the MCP tools subview and tool metadata when selected", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        autoGamePipeline: null,
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
    panel.state = createDocsPanelState("mcp");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="docs-page"[\s\S]*class=page content-page docs-page active/u);
    assert.match(rendered, /project status/u);
    assert.match(rendered, /project_status/u);
    assert.match(rendered, /accessibleLabel=Copy project status tool name/u);
    assert.match(rendered, /label="Copy"/u);
    assert.match(rendered, /<details class="docs-detail-container">[\s\S]*<summary>Fields<\/summary>/u);
    assert.match(rendered, /Read the current project status\./u);
    assert.match(rendered, /path/u);
    assert.match(rendered, /Project path to inspect\./u);
    assert.match(rendered, /manual read/u);
    assert.match(rendered, /Read GameMaker manual entries\./u);
});
