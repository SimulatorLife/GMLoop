import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GmAppHeader } from "../src/app/components/gm-app-header.js";
import { GmGraphToolbar } from "../src/app/components/gm-graph-toolbar.js";
import { GmPlaygroundPanel } from "../src/app/components/gm-playground-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmAppHeader extends GmAppHeader {
    public renderForTest(): unknown {
        return this.render();
    }
}

class TestableGmGraphToolbar extends GmGraphToolbar {
    public renderForTest(): unknown {
        return this.render();
    }
}

class TestableGmPlaygroundPanel extends GmPlaygroundPanel {
    public renderForTest(): unknown {
        return this.render();
    }
}

function createMockModel(): GraphVisualizationUiModel {
    return {
        autoGamePipeline: null,
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [
                {
                    displayName: "Player",
                    filePath: "/tmp/test/objects/obj_player/obj_player.gml",
                    graphId: "project",
                    id: "node-1",
                    kind: "object",
                    lineEnd: null,
                    lineStart: null,
                    name: "obj_player",
                    resourcePath: "objects/obj_player",
                    scopeId: null,
                    scipSymbol: null,
                    snippet: "",
                    summary: ""
                }
            ],
            projectRoot: "/tmp/test"
        },
        documentationCatalogs: null,
        isServerMode: true,
        lastFixRun: null,
        loadedTarget: {
            activePath: "/tmp/test/project.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: [],
            source: "working-directory"
        },
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Test GMLoop"
    };
}

function createEmptyGraphModel(): GraphVisualizationUiModel {
    return {
        autoGamePipeline: null,
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/test"
        },
        documentationCatalogs: null,
        isServerMode: true,
        lastFixRun: null,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Test GMLoop"
    };
}

function createMockState(activePage: GraphVisualizationUiState["activePage"]): GraphVisualizationUiState {
    return {
        ...createInitialGraphVisualizationUiState(),
        activeConfigView: "rendered",
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage,
        labelMode: "auto",
        searchQuery: "enemy"
    };
}

void test("app header renders grouped identity, actions, and loaded target sections", () => {
    const header = new TestableGmAppHeader();
    header.model = createMockModel();
    header.state = createMockState("graph");

    const rendered = renderTemplateValue(header.renderForTest());

    assert.match(rendered, /class="header-primary"/u);
    assert.match(rendered, /class="header-identity-row"/u);
    assert.match(rendered, /class="header-actions"/u);
    assert.match(rendered, /class="header-navigation-row"/u);
    assert.match(rendered, /class="loaded-target-actions"/u);
    assert.equal(Array.from(rendered.matchAll(/id="open-project"/gu)).length, 1);
    assert.match(rendered, /id="open-project"[\s\S]*class="open-button"/u);
    assert.match(rendered, /Open \.yyp\.\.\./u);
    assert.match(rendered, /id="manual-link"[\s\S]*href="https:\/\/manual\.gamemaker\.io\/"/u);
    assert.match(rendered, /id="manual-link"[\s\S]*class="header-icon-link"/u);
    assert.match(rendered, /id="github-link"[\s\S]*class="header-icon-link"/u);
    assert.doesNotMatch(rendered, /class="loaded-path-label"/u);
    assert.doesNotMatch(rendered, /MCP Not Started/u);
    assert.doesNotMatch(rendered, /mcp-status-badge/u);
    assert.doesNotMatch(rendered, /id="loaded-source"/u);
    assert.doesNotMatch(rendered, /id="loaded-selected"/u);
    assert.match(rendered, /id="tab-auto-game"/u);
});

void test("app header shows the selected project path while project loading is in progress", () => {
    const header = new TestableGmAppHeader();
    header.model = {
        ...createMockModel(),
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: ""
        },
        loadedTarget: {
            activePath: "/tmp/loading-project/Project.yyp",
            projectRoot: "/tmp/loading-project",
            selectedPaths: ["/tmp/loading-project"],
            source: "finder-open"
        },
        startupState: {
            detail: null,
            message: "Loading project data…",
            phase: "loading"
        }
    };
    header.state = createMockState("graph");

    const rendered = renderTemplateValue(header.renderForTest());

    assert.match(rendered, /id="loaded-target"[^>]*aria-busy=true/u);
    assert.match(rendered, /loaded-path-value[\s\S]*\/tmp\/loading-project\/Project\.yyp/u);
    assert.match(rendered, /class="loading-spinner loaded-path-spinner"/u);
});

