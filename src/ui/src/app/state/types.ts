/**
 * Top-level page surfaces in the graph visualization UI.
 */
export type GraphVisualizationUiPage = "graph" | "docs" | "config";

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
export type GraphVisualizationUiDocsView = "cli" | "mcp";

/**
 * Immutable UI state for graph/docs/config surfaces.
 */
export type GraphVisualizationUiState = Readonly<{
    activeDocsView: GraphVisualizationUiDocsView;
    activeGraphView: GraphVisualizationUiGraphView;
    activePage: GraphVisualizationUiPage;
    errorMessage: string | null;
    isOpenProjectPending: boolean;
    isRegeneratePending: boolean;
    labelMode: GraphVisualizationUiLabelMode;
    searchQuery: string;
}>;

/**
 * Action union accepted by the graph visualization UI state reducer.
 */
export type GraphVisualizationUiAction =
    | Readonly<{ page: GraphVisualizationUiPage; type: "navigate-page" }>
    | Readonly<{ docsView: GraphVisualizationUiDocsView; type: "set-docs-view" }>
    | Readonly<{ searchQuery: string; type: "set-search-query" }>
    | Readonly<{ type: "toggle-graph-view" }>
    | Readonly<{ type: "cycle-label-mode" }>
    | Readonly<{ pending: boolean; type: "set-regenerate-pending" }>
    | Readonly<{ pending: boolean; type: "set-open-project-pending" }>
    | Readonly<{ errorMessage: string | null; type: "set-error" }>
    | Readonly<{ type: "reset-defaults" }>;
