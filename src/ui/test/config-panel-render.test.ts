import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { PropertyValues } from "lit";

import { GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, GRAPH_UI_EVENT_SAVE_CONFIG } from "../src/app/components/events.js";
import { GmAppShell } from "../src/app/components/gm-app-shell.js";
import { GmConfigPanel } from "../src/app/components/gm-config-panel.js";
import { GmGraphToolbar } from "../src/app/components/gm-graph-toolbar.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmConfigPanel extends GmConfigPanel {
    public renderForTest(): unknown {
        return this.render();
    }
}

class TestableGmAppShell extends GmAppShell {
    protected override update(_changedProperties: PropertyValues<this>): void {}
}

class TestableGmGraphToolbar extends GmGraphToolbar {
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
                    },
                    {
                        description: "Indent with tabs instead of spaces.",
                        name: "useTabs",
                        source: "default",
                        value: false
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
                        ruleIds: ["gml/no-globalvar", "gml/require-region-pairs"],
                        ruleLevels: { "gml/no-globalvar": "warn", "gml/require-region-pairs": "error" }
                    },
                    {
                        name: "performance",
                        ruleIds: ["gml/no-globalvar"],
                        ruleLevels: { "gml/no-globalvar": "warn" }
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
    assert.doesNotMatch(rendered, /Config Path:?/iu);
    assert.doesNotMatch(rendered, /<dt>Draft<\/dt>/u);
    assert.doesNotMatch(rendered, /Project Root:?/iu);
    assert.doesNotMatch(rendered, /<dt>File<\/dt>/u);
    assert.match(rendered, /id="config-format-heading"[\s\S]*Format/u);
    assert.match(rendered, /id=config-format-useTabs/u);
    assert.match(rendered, /Indent with tabs instead of spaces\./u);
    assert.match(rendered, /id="config-lint-heading"[\s\S]*Lint/u);
    assert.match(rendered, /id="config-refactor-heading"[\s\S]*Refactor/u);
    assert.doesNotMatch(rendered, /id="config-tool-metadata-heading"/u);
    assert.doesNotMatch(rendered, /Tool Metadata/u);
    assert.match(rendered, /All Rules/u);
    assert.match(rendered, /All Levels/u);
    assert.match(rendered, /config-filter-reset/u);
    assert.match(rendered, /Reset Filters/u);
    assert.match(rendered, /disabled=true/u);
    assert.match(rendered, /class="gm-view-selector config-rule-level-selector"/u);
    assert.match(rendered, /class=gm-btn--chip active config-rule-level-warn/u);
    assert.match(rendered, /class=gm-btn--chip active config-rule-level-error/u);
    assert.doesNotMatch(rendered, /config-segmented/u);
    assert.doesNotMatch(rendered, /config-segmented-indicator/u);
    assert.match(rendered, /class="config-rule-title"[\s\S]*class="config-rule-fixable-badge"/u);
    assert.match(rendered, /<gm-badge[^>]*class="config-rule-fixable-badge"[^>]*\.label=fixable/u);
    assert.doesNotMatch(rendered, /fixable:code/u);
    assert.doesNotMatch(rendered, /id="config-raw-json"/u);
    assert.doesNotMatch(rendered, /config-severity-badge/u);
});

void test("config builder sections are collapsible panels and collapsed by default", () => {
    const panel = new TestableGmConfigPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    // Check that Format, Lint, and Refactor sections are rendered as details elements with class config-builder-section
    assert.match(rendered, /<details class="config-builder-section"[^>]*aria-labelledby="config-format-heading"/u);
    assert.match(rendered, /<details class="config-builder-section"[^>]*aria-labelledby="config-lint-heading"/u);
    assert.match(rendered, /<details class="config-builder-section"[^>]*aria-labelledby="config-refactor-heading"/u);

    // Verify they do not have the 'open' attribute (collapsed by default)
    assert.doesNotMatch(rendered, /<details class="config-builder-section"[^>]*\bopen\b/u);
});

void test("config toolbar restores rendered and raw JSON selector", () => {
    // Mock global document.querySelector for this test
    const originalDocument = (globalThis as any).document;
    (globalThis as any).document = {
        querySelector: (selector: string) => {
            if (selector === "gm-config-panel") {
                return {
                    isDraftDirty: false,
                    isDraftValid: true,
                    draftValidationError: null
                };
            }
            return null;
        }
    };

    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel();
    toolbar.state = createMockState();

    const rendered = renderTemplateValue(toolbar.renderForTest());

    // Restore global document
    (globalThis as any).document = originalDocument;

    assert.match(rendered, /id="toolbar-heading"[\s\S]*Config/u);
    assert.match(rendered, /id="toolbar-subheading"[\s\S]*Config path: \/tmp\/test\/gmloop\.json/u);
    assert.match(rendered, /class="gm-view-selector"/u);
    assert.match(rendered, /id="config-view-rendered"/u);
    assert.match(rendered, /id="config-view-raw"/u);
    assert.match(rendered, /Raw JSON/u);

    // Assert Save actions moved to toolbar
    assert.match(rendered, /<gm-badge[^>]*\.label=Saved/u);
    assert.match(rendered, /Save Config/u);
    assert.match(rendered, /Reset Draft/u);
});