void test("Auto-Game toolbar renders page status in the single shared page toolbar", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel();
    toolbar.state = createMockState("auto-game");

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /class="toolbar-heading-row"/u);
    assert.match(rendered, /id="toolbar-heading"[\s\S]*Auto-Game/u);
    assert.match(rendered, /id="toolbar-subheading"[\s\S]*Run autonomous game-development/u);
    assert.match(rendered, /<gm-status-chip[\s\S]*\.status=not-running[\s\S]*><\/gm-status-chip>/u);
    assert.doesNotMatch(rendered, /mcp-runtime-status-chip/u);
});

void test("Live Reload toolbar owns page title, status, subtitle, and controls", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = {
        ...createMockModel(),
        liveReload: null
    };
    toolbar.state = createMockState("live-reload");

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /id="toolbar-heading"[\s\S]*Live Reload/u);
    assert.match(rendered, /id="toolbar-subheading"[\s\S]*Start live reload to launch the watcher/u);
    assert.match(rendered, /<gm-status-chip[\s\S]*\.status=not-running[\s\S]*><\/gm-status-chip>/u);
    assert.match(rendered, /id="live-reload-controls"[\s\S]*id="start-live-reload"/u);
    assert.match(rendered, /id="live-reload-controls"[\s\S]*id="stop-live-reload"/u);
});

void test("Fix toolbar renders combined and individual project workflow buttons", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel();
    toolbar.state = createMockState("fix");

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /id=run-fix[\s\S]*Fix/u);
    assert.match(rendered, /id=run-format[\s\S]*Format/u);
    assert.match(rendered, /id=run-refactor[\s\S]*Refactor \/ Codemods/u);
    assert.match(rendered, /id=run-lint[\s\S]*Lint/u);
});

void test("Fix toolbar identifies the active workflow and disables concurrent project writes", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel();
    toolbar.state = {
        ...createMockState("fix"),
        fixWorkflow: "format",
        isFixPending: true
    };

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /id=run-format[\s\S]*\?disabled=true[\s\S]*aria-busy=true[\s\S]*Format/u);
    assert.equal(Array.from(rendered.matchAll(/\?disabled=true/gu)).length, 4);
    assert.equal(Array.from(rendered.matchAll(/button-spinner/gu)).length, 1);
});

void test("Fix toolbar keeps its workflow buttons visible but disabled while a project is still opening", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = {
        ...createMockModel(),
        startupState: {
            detail: null,
            message: "Loading project data…",
            phase: "loading"
        }
    };
    toolbar.state = createMockState("fix");

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /id=run-fix[\s\S]*Fix/u);
    assert.match(rendered, /id=run-format[\s\S]*Format/u);
    assert.match(rendered, /id=run-refactor[\s\S]*Refactor \/ Codemods/u);
    assert.match(rendered, /id=run-lint[\s\S]*Lint/u);
    const fixControlsMatch = /toolbar-fix-controls">(?<body>[\s\S]*?)<\/div>\s*<\/div>/u.exec(rendered);
    assert.ok(fixControlsMatch?.groups, "expected to find the fix controls group in the rendered toolbar");
    assert.equal(Array.from(fixControlsMatch.groups.body.matchAll(/\?disabled=true/gu)).length, 4);
});

void test("Fix toolbar enables its workflow buttons once the project finishes opening", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel();
    toolbar.state = createMockState("fix");

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /id=run-fix[\s\S]*Fix/u);
    const fixControlsMatch = /toolbar-fix-controls">(?<body>[\s\S]*?)<\/div>\s*<\/div>/u.exec(rendered);
    assert.ok(fixControlsMatch?.groups, "expected to find the fix controls group in the rendered toolbar");
    assert.equal(Array.from(fixControlsMatch.groups.body.matchAll(/\?disabled=true/gu)).length, 0);
});

