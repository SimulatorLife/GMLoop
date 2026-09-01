import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";

/**
 * Creates a minimal UI model for rendering tests that only need stable shell-level data.
 */
export function createMockGraphVisualizationUiModel(
    overrides: Partial<GraphVisualizationUiModel> = {}
): GraphVisualizationUiModel {
    return {
        autoGamePipeline: null,
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/test"
        },
        documentationCatalogs: null,
        isServerMode: false,
        lastFixRun: null,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Test GMLoop",
        ...overrides
    };
}

/**
 * Creates a minimal UI state for rendering tests with the repository's default panel tabs selected.
 */
export function createMockGraphVisualizationUiState(
    overrides: Partial<GraphVisualizationUiState> = {}
): GraphVisualizationUiState {
    return {
        ...createInitialGraphVisualizationUiState(),
        activeConfigView: "rendered",
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "graph",
        labelMode: "auto",
        ...overrides
    };
}
