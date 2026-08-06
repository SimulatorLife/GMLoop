import type { GraphVisualizationServeBackgroundState, GraphVisualizationServePayload } from "./types.js";

function createEmptyGraphVisualizationData(): GraphVisualizationServePayload {
    return Object.freeze({
        edges: [],
        generatedAt: new Date().toISOString(),
        graphs: [],
        nodes: [],
        projectRoot: ""
    });
}

function createGraphVisualizationServeLoadingState(
    message: string,
    detail: string | null
): GraphVisualizationServeBackgroundState {
    return Object.freeze({
        detail,
        message,
        phase: "loading"
    });
}

function createGraphVisualizationServeErrorState(
    message: string,
    detail: string | null
): GraphVisualizationServeBackgroundState {
    return Object.freeze({
        detail,
        message,
        phase: "error"
    });
}

export {
    createEmptyGraphVisualizationData,
    createGraphVisualizationServeErrorState,
    createGraphVisualizationServeLoadingState
};