void test("Docs toolbar owns catalog search and subcategory controls", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel();
    toolbar.state = createMockState("docs");

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /id="toolbar-heading"[\s\S]*Docs/u);
    assert.match(rendered, /id="toolbar-subheading"[\s\S]*CLI: Command help is not available right now\./u);
    assert.match(rendered, /role="search" aria-label="Filter documentation catalog"/u);
    assert.match(rendered, /id="docs-search-input"[\s\S]*aria-describedby="toolbar-subheading docs-search-summary"/u);
    assert.match(
        rendered,
        /<div class="gm-view-selector toolbar-docs-subtabs" role="tablist" aria-label="Documentation view selector">/u
    );
    assert.match(
        rendered,
        /id=docs-view-cli[\s\S]*class=gm-btn--chip active[\s\S]*role="tab"[\s\S]*aria-selected=true[\s\S]*aria-controls=cli-page[\s\S]*tabindex=0/u
    );
    assert.match(rendered, /id=docs-view-mcp[\s\S]*aria-controls=docs-mcp-page/u);
    assert.match(rendered, /id=docs-view-linting[\s\S]*aria-controls=linting-page/u);
    assert.match(rendered, /id=docs-view-formatting[\s\S]*aria-controls=formatting-page/u);
    assert.match(rendered, /id=docs-view-codemods[\s\S]*aria-controls=codemods-page/u);
});

void test("graph toolbar renders grouped controls for search, view state, and actions", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel();
    toolbar.state = createMockState("graph");

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /class="toolbar-control-group toolbar-search-group"/u);
    assert.match(rendered, /id="toggle-view"[\s\S]*class="gm-btn--chip"/u);
    assert.match(rendered, /id="toggle-labels"[\s\S]*class="gm-btn--chip"/u);
    assert.match(rendered, /id="reset-default"[\s\S]*class="gm-btn--chip"/u);
    assert.match(rendered, /id="regenerate"[\s\S]*class="gm-btn--chip"/u);
});

void test("graph index header tab remains enabled even when no graph index is loaded", () => {
    const header = new TestableGmAppHeader();
    header.model = createEmptyGraphModel();
    header.state = createMockState("docs");

    const rendered = renderTemplateValue(header.renderForTest());

    assert.doesNotMatch(rendered, /id="tab-graph"[^>]*disabled/u);
});

void test("graph toolbar disables graph controls and regenerate without a loaded graph target", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createEmptyGraphModel();
    toolbar.state = createMockState("graph");

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /id="search"[\s\S]*disabled/u);
    assert.match(rendered, /id="toggle-view"[\s\S]*disabled/u);
    assert.match(rendered, /id="toggle-labels"[\s\S]*disabled/u);
    assert.match(rendered, /id="reset-default"[\s\S]*disabled/u);
    assert.match(rendered, /id="regenerate"[\s\S]*disabled/u);
});

void test("playground panel renders controls layout and readable pane status labels", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState("playground");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /class=playground-layout controls-open/u);
    assert.match(rendered, /class="playground-controls-panel is-open"/u);
    assert.match(rendered, /class="playground-main"/u);
    assert.match(rendered, /class="pane-header-status">Writable<\/span>/u);
    assert.match(rendered, /class="pane-header-status">Read-only<\/span>/u);
    assert.doesNotMatch(rendered, /style="/u);
});

