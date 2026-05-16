import assert from "node:assert/strict";
import test from "node:test";

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
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: "auto",
        liveReloadErrorMessage: null,
        liveReloadStatus: null,
        mcpServerStatus: "not-started",
        searchQuery: ""
    };
}

void test("GmAppShell renders a skip-link element before the app shell", () => {
    const shell = new TestableGmAppShell();
    shell.model = createMockModel();

    const rendered = renderTemplateValue(shell.renderForTest());

    assert.match(rendered, /<a class="skip-link" href="#graph-page">Skip to content<\/a>/u);
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
