import assert from "node:assert/strict";
import test from "node:test";

import { createInitialGraphVisualizationUiState, reduceGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";

void test("reset-defaults restores visual view, auto labels, and clears search query", () => {
    const state = reduceGraphVisualizationUiState(
        {
            ...createInitialGraphVisualizationUiState(),
            activeConfigView: "rendered",
            activeDocsView: "cli",
            activeGraphView: "json",
            activePage: "graph",
            errorMessage: "something went wrong",
            labelMode: "always",
            searchQuery: "player object"
        },
        { type: "reset-defaults" }
    );

    assert.equal(state.activeGraphView, "visual");
    assert.equal(state.labelMode, "auto");
    assert.equal(state.searchQuery, "");
    assert.equal(state.activePage, "graph");
    assert.equal(state.activeDocsView, "cli");
    assert.equal(state.errorMessage, "something went wrong");
});

void test("reduceGraphVisualizationUiState with set-docs-view accepts the rules catalog subview", () => {
    const state = createInitialGraphVisualizationUiState();
    const updated = reduceGraphVisualizationUiState(state, { docsView: "rules", type: "set-docs-view" });

    assert.equal(updated.activeDocsView, "rules");
});

void test("reset-defaults does not change other state fields beyond the targeted reset values", () => {
    const initialState = reduceGraphVisualizationUiState(createInitialGraphVisualizationUiState(), {
        page: "docs",
        type: "navigate-page"
    });
    const docsState = reduceGraphVisualizationUiState(initialState, { docsView: "rules", type: "set-docs-view" });

    const afterReset = reduceGraphVisualizationUiState(docsState, { type: "reset-defaults" });

    assert.equal(afterReset.activePage, "docs");
    assert.equal(afterReset.activeDocsView, "rules");
});

void test("reset-defaults on a state already at defaults is a no-op identity", () => {
    const defaults = createInitialGraphVisualizationUiState();
    const afterReset = reduceGraphVisualizationUiState(defaults, { type: "reset-defaults" });

    assert.equal(afterReset.activeGraphView, defaults.activeGraphView);
    assert.equal(afterReset.labelMode, defaults.labelMode);
    assert.equal(afterReset.searchQuery, defaults.searchQuery);
});

void test("clear-error sets errorMessage to null regardless of prior value", () => {
    const stateWithError = reduceGraphVisualizationUiState(
        {
            ...createInitialGraphVisualizationUiState(),
            activeConfigView: "rendered",
            activeDocsView: "cli",
            activeGraphView: "visual",
            activePage: "graph",
            errorMessage: "Project open failed: invalid path",
            labelMode: "auto"
        },
        { type: "clear-error" }
    );

    assert.equal(stateWithError.errorMessage, null);
});

void test("clear-error on a state already with null errorMessage remains null", () => {
    const initial = createInitialGraphVisualizationUiState();
    const afterClear = reduceGraphVisualizationUiState(initial, { type: "clear-error" });

    assert.equal(afterClear.errorMessage, null);
});

void test("reset-project-scoped-state clears project-specific workflow and filter state", () => {
    const initial = createInitialGraphVisualizationUiState();
    const state: GraphVisualizationUiState = {
        ...initial,
        activeDocsView: "rules",
        activeGraphView: "json",
        activePage: "fix",
        fixErrorMessage: "Fix failed.",
        fixLogLines: ["Previous project fix log"],
        fixStatus: "success" as const,
        labelMode: "always" as const,
        liveReloadErrorMessage: "Previous project live-reload error.",
        searchQuery: "previous project"
    };

    const reset = reduceGraphVisualizationUiState(state, { type: "reset-project-scoped-state" });

    assert.equal(reset.activePage, "fix");
    assert.equal(reset.activeDocsView, "rules");
    assert.equal(reset.activeGraphView, "json");
    assert.equal(reset.labelMode, "always");
    assert.equal(reset.fixErrorMessage, null);
    assert.deepEqual(reset.fixLogLines, []);
    assert.equal(reset.fixStatus, "idle");
    assert.equal(reset.liveReloadErrorMessage, null);
    assert.equal(reset.searchQuery, "");
});

void test("reduceGraphVisualizationUiState with set-page-error and clear-page-error sets and clears page-specific errors", () => {
    const initial = createInitialGraphVisualizationUiState();

    const graphError = reduceGraphVisualizationUiState(initial, {
        errorMessage: "Graph failed",
        page: "graph",
        type: "set-page-error"
    });
    assert.equal(graphError.graphErrorMessage, "Graph failed");

    const configError = reduceGraphVisualizationUiState(graphError, {
        errorMessage: "Config failed",
        page: "config",
        type: "set-page-error"
    });
    assert.equal(configError.graphErrorMessage, "Graph failed");
    assert.equal(configError.configErrorMessage, "Config failed");

    const clearedGraph = reduceGraphVisualizationUiState(configError, {
        page: "graph",
        type: "clear-page-error"
    });
    assert.equal(clearedGraph.graphErrorMessage, null);
    assert.equal(clearedGraph.configErrorMessage, "Config failed");

    const clearedConfig = reduceGraphVisualizationUiState(clearedGraph, {
        page: "config",
        type: "clear-page-error"
    });
    assert.equal(clearedConfig.configErrorMessage, null);
});
