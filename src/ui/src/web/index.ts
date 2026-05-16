import { bootstrapGraphVisualizationLitApp } from "../app/bootstrap.js";
import type {
    GraphVisualizationData,
    GraphVisualizationDocumentationCatalogs,
    GraphVisualizationLiveReloadModel,
    GraphVisualizationLoadedTarget,
    GraphVisualizationProjectConfigurationCatalog,
    GraphVisualizationRenderOptions,
    GraphVisualizationStartupState
} from "../graph/types.js";
import { registerGraphVisualizationCustomElements } from "./register-components.js";

type FixApiResponse = Readonly<{
    error?: string;
    logLines?: ReadonlyArray<string>;
    ok?: boolean;
}>;

type MutationApiResponse = Readonly<{
    changed?: boolean;
    error?: string;
    ok?: boolean;
}>;

type LiveReloadStartApiResponse = Readonly<{
    error?: string;
    liveReload?: GraphVisualizationLiveReloadModel;
    ok?: boolean;
}>;

async function readJsonResponse<TResponse>(response: Response): Promise<TResponse> {
    return (await response.json()) as TResponse;
}

function reloadWhenChanged(result: MutationApiResponse): void {
    if (result.changed === true) {
        globalThis.location.reload();
    }
}

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
        __GMLOOP_STARTUP_STATE__?: GraphVisualizationStartupState;
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
                optionPayload.projectConfigurationCatalog ?? globalThis.__GMLOOP_PROJECT_CONFIGURATION__,
            startupState: optionPayload.startupState ?? globalThis.__GMLOOP_STARTUP_STATE__
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
            onOpenProject: async () => {
                const response = await fetch("/api/open", { method: "POST" });
                const result = await readJsonResponse<MutationApiResponse>(response);
                if (!response.ok || result.ok !== true) {
                    throw new Error(result.error ?? "Project open failed.");
                }
                reloadWhenChanged(result);
            },
            onRegenerate: async () => {
                const response = await fetch("/api/reindex", { method: "POST" });
                const result = await readJsonResponse<MutationApiResponse>(response);
                if (!response.ok || result.ok !== true) {
                    throw new Error(result.error ?? "Regeneration failed.");
                }
                reloadWhenChanged(result);
                return { changed: result.changed === true };
            },
            onRunFix: async () => {
                const response = await fetch("/api/fix", { method: "POST" });
                const result = await readJsonResponse<FixApiResponse>(response);
                if (!response.ok || result.ok !== true) {
                    throw new Error(result.error ?? "Fix workflow failed.");
                }

                return {
                    logLines: result.logLines ?? [],
                    status: "success"
                };
            },
            onStartLiveReload: async () => {
                const response = await fetch("/api/live-reload/start", {
                    body: JSON.stringify({ restart: false }),
                    headers: { "Content-Type": "application/json" },
                    method: "POST"
                });
                const result = await readJsonResponse<LiveReloadStartApiResponse>(response);
                if (!response.ok || result.ok !== true) {
                    throw new Error(result.error ?? "Live reload startup failed.");
                }

                return result.liveReload ?? null;
            }
        },
        data: payload.data,
        options: payload.options,
        rootElement
    });
}
