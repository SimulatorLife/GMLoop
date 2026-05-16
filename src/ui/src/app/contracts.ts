import type {
    GraphVisualizationData,
    GraphVisualizationDocumentationCatalogs,
    GraphVisualizationLiveReloadModel,
    GraphVisualizationLiveReloadStatusSnapshot,
    GraphVisualizationLoadedTarget,
    GraphVisualizationMcpServerStatus,
    GraphVisualizationProjectConfigurationCatalog,
    GraphVisualizationRenderOptions
} from "../graph/types.js";

export type GraphVisualizationFixRunResult = Readonly<{
    logLines: ReadonlyArray<string>;
    status: "success";
}>;

/**
 * Normalized model consumed by the Lit graph visualization UI shell.
 */
export type GraphVisualizationUiModel = Readonly<{
    data: GraphVisualizationData;
    documentationCatalogs: GraphVisualizationDocumentationCatalogs | null;
    isServerMode: boolean;
    loadedTarget: GraphVisualizationLoadedTarget | null;
    liveReload: GraphVisualizationLiveReloadModel | null;
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
    onRunFix: () => GraphVisualizationFixRunResult | Promise<GraphVisualizationFixRunResult>;
    onRefreshLiveReloadStatus: () =>
        | GraphVisualizationLiveReloadStatusSnapshot
        | null
        | Promise<GraphVisualizationLiveReloadStatusSnapshot | null>;
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
        liveReload: options.liveReload ?? null,
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
        onRegenerate: () => {},
        onRunFix: () => ({ logLines: ["Fix workflow is unavailable in this host."], status: "success" }),
        onRefreshLiveReloadStatus: () => null
    };
}
