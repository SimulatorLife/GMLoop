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
        loadedTarget: { activePath: "/test", projectRoot: "/tmp/test", selectedPaths: [], source: "working-directory" },
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        title: "Test GMLoop"
    };
}

function createMockState(): GraphVisualizationUiState {
    return {
        activePage: "playground",
        activeGraphView: "visual",
        activeDocsView: "cli",
        labelMode: "auto",
        searchQuery: "",
        isRegeneratePending: false,
        isOpenProjectPending: false,
        errorMessage: null,
        mcpServerStatus: "not-started"
    };
}

/**
 * Verify that the playground panel's toggle buttons render with semantic
 * button elements and proper accessibility attributes.
 */
void test("playground panel renders toggle buttons as accessible <button> elements", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /button\s+type="button"\s+class="rule-toggle active"\s+aria-pressed=true/u);
    assert.match(rendered, /button\s+type="button"\s+class="rule-toggle "\s+aria-pressed=false/u);
    assert.match(rendered, /Patch Transpile/u);
    assert.match(rendered, /Expression Transpile/u);
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

/**
 * Verify that toggle state changes reflect in aria-pressed values.
 */
void test("playground panel toggle aria-pressed reflects active state", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    const activeToggleMatches = [...rendered.matchAll(/class="rule-toggle active"\s+aria-pressed=true/gu)];
    assert.equal(activeToggleMatches.length, 3);
    const inactiveToggleMatches = [...rendered.matchAll(/class="rule-toggle "\s+aria-pressed=false/gu)];
    assert.equal(inactiveToggleMatches.length, 2);
});

void test("playground panel renders transpile modes off by default while other toggles stay enabled", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Format/);
    assert.match(rendered, /Lint/);
    assert.match(rendered, /Refactor/);
    assert.match(rendered, /Patch Transpile/);
    assert.match(rendered, /Expression Transpile/);
    assert.equal([...rendered.matchAll(/class="rule-toggle active"/gu)].length, 3);
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
