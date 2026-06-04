import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GmAppHeader } from "../src/app/components/gm-app-header.js";
import { GmGraphToolbar } from "../src/app/components/gm-graph-toolbar.js";
import { GmPlaygroundPanel } from "../src/app/components/gm-playground-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
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
        activeConfigView: "rendered",
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage,
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
        mcpServerStatus: "not-started",
        pendingActionCount: 0,
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
    assert.match(rendered, /id="manual-link"[\s\S]*href="https:\/\/manual\.gamemaker\.io\/"/u);
    assert.match(rendered, /id="manual-link"[\s\S]*class="header-icon-link"/u);
    assert.match(rendered, /id="github-link"[\s\S]*class="header-icon-link"/u);
    assert.doesNotMatch(rendered, /class="loaded-path-label"/u);
    assert.doesNotMatch(rendered, /MCP Not Started/u);
    assert.doesNotMatch(rendered, /mcp-status-badge/u);
    assert.doesNotMatch(rendered, /id="loaded-source"/u);
    assert.doesNotMatch(rendered, /id="loaded-selected"/u);
    assert.match(rendered, /id="tab-mcp"/u);
});

void test("MCP toolbar renders page status in the single shared page toolbar", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel();
    toolbar.state = createMockState("mcp");

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /class="toolbar-heading-row"/u);
    assert.match(rendered, /id="toolbar-heading"[\s\S]*MCP/u);
    assert.match(rendered, /id="toolbar-subheading"[\s\S]*The MCP bridge has not started in this session yet\./u);
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

void test("Docs toolbar owns subcategory controls and catalog search", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel();
    toolbar.state = createMockState("docs");

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /id="toolbar-heading"[\s\S]*Docs/u);
    assert.match(rendered, /id="toolbar-subheading"[\s\S]*Command help is not available right now\./u);
    assert.match(rendered, /id="docs-controls"[\s\S]*class="gm-view-selector"/u);
    assert.match(rendered, /id="docs-controls"[\s\S]*id="docs-view-cli"/u);
    assert.match(rendered, /id="docs-controls"[\s\S]*id="docs-view-mcp"/u);
    assert.match(rendered, /id="docs-controls"[\s\S]*id="docs-view-rules"/u);
    assert.match(rendered, /id="docs-view-cli"[\s\S]*class=gm-btn--chip active/u);
    assert.match(rendered, /id="docs-controls"[\s\S]*id="docs-search-input"/u);
    assert.match(rendered, /id="docs-search-input"[\s\S]*aria-describedby="toolbar-subheading docs-search-summary"/u);
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

void test("graph index header tab is disabled when no graph index is loaded", () => {
    const header = new TestableGmAppHeader();
    header.model = createEmptyGraphModel();
    header.state = createMockState("docs");

    const rendered = renderTemplateValue(header.renderForTest());

    assert.match(rendered, /id="tab-graph"[\s\S]*disabled/u);
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
    assert.match(
        source,
        /\.toolbar-controls\s*\{[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*flex-start;[\s\S]*width:\s*100%;/u
    );
    assert.match(source, /\.toolbar-control-group\s*\{[\s\S]*flex-wrap:\s*nowrap;/u);
    assert.match(source, /\.toolbar-search-group\s*\{[\s\S]*flex:\s*1 1 220px;[\s\S]*max-width:\s*360px;/u);
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

void test("page styles keep every top-level page on the shared lighter content background", () => {
    const graphSource = readFileSync(new URL("../../src/web/styles/graph.css", import.meta.url), "utf8");
    const playgroundSource = readFileSync(new URL("../../src/web/styles/playground.css", import.meta.url), "utf8");
    const panelSources = [
        "../../src/app/components/gm-config-panel.ts",
        "../../src/app/components/gm-docs-panel.ts",
        "../../src/app/components/gm-fix-panel.ts",
        "../../src/app/components/gm-graph-panel.ts",
        "../../src/app/components/gm-live-reload-panel.ts",
        "../../src/app/components/gm-mcp-panel.ts",
        "../../src/app/components/gm-playground-panel.ts"
    ].map((sourcePath) => readFileSync(new URL(sourcePath, import.meta.url), "utf8"));

    assert.match(graphSource, /#graph-page\s*\{[\s\S]*background:\s*var\(--gm-bg-light\);/u);
    assert.match(playgroundSource, /#playground-page\s*\{[\s\S]*background:\s*var\(--gm-bg-light\);/u);
    assert.doesNotMatch(graphSource, /background:\s*linear-gradient\(180deg,\s*rgba\(8,\s*14,\s*24/u);
    assert.doesNotMatch(playgroundSource, /background:\s*linear-gradient\(180deg,\s*rgba\(8,\s*14,\s*24/u);
    assert.equal(
        panelSources.every((source) => source.includes("page content-page")),
        true
    );
});
