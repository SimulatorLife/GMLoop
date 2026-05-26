import type {
    GraphVisualizationData,
    GraphVisualizationDocumentationCatalogs,
    GraphVisualizationLastFixRun,
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

export type GraphVisualizationFixProgressSnapshot = Readonly<{
    logLines: ReadonlyArray<string>;
}>;

export type GraphVisualizationFixRunOptions = Readonly<{
    onProgress: (progress: GraphVisualizationFixProgressSnapshot) => void;
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
    lastFixRun: GraphVisualizationLastFixRun | null;
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
    onRunFix: (
        options?: GraphVisualizationFixRunOptions
    ) => GraphVisualizationFixRunResult | Promise<GraphVisualizationFixRunResult>;
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
        lastFixRun: options.lastFixRun ?? null,
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

/**
 * Return whether the current UI model includes graph data that can be explored.
 */
export function hasLoadedGraphIndex(model: GraphVisualizationUiModel): boolean {
    return model.data.nodes.length > 0;
}

/**
 * Return whether the current UI model includes graph edges that can be visualised.
 */
export function hasGraphEdges(model: GraphVisualizationUiModel): boolean {
    return model.data.edges.length > 0;
}

/**
 * Return whether the current UI model is associated with a loaded project target.
 */
export function hasLoadedGraphProject(model: GraphVisualizationUiModel): boolean {
    return model.loadedTarget !== null;
}
