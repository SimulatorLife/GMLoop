import { bootstrapGraphVisualizationLitApp } from "../app/bootstrap.js";
import type {
    GraphVisualizationData,
    GraphVisualizationDocumentationCatalogs,
    GraphVisualizationLiveReloadModel,
    GraphVisualizationLoadedTarget,
    GraphVisualizationProjectConfigurationCatalog,
    GraphVisualizationRenderOptions
} from "../graph/types.js";
import { registerGraphVisualizationCustomElements } from "./register-components.js";

type FixApiResponse = Readonly<{
    error?: string;
    logLines?: ReadonlyArray<string>;
    ok?: boolean;
}>;

/**
 * Serialized payload consumed by the web bootstrap entry.
 */
export type GraphVisualizationWebBootstrapPayload = Readonly<{
    data: GraphVisualizationData;
    options: GraphVisualizationRenderOptions;
}>;

declare global {
    interface Window {
        __GMLOOP_DOCUMENTATION_CATALOGS__?: GraphVisualizationDocumentationCatalogs;
        __GMLOOP_GRAPH_VISUALIZATION_DATA__?: GraphVisualizationData;
        __GMLOOP_GRAPH_VISUALIZATION_OPTIONS__?: GraphVisualizationRenderOptions;
        __GMLOOP_LOADED_TARGET__?: GraphVisualizationLoadedTarget;
        __GMLOOP_LIVE_RELOAD__?: GraphVisualizationLiveReloadModel;
        __GMLOOP_PROJECT_CONFIGURATION__?: GraphVisualizationProjectConfigurationCatalog;
    }
}

function readGraphVisualizationWebBootstrapPayload(): GraphVisualizationWebBootstrapPayload {
    const graphData = globalThis.__GMLOOP_GRAPH_VISUALIZATION_DATA__;
    if (!graphData) {
        throw new Error("Missing window.__GMLOOP_GRAPH_VISUALIZATION_DATA__ payload.");
    }

    const optionPayload = globalThis.__GMLOOP_GRAPH_VISUALIZATION_OPTIONS__;
    if (!optionPayload) {
        throw new Error("Missing window.__GMLOOP_GRAPH_VISUALIZATION_OPTIONS__ payload.");
    }

    return {
        data: graphData,
        options: {
            ...optionPayload,
            documentationCatalogs: optionPayload.documentationCatalogs ?? globalThis.__GMLOOP_DOCUMENTATION_CATALOGS__,
            loadedTarget: optionPayload.loadedTarget ?? globalThis.__GMLOOP_LOADED_TARGET__,
            liveReload: optionPayload.liveReload ?? globalThis.__GMLOOP_LIVE_RELOAD__,
            projectConfigurationCatalog:
                optionPayload.projectConfigurationCatalog ?? globalThis.__GMLOOP_PROJECT_CONFIGURATION__
        }
    };
}

/**
 * Register custom elements and mount the Lit graph app using window bootstrap payloads.
 */
export function mountGraphVisualizationWebApp(rootElement: HTMLElement): void {
    registerGraphVisualizationCustomElements();
    const payload = readGraphVisualizationWebBootstrapPayload();
    bootstrapGraphVisualizationLitApp({
        callbacks: {
            onRunFix: async () => {
                const response = await fetch("/api/fix", { method: "POST" });
                const result = (await response.json()) as FixApiResponse;
                if (!response.ok || result.ok !== true) {
                    throw new Error(result.error ?? "Fix workflow failed.");
                }

                return {
                    logLines: result.logLines ?? [],
                    status: "success"
                };
            }
        },
        data: payload.data,
        options: payload.options,
        rootElement
    });
}
