import { Core } from "@gmloop/core";
import { html } from "lit";

import {
    createNoopGraphVisualizationUiCallbacks,
    type GraphVisualizationUiCallbacks,
    type GraphVisualizationUiModel
} from "../contracts.js";
import { hasLoadedGraphIndex, hasLoadedGraphProject } from "../graph-availability.js";
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
    GRAPH_UI_EVENT_CYCLE_LABEL_MODE,
    GRAPH_UI_EVENT_NAVIGATE_PAGE,
    GRAPH_UI_EVENT_RESET_DEFAULTS,
    GRAPH_UI_EVENT_SET_DOCS_VIEW,
    GRAPH_UI_EVENT_SET_SEARCH_QUERY,
    GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW,
    GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT,
    GRAPH_UI_EVENT_TRIGGER_REFRESH_LIVE_RELOAD,
    GRAPH_UI_EVENT_TRIGGER_REGENERATE
} from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

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

    /**
     * Store subscription handle for URL persistence. Populated in the
     * constructor and cleaned up when the element disconnects.
     */
    #unsubscribeStore: (() => void) | null = null;

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

    #onSetSearchQuery = (eventValue: Event): void => {
        if (!this.model || !hasLoadedGraphIndex(this.model)) {
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
        void this.#runHostActionWithPendingState("set-open-project-pending", this.callbacks.onOpenProject);
    };

    #onTriggerRegenerate = (): void => {
        if (!this.model || !hasLoadedGraphProject(this.model)) {
            return;
        }

        void this.#runHostActionWithPendingState("set-regenerate-pending", this.callbacks.onRegenerate);
    };

    #onTriggerRefreshLiveReload = (): void => {
        void this.#refreshLiveReloadStatus();
    };

    #onDismissErrorBanner = (): void => {
        this.#store.dispatch({ type: "clear-error" });
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
            { event: GRAPH_UI_EVENT_TRIGGER_REFRESH_LIVE_RELOAD, handler: this.#onTriggerRefreshLiveReload },
            { event: "dismiss", handler: this.#onDismissErrorBanner }
        ]);

        // Subscribe to store and persist URL state on changes
        this.#unsubscribeStore = this.#store.subscribe((nextState) => {
            this.#state = nextState;
            replaceGraphVisualizationUiStateInCurrentUrl(nextState);
            this.requestUpdate();
        });
    }

    public override connectedCallback(): void {
        super.connectedCallback();
        this.#eventBus.connect();
    }

    public override disconnectedCallback(): void {
        this.#eventBus.disconnect();
        this.#unsubscribeStore?.();
        this.#unsubscribeStore = null;

        super.disconnectedCallback();
    }

    async #runHostActionWithPendingState(
        pendingType: "set-open-project-pending" | "set-regenerate-pending",
        hostAction: () => void | Promise<void>
    ): Promise<void> {
        try {
            this.#store.dispatch({ pending: true, type: pendingType });
            this.#store.dispatch({ errorMessage: null, type: "set-error" });
            await hostAction();
        } catch (error) {
            const message = Core.getErrorMessage(error, { fallback: "Unknown error" });
            this.#store.dispatch({ errorMessage: message, type: "set-error" });
        } finally {
            this.#store.dispatch({ pending: false, type: pendingType });
        }
    }

    async #refreshLiveReloadStatus(): Promise<void> {
        try {
            this.#store.dispatch({ pending: true, type: "set-live-reload-refresh-pending" });
            this.#store.dispatch({ errorMessage: null, type: "set-live-reload-error" });
            const status = await this.callbacks.onRefreshLiveReloadStatus();
            this.#store.dispatch({ status, type: "set-live-reload-status" });
        } catch (error) {
            const message = Core.getErrorMessage(error, { fallback: "Unknown live-reload status error" });
            this.#store.dispatch({ errorMessage: message, type: "set-live-reload-error" });
        } finally {
            this.#store.dispatch({ pending: false, type: "set-live-reload-refresh-pending" });
        }
    }

    protected override render() {
        if (!this.model) {
            return html``;
        }

        return html`
            <a class="skip-link" href="#graph-page">Skip to content</a>
            <div id="app-shell">
                <gm-app-header .model=${this.model} .state=${this.#state}></gm-app-header>
                <gm-graph-toolbar .model=${this.model} .state=${this.#state}></gm-graph-toolbar>
                ${this.#state.errorMessage
                    ? html`<gm-error-banner
                          .message=${this.#state.errorMessage}
                          @gm-error-banner-dismiss=${this.#onDismissErrorBanner}
                      ></gm-error-banner>`
                    : null}
                <main>
                    <gm-graph-panel .model=${this.model} .state=${this.#state}></gm-graph-panel>
                    <gm-playground-panel .model=${this.model} .state=${this.#state}></gm-playground-panel>
                    <gm-docs-panel .model=${this.model} .state=${this.#state}></gm-docs-panel>
                    <gm-config-panel .model=${this.model} .state=${this.#state}></gm-config-panel>
                    <gm-mcp-panel .model=${this.model} .state=${this.#state}></gm-mcp-panel>
                    <gm-live-reload-panel .model=${this.model} .state=${this.#state}></gm-live-reload-panel>
                </main>
            </div>
        `;
    }
}
