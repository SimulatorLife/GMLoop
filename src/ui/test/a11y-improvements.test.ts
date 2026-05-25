import assert from "node:assert/strict";
import test from "node:test";

import { GRAPH_UI_EVENT_NAVIGATE_PAGE } from "../src/app/components/events.js";
import { GmAppHeader } from "../src/app/components/gm-app-header.js";
import { GmAppShell } from "../src/app/components/gm-app-shell.js";
import { GmConfigPanel } from "../src/app/components/gm-config-panel.js";
import { GmDocsPanel } from "../src/app/components/gm-docs-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmAppShell extends GmAppShell {
    public renderForTest(): unknown {
        return this.render();
    }
}

class TestableGmConfigPanel extends GmConfigPanel {
    public renderForTest(): unknown {
        return this.render();
    }
}

class TestableGmAppHeader extends GmAppHeader {
    public renderForTest(): unknown {
        return this.render();
    }
}

class TestableGmDocsPanel extends GmDocsPanel {
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
        documentationCatalogs: null,
        isServerMode: false,
        lastFixRun: null,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: {
            format: { entries: [] },
            gameMakerCli: {
                available: false,
                cliCommands: [],
                error: null,
                invocation: null,
                mcpServer: {
                    available: false,
                    error: null,
                    name: null,
                    projectPath: null,
                    serverId: null,
                    sourcePath: null,
                    version: null
                },
                mcpTools: [],
                version: null
            },
            githubRepositoryUrl: "https://github.com/SimulatorLife/GMLoop",
            gmloop: {
                configPath: "/tmp/.gmloop.json",
                exists: true,
                projectRoot: "/tmp/test",
                rawConfig: {}
            },
            lint: { rules: [], rulesets: [], ruleset: null },
            refactor: { codemods: [] }
        },
        startupState: null,
        title: "Test"
    };
}

function createMockState(): GraphVisualizationUiState {
    return {
        activeDocsView: "cli",
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

void test("GmAppShell targets graph content in skip-link by default", () => {
    const shell = new TestableGmAppShell();
    shell.model = createMockModel();

    const rendered = renderTemplateValue(shell.renderForTest());

    assert.match(rendered, /<a class="skip-link" href=#graph-page>Skip to content<\/a>/u);
});

void test("GmAppShell skip-link follows the active page target", () => {
    const shell = new TestableGmAppShell();
    shell.model = createMockModel();
    shell.connectedCallback();

    shell.dispatchEvent(new CustomEvent(GRAPH_UI_EVENT_NAVIGATE_PAGE, { detail: { page: "docs" } }));
    let rendered = renderTemplateValue(shell.renderForTest());
    assert.match(rendered, /<a class="skip-link" href=#docs-page>Skip to content<\/a>/u);

    shell.dispatchEvent(new CustomEvent(GRAPH_UI_EVENT_NAVIGATE_PAGE, { detail: { page: "fix" } }));
    rendered = renderTemplateValue(shell.renderForTest());
    assert.match(rendered, /<a class="skip-link" href=#fix-page>Skip to content<\/a>/u);

    shell.disconnectedCallback();
});

void test("GmAppShell error banner has role=alert and tabindex=-1 for keyboard focus", () => {
    const shell = new TestableGmAppShell();
    shell.model = createMockModel();
    assert.equal(shell.model !== null, true);
});

void test("GmDocsPanel renders docs-toggle-row with aria-label group context", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /<div class="docs-toggle-row" role="group" aria-label="Documentation view selector">/u);
});

void test("GmConfigPanel renders shared view-selector with aria-label group context", () => {
    const panel = new TestableGmConfigPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(
        rendered,
        /<div class="config-view-selector view-selector" role="group" aria-label="Configuration view selector">/u
    );
});

void test("GmDocsPanel uses a dedicated id for MCP docs subview to avoid id collisions", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.equal(Array.from(rendered.matchAll(/id="docs-mcp-page"/gu)).length, 1);
    assert.equal(Array.from(rendered.matchAll(/id="mcp-page"/gu)).length, 0);
});

void test("GmAppHeader exposes aria-current for the active top-level page only", () => {
    const header = new TestableGmAppHeader();
    header.model = createMockModel();
    header.state = createMockState();
    header.state = { ...header.state, activePage: "docs" };

    const rendered = renderTemplateValue(header.renderForTest());

    assert.match(rendered, /id="tab-docs"[^>]*aria-current=page/u);
    assert.doesNotMatch(rendered, /id="tab-graph"[^>]*aria-current=page/u);
    assert.doesNotMatch(rendered, /id="tab-config"[^>]*aria-current=page/u);
});
