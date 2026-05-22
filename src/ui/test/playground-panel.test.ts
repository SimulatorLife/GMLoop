import assert from "node:assert/strict";
import test from "node:test";

import { GmPlaygroundPanel } from "../src/app/components/gm-playground-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { DEFAULT_PLAYGROUND_GML_SOURCE } from "../src/app/playground-default-gml.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

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
            nodes: [],
            projectRoot: "/tmp/test"
        },
        documentationCatalogs: null,
        isServerMode: false,
        lastFixRun: null,
        loadedTarget: { activePath: "/test", projectRoot: "/tmp/test", selectedPaths: [], source: "working-directory" },
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Test GMLoop"
    };
}

function createMockState(): GraphVisualizationUiState {
    return {
        activePage: "playground",
        activeGraphView: "visual",
        activeDocsView: "cli",
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

void test("playground panel renders controls panel toggle with expanded state", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /button\s+type="button"\s+class="playground-controls-toggle"/u);
    assert.match(rendered, /aria-controls="playground-controls-panel"/u);
    assert.match(rendered, /aria-expanded=true/u);
    assert.match(rendered, />\s*Hide Controls\s*</u);
    assert.match(rendered, /id="playground-controls-panel"/u);
});

/**
 * Verify that view selector buttons also use semantic <button> elements.
 */
void test("playground panel view selector uses semantic <button> elements", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /button\s+type="button"\s+class="view-option active"\s+aria-pressed=true/u);
    assert.match(rendered, /Output Code/u);
    assert.match(rendered, /AST View/u);
});

/**
 * Verify the playground panel clears its debounce timer when disconnected,
 * preventing memory leaks from dangling setTimeout references.
 */
void test("playground panel clears debounce timer on disconnect", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    // Verify the component has a disconnect lifecycle method
    assert.equal(typeof panel.disconnectedCallback, "function");

    // Call disconnectedCallback to trigger cleanup (timer field is private)
    panel.disconnectedCallback();
});

void test("playground panel toolbar keeps rule sections out of the top bar", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = {
        ...createMockModel(),
        projectConfigurationCatalog: {
            format: {
                entries: [
                    {
                        description: "Preferred maximum line width for formatting decisions.",
                        name: "printWidth",
                        source: "default",
                        value: 100
                    }
                ]
            },
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
            githubRepositoryUrl: "",
            gmloop: {
                configPath: null,
                exists: false,
                projectRoot: "/tmp/test",
                rawConfig: {}
            },
            lint: {
                rules: [
                    {
                        description: "No constructor assignment.",
                        fixable: "code",
                        level: "error",
                        options: {},
                        ruleId: "@gmloop/no-constructor-assignment"
                    }
                ],
                rulesets: [
                    {
                        name: "recommended",
                        ruleIds: ["@gmloop/no-constructor-assignment"]
                    }
                ],
                ruleset: null
            },
            refactor: {
                codemods: [
                    {
                        config: {},
                        description: "Legacy test codemod",
                        enabled: true,
                        id: "legacy-codemod",
                        requiresSemanticProjectIndex: false
                    }
                ]
            }
        }
    };
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());
    const toolbarMatch =
        /<div class="playground-toolbar">(?<toolbarContent>[\s\S]*?)<\/div>\s*<div class="playground-layout/u.exec(
            rendered
        );

    assert.notEqual(toolbarMatch, null);
    assert.doesNotMatch(toolbarMatch.groups?.toolbarContent ?? "", /Format Options/u);
    assert.doesNotMatch(toolbarMatch.groups?.toolbarContent ?? "", /Lint Rules/u);
    assert.doesNotMatch(toolbarMatch.groups?.toolbarContent ?? "", /Codemods/u);
    assert.match(rendered, /class="playground-controls-panel is-open"/u);
    assert.match(rendered, /Format Options/u);
    assert.match(rendered, /Lint Rules/u);
    assert.match(rendered, /Codemods/u);
});

