import "./components/index.js";

import type { GraphVisualizationData, GraphVisualizationRenderOptions } from "../graph/types.js";
import {
    createGraphVisualizationUiModel,
    createNoopGraphVisualizationUiCallbacks,
    type GraphVisualizationUiCallbacks
} from "./contracts.js";

/**
 * Dependencies required to mount the Lit graph visualization app shell.
 */
export type GraphVisualizationAppBootstrapDependencies = Readonly<{
    callbacks?: Readonly<{
        onOpenProject?: () => void | Promise<void>;
        onRegenerate?: () => void | Promise<void>;
        onRunFix?: GraphVisualizationUiCallbacks["onRunFix"];
        onStartLiveReload?: GraphVisualizationUiCallbacks["onStartLiveReload"];
        onRefreshLiveReloadStatus?: GraphVisualizationUiCallbacks["onRefreshLiveReloadStatus"];
    }>;
    data: GraphVisualizationData;
    options: GraphVisualizationRenderOptions;
    rootElement: HTMLElement;
}>;

/**
 * Mount the graph visualization Lit UI application into a host element.
 */
export function bootstrapGraphVisualizationLitApp(dependencies: GraphVisualizationAppBootstrapDependencies): void {
    const appElement = document.createElement("gm-app-shell");
    const model = createGraphVisualizationUiModel(dependencies.data, dependencies.options);
    const defaultCallbacks = createNoopGraphVisualizationUiCallbacks();
    const callbacks: GraphVisualizationUiCallbacks = {
        onOpenProject: dependencies.callbacks?.onOpenProject ?? defaultCallbacks.onOpenProject,
        onRegenerate: dependencies.callbacks?.onRegenerate ?? defaultCallbacks.onRegenerate,
        onRunFix: dependencies.callbacks?.onRunFix ?? defaultCallbacks.onRunFix,
        onStartLiveReload: dependencies.callbacks?.onStartLiveReload ?? defaultCallbacks.onStartLiveReload,
        onRefreshLiveReloadStatus:
            dependencies.callbacks?.onRefreshLiveReloadStatus ?? defaultCallbacks.onRefreshLiveReloadStatus
    };

    Reflect.set(appElement, "model", model);
    Reflect.set(appElement, "callbacks", callbacks);

    dependencies.rootElement.replaceChildren(appElement);
}
