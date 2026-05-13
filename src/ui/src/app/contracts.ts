import type {
    GraphVisualizationData,
    GraphVisualizationDocumentationCatalogs,
    GraphVisualizationLoadedTarget,
    GraphVisualizationMcpServerStatus,
    GraphVisualizationProjectConfigurationCatalog,
    GraphVisualizationRenderOptions
} from "../graph/types.js";

/**
 * Normalized model consumed by the Lit graph visualization UI shell.
 */
export type GraphVisualizationUiModel = Readonly<{
    data: GraphVisualizationData;
    documentationCatalogs: GraphVisualizationDocumentationCatalogs | null;
    isServerMode: boolean;
    loadedTarget: GraphVisualizationLoadedTarget | null;
    mcpServerStatus: GraphVisualizationMcpServerStatus;
    projectConfigurationCatalog: GraphVisualizationProjectConfigurationCatalog | null;
    title: string;
}>;

/**
 * Host callbacks invoked from UI actions.
 */
export type GraphVisualizationUiCallbacks = Readonly<{
    onOpenProject: () => void | Promise<void>;
    onRegenerate: () => void | Promise<void>;
}>;

/**
 * Convert graph visualization renderer inputs into the model consumed by Lit UI components.
 */
export function createGraphVisualizationUiModel(
    data: GraphVisualizationData,
    options: GraphVisualizationRenderOptions
): GraphVisualizationUiModel {
    return {
        data,
        documentationCatalogs: options.documentationCatalogs ?? null,
        isServerMode: options.isServerMode ?? false,
        loadedTarget: options.loadedTarget ?? null,
        mcpServerStatus: options.mcpServerStatus ?? "not-started",
        projectConfigurationCatalog: options.projectConfigurationCatalog ?? null,
        title: options.title
    };
}

/**
 * Provide no-op callback implementations for host wiring that has not yet been attached.
 */
export function createNoopGraphVisualizationUiCallbacks(): GraphVisualizationUiCallbacks {
    return {
        onOpenProject: () => {},
        onRegenerate: () => {}
    };
}
