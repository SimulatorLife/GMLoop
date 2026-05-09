import type { GraphVisualizationUiModel } from "./contracts.js";

/**
 * Return whether the current UI model includes graph data that can be explored.
 */
export function hasLoadedGraphIndex(model: GraphVisualizationUiModel): boolean {
    return model.data.nodes.length > 0;
}

/**
 * Return whether the current UI model is associated with a loaded project target.
 */
export function hasLoadedGraphProject(model: GraphVisualizationUiModel): boolean {
    return model.loadedTarget !== null;
}
