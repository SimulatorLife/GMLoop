import { html } from "lit";

import type { GraphVisualizationProjectWorkflow } from "../../graph/types.js";
import {
    createNoopGraphVisualizationUiCallbacks,
    type GraphVisualizationUiCallbacks,
    type GraphVisualizationUiModel,
    hasLoadedGraphIndex,
    hasLoadedGraphProject
} from "../contracts.js";
import { getUiErrorMessage } from "../error-message.js";
import { createInitialFixWorkflowLogLines, createRunningFixWorkflowLogLines } from "../fix-workflow-progress.js";
import { GraphVisualizationUiStore } from "../state/store.js";
import type {
    GraphVisualizationUiDocsView,
    GraphVisualizationUiPage,
    GraphVisualizationUiState
} from "../state/types.js";
import {
    readGraphVisualizationUiStateFromCurrentUrl,
    replaceGraphVisualizationUiStateInCurrentUrl
} from "../state/url-state.js";
import { EventBusManager } from "./event-bus-mixin.js";
import {
    GRAPH_UI_EVENT_CLEAR_PAGE_ERROR,
    GRAPH_UI_EVENT_CYCLE_LABEL_MODE,
    GRAPH_UI_EVENT_NAVIGATE_PAGE,
    GRAPH_UI_EVENT_RESET_DEFAULTS,
    GRAPH_UI_EVENT_SAVE_CONFIG,
    GRAPH_UI_EVENT_SET_CONFIG_VIEW,
    GRAPH_UI_EVENT_SET_DOCS_VIEW,
    GRAPH_UI_EVENT_SET_SEARCH_QUERY,
    GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW,
    GRAPH_UI_EVENT_TRIGGER_CREATE_CONFIG,
    GRAPH_UI_EVENT_TRIGGER_FIX,
    GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT,
    GRAPH_UI_EVENT_TRIGGER_REGENERATE,
    GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD,
    GRAPH_UI_EVENT_TRIGGER_STOP_LIVE_RELOAD,
    type GraphUiClearPageErrorDetail,
    type GraphUiSaveConfigDetail,
    type GraphUiSetConfigViewDetail,
    type GraphUiTriggerFixDetail
} from "./events.js";
import { LifecycleParticipantsController } from "./lifecycle-participants-controller.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

const LIVE_RELOAD_ERROR_ACTION_TYPE = "set-live-reload-error";
const FIX_LOG_LINES_ACTION_TYPE = "set-fix-log-lines";

const PAGE_MAIN_SECTION_ID: Readonly<Record<GraphVisualizationUiPage, string>> = Object.freeze({
    config: "config-page",
    docs: "docs-page",
    fix: "fix-page",
    graph: "graph-page",
    "live-reload": "live-reload-page",
    "auto-game": "auto-game-page",
    playground: "playground-page"
});

/**
 * Root app shell that composes header, toolbar, and graph/docs/config surfaces.
 *
 * Event subscriptions are managed by an injected `EventBusManager` collaborator,
 * which auto-registers listeners on `connectedCallback` and tears them down
 * in reverse order on `disconnectedCallback`.
 */
export class GmAppShell extends LightDomLitElement {
    public static override properties = {
        callbacks: { attribute: false },
        model: { attribute: false }
    };

    public accessor callbacks: GraphVisualizationUiCallbacks = createNoopGraphVisualizationUiCallbacks();

    public accessor model: GraphVisualizationUiModel | null = null;

    #state: GraphVisualizationUiState;

    #store: GraphVisualizationUiStore;

    /**
     * Manages the lifecycle of event listeners for UI interactions.
     * Initialized in the constructor; connected on `connectedCallback`
     * and torn down on `disconnectedCallback`.
     */
    #eventBus: EventBusManager;

    // ─── Private handlers (access #state and #store via closure) ───────────────

    #onNavigatePage = (eventValue: Event): void => {
        if (!this.model) {
            return;
        }