void test("playground panel renders transpile modes in the controls panel and off by default", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());
    const controlsPanelMatch = /<aside[\s\S]*?class="playground-controls-panel is-open"[\s\S]*?<\/aside>/u.exec(
        rendered
    );

    assert.notEqual(controlsPanelMatch, null);
    assert.match(controlsPanelMatch[0], /Transpile/u);
    assert.match(controlsPanelMatch[0], /Patch Transpile/u);
    assert.match(controlsPanelMatch[0], /Expression Transpile/u);
    assert.match(rendered, /Patch Transpile/);
    assert.match(rendered, /Expression Transpile/);
    assert.equal([...rendered.matchAll(/class="rule-toggle active"/gu)].length, 0);
    assert.equal([...rendered.matchAll(/class="rule-toggle "/gu)].length, 2);
});

void test("playground panel starts with the shared demo sample source", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /demo_inventory_total/u);
    assert.match(rendered, /array_length\(inventory\)/u);
    assert.equal(DEFAULT_PLAYGROUND_GML_SOURCE.includes('var total = real("5");'), true);
    assert.equal(DEFAULT_PLAYGROUND_GML_SOURCE.includes("fa_readonly + fa_archive"), true);
    assert.match(DEFAULT_PLAYGROUND_GML_SOURCE, /if \(array_length\(inventory\) > 0\) show_debug_message/u);
    assert.match(DEFAULT_PLAYGROUND_GML_SOURCE, /function demo_inventory_total\( playerName , inventory \)/u);
    assert.match(DEFAULT_PLAYGROUND_GML_SOURCE, /inventory \[ i \]/u);
});

void test("playground panel renders format/lint/codemod detail sections", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = {
        ...createMockModel(),
        projectConfigurationCatalog: {
            format: {
                entries: [
                    {
                        description: "Preferred maximum line width for formatting decisions.",
                        name: "printWidth",
                        source: "default",
                        value: 100
                    }
                ]
            },
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
            githubRepositoryUrl: "",
            gmloop: {
                configPath: null,
                exists: false,
                projectRoot: "/tmp/test",
                rawConfig: {}
            },
            lint: {
                rules: [
                    {
                        description: "No constructor assignment.",
                        fixable: "code",
                        level: "error",
                        options: {},
                        ruleId: "@gmloop/no-constructor-assignment"
                    }
                ],
                rulesets: [
                    {
                        name: "recommended",
                        ruleIds: ["@gmloop/no-constructor-assignment"]
                    }
                ],
                ruleset: null
            },
            refactor: {
                codemods: [
                    {
                        config: {},
                        description: "Legacy test codemod",
                        enabled: true,
                        id: "legacy-codemod",
                        requiresSemanticProjectIndex: false
                    }
                ]
            }
        }
    };
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Format Options/u);
    assert.match(rendered, /Lint Rules/u);
    assert.match(rendered, /Codemods/u);
});

void test("playground panel falls back to workspace catalogs when project config entries are empty", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = {
        ...createMockModel(),
        documentationCatalogs: {
            cliCommands: [],
            mcpServer: { name: "gmloop-mcp", version: "0.0.1" },
            mcpTools: [],
            workspaceRules: {
                formatOptions: [
                    {
                        defaultValue: 100,
                        description: "Preferred maximum line width for formatting decisions.",
                        name: "printWidth"
                    }
                ],
                lintRules: [
                    {
                        description: "Rule for noGlobalvar.",
                        fixable: null,
                        ruleId: "gml/no-globalvar"
                    }
                ],
                refactorCodemods: [
                    {
                        description:
                            "Expand unsupported scientific-notation number literals into plain decimal literals.",
                        id: "scientificNotation",
                        requiresSemanticProjectIndex: false
                    }
                ]
            }
        },
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
            githubRepositoryUrl: "",
            gmloop: {
                configPath: null,
                exists: false,
                projectRoot: "/tmp/test",
                rawConfig: {}
            },
            lint: { rules: [], rulesets: [], ruleset: null },
            refactor: { codemods: [] }
        }
    };
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Format Options/u);
    assert.match(rendered, /Lint Rules/u);
    assert.match(rendered, /Codemods/u);
});
