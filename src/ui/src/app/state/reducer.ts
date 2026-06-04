import type { GraphVisualizationUiAction, GraphVisualizationUiLabelMode, GraphVisualizationUiState } from "./types.js";

/**
 * Build the default UI state for graph/docs/config views.
 */
export function createInitialGraphVisualizationUiState(): GraphVisualizationUiState {
    return {
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "graph",
        activeConfigView: "rendered",
        errorMessage: null,
        fixErrorMessage: null,
        fixLogLines: [],
        fixStatus: "idle",
        isFixPending: false,
        isLiveReloadStartPending: false,
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: "auto",
        liveReloadErrorMessage: null,
        mcpServerStatus: "not-started",
        pendingActionCount: 0,
        searchQuery: "",
        graphErrorMessage: null,
        docsErrorMessage: null,
        configErrorMessage: null,
        playgroundErrorMessage: null,
        mcpErrorMessage: null
    };
}

/**
 * Compute the number of pending background operations from the current state.
 */
function computePendingActionCount(state: GraphVisualizationUiState): number {
    let count = 0;
    if (state.isFixPending) count++;
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
        case "set-config-view": {
            return {
                ...state,
                activeConfigView: action.configView
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
        case "set-error": {
            return {
                ...state,
                errorMessage: action.errorMessage
            };
        }
        case "set-page-error": {
            switch (action.page) {
                case "graph": {
                    return { ...state, graphErrorMessage: action.errorMessage };
                }
                case "docs": {
                    return { ...state, docsErrorMessage: action.errorMessage };
                }
                case "config": {
                    return { ...state, configErrorMessage: action.errorMessage };
                }
                case "playground": {
                    return { ...state, playgroundErrorMessage: action.errorMessage };
                }
                case "mcp": {
                    return { ...state, mcpErrorMessage: action.errorMessage };
                }
                case "fix": {
                    return { ...state, fixErrorMessage: action.errorMessage };
                }
                case "live-reload": {
                    return { ...state, liveReloadErrorMessage: action.errorMessage };
                }
                default: {
                    return state;
                }
            }
        }
        case "clear-page-error": {
            switch (action.page) {
                case "graph": {
                    return { ...state, errorMessage: null, graphErrorMessage: null };
                }
                case "docs": {
                    return { ...state, docsErrorMessage: null };
                }
                case "config": {
                    return { ...state, configErrorMessage: null };
                }
                case "playground": {
                    return { ...state, playgroundErrorMessage: null };
                }
                case "mcp": {
                    return { ...state, mcpErrorMessage: null };
                }
                case "fix": {
                    return { ...state, fixErrorMessage: null };
                }
                case "live-reload": {
                    return { ...state, liveReloadErrorMessage: null };
                }
                default: {
                    return state;
                }
            }
        }
        case "clear-error": {
            return {
                ...state,
                errorMessage: null,
                graphErrorMessage: null
            };
        }
        case "reset-project-scoped-state": {
            return {
                ...state,
                fixErrorMessage: null,
                fixLogLines: [],
                fixStatus: "idle",
                liveReloadErrorMessage: null,
                searchQuery: "",
                graphErrorMessage: null,
                docsErrorMessage: null,
                configErrorMessage: null,
                playgroundErrorMessage: null,
                mcpErrorMessage: null
            };
        }

        case "reset-defaults": {
            return {
                ...state,
                activeGraphView: "visual",
                labelMode: "auto",
                searchQuery: "",
                activeConfigView: "rendered"
            };
        }
        default: {
            return state;
        }
    }
}
