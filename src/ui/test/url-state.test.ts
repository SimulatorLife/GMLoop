import assert from "node:assert/strict";
import test from "node:test";

import {
    parseGraphVisualizationUiStateFromUrlSearch,
    serializeGraphVisualizationUiStateToUrlSearch
} from "../src/app/state/url-state.js";

void test("parseGraphVisualizationUiStateFromUrlSearch accepts valid query parameters", () => {
    const state = parseGraphVisualizationUiStateFromUrlSearch(
        "?page=docs&docs=rules&view=json&labels=hidden&q=player%20object"
    );

    assert.equal(state.activePage, "docs");
    assert.equal(state.activeDocsView, "rules");
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
        activeDocsView: "rules",
        activeGraphView: "json",
        activePage: "config",
        errorMessage: null,
        fixErrorMessage: null,
        fixLogLines: [],
        fixStatus: "idle",
        isFixPending: false,
        isLiveReloadRefreshPending: false,
        isLiveReloadStartPending: false,
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: "always",
        liveReloadErrorMessage: null,
        liveReloadStatus: null,
        mcpServerStatus: "not-started",
        pendingActionCount: 0,
        searchQuery: "enemy ship"
    });

    assert.equal(search, "?page=config&docs=rules&view=json&labels=always&q=enemy+ship");
    const parsed = parseGraphVisualizationUiStateFromUrlSearch(search);
    assert.equal(parsed.activePage, "config");
    assert.equal(parsed.activeDocsView, "rules");
    assert.equal(parsed.activeGraphView, "json");
    assert.equal(parsed.labelMode, "always");
    assert.equal(parsed.searchQuery, "enemy ship");
});

void test("parseGraphVisualizationUiStateFromUrlSearch accepts the mcp top-level page", () => {
    const state = parseGraphVisualizationUiStateFromUrlSearch("?page=mcp&docs=mcp");

    assert.equal(state.activePage, "mcp");
    assert.equal(state.activeDocsView, "mcp");
});
