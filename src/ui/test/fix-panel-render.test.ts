import assert from "node:assert/strict";
import test from "node:test";

import { GmFixPanel } from "../src/app/components/gm-fix-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmFixPanel extends GmFixPanel {
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
        isServerMode: true,
        lastFixRun: null,
        loadedTarget: {
            activePath: "/tmp/test",
            projectRoot: "/tmp/test",
            selectedPaths: [],
            source: "working-directory"
        },
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Fix Panel"
    };
}

function createMockState(): GraphVisualizationUiState {
    return {
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "fix",
        errorMessage: null,
        fixErrorMessage: null,
        fixLogLines: ["[1/3 Refactor Codemods]", "[2/3 Lint Fixes]", "[3/3 Format]"],
        fixStatus: "success",
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

void test("GmFixPanel renders the fix workflow button, stages, status, target, and log", () => {
    const panel = new TestableGmFixPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="fix-page"[\s\S]*class=page docs-page active/u);
    assert.match(rendered, /Apply Project Fixes/u);
    assert.match(rendered, /id="run-fix"/u);
    assert.match(rendered, /Completed/u);
    assert.match(rendered, /1\. Refactor/u);
    assert.match(rendered, /2\. Lint/u);
    assert.match(rendered, /3\. Format/u);
    assert.match(rendered, /\[1\/3 Refactor Codemods\]/u);
    assert.match(rendered, /\/tmp\/test/u);
});

void test("GmFixPanel renders the last server-side fix run after UI reload clears session state", () => {
    const panel = new TestableGmFixPanel();
    panel.model = {
        ...createMockModel(),
        lastFixRun: {
            logLines: ["Project root: /tmp/test", "Success!"],
            projectRoot: "/tmp/test",
            status: "success"
        }
    };
    panel.state = {
        ...createMockState(),
        fixLogLines: [],
        fixStatus: "idle"
    };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Completed/u);
    assert.match(rendered, /Project root: \/tmp\/test/u);
    assert.match(rendered, /Success!/u);
    assert.doesNotMatch(rendered, /No fix run has been started/u);
});

void test("GmFixPanel ignores a server-side fix run from a different project", () => {
    const panel = new TestableGmFixPanel();
    panel.model = {
        ...createMockModel(),
        lastFixRun: {
            logLines: ["Previous project fix log"],
            projectRoot: "/tmp/previous",
            status: "success"
        }
    };
    panel.state = {
        ...createMockState(),
        fixLogLines: [],
        fixStatus: "idle"
    };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Ready/u);
    assert.match(rendered, /No fix run has been started from this UI session\./u);
    assert.doesNotMatch(rendered, /Previous project fix log/u);
});

void test("GmFixPanel disables the run button when no project is loaded", () => {
    const panel = new TestableGmFixPanel();
    panel.model = {
        ...createMockModel(),
        loadedTarget: null
    };
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="run-fix"[\s\S]*disabled/u);
    assert.match(rendered, /Open a project before running fixes\./u);
});
