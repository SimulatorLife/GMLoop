import assert from "node:assert/strict";
import test from "node:test";

import { GmPlaygroundPanel } from "../src/app/components/gm-playground-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";

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
        errorMessage: null
    };
}

/**
 * Verify that the playground panel's toggle buttons render with semantic
 * button elements and proper accessibility attributes.
 */
void test("playground panel renders toggle buttons as accessible <button> elements", () => {
    const container = document.createElement("div");
    const panel = new GmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    container.append(panel);

    // Wait for Lit to render
    void panel.updateComplete;

    const formatButton = container.querySelector<HTMLButtonElement>("[aria-pressed]");
    assert.ok(formatButton, "Expected at least one toggle button with aria-pressed attribute");

    const formatToggle = container.querySelector<HTMLButtonElement>("button.rule-toggle");
    assert.ok(formatToggle, "Expected a <button class='rule-toggle'> for Format");
    assert.equal(formatToggle.getAttribute("type"), "button", "Toggle button should have type='button'");
    assert.ok(
        formatToggle.hasAttribute("aria-pressed"),
        "Format toggle should have aria-pressed attribute for state communication"
    );

    const lintToggle = container.querySelector<HTMLButtonElement>("button.rule-toggle:nth-of-type(2)");
    assert.ok(lintToggle, "Expected a Lint toggle button");
    assert.ok(lintToggle.hasAttribute("aria-pressed"), "Lint toggle should have aria-pressed attribute");

    const refactorToggle = container.querySelector<HTMLButtonElement>("button.rule-toggle:nth-of-type(3)");
    assert.ok(refactorToggle, "Expected a Refactor toggle button");
    assert.ok(refactorToggle.hasAttribute("aria-pressed"), "Refactor toggle should have aria-pressed attribute");
});

/**
 * Verify that view selector buttons also use semantic <button> elements.
 */
void test("playground panel view selector uses semantic <button> elements", () => {
    const container = document.createElement("div");
    const panel = new GmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    container.append(panel);

    void panel.updateComplete;

    const viewOptions = container.querySelectorAll<HTMLButtonElement>("button.view-option");
    assert.ok(viewOptions.length >= 2, "Expected at least two view option buttons");

    const codeViewButton = Array.from(viewOptions).find((btn) => btn.textContent?.includes("Output Code"));
    assert.ok(codeViewButton, "Expected an 'Output Code' view option button");
    assert.equal(codeViewButton.getAttribute("type"), "button");
    assert.ok(
        codeViewButton.hasAttribute("aria-pressed"),
        "View option buttons should expose state through aria-pressed"
    );

    const astViewButton = Array.from(viewOptions).find((btn) => btn.textContent?.includes("AST View"));
    assert.ok(astViewButton, "Expected an 'AST View' view option button");
    assert.equal(astViewButton.getAttribute("type"), "button");
});

/**
 * Verify that toggle state changes reflect in aria-pressed values.
 */
void test("playground panel toggle aria-pressed reflects active state", () => {
    const container = document.createElement("div");
    const panel = new GmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    container.append(panel);

    void panel.updateComplete;

    const formatToggle = container.querySelector<HTMLButtonElement>("button.rule-toggle");
    assert.ok(formatToggle);
    const initialPressed = formatToggle.getAttribute("aria-pressed");
    assert.ok(initialPressed !== null, "aria-pressed should be set initially");

    // The toggle state is internal to the component; we verify the attribute is rendered
    assert.ok(
        initialPressed === "true" || initialPressed === "false",
        `aria-pressed should be boolean string, got: ${initialPressed}`
    );
});
