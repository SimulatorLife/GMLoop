import assert from "node:assert/strict";
import test from "node:test";

import { GmConfigPanel } from "../src/app/components/gm-config-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { createButtonAriaPressedPattern, renderTemplateValue } from "./render-template-helpers.js";

class TestableGmConfigPanel extends GmConfigPanel {
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
            format: {
                entries: [
                    {
                        description: "Preferred line width.",
                        name: "printWidth",
                        source: "configured",
                        value: 100
                    }
                ]
            },
            githubRepositoryUrl: "https://github.com/SimulatorLife/GMLoop",
            gmloop: {
                configPath: "/tmp/test/gmloop.json",
                exists: true,
                projectRoot: "/tmp/test",
                rawConfig: {
                    lintRuleset: "recommended",
                    printWidth: 100
                }
            },
            lint: {
                rules: [
                    {
                        description: "Disallow legacy globalvar declarations.",
                        fixable: null,
                        level: "warn",
                        options: {},
                        ruleId: "gml/no-globalvar"
                    }
                ],
                ruleset: "recommended"
            },
            refactor: {
                codemods: [
                    {
                        config: {},
                        description: "Hoist loop length lookups.",
                        enabled: true,
                        id: "loopLengthHoisting",
                        requiresSemanticProjectIndex: false
                    }
                ]
            }
        },
        title: "Config Panel"
    };
}

function createMockState(): GraphVisualizationUiState {
    return {
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "config",
        errorMessage: null,
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

void test("config panel defaults to rendered view and exposes a rendered/raw toggle", () => {
    const panel = new TestableGmConfigPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="config-view-rendered"/u);
    assert.match(rendered, /id="config-view-raw"/u);
    assert.match(rendered, createButtonAriaPressedPattern("config-view-rendered", true));
    assert.match(rendered, createButtonAriaPressedPattern("config-view-raw", false));
    assert.match(rendered, /Project Metadata/u);
    assert.match(rendered, /Lint Rules/u);
    assert.match(rendered, /Refactor Codemods/u);
    assert.doesNotMatch(rendered, /class="config-raw"/u);
});
