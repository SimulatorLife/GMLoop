import type {
    GraphVisualizationData,
    GraphVisualizationDocumentationCatalogs,
    GraphVisualizationLiveReloadModel,
    GraphVisualizationLiveReloadStatusSnapshot,
    GraphVisualizationLoadedTarget,
    GraphVisualizationMcpServerStatus,
    GraphVisualizationProjectConfigurationCatalog,
    GraphVisualizationRenderOptions,
    GraphVisualizationStartupState
} from "../graph/types.js";

export type GraphVisualizationFixRunResult = Readonly<{
    logLines: ReadonlyArray<string>;
    status: "success";
}>;

export type GraphVisualizationHostMutationResult = Readonly<{
    changed: boolean;
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
    startupState: GraphVisualizationStartupState | null;
    title: string;
}>;

/**
 * Host callbacks invoked from UI actions.
 */
export type GraphVisualizationUiCallbacks = Readonly<{
    onOpenProject: () => void | Promise<void>;
    onRegenerate: () =>
        | GraphVisualizationHostMutationResult
        | void
        | Promise<GraphVisualizationHostMutationResult | void>;
    onRunFix: () => GraphVisualizationFixRunResult | Promise<GraphVisualizationFixRunResult>;
    onStartLiveReload: () =>
        | GraphVisualizationLiveReloadModel
        | null
        | Promise<GraphVisualizationLiveReloadModel | null>;
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
        startupState: options.startupState ?? null,
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
        onStartLiveReload: () => null,
        onRefreshLiveReloadStatus: () => null
    };
}
