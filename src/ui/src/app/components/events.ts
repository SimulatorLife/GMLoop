import type { GraphVisualizationUiDocsView, GraphVisualizationUiPage } from "../state/types.js";

export const GRAPH_UI_EVENT_NAVIGATE_PAGE = "gmloop-navigate-page";
export const GRAPH_UI_EVENT_SET_DOCS_VIEW = "gmloop-set-docs-view";
export const GRAPH_UI_EVENT_SET_SEARCH_QUERY = "gmloop-set-search-query";
export const GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW = "gmloop-toggle-graph-view";
export const GRAPH_UI_EVENT_CYCLE_LABEL_MODE = "gmloop-cycle-label-mode";
export const GRAPH_UI_EVENT_TRIGGER_REGENERATE = "gmloop-trigger-regenerate";
export const GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT = "gmloop-trigger-open-project";

export type GraphUiNavigatePageDetail = Readonly<{ page: GraphVisualizationUiPage }>;
export type GraphUiSetDocsViewDetail = Readonly<{ docsView: GraphVisualizationUiDocsView }>;
export type GraphUiSetSearchQueryDetail = Readonly<{ searchQuery: string }>;