void test("playground panel source uses class-based error rendering instead of inline styles", () => {
    const source = readFileSync(new URL("../../src/app/components/gm-playground-panel.ts", import.meta.url), "utf8");

    assert.match(source, /class="playground-output is-error"/u);
    assert.doesNotMatch(source, /style="color: #ff8080/u);
});

void test("toolbar stylesheet keeps graph toolbar controls in a full-width horizontal flow", () => {
    const source = readFileSync(new URL("../../src/web/styles/toolbar.css", import.meta.url), "utf8");

    assert.match(source, /\.page-toolbar\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/u);
    assert.match(source, /\.page-toolbar\s*\{[\s\S]*gap:\s*var\(--gm-space-md\);/u);
    assert.match(source, /\.page-toolbar\s*\{[\s\S]*margin:\s*var\(--gm-space-lg\)\s+var\(--gm-space-xl\)\s+0;/u);
    assert.match(
        source,
        /\.toolbar-controls\s*\{[\s\S]*gap:\s*var\(--gm-space-xl\);[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*flex-start;[\s\S]*width:\s*100%;/u
    );
    assert.match(source, /\.toolbar-heading-row\s*\{[\s\S]*gap:\s*var\(--gm-space-xl\);/u);
    assert.match(source, /\.toolbar-control-group\s*\{[\s\S]*gap:\s*var\(--gm-space-md\);/u);
    assert.match(source, /\.toolbar-control-group\s*\{[\s\S]*flex-wrap:\s*nowrap;/u);
    assert.match(source, /\.toolbar-search-group\s*\{[\s\S]*flex:\s*1 1 220px;[\s\S]*max-width:\s*360px;/u);
});

void test("spacing tokens define shared page and toolbar rhythm", () => {
    const tokensSource = readFileSync(new URL("../../src/web/styles/tokens.css", import.meta.url), "utf8");
    const layoutSource = readFileSync(new URL("../../src/web/styles/layout.css", import.meta.url), "utf8");
    const responsiveSource = readFileSync(new URL("../../src/web/styles/responsive.css", import.meta.url), "utf8");

    assert.match(tokensSource, /--gm-space-xs:\s*4px;/u);
    assert.match(tokensSource, /--gm-space-sm:\s*8px;/u);
    assert.match(tokensSource, /--gm-space-md:\s*12px;/u);
    assert.match(tokensSource, /--gm-space-lg:\s*16px;/u);
    assert.match(tokensSource, /--gm-space-xl:\s*24px;/u);
    assert.match(
        layoutSource,
        /main\s*\{[\s\S]*padding:\s*var\(--gm-space-lg\)\s+var\(--gm-space-xl\)\s+var\(--gm-space-xl\);/u
    );
    assert.match(
        responsiveSource,
        /main\s*\{[\s\S]*padding:\s*var\(--gm-space-lg\)\s+var\(--gm-space-lg\)\s+var\(--gm-space-lg\);/u
    );
    assert.match(
        responsiveSource,
        /\.toolbar-search-group,[\s\S]*\.toolbar-docs-search,[\s\S]*\.toolbar-docs-controls\s*\{[\s\S]*width:\s*100%;/u
    );
    assert.match(
        responsiveSource,
        /\.toolbar-heading-row\s+\.toolbar-docs-search,[\s\S]*\.toolbar-docs-controls\s*\{[\s\S]*flex:\s*0 1 auto;[\s\S]*max-width:\s*none;/u
    );
});

void test("shared view selector keeps inactive tabs visually unoutlined", () => {
    const source = readFileSync(new URL("../../src/web/styles/components.css", import.meta.url), "utf8");

    assert.match(source, /\.gm-view-selector\s*>\s*\.gm-btn--chip\s*\{[\s\S]*border-color:\s*transparent;/u);
    assert.match(source, /\.gm-view-selector\s*>\s*\.gm-btn--chip\s*\{[\s\S]*background:\s*transparent;/u);
    assert.match(
        source,
        /\.gm-view-selector\s*>\s*\.gm-btn--chip\.active,[\s\S]*\.gm-view-selector\s*>\s*\.gm-btn--chip\[aria-pressed="true"\]\s*\{[\s\S]*border-color:\s*transparent;/u
    );
});

void test("docs stylesheet defines a constrained documentation browser layout", () => {
    const source = readFileSync(new URL("../../src/web/styles/docs.css", import.meta.url), "utf8");

    assert.doesNotMatch(source, /auto-fit/u);
    assert.match(source, /\.docs-layout\s*\{[\s\S]*grid-template-areas:\s*"main";/u);
    assert.match(source, /\.docs-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/u);
    assert.doesNotMatch(source, /\.docs-nav\s*\{/u);
    assert.doesNotMatch(source, /\.docs-sidebar\s*\{/u);
    assert.match(source, /\.docs-reference-entry\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/u);
    assert.match(source, /\.docs-usage-shell\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/u);
    assert.match(source, /\.docs-usage-copy-button\s+\.gm-copy-button\s*\{[\s\S]*min-width:\s*var\(--gm-height-sm\);/u);
    assert.match(source, /\.docs-usage-copy-button\s+\.gm-copy-button__label\s*\{[\s\S]*clip-path:\s*inset\(50%\);/u);
    assert.match(source, /\.docs-search-summary:empty\s*\{[\s\S]*display:\s*none;/u);
    assert.match(
        source,
        /@media\s*\(max-width:\s*920px\)\s*\{[\s\S]*?\.toolbar-heading-row\s+\.toolbar-docs-search\s*\{[\s\S]*flex:\s*0 1 auto;[\s\S]*max-width:\s*none;/u
    );
    assert.match(source, /\.docs-detail-container\s*\{[\s\S]*border:\s*1px solid var\(--gm-border-subtle\);/u);
    assert.match(source, /\.docs-detail-container summary\s*\{[\s\S]*min-height:\s*var\(--gm-height-sm\);/u);
    assert.match(
        source,
        /\.docs-detail-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(156px,\s*220px\)\s+minmax\(0,\s*1fr\);/u
    );
    assert.match(
        source,
        /@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*?\.docs-reference-entry\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/u
    );
});

void test("disabled button styles preserve the disabled cursor on hover", () => {
    const componentsSource = readFileSync(new URL("../../src/web/styles/components.css", import.meta.url), "utf8");
    const liveReloadSource = readFileSync(new URL("../../src/web/styles/live-reload.css", import.meta.url), "utf8");

    assert.match(componentsSource, /\.gm-btn:hover:not\(:disabled\),/u);
    assert.match(componentsSource, /button:not\(\[class\]\):hover:not\(:disabled\)/u);
    assert.match(componentsSource, /\.gm-btn--chip:hover:not\(:disabled\)/u);
    assert.match(componentsSource, /\.gm-btn--nav:hover:not\(:disabled\)/u);
    assert.match(
        componentsSource,
        /\.gm-btn:disabled,[\s\S]*button:not\(\[class\]\):disabled\s*\{[\s\S]*cursor:\s*not-allowed;[\s\S]*\}/u
    );
    assert.doesNotMatch(
        componentsSource,
        /\.gm-btn:disabled,[\s\S]*button:not\(\[class\]\):disabled\s*\{[^}]*pointer-events:\s*none;/u
    );
    assert.doesNotMatch(componentsSource, /\.gm-btn--chip:disabled\s*\{[^}]*pointer-events:\s*none;/u);
    assert.doesNotMatch(componentsSource, /\.gm-btn--nav:disabled\s*\{[^}]*pointer-events:\s*none;/u);
    assert.doesNotMatch(liveReloadSource, /\.live-reload-btn:disabled\s*\{[^}]*pointer-events:\s*none;/u);
});

void test("page styles keep every top-level page on the shared lighter content background", () => {
    const graphSource = readFileSync(new URL("../../src/web/styles/graph.css", import.meta.url), "utf8");
    const playgroundSource = readFileSync(new URL("../../src/web/styles/playground.css", import.meta.url), "utf8");
    const panelSources = [
        "../../src/app/components/gm-config-panel.ts",
        "../../src/app/components/gm-docs-panel.ts",
        "../../src/app/components/gm-fix-panel.ts",
        "../../src/app/components/gm-graph-panel.ts",
        "../../src/app/components/gm-live-reload-panel.ts",
        "../../src/app/components/gm-auto-game-panel.ts",
        "../../src/app/components/gm-playground-panel.ts"
    ].map((sourcePath) => readFileSync(new URL(sourcePath, import.meta.url), "utf8"));

    assert.match(graphSource, /#graph-page\s*\{[\s\S]*background:\s*var\(--gm-bg-muted\);/u);
    assert.match(playgroundSource, /#playground-page\s*\{[\s\S]*background:\s*var\(--gm-bg-muted\);/u);
    assert.doesNotMatch(graphSource, /background:\s*linear-gradient\(180deg,\s*rgba\(8,\s*14,\s*24/u);
    assert.doesNotMatch(playgroundSource, /background:\s*linear-gradient\(180deg,\s*rgba\(8,\s*14,\s*24/u);
    assert.equal(
        panelSources.every((source) => source.includes("page content-page")),
        true
    );
});
