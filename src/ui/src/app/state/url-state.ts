import { createInitialGraphVisualizationUiState } from "./reducer.js";
import type {
    GraphVisualizationUiDocsView,
    GraphVisualizationUiGraphView,
    GraphVisualizationUiLabelMode,
    GraphVisualizationUiPage,
    GraphVisualizationUiState
} from "./types.js";

const VALID_DOCS_VIEWS = new Set<GraphVisualizationUiDocsView>(["cli", "mcp", "rules"]);
const VALID_GRAPH_VIEWS = new Set<GraphVisualizationUiGraphView>(["visual", "json"]);
const VALID_LABEL_MODES = new Set<GraphVisualizationUiLabelMode>(["auto", "always", "hidden"]);
const VALID_PAGES = new Set<GraphVisualizationUiPage>(["graph", "docs", "config", "playground", "mcp"]);

function readUrlParameterValue(parameters: URLSearchParams, key: string): string | null {
    const value = parameters.get(key);
    return value === null || value.length === 0 ? null : value;
}

function readValidPage(parameters: URLSearchParams, fallback: GraphVisualizationUiPage): GraphVisualizationUiPage {
    const page = readUrlParameterValue(parameters, "page");
    return page !== null && VALID_PAGES.has(page as GraphVisualizationUiPage)
        ? (page as GraphVisualizationUiPage)
        : fallback;
}

function readValidDocsView(
    parameters: URLSearchParams,
    fallback: GraphVisualizationUiDocsView
): GraphVisualizationUiDocsView {
    const docsView = readUrlParameterValue(parameters, "docs");
    return docsView !== null && VALID_DOCS_VIEWS.has(docsView as GraphVisualizationUiDocsView)
        ? (docsView as GraphVisualizationUiDocsView)
        : fallback;
}

function readValidGraphView(
    parameters: URLSearchParams,
    fallback: GraphVisualizationUiGraphView
): GraphVisualizationUiGraphView {
    const graphView = readUrlParameterValue(parameters, "view");
    return graphView !== null && VALID_GRAPH_VIEWS.has(graphView as GraphVisualizationUiGraphView)
        ? (graphView as GraphVisualizationUiGraphView)
        : fallback;
}

function readValidLabelMode(
    parameters: URLSearchParams,
    fallback: GraphVisualizationUiLabelMode
): GraphVisualizationUiLabelMode {
    const labelMode = readUrlParameterValue(parameters, "labels");
    return labelMode !== null && VALID_LABEL_MODES.has(labelMode as GraphVisualizationUiLabelMode)
        ? (labelMode as GraphVisualizationUiLabelMode)
        : fallback;
}

/**
 * Parse a graph-visualization URL search string into immutable UI state.
 */
export function parseGraphVisualizationUiStateFromUrlSearch(search: string): GraphVisualizationUiState {
    const defaults = createInitialGraphVisualizationUiState();
    const parameters = new URLSearchParams(search);
    const searchQuery = parameters.get("q") ?? "";

    return {
        ...defaults,
        activeDocsView: readValidDocsView(parameters, defaults.activeDocsView),
        activeGraphView: readValidGraphView(parameters, defaults.activeGraphView),
        activePage: readValidPage(parameters, defaults.activePage),
        labelMode: readValidLabelMode(parameters, defaults.labelMode),
        searchQuery
    };
}

/**
 * Serialize immutable UI state into a stable graph-visualization query string.
 */
export function serializeGraphVisualizationUiStateToUrlSearch(state: GraphVisualizationUiState): string {
    const parameters = new URLSearchParams();
    parameters.set("page", state.activePage);
    parameters.set("docs", state.activeDocsView);
    parameters.set("view", state.activeGraphView);
    parameters.set("labels", state.labelMode);
    if (state.searchQuery.length > 0) {
        parameters.set("q", state.searchQuery);
    }

    const queryString = parameters.toString();
    return queryString.length > 0 ? `?${queryString}` : "";
}

/**
 * Replace the current browser URL query string with serialized UI state.
 */
export function replaceGraphVisualizationUiStateInCurrentUrl(state: GraphVisualizationUiState): void {
    if (globalThis.history === undefined || globalThis.location === undefined) {
        return;
    }

    const nextSearch = serializeGraphVisualizationUiStateToUrlSearch(state);
    const nextUrl = `${globalThis.location.pathname}${nextSearch}${globalThis.location.hash}`;
    globalThis.history.replaceState(null, "", nextUrl);
}

/**
 * Read immutable UI state directly from the current browser location.
 */
export function readGraphVisualizationUiStateFromCurrentUrl(): GraphVisualizationUiState {
    if (globalThis.location === undefined) {
        return createInitialGraphVisualizationUiState();
    }

    return parseGraphVisualizationUiStateFromUrlSearch(globalThis.location.search);
}
