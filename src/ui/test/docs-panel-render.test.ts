import assert from "node:assert/strict";
import test from "node:test";

import { GmDocsPanel } from "../src/app/components/gm-docs-panel.js";
import { GRAPH_UI_EVENT_CLEAR_PAGE_ERROR } from "../src/app/events/events.js";
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
                        long: "--out",
                        short: undefined,
                        variadic: false
                    },
                    {
                        attributeName: "path",
                        boolean: false,
                        choices: [],
                        description: "Target .gml file, GameMaker project directory, or .yyp path",
                        flags: "--path <path>",
                        long: "--path",
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
                options: [
                    {
                        attributeName: "path",
                        boolean: false,
                        choices: [],
                        description: "Target .gml file, GameMaker project directory, or .yyp path",
                        flags: "--path <path>",
                        long: "--path",
                        short: undefined,
                        variadic: false
                    }
                ],
                usage: "gmloop format"
            },
            {
                arguments: [],
                commandPath: ["generate-feather-metadata"],
                description: "Generate feather-metadata.json from the GameMaker manual.",
                displayName: "generate-feather-metadata",
                options: [
                    {
                        attributeName: "output",
                        boolean: false,
                        choices: [],
                        description: "Path to write feather-metadata.json.",
                        flags: "--output <path>",
                        long: "--output",
                        short: undefined,
                        variadic: false
                    }
                ],
                usage: "gmloop generate-feather-metadata"
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
                internal: false,
                toolName: "project_status"
            },
            {
                commandDisplayName: "manual read",
                description: "Read GameMaker manual entries.",
                fields: [],
                internal: false,
                toolName: "manual_read"
            },
            {
                commandDisplayName: "replay record",
                description: "Record a replay scenario.",
                fields: [],
                internal: true,
                toolName: "replay_record"
            }
        ],
        lspTools: [
            {
                description: "Find where a function, class, or variable is defined.",
                displayName: "Go to Definition",
                fields: [
                    {
                        choices: [],
                        default: undefined,
                        description: "Absolute path to the source file",
                        name: "file_path",
                        required: true,
                        type: "string"
                    }
                ],
                name: "lsp_goto_definition"
            },
            {
                description: "Get compiler errors, warnings, and hints.",
                displayName: "Get Diagnostics",
                fields: [
                    {
                        choices: ["all", "error", "warning"],
                        default: "all",
                        description: "Severity filter",
                        name: "severity_filter",
                        required: false,
                        type: "string"
                    }
                ],
                name: "lsp_diagnostics"
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
                },
                {
                    defaultValue: false,
                    description: "Indent with tabs instead of spaces.",
                    name: "useTabs"
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
    assert.doesNotMatch(rendered, /id=docs-view-linting[\s\S]*class=docs-nav-button/u);
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
    assert.match(rendered, /useTabs/u);
    assert.match(rendered, /Indent with tabs instead of spaces\./u);
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
    assert.doesNotMatch(rendered, /class="docs-nav" role="tablist"/u);
    assert.doesNotMatch(rendered, /class=docs-nav-button/u);
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
    assert.match(
        rendered,
        /<gm-collapsible[\s\S]*class="docs-detail-container"[\s\S]*\.summary=Arguments and options/u
    );
    assert.doesNotMatch(rendered, /<gm-collapsible[^>]*class="docs-detail-container"[^>]*\bopen\b/u);
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

void test("GmDocsPanel omits --path for commands that do not declare it", () => {
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

    assert.match(
        rendered,
        /<code class="docs-usage">gmloop generate-feather-metadata<\/code>[\s\S]*?\.value=gmloop generate-feather-metadata/u
    );
    assert.doesNotMatch(rendered, /gmloop generate-feather-metadata --path/u);
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
    assert.match(rendered, /<gm-collapsible[\s\S]*class="docs-detail-container"[\s\S]*\.summary=Fields/u);
    assert.match(rendered, /Read the current project status\./u);
    assert.match(rendered, /path/u);
    assert.match(rendered, /Project path to inspect\./u);
    assert.match(rendered, /manual read/u);
    assert.match(rendered, /Read GameMaker manual entries\./u);
    // By default, the internal tools should be hidden
    assert.doesNotMatch(rendered, /replay record/u);
    assert.doesNotMatch(rendered, /replay_record/u);
});

void test("GmDocsPanel toggles internal MCP tools visibility", () => {
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

    // Enable internal tools toggle
    panel.showInternalMcpTools = true;

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /project status/u);
    assert.match(rendered, /replay record/u);
    assert.match(rendered, /replay_record/u);
    assert.match(rendered, /<gm-badge[^>]*\.label=internal/u);
});

void test("GmDocsPanel renders the LSP tools subview and tool metadata when selected", () => {
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
        title: "Docs LSP View"
    };
    panel.state = createDocsPanelState("lsp");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="docs-page"[\s\S]*class=page content-page docs-page active/u);
    assert.match(rendered, /Go to Definition/u);
    assert.match(rendered, /lsp_goto_definition/u);
    assert.match(rendered, /accessibleLabel=Copy Go to Definition tool name/u);
    assert.match(rendered, /label="Copy"/u);
    assert.match(rendered, /<gm-collapsible[\s\S]*class="docs-detail-container"[\s\S]*\.summary=Fields/u);
    assert.match(rendered, /Find where a function, class, or variable is defined\./u);
    assert.match(rendered, /file_path/u);
    assert.match(rendered, /Absolute path to the source file/u);
    assert.match(rendered, /Get Diagnostics/u);
    assert.match(rendered, /lsp_diagnostics/u);
    assert.match(rendered, /Choices:[\s\S]*all[\s\S]*error[\s\S]*warning/u);
    assert.match(rendered, /Default:[\s\S]*"all"/u);
});

