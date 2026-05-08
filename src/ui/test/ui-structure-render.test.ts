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
                    graphId: "project",
                    id: "node-1",
                    kind: "object",
                    name: "obj_player",
                    snippet: "",
                    summary: ""
                }
            ],
            projectRoot: "/tmp/test"
        },
        documentationCatalogs: null,
        isServerMode: true,
        loadedTarget: {
            activePath: "/tmp/test/project.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: [],
            source: "working-directory"
        },
        projectConfigurationCatalog: null,
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
        loadedTarget: null,
        projectConfigurationCatalog: null,
        title: "Test GMLoop"
    };
}

function createMockState(activePage: GraphVisualizationUiState["activePage"]): GraphVisualizationUiState {
    return {
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage,
        errorMessage: null,
        isOpenProjectPending: false,
        isRegeneratePending: false,
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
    assert.match(rendered, /class="loaded-path-label">Active<\/span>/u);
    assert.match(rendered, /class="loaded-path-label">Selected<\/span>/u);
    assert.match(rendered, /loaded-path-value is-empty/u);
});

void test("graph toolbar renders grouped controls for search, view state, and actions", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel();
    toolbar.state = createMockState("graph");

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /class="toolbar-control-group toolbar-search-group"/u);
    assert.match(rendered, /id="toggle-view"[\s\S]*class="toolbar-chip-button"/u);
    assert.match(rendered, /id="toggle-labels"[\s\S]*class="toolbar-chip-button"/u);
    assert.match(rendered, /id="reset-default"[\s\S]*class="toolbar-chip-button"/u);
    assert.match(rendered, /id="regenerate"[\s\S]*class="toolbar-chip-button"/u);
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

void test("playground panel renders structural spacer and readable pane status labels", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState("playground");

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /class="playground-toolbar-spacer"/u);
    assert.match(rendered, /class="pane-header-status">Writable<\/span>/u);
    assert.match(rendered, /class="pane-header-status">Read-only<\/span>/u);
    assert.doesNotMatch(rendered, /style="/u);
});

void test("playground panel source uses class-based error rendering instead of inline styles", () => {
    const source = readFileSync(new URL("../../src/app/components/gm-playground-panel.ts", import.meta.url), "utf8");

    assert.match(source, /class="playground-output is-error"/u);
    assert.doesNotMatch(source, /style="color: #ff8080/u);
});
