import assert from "node:assert/strict";
import test from "node:test";

import { createInitialGraphVisualizationUiState, reduceGraphVisualizationUiState } from "../src/app/state/reducer.js";

void test("reduceGraphVisualizationUiState with toggle-graph-view alternates between visual and json", () => {
    const state = createInitialGraphVisualizationUiState();
    assert.equal(state.activeGraphView, "visual");

    const toggled = reduceGraphVisualizationUiState(state, { type: "toggle-graph-view" });
    assert.equal(toggled.activeGraphView, "json");

    const toggledBack = reduceGraphVisualizationUiState(toggled, { type: "toggle-graph-view" });
    assert.equal(toggledBack.activeGraphView, "visual");
});

void test("reduceGraphVisualizationUiState with cycle-label-mode cycles through auto, always, hidden", () => {
    const state = createInitialGraphVisualizationUiState();
    assert.equal(state.labelMode, "auto");

    const always = reduceGraphVisualizationUiState(state, { type: "cycle-label-mode" });
    assert.equal(always.labelMode, "always");

    const hidden = reduceGraphVisualizationUiState(always, { type: "cycle-label-mode" });
    assert.equal(hidden.labelMode, "hidden");

    const autoAgain = reduceGraphVisualizationUiState(hidden, { type: "cycle-label-mode" });
    assert.equal(autoAgain.labelMode, "auto");
});

void test("reduceGraphVisualizationUiState with reset-defaults clears search query", () => {
    const stateWithSearch = reduceGraphVisualizationUiState(createInitialGraphVisualizationUiState(), {
        searchQuery: "player object",
        type: "set-search-query"
    });
    assert.equal(stateWithSearch.searchQuery, "player object");

    const reset = reduceGraphVisualizationUiState(stateWithSearch, { type: "reset-defaults" });
    assert.equal(reset.searchQuery, "");
});

void test("reduceGraphVisualizationUiState with set-search-query updates searchQuery", () => {
    const state = createInitialGraphVisualizationUiState();
    const updated = reduceGraphVisualizationUiState(state, {
        searchQuery: "script_test",
        type: "set-search-query"
    });
    assert.equal(updated.searchQuery, "script_test");
});

void test("reduceGraphVisualizationUiState preserves non-reset fields on reset-defaults", () => {
    const state = reduceGraphVisualizationUiState(createInitialGraphVisualizationUiState(), {
        page: "docs",
        type: "navigate-page"
    });
    assert.equal(state.activePage, "docs");

    const reset = reduceGraphVisualizationUiState(state, { type: "reset-defaults" });
    assert.equal(reset.activePage, "docs");
    assert.equal(reset.activeGraphView, "visual");
    assert.equal(reset.labelMode, "auto");
    assert.equal(reset.searchQuery, "");
});