void test("config panel renders editable raw JSON view", () => {
    const panel = new TestableGmConfigPanel();
    panel.model = createMockModel();
    panel.state = {
        ...createMockState(),
        activeConfigView: "raw"
    };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="config-raw-json"/u);
    assert.match(rendered, /class="config-raw-textarea"/u);
    assert.match(rendered, /JSON is valid/u);
});

void test("config panel renders a copy button for the raw JSON view", () => {
    const panel = new TestableGmConfigPanel();
    panel.model = createMockModel();
    panel.state = {
        ...createMockState(),
        activeConfigView: "raw"
    };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="copy-config-raw-json"[\s\S]*class="config-raw-copy-button"/u);
    assert.match(rendered, /accessibleLabel="Copy raw config JSON to clipboard"/u);
    assert.match(rendered, /label="Copy JSON"/u);
});

void test("config severity selector uses severity-colored active states", () => {
    const source = readFileSync(new URL("../../src/web/styles/config.css", import.meta.url), "utf8");

    assert.match(
        source,
        /\.config-rule-level-selector\s*>\s*\.config-rule-level-error\[aria-pressed="true"\]\s*\{[\s\S]*background:\s*var\(--gm-error-surface\);/u
    );
    assert.match(
        source,
        /\.config-rule-level-selector\s*>\s*\.config-rule-level-warn\[aria-pressed="true"\]\s*\{[\s\S]*background:\s*var\(--gm-warning-surface\);/u
    );
});

void test("config builder sections have collapse indicator styles", () => {
    const source = readFileSync(new URL("../../src/web/styles/config.css", import.meta.url), "utf8");

    // Verify indicator is defined on summary::before
    assert.match(source, /\.config-builder-section\s+summary::before\s*\{[\s\S]*content:\s*["']▶["'];/u);
    // Verify rotation on open state
    assert.match(
        source,
        /\.config-builder-section\[open\]\s+summary::before\s*\{[\s\S]*transform:\s*rotate\(90deg\);/u
    );
});

void test("app shell routes config save events through the host callback", async () => {
    const shell = new TestableGmAppShell();
    let savedConfig: Readonly<Record<string, unknown>> | null = null;
    shell.model = {
        ...createMockModel(),
        loadedTarget: {
            activePath: "/tmp/test/Game.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: [],
            source: "working-directory"
        }
    };
    shell.callbacks = {
        onOpenProject: () => {},
        onRegenerate: () => {},
        onSaveConfig: (config) => {
            savedConfig = config;
        },
        onRunFix: () => ({ logLines: [], status: "success" }),
        onStartLiveReload: () => null,
        onStopLiveReload: () => {}
    };

    shell.connectedCallback();
    shell.dispatchEvent(
        new CustomEvent(GRAPH_UI_EVENT_SAVE_CONFIG, {
            bubbles: true,
            detail: { config: { lintRuleset: "recommended", printWidth: 100 } }
        })
    );
    await Promise.resolve();
    shell.disconnectedCallback();

    assert.deepEqual(savedConfig, { lintRuleset: "recommended", printWidth: 100 });
});

void test("GmConfigPanel does not override Lit lifecycle hooks for event wiring", () => {
    // The composition refactor moved the gm-error-banner-dismiss listener
    // into an EventBusManager registered through LifecycleParticipantsController.
    // The host must not re-introduce lifecycle overrides that duplicate that
    // wiring. Reading own properties (not the prototype chain) keeps this
    // assertion stable against inherited LitElement hooks.
    const prototype = GmConfigPanel.prototype as unknown as Record<string, unknown>;
    const hasOwn = Object.prototype.hasOwnProperty;

    assert.equal(
        hasOwn.call(prototype, "connectedCallback"),
        false,
        "Expected GmConfigPanel to drop its connectedCallback override."
    );
    assert.equal(
        hasOwn.call(prototype, "disconnectedCallback"),
        false,
        "Expected GmConfigPanel to drop its disconnectedCallback override."
    );
});

void test("GmConfigPanel propagates gm-error-banner-dismiss via composition", () => {
    // With the composition refactor the EventBusManager registered in the
    // constructor owns the gm-error-banner-dismiss subscription. The panel
    // must still translate that dismissal into a GRAPH_UI_EVENT_CLEAR_PAGE_ERROR
    // custom event so the surrounding app shell can clear the config error state.
    // Invoking the inherited LitElement connectedCallback/disconnectedCallback
    // drives the LifecycleParticipantsController in the same way the DOM would.
    const panel = new GmConfigPanel();
    let observedPage: string | null = null;
    const listener = (event: Event): void => {
        const customEvent = event as CustomEvent<{ page: string }>;
        if (customEvent.detail?.page !== undefined) {
            observedPage = customEvent.detail.page;
        }
    };
    panel.addEventListener(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, listener);

    try {
        panel.connectedCallback();
        panel.dispatchEvent(new CustomEvent("gm-error-banner-dismiss", { bubbles: true }));

        assert.equal(observedPage, "config");
    } finally {
        panel.disconnectedCallback();
        panel.removeEventListener(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, listener);
    }
});
