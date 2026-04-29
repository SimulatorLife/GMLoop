import { bootstrapGraphVisualizationApp } from "./graph-visualization-browser-app.js";
import { EDGE_LINE_VISUAL_STYLES, NODE_VISUAL_STYLES } from "./graph-visualization-style-metadata.js";

/**
 * Render the browser module source that boots the graph visualization application.
 */
export function renderGraphVisualizationClientScript(
    serializedData: string,
    serializedDocumentationCatalogs: string,
    serializedLoadedTarget: string,
    serializedProjectConfigurationCatalog: string,
    isServerMode: boolean
): string {
    const scriptLines = [
        `const graphVisualizationData = ${serializedData};`,
        `const graphVisualizationDocumentationCatalogs = ${serializedDocumentationCatalogs};`,
        `const graphVisualizationLoadedTarget = ${serializedLoadedTarget};`,
        `const graphVisualizationProjectConfigurationCatalog = ${serializedProjectConfigurationCatalog};`,
        `const graphVisualizationServerMode = ${isServerMode ? "true" : "false"};`,
        `const EDGE_LINE_VISUAL_STYLES = ${JSON.stringify(EDGE_LINE_VISUAL_STYLES)};`,
        `const NODE_VISUAL_STYLES = ${JSON.stringify(NODE_VISUAL_STYLES)};`,
        "",
        "window.__GMLOOP_DOCUMENTATION_CATALOGS__ = graphVisualizationDocumentationCatalogs;",
        "window.__GMLOOP_LOADED_TARGET__ = graphVisualizationLoadedTarget;",
        "window.__GMLOOP_PROJECT_CONFIGURATION__ = graphVisualizationProjectConfigurationCatalog;",
        "",
        `(${bootstrapGraphVisualizationApp.toString()})({`,
        "    data: graphVisualizationData,",
        "    directoryOpen,",
        "    documentationCatalogs: graphVisualizationDocumentationCatalogs,",
        "    fileOpen,",
        "    isServerMode: graphVisualizationServerMode,",
        "    loadedTarget: graphVisualizationLoadedTarget,",
        "    projectConfigurationCatalog: graphVisualizationProjectConfigurationCatalog",
        "});"
    ];

    return scriptLines.join("\n");
}
