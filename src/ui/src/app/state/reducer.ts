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
        fixWorkflow: null,
        autoGamePendingOperation: null,
        isConfigSavePending: false,
        isFixPending: false,
        isFixCancelPending: false,
        isLiveReloadStartPending: false,
        isLiveReloadStopPending: false,
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: "auto",
        liveReloadErrorMessage: null,
        mcpServerStatus: "not-started",
        pendingActionCount: 0,
        searchQuery: "",
        graphErrorMessage: null,
        graphIndexProgress: null,
        docsErrorMessage: null,
        configErrorMessage: null,
        playgroundErrorMessage: null,
        playgroundControlsOpen:
            typeof globalThis !== "undefined" &&
            "matchMedia" in globalThis &&
            globalThis.matchMedia("(max-width: 920px)").matches
                ? false
                : true,
        autoGameErrorMessage: null
    };
}

/**
 * Compute the number of pending background operations from the current state.
 */
function computePendingActionCount(state: GraphVisualizationUiState): number {
    let count = 0;
    if (state.isFixPending) count++;
    if (state.isConfigSavePending) count++;
    if (state.isLiveReloadStartPending) count++;
    if (state.isLiveReloadStopPending) count++;
    if (state.isOpenProjectPending) count++;
    if (state.isRegeneratePending) count++;
    if (state.autoGamePendingOperation !== null) count++;
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
        case "set-graph-index-progress": {
            return {
                ...state,
                graphIndexProgress: action.progress
            };
        }
        case "toggle-graph-view": {
            return {
                ...state,
                activeGraphView: state.activeGraphView === "visual" ? "json" : "visual"
            };
        }
        case "toggle-playground-controls": {
            return {
                ...state,
                playgroundControlsOpen: !state.playgroundControlsOpen
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
        case "set-config-save-pending": {
            return {
                ...state,
                isConfigSavePending: action.pending,
                pendingActionCount: computePendingActionCount({ ...state, isConfigSavePending: action.pending })
            };
        }
        case "set-fix-pending": {
            return {
                ...state,
                isFixCancelPending: action.pending ? state.isFixCancelPending : false,
                isFixPending: action.pending,
                fixStatus: action.pending ? "running" : state.fixStatus,
                fixWorkflow: action.workflow,
                pendingActionCount: computePendingActionCount({ ...state, isFixPending: action.pending })
            };
        }
        case "set-fix-cancel-pending": {
            return {
                ...state,
                isFixCancelPending: action.pending
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
        case "set-live-reload-stop-pending": {
            return {
                ...state,
                isLiveReloadStopPending: action.pending,
                pendingActionCount: computePendingActionCount({ ...state, isLiveReloadStopPending: action.pending })
            };
        }
        case "set-auto-game-operation-pending": {
            const autoGamePendingOperation = action.pending ? action.operation : null;
            return {
                ...state,
                autoGamePendingOperation,
                pendingActionCount: computePendingActionCount({ ...state, autoGamePendingOperation })
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
                case "auto-game": {
                    return { ...state, autoGameErrorMessage: action.errorMessage };
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
                case "auto-game": {
                    return { ...state, autoGameErrorMessage: null };
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
                fixWorkflow: null,
                isFixCancelPending: false,
                liveReloadErrorMessage: null,
                searchQuery: "",
                graphErrorMessage: null,
                graphIndexProgress: null,
                docsErrorMessage: null,
                configErrorMessage: null,
                playgroundErrorMessage: null,
                autoGameErrorMessage: null
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
