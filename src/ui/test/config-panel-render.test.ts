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
            gameMakerCli: {
                available: true,
                cliCommands: [
                    {
                        commandPath: ["manual", "read"],
                        description: "Query the GameMaker manual",
                        displayName: "manual read",
                        parameters: [
                            {
                                choices: [],
                                description: "Query",
                                kind: "argument",
                                multiple: false,
                                name: "query",
                                required: true,
                                syntax: "query",
                                valueType: "string"
                            }
                        ],
                        usageLines: ["gm-cli manual read <query>"]
                    }
                ],
                error: null,
                invocation: "npx @gamemaker/gm-cli@latest",
                mcpServer: {
                    available: true,
                    error: null,
                    name: "ResourceTool",
                    projectPath: "/tmp/test/Game.yyp",
                    serverId: "gamemaker-resource-tool",
                    sourcePath: "/tmp/test/.mcp.json",
                    version: "2024.14.15"
                },
                mcpTools: [
                    {
                        description: "Checks the Status of the current Project",
                        fields: [],
                        name: "status"
                    }
                ],
                version: "1.3.0"
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
                        fixable: "code",
                        level: "warn",
                        options: {},
                        ruleId: "gml/no-globalvar"
                    },
                    {
                        description: "Require matching regions.",
                        fixable: null,
                        level: "error",
                        options: {},
                        ruleId: "gml/require-region-pairs"
                    }
                ],
                rulesets: [
                    {
                        name: "recommended",
                        ruleIds: ["gml/no-globalvar", "gml/require-region-pairs"]
                    },
                    {
                        name: "performance",
                        ruleIds: ["gml/no-globalvar"]
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
        startupState: null,
        title: "Config Panel"
    };
}

function createMockState(): GraphVisualizationUiState {
    return {
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "config",
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

void test("config panel defaults to rendered view and exposes a rendered/raw toggle", () => {
    const panel = new TestableGmConfigPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="config-view-rendered"/u);
    assert.match(rendered, /id="config-view-raw"/u);
    assert.match(rendered, /class="config-view-selector view-selector"/u);
    assert.match(rendered, /class="?view-option active"?/u);
    assert.match(rendered, createButtonAriaPressedPattern("config-view-rendered", true));
    assert.match(rendered, createButtonAriaPressedPattern("config-view-raw", false));
    assert.match(rendered, /Project Root:?/iu);
    assert.match(rendered, /Config Path:?/iu);
    assert.match(rendered, /Format \(1\)/u);
    assert.match(rendered, /Lint \(2\)/u);
    assert.match(rendered, /Refactor \(1\)/u);
    assert.match(rendered, /GameMaker CLI \(1\)/u);
    assert.match(rendered, /GameMaker MCP \(1\)/u);
    assert.match(rendered, /manual read/u);
    assert.match(rendered, /ResourceTool v2024\.14\.15/u);
    assert.match(rendered, /configured MCP server "gamemaker-resource-tool"/u);
    assert.match(rendered, /All Rules/u);
    assert.match(rendered, /All Levels/u);
    assert.match(rendered, /class="?config-severity-badge warn"?/u);
    assert.match(rendered, /class="?config-severity-badge error"?/u);
    assert.match(rendered, /<gm-badge[^>]*\.label=fixable/u);
    assert.doesNotMatch(rendered, /fixable:code/u);
    assert.doesNotMatch(rendered, /class="config-raw"/u);
});
