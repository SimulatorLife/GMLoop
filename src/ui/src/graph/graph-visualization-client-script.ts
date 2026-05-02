import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EDGE_LINE_VISUAL_STYLES, NODE_VISUAL_STYLES } from "./graph-visualization-style-metadata.js";

const GRAPH_VISUALIZATION_BROWSER_APP_MODULE_FILE_NAME = "graph-visualization-browser-app.js";

function readGraphVisualizationBrowserAppModuleSource(): string {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    const candidateModulePaths = [
        path.resolve(moduleDirectory, GRAPH_VISUALIZATION_BROWSER_APP_MODULE_FILE_NAME),
        path.resolve(moduleDirectory, "../../dist/src/graph", GRAPH_VISUALIZATION_BROWSER_APP_MODULE_FILE_NAME)
    ];

    let moduleSource = "";
    for (const candidatePath of candidateModulePaths) {
        try {
            moduleSource = readFileSync(candidatePath, "utf8");
            break;
        } catch {
            continue;
        }
    }

    if (moduleSource.length === 0) {
        throw new Error("Unable to resolve the graph visualization browser module source.");
    }

    const sourceWithoutImports = moduleSource.replaceAll(/^\s*import\s+.+?;\s*$/gmu, "");
    const sourceWithoutSourceMap = sourceWithoutImports.replaceAll(/\n\/\/# sourceMappingURL=.*$/gmu, "");
    const sourceWithoutExports = sourceWithoutSourceMap.replaceAll(/^export\s+/gmu, "");

    if (!sourceWithoutExports.includes("function bootstrapGraphVisualizationApp")) {
        throw new Error("Graph visualization browser module source is missing bootstrapGraphVisualizationApp.");
    }

    return sourceWithoutExports.trim();
}

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
        readGraphVisualizationBrowserAppModuleSource(),
        "",
        "bootstrapGraphVisualizationApp({",
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
