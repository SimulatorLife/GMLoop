import type { GraphVisualizationUiAction, GraphVisualizationUiLabelMode, GraphVisualizationUiState } from "./types.js";

/**
 * Build the default UI state for graph/docs/config views.
 */
export function createInitialGraphVisualizationUiState(): GraphVisualizationUiState {
    return {
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "graph",
        errorMessage: null,
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: "auto",
        searchQuery: ""
    };
}

function getNextLabelMode(currentLabelMode: GraphVisualizationUiLabelMode): GraphVisualizationUiLabelMode {
    if (currentLabelMode === "auto") {
        return "always";
    }

    if (currentLabelMode === "always") {
        return "hidden";
    }

    return "auto";
}

/**
 * Apply a UI action to the current state.
 */
export function reduceGraphVisualizationUiState(
    state: GraphVisualizationUiState,
    action: GraphVisualizationUiAction
): GraphVisualizationUiState {
    switch (action.type) {
        case "navigate-page": {
            return {
                ...state,
                activePage: action.page
            };
        }
        case "set-docs-view": {
            return {
                ...state,
                activeDocsView: action.docsView
            };
        }
        case "set-search-query": {
            return {
                ...state,
                searchQuery: action.searchQuery
            };
        }
        case "toggle-graph-view": {
            return {
                ...state,
                activeGraphView: state.activeGraphView === "visual" ? "json" : "visual"
            };
        }
        case "cycle-label-mode": {
            return {
                ...state,
                labelMode: getNextLabelMode(state.labelMode)
            };
        }
        case "set-regenerate-pending": {
            return {
                ...state,
                isRegeneratePending: action.pending
            };
        }
        case "set-open-project-pending": {
            return {
                ...state,
                isOpenProjectPending: action.pending
            };
        }
        case "set-error": {
            return {
                ...state,
                errorMessage: action.errorMessage
            };
        }
        default: {
            return state;
        }
    }
}
