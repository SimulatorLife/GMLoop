import assert from "node:assert/strict";
import test from "node:test";

import { createInitialGraphVisualizationUiState, reduceGraphVisualizationUiState } from "../src/app/state/reducer.js";

void test("reset-defaults restores visual view, auto labels, and clears search query", () => {
    const state = reduceGraphVisualizationUiState(
        {
            activeDocsView: "cli",
            activeGraphView: "json",
            activePage: "graph",
            errorMessage: "something went wrong",
            isOpenProjectPending: false,
            isRegeneratePending: false,
            labelMode: "always",
            mcpServerStatus: "not-started",
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
