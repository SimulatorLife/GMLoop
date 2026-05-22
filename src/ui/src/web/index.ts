import { bootstrapGraphVisualizationLitApp } from "../app/bootstrap.js";
import { resetProjectScopedGraphVisualizationUiStateInCurrentUrl } from "../app/state/url-state.js";
import type {
    GraphVisualizationData,
    GraphVisualizationLiveReloadModel,
    GraphVisualizationRenderOptions
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
    projectChanged?: boolean;
}>;

type LiveReloadStartApiResponse = Readonly<{
    error?: string;
    liveReload?: GraphVisualizationLiveReloadModel;
    ok?: boolean;
}>;

type UiRevisionApiResponse = Readonly<{
    revision?: number;
}>;

const SERVER_UI_REVISION_POLL_INTERVAL_MS = 1000;

async function readJsonResponse<TResponse>(response: Response): Promise<TResponse> {
    return (await response.json()) as TResponse;
}

function reloadWhenChanged(result: MutationApiResponse): void {
    if (result.changed === true) {
        globalThis.location.reload();
    }
}

export function startServerUiRevisionPolling(isServerMode: boolean): void {
    if (!isServerMode) {
        return;
    }

    let observedRevision: number | null = null;
    let activeRevisionRequest: Promise<void> | null = null;

    const readRevision = async (): Promise<void> => {
        try {
            const response = await fetch("/api/ui-revision", {
                cache: "no-store",
                headers: { Accept: "application/json" }
            });
            if (!response.ok) {
                return;
            }

            const payload = await readJsonResponse<UiRevisionApiResponse>(response);
            if (typeof payload.revision !== "number") {
                return;
            }

            if (observedRevision === null) {
                observedRevision = payload.revision;
                return;
            }

            if (payload.revision !== observedRevision) {
                globalThis.location.reload();
            }
        } catch {
            // Revision polling is opportunistic; transient server restarts should not break the UI.
        } finally {
            activeRevisionRequest = null;
        }
    };

    const pollRevision = (): void => {
        activeRevisionRequest ??= readRevision();
    };

    pollRevision();
    const pollTimer = globalThis.setInterval(() => {
        pollRevision();
    }, SERVER_UI_REVISION_POLL_INTERVAL_MS);
    // Expose timer reference for testability and programmatic teardown.
    // Uses a Symbol key so this is not a public API surface.
    const timerKey = Symbol.for("gmloop.ui.pollTimer");
    Object.defineProperty(globalThis, timerKey, {
        configurable: true,
        enumerable: false,
        value: pollTimer,
        writable: true
    });
}

/**
 * Stops the UI revision polling timer and removes it from globalThis.
 * Idempotent: calling when no timer exists is a no-op.
 */
export function stopServerUiRevisionPolling(): void {
    const timerKey = Symbol.for("gmloop.ui.pollTimer");
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, timerKey);
    if (descriptor?.value !== undefined) {
        globalThis.clearInterval(descriptor.value as Parameters<typeof globalThis.clearInterval>[0]);
        delete (globalThis as unknown as Record<symbol, unknown>)[timerKey];
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
        __GMLOOP_GRAPH_VISUALIZATION_DATA__?: GraphVisualizationData;
        __GMLOOP_GRAPH_VISUALIZATION_OPTIONS__?: GraphVisualizationRenderOptions;
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
        options: optionPayload
    };
}

/**
 * Register custom elements and mount the Lit graph app using window bootstrap payloads.
 */
export function mountGraphVisualizationWebApp(rootElement: HTMLElement): void {
    registerGraphVisualizationCustomElements();
    const payload = readGraphVisualizationWebBootstrapPayload();
    startServerUiRevisionPolling(payload.options.isServerMode === true);
    bootstrapGraphVisualizationLitApp({
        callbacks: {
            onOpenProject: async () => {
                const response = await fetch("/api/open", { method: "POST" });
                const result = await readJsonResponse<MutationApiResponse>(response);
                if (!response.ok || result.ok !== true) {
                    throw new Error(result.error ?? "Project open failed.");
                }
                if (result.projectChanged === true) {
                    resetProjectScopedGraphVisualizationUiStateInCurrentUrl();
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
