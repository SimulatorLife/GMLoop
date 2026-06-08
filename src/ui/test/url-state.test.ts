import assert from "node:assert/strict";
import test from "node:test";

import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import {
    parseGraphVisualizationUiStateFromUrlSearch,
    resetProjectScopedGraphVisualizationUiState,
    serializeGraphVisualizationUiStateToUrlSearch
} from "../src/app/state/url-state.js";

void test("parseGraphVisualizationUiStateFromUrlSearch accepts valid query parameters", () => {
    const state = parseGraphVisualizationUiStateFromUrlSearch(
        "?page=docs&docs=linting&view=json&labels=hidden&q=player%20object"
    );

    assert.equal(state.activePage, "docs");
    assert.equal(state.activeDocsView, "linting");
    assert.equal(state.activeGraphView, "json");
    assert.equal(state.labelMode, "hidden");
    assert.equal(state.searchQuery, "player object");
});

void test("parseGraphVisualizationUiStateFromUrlSearch rejects invalid values and falls back to defaults", () => {
    const state = parseGraphVisualizationUiStateFromUrlSearch(
        "?page=unknown&docs=other&view=sideways&labels=loud&q=test"
    );

    assert.equal(state.activePage, "graph");
    assert.equal(state.activeDocsView, "cli");
    assert.equal(state.activeGraphView, "visual");
    assert.equal(state.labelMode, "auto");
    assert.equal(state.searchQuery, "test");
});

void test("serializeGraphVisualizationUiStateToUrlSearch round-trips supported navigation state", () => {
    const search = serializeGraphVisualizationUiStateToUrlSearch({
        ...createInitialGraphVisualizationUiState(),
        activeConfigView: "rendered",
        activeDocsView: "linting",
        activeGraphView: "json",
        activePage: "config",
        labelMode: "always",
        searchQuery: "enemy ship"
    });

    assert.equal(search, "?page=config&docs=linting&view=json&labels=always&config=rendered&q=enemy+ship");
    const parsed = parseGraphVisualizationUiStateFromUrlSearch(search);
    assert.equal(parsed.activePage, "config");
    assert.equal(parsed.activeDocsView, "linting");
    assert.equal(parsed.activeGraphView, "json");
    assert.equal(parsed.labelMode, "always");
    assert.equal(parsed.activeConfigView, "rendered");
    assert.equal(parsed.searchQuery, "enemy ship");
});

void test("parseGraphVisualizationUiStateFromUrlSearch accepts the mcp top-level page", () => {
    const state = parseGraphVisualizationUiStateFromUrlSearch("?page=mcp&docs=mcp");

    assert.equal(state.activePage, "mcp");
    assert.equal(state.activeDocsView, "mcp");
});

void test("parseGraphVisualizationUiStateFromUrlSearch accepts the formatting and codemods docs subviews", () => {
    const formatting = parseGraphVisualizationUiStateFromUrlSearch("?page=docs&docs=formatting");
    const codemods = parseGraphVisualizationUiStateFromUrlSearch("?page=docs&docs=codemods");

    assert.equal(formatting.activeDocsView, "formatting");
    assert.equal(codemods.activeDocsView, "codemods");
});

void test("resetProjectScopedGraphVisualizationUiState removes project search from serialized URL state", () => {
    const state = parseGraphVisualizationUiStateFromUrlSearch(
        "?page=fix&docs=codemods&view=json&labels=always&q=old%20project"
    );

    const reset = resetProjectScopedGraphVisualizationUiState({
        ...state,
        fixLogLines: ["Old project fix log"],
        fixStatus: "success",
        liveReloadErrorMessage: "Old project live reload error."
    });

    assert.equal(
        serializeGraphVisualizationUiStateToUrlSearch(reset),
        "?page=fix&docs=codemods&view=json&labels=always&config=rendered"
    );
});
