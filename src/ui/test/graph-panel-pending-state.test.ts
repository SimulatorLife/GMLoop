import assert from "node:assert/strict";
import test from "node:test";

import { createInitialGraphVisualizationUiState, reduceGraphVisualizationUiState } from "../src/app/state/reducer.js";

void test("reduceGraphVisualizationUiState with set-regenerate-pending true sets isRegeneratePending", () => {
    const state = createInitialGraphVisualizationUiState();
    assert.equal(state.isRegeneratePending, false);

    const pending = reduceGraphVisualizationUiState(state, {
        pending: true,
        type: "set-regenerate-pending"
    });
    assert.equal(pending.isRegeneratePending, true);
});

void test("reduceGraphVisualizationUiState with set-regenerate-pending false clears isRegeneratePending", () => {
    const pendingState = reduceGraphVisualizationUiState(createInitialGraphVisualizationUiState(), {
        pending: true,
        type: "set-regenerate-pending"
    });
    assert.equal(pendingState.isRegeneratePending, true);

    const cleared = reduceGraphVisualizationUiState(pendingState, {
        pending: false,
        type: "set-regenerate-pending"
    });
    assert.equal(cleared.isRegeneratePending, false);
});

void test("reduceGraphVisualizationUiState with set-open-project-pending sets isOpenProjectPending", () => {
    const state = createInitialGraphVisualizationUiState();
    assert.equal(state.isOpenProjectPending, false);

    const pending = reduceGraphVisualizationUiState(state, {
        pending: true,
        type: "set-open-project-pending"
    });
    assert.equal(pending.isOpenProjectPending, true);
});

void test("reduceGraphVisualizationUiState with set-open-project-pending false clears isOpenProjectPending", () => {
    const pendingState = reduceGraphVisualizationUiState(createInitialGraphVisualizationUiState(), {
        pending: true,
        type: "set-open-project-pending"
    });
    assert.equal(pendingState.isOpenProjectPending, true);

    const cleared = reduceGraphVisualizationUiState(pendingState, {
        pending: false,
        type: "set-open-project-pending"
    });
    assert.equal(cleared.isOpenProjectPending, false);
});

void test("reduceGraphVisualizationUiState with set-error sets errorMessage", () => {
    const state = createInitialGraphVisualizationUiState();
    assert.equal(state.errorMessage, null);

    const withError = reduceGraphVisualizationUiState(state, {
        errorMessage: "Graph index generation failed: timeout",
        type: "set-error"
    });
    assert.equal(withError.errorMessage, "Graph index generation failed: timeout");
});

void test("reduceGraphVisualizationUiState with set-error null clears errorMessage", () => {
    const errorState = reduceGraphVisualizationUiState(createInitialGraphVisualizationUiState(), {
        errorMessage: "Some error",
        type: "set-error"
    });
    assert.equal(errorState.errorMessage, "Some error");

    const cleared = reduceGraphVisualizationUiState(errorState, {
        errorMessage: null,
        type: "set-error"
    });
    assert.equal(cleared.errorMessage, null);
});
