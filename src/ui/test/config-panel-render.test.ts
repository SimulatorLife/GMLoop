import assert from "node:assert/strict";
import test from "node:test";

import { GmConfigPanel } from "../src/app/components/gm-config-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

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
        lastFixRun: null,
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
        ...createInitialGraphVisualizationUiState(),
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "config",
        activeConfigView: "rendered",
        labelMode: "auto"
    };
}

void test("config panel renders setup banner when project has no config", () => {
    const panel = new TestableGmConfigPanel();
    panel.model = {
        ...createMockModel(),
        projectConfigurationCatalog: {
            ...createMockModel().projectConfigurationCatalog,
            gmloop: {
                configPath: null,
                exists: false,
                projectRoot: "/tmp/test",
                rawConfig: {}
            }
        }
    };
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /class="config-setup-banner"/u);
    assert.match(rendered, /Create Default Config/u);
});

void test("config panel defaults to rendered view and exposes configuration details", () => {
    const panel = new TestableGmConfigPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="config-page"[\s\S]*class=page content-page active/u);
    assert.doesNotMatch(rendered, /Project Root:?/iu);
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
    assert.match(rendered, /class="config-filter-reset"/u);
    assert.match(rendered, /Reset Filters/u);
    assert.match(rendered, /disabled=true/u);
    assert.match(rendered, /class="?config-severity-badge warn"?/u);
    assert.match(rendered, /class="?config-severity-badge error"?/u);
    assert.match(rendered, /<gm-badge[^>]*\.label=fixable/u);
    assert.doesNotMatch(rendered, /fixable:code/u);
    assert.doesNotMatch(rendered, /class="config-raw"/u);
});
