import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EDGE_LINE_VISUAL_STYLES, NODE_VISUAL_STYLES } from "./graph-visualization-style-metadata.js";

const GRAPH_VISUALIZATION_BROWSER_APP_MODULE_FILE_NAME = "graph-visualization-browser-app.js";
const GRAPH_VISUALIZATION_PLAYGROUND_DEFAULT_MODULE_FILE_NAME = "playground-default-gml.js";
const GRAPH_VISUALIZATION_UI_REDUCER_MODULE_FILE_NAME = "reducer.js";
const GRAPH_VISUALIZATION_URL_STATE_MODULE_FILE_NAME = "url-state.js";

function readGraphVisualizationModuleSource(
    candidateModulePaths: ReadonlyArray<string>,
    requiredSymbolName: string
): string {
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

    if (!sourceWithoutExports.includes(requiredSymbolName)) {
        throw new Error(`Graph visualization browser module source is missing ${requiredSymbolName}.`);
    }

    return sourceWithoutExports.trim();
}

function readGraphVisualizationBrowserAppModuleSource(): string {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    return readGraphVisualizationModuleSource(
        [
            path.resolve(moduleDirectory, GRAPH_VISUALIZATION_BROWSER_APP_MODULE_FILE_NAME),
            path.resolve(moduleDirectory, "../../src/graph", GRAPH_VISUALIZATION_BROWSER_APP_MODULE_FILE_NAME)
        ],
        "function bootstrapGraphVisualizationApp"
    );
}

function readGraphVisualizationPlaygroundDefaultModuleSource(): string {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    return readGraphVisualizationModuleSource(
        [
            path.resolve(moduleDirectory, "../app", GRAPH_VISUALIZATION_PLAYGROUND_DEFAULT_MODULE_FILE_NAME),
            path.resolve(moduleDirectory, "../../src/app", GRAPH_VISUALIZATION_PLAYGROUND_DEFAULT_MODULE_FILE_NAME)
        ],
        "const DEFAULT_PLAYGROUND_GML_SOURCE"
    );
}

function readGraphVisualizationUrlStateModuleSource(): string {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    return readGraphVisualizationModuleSource(
        [
            path.resolve(moduleDirectory, "../app/state", GRAPH_VISUALIZATION_URL_STATE_MODULE_FILE_NAME),
            path.resolve(moduleDirectory, "../../src/app/state", GRAPH_VISUALIZATION_URL_STATE_MODULE_FILE_NAME)
        ],
        "function parseGraphVisualizationUiStateFromUrlSearch"
    );
}

function readGraphVisualizationUiReducerModuleSource(): string {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    return readGraphVisualizationModuleSource(
        [
            path.resolve(moduleDirectory, "../app/state", GRAPH_VISUALIZATION_UI_REDUCER_MODULE_FILE_NAME),
            path.resolve(moduleDirectory, "../../src/app/state", GRAPH_VISUALIZATION_UI_REDUCER_MODULE_FILE_NAME)
        ],
        "function createInitialGraphVisualizationUiState"
    );
}

/**
 * Render the browser module source that boots the graph visualization application.
 */
export function renderGraphVisualizationClientScript(
    serializedData: string,
    serializedDocumentationCatalogs: string,
    serializedLiveReload: string,
    serializedLoadedTarget: string,
    serializedProjectConfigurationCatalog: string,
    isServerMode: boolean
): string {
    const scriptLines = [
        `const graphVisualizationData = ${serializedData};`,
        `const graphVisualizationDocumentationCatalogs = ${serializedDocumentationCatalogs};`,
        `const graphVisualizationLiveReload = ${serializedLiveReload};`,
        `const graphVisualizationLoadedTarget = ${serializedLoadedTarget};`,
        `const graphVisualizationProjectConfigurationCatalog = ${serializedProjectConfigurationCatalog};`,
        `const graphVisualizationServerMode = ${isServerMode ? "true" : "false"};`,
        `const EDGE_LINE_VISUAL_STYLES = ${JSON.stringify(EDGE_LINE_VISUAL_STYLES)};`,
        `const NODE_VISUAL_STYLES = ${JSON.stringify(NODE_VISUAL_STYLES)};`,
        "",
        "window.__GMLOOP_DOCUMENTATION_CATALOGS__ = graphVisualizationDocumentationCatalogs;",
        "window.__GMLOOP_LIVE_RELOAD__ = graphVisualizationLiveReload;",
        "window.__GMLOOP_LOADED_TARGET__ = graphVisualizationLoadedTarget;",
        "window.__GMLOOP_PROJECT_CONFIGURATION__ = graphVisualizationProjectConfigurationCatalog;",
        "",
        readGraphVisualizationUiReducerModuleSource(),
        "",
        readGraphVisualizationUrlStateModuleSource(),
        "",
        readGraphVisualizationPlaygroundDefaultModuleSource(),
        "",
        readGraphVisualizationBrowserAppModuleSource(),
        "",
        "bootstrapGraphVisualizationApp({",
        "    data: graphVisualizationData,",
        "    directoryOpen,",
        "    documentationCatalogs: graphVisualizationDocumentationCatalogs,",
        "    fileOpen,",
        "    isServerMode: graphVisualizationServerMode,",
        "    liveReload: graphVisualizationLiveReload,",
        "    loadedTarget: graphVisualizationLoadedTarget,",
        "    projectConfigurationCatalog: graphVisualizationProjectConfigurationCatalog",
        "});"
    ];

    return scriptLines.join("\n");
}
