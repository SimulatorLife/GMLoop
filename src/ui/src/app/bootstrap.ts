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
        onOpenProject?: GraphVisualizationUiCallbacks["onOpenProject"];
        onRegenerate?: GraphVisualizationUiCallbacks["onRegenerate"];
        onCreateConfig?: GraphVisualizationUiCallbacks["onCreateConfig"];
        onSaveConfig?: GraphVisualizationUiCallbacks["onSaveConfig"];
        onRunFix?: GraphVisualizationUiCallbacks["onRunFix"];
        onStartLiveReload?: GraphVisualizationUiCallbacks["onStartLiveReload"];
        onStopLiveReload?: GraphVisualizationUiCallbacks["onStopLiveReload"];
        onInitializeAutoGameAgentPack?: GraphVisualizationUiCallbacks["onInitializeAutoGameAgentPack"];
        onSetAutoGameSkillEnabled?: GraphVisualizationUiCallbacks["onSetAutoGameSkillEnabled"];
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
        onCreateConfig: dependencies.callbacks?.onCreateConfig ?? defaultCallbacks.onCreateConfig,
        onSaveConfig: dependencies.callbacks?.onSaveConfig ?? defaultCallbacks.onSaveConfig,
        onRunFix: dependencies.callbacks?.onRunFix ?? defaultCallbacks.onRunFix,
        onStartLiveReload: dependencies.callbacks?.onStartLiveReload ?? defaultCallbacks.onStartLiveReload,
        onStopLiveReload: dependencies.callbacks?.onStopLiveReload ?? defaultCallbacks.onStopLiveReload,
        onInitializeAutoGameAgentPack:
            dependencies.callbacks?.onInitializeAutoGameAgentPack ?? defaultCallbacks.onInitializeAutoGameAgentPack,
        onSetAutoGameSkillEnabled:
            dependencies.callbacks?.onSetAutoGameSkillEnabled ?? defaultCallbacks.onSetAutoGameSkillEnabled
    };

    Reflect.set(appElement, "model", model);
    Reflect.set(appElement, "callbacks", callbacks);

    dependencies.rootElement.replaceChildren(appElement);
}
