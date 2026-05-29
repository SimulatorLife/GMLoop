import type { GraphVisualizationLiveReloadStatusSnapshot } from "../../graph/types.js";

/**
 * Top-level page surfaces in the graph visualization UI.
 */
export type GraphVisualizationUiPage = "graph" | "docs" | "config" | "fix" | "playground" | "mcp" | "live-reload";

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
export type GraphVisualizationUiDocsView = "cli" | "mcp" | "rules";

/**
 * MCP server connection status.
 */
export type GraphVisualizationUiMcpServerStatus = "not-started" | "running" | "stopped";

/**
 * Immutable UI state for graph/docs/config surfaces.
 */
export type GraphVisualizationUiState = Readonly<{
    activeDocsView: GraphVisualizationUiDocsView;
    activeGraphView: GraphVisualizationUiGraphView;
    activePage: GraphVisualizationUiPage;
    errorMessage: string | null;
    fixErrorMessage: string | null;
    fixLogLines: ReadonlyArray<string>;
    fixStatus: "idle" | "running" | "success" | "error";
    isLiveReloadRefreshPending: boolean;
    isLiveReloadStartPending: boolean;
    isFixPending: boolean;
    isOpenProjectPending: boolean;
    isRegeneratePending: boolean;
    labelMode: GraphVisualizationUiLabelMode;
    liveReloadErrorMessage: string | null;
    liveReloadStatus: GraphVisualizationLiveReloadStatusSnapshot | null;
    mcpServerStatus: GraphVisualizationUiMcpServerStatus;
    pendingActionCount: number;
    searchQuery: string;
}>;

/**
 * Action union accepted by the graph visualization UI state reducer.
 */
export type GraphVisualizationUiAction =
    | Readonly<{ page: GraphVisualizationUiPage; type: "navigate-page" }>
    | Readonly<{ docsView: GraphVisualizationUiDocsView; type: "set-docs-view" }>
    | Readonly<{ mcpServerStatus: GraphVisualizationUiMcpServerStatus; type: "set-mcp-server-status" }>
    | Readonly<{ searchQuery: string; type: "set-search-query" }>
    | Readonly<{ type: "toggle-graph-view" }>
    | Readonly<{ type: "cycle-label-mode" }>
    | Readonly<{ pending: boolean; type: "set-regenerate-pending" }>
    | Readonly<{ pending: boolean; type: "set-fix-pending" }>
    | Readonly<{ errorMessage: string | null; type: "set-fix-error" }>
    | Readonly<{ logLines: ReadonlyArray<string>; type: "set-fix-log-lines" }>
    | Readonly<{ status: GraphVisualizationUiState["fixStatus"]; type: "set-fix-status" }>
    | Readonly<{ pending: boolean; type: "set-open-project-pending" }>
    | Readonly<{ pending: boolean; type: "set-live-reload-refresh-pending" }>
    | Readonly<{ pending: boolean; type: "set-live-reload-start-pending" }>
    | Readonly<{ errorMessage: string | null; type: "set-live-reload-error" }>
    | Readonly<{ status: GraphVisualizationLiveReloadStatusSnapshot | null; type: "set-live-reload-status" }>
    | Readonly<{ errorMessage: string | null; type: "set-error" }>
    | Readonly<{ type: "clear-error" }>
    | Readonly<{ type: "reset-project-scoped-state" }>
    | Readonly<{ type: "reset-defaults" }>;