void test("GmDocsPanel does not override Lit lifecycle hooks for event wiring", () => {
    // The composition refactor moved the gm-error-banner-dismiss listener
    // into an EventBusManager registered through LifecycleParticipantsController.
    // The host must not re-introduce lifecycle overrides that duplicate that
    // wiring. Reading own properties (not the prototype chain) keeps this
    // assertion stable against inherited LitElement hooks.
    const prototype = GmDocsPanel.prototype as unknown as Record<string, unknown>;
    const hasOwn = Object.prototype.hasOwnProperty;

    assert.equal(
        hasOwn.call(prototype, "connectedCallback"),
        false,
        "Expected GmDocsPanel to drop its connectedCallback override."
    );
    assert.equal(
        hasOwn.call(prototype, "disconnectedCallback"),
        false,
        "Expected GmDocsPanel to drop its disconnectedCallback override."
    );
});

void test("GmDocsPanel propagates gm-error-banner-dismiss via composition", () => {
    // With the composition refactor the EventBusManager registered in the
    // constructor owns the gm-error-banner-dismiss subscription. The panel
    // must still translate that dismissal into a GRAPH_UI_EVENT_CLEAR_PAGE_ERROR
    // custom event so the surrounding app shell can clear the docs error state.
    // Invoking the inherited LitElement connectedCallback/disconnectedCallback
    // drives the LifecycleParticipantsController in the same way the DOM would.
    const panel = new GmDocsPanel();
    let observedPage: string | null = null;
    const listener = (event: Event): void => {
        const customEvent = event as CustomEvent<{ page: string }>;
        if (customEvent.detail?.page !== undefined) {
            observedPage = customEvent.detail.page;
        }
    };
    panel.addEventListener(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, listener);

    try {
        panel.connectedCallback();
        panel.dispatchEvent(new CustomEvent("gm-error-banner-dismiss", { bubbles: true }));

        assert.equal(observedPage, "docs");
    } finally {
        panel.disconnectedCallback();
        panel.removeEventListener(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, listener);
    }
});
