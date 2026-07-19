import type { GraphVisualizationGraphIndexProgress, GraphVisualizationProjectWorkflow } from "../../graph/types.js";

/**
 * Top-level page surfaces in the graph visualization UI.
 */
export type GraphVisualizationUiPage = "graph" | "docs" | "config" | "fix" | "playground" | "auto-game" | "live-reload";

/**
 * Graph presentation modes in the graph surface.
 */
export type GraphVisualizationUiGraphView = "visual" | "json";

/**
 * Node label display modes in the graph surface.
 */
export type GraphVisualizationUiLabelMode = "auto" | "always" | "hidden";

/**
 * Documentation sub-views in the docs surface.
 */
export type GraphVisualizationUiDocsView = "cli" | "lsp" | "mcp" | "linting" | "formatting" | "codemods";

/**
 * Configuration presentation modes in the config surface.
 */
export type GraphVisualizationUiConfigView = "rendered" | "raw";

/**
 * MCP server connection status.
 */
export type GraphVisualizationUiMcpServerStatus = "not-started" | "running" | "stopped";

/** Auto-Game host operation currently awaiting completion. */
export type GraphVisualizationUiAutoGamePendingOperation =
    "initialize-agent-pack" | "pipeline-pause" | "pipeline-start" | "pipeline-stop" | "run-task" | "skill-toggle";

/**
 * Immutable UI state for graph/docs/config surfaces.
 */
export type GraphVisualizationUiState = Readonly<{
    activeDocsView: GraphVisualizationUiDocsView;
    activeGraphView: GraphVisualizationUiGraphView;
    activePage: GraphVisualizationUiPage;
    activeConfigView: GraphVisualizationUiConfigView;
    errorMessage: string | null;
    fixErrorMessage: string | null;
    fixLogLines: ReadonlyArray<string>;
    fixStatus: "idle" | "running" | "success" | "error";
    fixWorkflow: GraphVisualizationProjectWorkflow | null;
    autoGamePendingOperation: GraphVisualizationUiAutoGamePendingOperation | null;
    isLiveReloadStartPending: boolean;
    isLiveReloadStopPending: boolean;
    isConfigSavePending: boolean;
    isFixPending: boolean;
    isFixCancelPending: boolean;
    isOpenProjectPending: boolean;
    isRegeneratePending: boolean;
    labelMode: GraphVisualizationUiLabelMode;
    liveReloadErrorMessage: string | null;
    mcpServerStatus: GraphVisualizationUiMcpServerStatus;
    pendingActionCount: number;
    searchQuery: string;
    graphErrorMessage: string | null;
    graphIndexProgress: GraphVisualizationGraphIndexProgress | null;
    docsErrorMessage: string | null;
    configErrorMessage: string | null;
    playgroundErrorMessage: string | null;
    playgroundControlsOpen: boolean;
    autoGameErrorMessage: string | null;
}>;

/**
 * Action union accepted by the graph visualization UI state reducer.
 */
export type GraphVisualizationUiAction =
    | Readonly<{ page: GraphVisualizationUiPage; type: "navigate-page" }>
    | Readonly<{ docsView: GraphVisualizationUiDocsView; type: "set-docs-view" }>
    | Readonly<{ configView: GraphVisualizationUiConfigView; type: "set-config-view" }>
    | Readonly<{ mcpServerStatus: GraphVisualizationUiMcpServerStatus; type: "set-mcp-server-status" }>
    | Readonly<{ searchQuery: string; type: "set-search-query" }>
    | Readonly<{ type: "toggle-graph-view" }>
    | Readonly<{ type: "toggle-playground-controls" }>
    | Readonly<{ type: "cycle-label-mode" }>
    | Readonly<{ pending: boolean; type: "set-regenerate-pending" }>
    | Readonly<{ pending: boolean; type: "set-config-save-pending" }>
    | Readonly<{
          pending: boolean;
          type: "set-fix-pending";
          workflow: GraphVisualizationProjectWorkflow;
      }>
    | Readonly<{ pending: boolean; type: "set-fix-cancel-pending" }>
    | Readonly<{ errorMessage: string | null; type: "set-fix-error" }>
    | Readonly<{ logLines: ReadonlyArray<string>; type: "set-fix-log-lines" }>
    | Readonly<{ status: GraphVisualizationUiState["fixStatus"]; type: "set-fix-status" }>
    | Readonly<{ pending: boolean; type: "set-open-project-pending" }>
    | Readonly<{ pending: boolean; type: "set-live-reload-start-pending" }>
    | Readonly<{ pending: boolean; type: "set-live-reload-stop-pending" }>
    | Readonly<{
          operation: GraphVisualizationUiAutoGamePendingOperation;
          pending: boolean;
          type: "set-auto-game-operation-pending";
      }>
    | Readonly<{ errorMessage: string | null; type: "set-live-reload-error" }>
    | Readonly<{ errorMessage: string | null; type: "set-error" }>
    | Readonly<{ progress: GraphVisualizationGraphIndexProgress; type: "set-graph-index-progress" }>
    | Readonly<{ errorMessage: string | null; page: GraphVisualizationUiPage; type: "set-page-error" }>
    | Readonly<{ page: GraphVisualizationUiPage; type: "clear-page-error" }>
    | Readonly<{ type: "clear-error" }>
    | Readonly<{ type: "reset-project-scoped-state" }>
    | Readonly<{ type: "reset-defaults" }>;