        const targetPage = (eventValue as CustomEvent<{ page: GraphVisualizationUiPage }>).detail.page;
        if (targetPage === "graph" && !hasLoadedGraphIndex(this.model)) {
            return;
        }

        this.#store.dispatch({
            page: targetPage,
            type: "navigate-page"
        });
    };

    #onSetDocsView = (eventValue: Event): void => {
        this.#store.dispatch({
            docsView: (eventValue as CustomEvent<{ docsView: GraphVisualizationUiDocsView }>).detail.docsView,
            type: "set-docs-view"
        });
    };

    #onSetConfigView = (eventValue: Event): void => {
        this.#store.dispatch({
            configView: (eventValue as CustomEvent<GraphUiSetConfigViewDetail>).detail.configView,
            type: "set-config-view"
        });
    };

    #onSetSearchQuery = (eventValue: Event): void => {
        if (!this.model) {
            return;
        }

        if (this.#state.activePage === "graph" && !hasLoadedGraphIndex(this.model)) {
            return;
        }

        this.#store.dispatch({
            searchQuery: (eventValue as CustomEvent<{ searchQuery: string }>).detail.searchQuery,
            type: "set-search-query"
        });
    };

    #onToggleGraphView = (): void => {
        if (!this.model || !hasLoadedGraphIndex(this.model)) {
            return;
        }

        this.#store.dispatch({ type: "toggle-graph-view" });
    };

    #onCycleLabelMode = (): void => {
        if (!this.model || !hasLoadedGraphIndex(this.model)) {
            return;
        }

        this.#store.dispatch({ type: "cycle-label-mode" });
    };

    #onResetDefaults = (): void => {
        if (!this.model || !hasLoadedGraphIndex(this.model)) {
            return;
        }

        this.#store.dispatch({ type: "reset-defaults" });
    };

    #onTriggerOpenProject = (): void => {
        void this.#runHostActionWithPendingState("set-open-project-pending", "graph", this.callbacks.onOpenProject);
    };

    #onTriggerRegenerate = (): void => {
        if (!this.model || !this.model.isServerMode || !hasLoadedGraphProject(this.model)) {
            return;
        }

        void this.#runHostActionWithPendingState("set-regenerate-pending", "graph", this.callbacks.onRegenerate);
    };

    #onTriggerCreateConfig = (): void => {
        if (!this.model || !hasLoadedGraphProject(this.model) || !this.callbacks.onCreateConfig) {
            return;
        }

        void this.#runHostActionWithPendingState("set-regenerate-pending", "config", this.callbacks.onCreateConfig);
    };

    #onSaveConfig = (eventValue: Event): void => {
        if (!this.model || !hasLoadedGraphProject(this.model)) {
            return;
        }

        const config = (eventValue as CustomEvent<GraphUiSaveConfigDetail>).detail.config;
        void this.#runHostActionWithPendingState("set-config-save-pending", "config", () =>
            this.callbacks.onSaveConfig(config)
        );
    };

    #onTriggerFix = (eventValue: Event): void => {
        if (!this.model || !hasLoadedGraphProject(this.model)) {
            return;
        }

        const workflow = (eventValue as CustomEvent<GraphUiTriggerFixDetail>).detail.workflow;
        void this.#runFixWorkflow(workflow);
    };

    #onTriggerStartLiveReload = (): void => {
        void this.#startLiveReload();
    };

    #onTriggerStopLiveReload = (): void => {
        void this.#stopLiveReload();
    };

    #onDismissErrorBanner = (): void => {
        this.#store.dispatch({ type: "clear-error" });
    };

    #onClearPageError = (event: Event): void => {
        const customEvent = event as CustomEvent<GraphUiClearPageErrorDetail>;
        this.#store.dispatch({ page: customEvent.detail.page, type: "clear-page-error" });
    };

    public constructor() {
        super();
        this.#store = new GraphVisualizationUiStore(readGraphVisualizationUiStateFromCurrentUrl());
        this.#state = this.#store.getState();

        this.#eventBus = new EventBusManager(this, [
            { event: GRAPH_UI_EVENT_NAVIGATE_PAGE, handler: this.#onNavigatePage },
            { event: GRAPH_UI_EVENT_SET_DOCS_VIEW, handler: this.#onSetDocsView },
            { event: GRAPH_UI_EVENT_SET_SEARCH_QUERY, handler: this.#onSetSearchQuery },
            { event: GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW, handler: this.#onToggleGraphView },
            { event: GRAPH_UI_EVENT_CYCLE_LABEL_MODE, handler: this.#onCycleLabelMode },
            { event: GRAPH_UI_EVENT_RESET_DEFAULTS, handler: this.#onResetDefaults },
            { event: GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT, handler: this.#onTriggerOpenProject },
            { event: GRAPH_UI_EVENT_TRIGGER_REGENERATE, handler: this.#onTriggerRegenerate },
            { event: GRAPH_UI_EVENT_TRIGGER_CREATE_CONFIG, handler: this.#onTriggerCreateConfig },
            { event: GRAPH_UI_EVENT_SAVE_CONFIG, handler: this.#onSaveConfig },
            { event: GRAPH_UI_EVENT_SET_CONFIG_VIEW, handler: this.#onSetConfigView },
            { event: GRAPH_UI_EVENT_TRIGGER_FIX, handler: this.#onTriggerFix },
            { event: GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD, handler: this.#onTriggerStartLiveReload },
            { event: GRAPH_UI_EVENT_TRIGGER_STOP_LIVE_RELOAD, handler: this.#onTriggerStopLiveReload },
            { event: GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, handler: this.#onClearPageError },
            { event: "dismiss", handler: this.#onDismissErrorBanner }
        ]);

        // Subscribe to store and persist URL state on changes
        const unsubscribeStore = this.#store.subscribe((nextState) => {
            this.#state = nextState;
            replaceGraphVisualizationUiStateInCurrentUrl(nextState);
            this.requestUpdate();
        });

        new LifecycleParticipantsController(this, [
            createStoreUnsubscribeParticipant(unsubscribeStore),
            this.#eventBus
        ]);
    }

    async #runHostActionWithPendingState(
        pendingType: "set-config-save-pending" | "set-open-project-pending" | "set-regenerate-pending",
        page: GraphVisualizationUiPage,
        hostAction:
            | GraphVisualizationUiCallbacks["onOpenProject"]
            | GraphVisualizationUiCallbacks["onRegenerate"]
            | NonNullable<GraphVisualizationUiCallbacks["onCreateConfig"]>
    ): Promise<void> {
        try {
            this.#store.dispatch({ pending: true, type: pendingType });
            this.#store.dispatch({ errorMessage: null, page, type: "set-page-error" });
            await hostAction();
        } catch (error) {
            const message = getUiErrorMessage(error, "Unknown error");
            this.#store.dispatch({ errorMessage: message, page, type: "set-page-error" });
        } finally {
            this.#store.dispatch({ pending: false, type: pendingType });
        }
    }

    async #startLiveReload(): Promise<void> {
        if (!this.model || !this.model.isServerMode) {
            return;
        }
        if (this.#state.isLiveReloadStartPending) {
            return;
        }

        try {
            this.#store.dispatch({ pending: true, type: "set-live-reload-start-pending" });
            this.#store.dispatch({ errorMessage: null, type: LIVE_RELOAD_ERROR_ACTION_TYPE });
            const liveReload = await this.callbacks.onStartLiveReload();
            if (liveReload !== null) {
                this.model = {
                    ...this.model,
                    liveReload
                };
            }
        } catch (error) {
            const message = getUiErrorMessage(error, "Unknown live-reload startup error");
            this.#store.dispatch({ errorMessage: message, type: LIVE_RELOAD_ERROR_ACTION_TYPE });
        } finally {
            this.#store.dispatch({ pending: false, type: "set-live-reload-start-pending" });
        }
    }

    async #stopLiveReload(): Promise<void> {
        if (!this.model || this.model.liveReload === null) {
            return;
        }

        try {
            await this.callbacks.onStopLiveReload();
            this.model = {
                ...this.model,
                liveReload: null
            };
            this.#store.dispatch({ errorMessage: null, type: LIVE_RELOAD_ERROR_ACTION_TYPE });
        } catch (error) {
            const message = getUiErrorMessage(error, "Unknown live-reload stop error");
            this.#store.dispatch({ errorMessage: message, type: LIVE_RELOAD_ERROR_ACTION_TYPE });
        }
    }

    async #runFixWorkflow(workflow: GraphVisualizationProjectWorkflow): Promise<void> {
        const fixWorkflowStartedAt = Date.now();
        let hasReceivedFixProgress = false;
        const fixWorkflowProgressTimer = setInterval(() => {
            if (hasReceivedFixProgress) {
                return;
            }
            this.#store.dispatch({
                logLines: createRunningFixWorkflowLogLines(Date.now() - fixWorkflowStartedAt, workflow),
                type: FIX_LOG_LINES_ACTION_TYPE
            });
        }, 1000);

        try {
            this.#store.dispatch({ pending: true, type: "set-fix-pending", workflow });
            this.#store.dispatch({ errorMessage: null, type: "set-fix-error" });
            this.#store.dispatch({
                logLines: createInitialFixWorkflowLogLines(workflow),
                type: FIX_LOG_LINES_ACTION_TYPE
            });
            const result = await this.callbacks.onRunFix({
                workflow,
                onProgress: (progress) => {
                    if (progress.logLines.length === 0) {
                        return;
                    }
                    if (!hasReceivedFixProgress) {
                        hasReceivedFixProgress = true;
                        clearInterval(fixWorkflowProgressTimer);
                    }
                    this.#store.dispatch({ logLines: progress.logLines, type: FIX_LOG_LINES_ACTION_TYPE });
                }
            });
            this.#store.dispatch({ logLines: result.logLines, type: FIX_LOG_LINES_ACTION_TYPE });
            this.#store.dispatch({ status: result.status, type: "set-fix-status" });
        } catch (error) {
            const message = getUiErrorMessage(error, "Unknown fix workflow error");
            this.#store.dispatch({ errorMessage: message, type: "set-fix-error" });
            this.#store.dispatch({ status: "error", type: "set-fix-status" });
        } finally {
            clearInterval(fixWorkflowProgressTimer);
            this.#store.dispatch({ pending: false, type: "set-fix-pending", workflow });
        }
    }

    protected override render() {
        if (!this.model) {
            return html``;
        }

        return html`
            <a class="skip-link" href=${`#${PAGE_MAIN_SECTION_ID[this.#state.activePage]}`}>Skip to content</a>
            <div id="app-shell">
                <gm-app-header .model=${this.model} .state=${this.#state}></gm-app-header>
                <gm-page-toolbar .model=${this.model} .state=${this.#state}></gm-page-toolbar>
                <main>
                    <gm-graph-panel .model=${this.model} .state=${this.#state}></gm-graph-panel>
                    <gm-playground-panel .model=${this.model} .state=${this.#state}></gm-playground-panel>
                    <gm-docs-panel .model=${this.model} .state=${this.#state}></gm-docs-panel>
                    <gm-config-panel .model=${this.model} .state=${this.#state}></gm-config-panel>
                    <gm-fix-panel .model=${this.model} .state=${this.#state}></gm-fix-panel>
                    <gm-auto-game-panel .model=${this.model} .state=${this.#state}></gm-auto-game-panel>
                    <gm-live-reload-panel .model=${this.model} .state=${this.#state}></gm-live-reload-panel>
                </main>
            </div>
        `;
    }
}

function createStoreUnsubscribeParticipant(unsubscribe: () => void) {
    let cleanup: (() => void) | null = unsubscribe;
    return Object.freeze({
        connect(): void {
            // No-op: store subscription is created in the constructor; this participant only handles cleanup.
        },
        disconnect(): void {
            cleanup?.();
            cleanup = null;
        }
    });
}
