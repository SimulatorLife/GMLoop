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
        fixErrorMessage: null,
        fixLogLines: [],
        fixStatus: "idle",
        isFixPending: false,
        isLiveReloadRefreshPending: false,
        isLiveReloadStartPending: false,
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: "auto",
        liveReloadErrorMessage: null,
        liveReloadStatus: null,
        mcpServerStatus: "not-started",
        pendingActionCount: 0,
        searchQuery: ""
    };
}

/**
 * Compute the number of pending background operations from the current state.
 */
function computePendingActionCount(state: GraphVisualizationUiState): number {
    let count = 0;
    if (state.isFixPending) count++;
    if (state.isLiveReloadRefreshPending) count++;
    if (state.isLiveReloadStartPending) count++;
    if (state.isOpenProjectPending) count++;
    if (state.isRegeneratePending) count++;
    return count;
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
        case "set-mcp-server-status": {
            return {
                ...state,
                mcpServerStatus: action.mcpServerStatus
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
                isRegeneratePending: action.pending,
                pendingActionCount: computePendingActionCount({ ...state, isRegeneratePending: action.pending })
            };
        }
        case "set-fix-pending": {
            return {
                ...state,
                isFixPending: action.pending,
                fixStatus: action.pending ? "running" : state.fixStatus,
                pendingActionCount: computePendingActionCount({ ...state, isFixPending: action.pending })
            };
        }
        case "set-fix-error": {
            return {
                ...state,
                fixErrorMessage: action.errorMessage
            };
        }
        case "set-fix-log-lines": {
            return {
                ...state,
                fixLogLines: action.logLines
            };
        }
        case "set-fix-status": {
            return {
                ...state,
                fixStatus: action.status
            };
        }
        case "set-open-project-pending": {
            return {
                ...state,
                isOpenProjectPending: action.pending,
                pendingActionCount: computePendingActionCount({ ...state, isOpenProjectPending: action.pending })
            };
        }
        case "set-live-reload-refresh-pending": {
            return {
                ...state,
                isLiveReloadRefreshPending: action.pending,
                pendingActionCount: computePendingActionCount({ ...state, isLiveReloadRefreshPending: action.pending })
            };
        }
        case "set-live-reload-start-pending": {
            return {
                ...state,
                isLiveReloadStartPending: action.pending,
                pendingActionCount: computePendingActionCount({ ...state, isLiveReloadStartPending: action.pending })
            };
        }
        case "set-live-reload-error": {
            return {
                ...state,
                liveReloadErrorMessage: action.errorMessage
            };
        }
        case "set-live-reload-status": {
            return {
                ...state,
                liveReloadErrorMessage: null,
                liveReloadStatus: action.status
            };
        }
        case "set-error": {
            return {
                ...state,
                errorMessage: action.errorMessage
            };
        }
        case "clear-error": {
            return {
                ...state,
                errorMessage: null
            };
        }
        case "reset-project-scoped-state": {
            return {
                ...state,
                fixErrorMessage: null,
                fixLogLines: [],
                fixStatus: "idle",
                liveReloadErrorMessage: null,
                liveReloadStatus: null,
                searchQuery: ""
            };
        }
        case "reset-defaults": {
            return {
                ...state,
                activeGraphView: "visual",
                labelMode: "auto",
                searchQuery: ""
            };
        }
        default: {
            return state;
        }
    }
}
