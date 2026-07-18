import assert from "node:assert/strict";
import test from "node:test";

import { GRAPH_UI_EVENT_CLEAR_PAGE_ERROR } from "../src/app/components/events.js";
import { GmFixPanel } from "../src/app/components/gm-fix-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmFixPanel extends GmFixPanel {
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
        ...createInitialGraphVisualizationUiState(),
        activeConfigView: "rendered",
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "fix",
        fixLogLines: ["[1/3 Refactor Codemods]", "[2/3 Lint Fixes]", "[3/3 Format]"],
        fixStatus: "success",
        labelMode: "auto"
    };
}

void test("GmFixPanel renders the fix log section", () => {
    const panel = new TestableGmFixPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());
    const runLogIndex = rendered.indexOf("Run Log");
    const firstLogLineIndex = rendered.indexOf("[1/3 Refactor Codemods]");

    assert.match(rendered, /id="fix-page"[\s\S]*class=page content-page active/u);
    assert.match(rendered, /class="fix-log-section"/u);
    assert.match(rendered, /Run Log/u);
    assert.notEqual(runLogIndex, -1);
    assert.ok(firstLogLineIndex > runLogIndex);
    assert.match(rendered, /\[1\/3 Refactor Codemods\]/u);
    assert.doesNotMatch(rendered, /fix-action-bar/u);
    assert.doesNotMatch(rendered, /id="run-fix"/u);
    assert.doesNotMatch(rendered, /1\. Refactor/u);
    assert.doesNotMatch(rendered, /2\. Lint/u);
    assert.doesNotMatch(rendered, /3\. Format/u);
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

    assert.match(rendered, /No fix run has been started from this UI session\./u);
    assert.doesNotMatch(rendered, /Previous project fix log/u);
});

void test("GmFixPanel renders the fix log section even when no project is loaded", () => {
    const panel = new TestableGmFixPanel();
    panel.model = {
        ...createMockModel(),
        loadedTarget: null
    };
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /class="fix-log-section"/u);
    assert.match(rendered, /Run Log/u);
    assert.doesNotMatch(rendered, /id="run-fix"/u);
});

void test("GmFixPanel does not override Lit lifecycle hooks for event wiring", () => {
    // The composition refactor moved the gm-error-banner-dismiss listener
    // into an EventBusManager registered through LifecycleParticipantsController.
    // The host must not re-introduce lifecycle overrides that duplicate that
    // wiring. Reading own properties (not the prototype chain) keeps this
    // assertion stable against inherited LitElement hooks.
    const prototype = GmFixPanel.prototype as unknown as Record<string, unknown>;
    const hasOwn = Object.prototype.hasOwnProperty;

    assert.equal(
        hasOwn.call(prototype, "connectedCallback"),
        false,
        "Expected GmFixPanel to drop its connectedCallback override."
    );
    assert.equal(
        hasOwn.call(prototype, "disconnectedCallback"),
        false,
        "Expected GmFixPanel to drop its disconnectedCallback override."
    );
});

void test("GmFixPanel propagates gm-error-banner-dismiss via composition", () => {
    // With the composition refactor the EventBusManager registered in the
    // constructor owns the gm-error-banner-dismiss subscription. The panel
    // must still translate that dismissal into a GRAPH_UI_EVENT_CLEAR_PAGE_ERROR
    // custom event so the surrounding app shell can clear the fix error state.
    // Invoking the inherited LitElement connectedCallback/disconnectedCallback
    // drives the LifecycleParticipantsController in the same way the DOM would.
    const panel = new GmFixPanel();
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

        assert.equal(observedPage, "fix");
    } finally {
        panel.disconnectedCallback();
        panel.removeEventListener(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, listener);
    }
});
