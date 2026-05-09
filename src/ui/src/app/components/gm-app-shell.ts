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
import {
    GRAPH_UI_EVENT_CYCLE_LABEL_MODE,
    GRAPH_UI_EVENT_NAVIGATE_PAGE,
    GRAPH_UI_EVENT_RESET_DEFAULTS,
    GRAPH_UI_EVENT_SET_DOCS_VIEW,
    GRAPH_UI_EVENT_SET_SEARCH_QUERY,
    GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW,
    GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT,
    GRAPH_UI_EVENT_TRIGGER_REGENERATE
} from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * Root app shell that composes header, toolbar, and graph/docs/config surfaces.
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
     * Unsubscribes from the store. Populated in `connectedCallback` and
     * cleaned up in `disconnectedCallback` so the pair stays in sync.
     */
    #unsubscribe: (() => void) | null = null;

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

    public constructor() {
        super();
        this.#store = new GraphVisualizationUiStore(readGraphVisualizationUiStateFromCurrentUrl());
        this.#state = this.#store.getState();
    }

    public override connectedCallback(): void {
        super.connectedCallback();

        // Register all event listeners
        this.addEventListener(GRAPH_UI_EVENT_NAVIGATE_PAGE, this.#onNavigatePage);
        this.addEventListener(GRAPH_UI_EVENT_SET_DOCS_VIEW, this.#onSetDocsView);
        this.addEventListener(GRAPH_UI_EVENT_SET_SEARCH_QUERY, this.#onSetSearchQuery);
        this.addEventListener(GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW, this.#onToggleGraphView);
        this.addEventListener(GRAPH_UI_EVENT_CYCLE_LABEL_MODE, this.#onCycleLabelMode);
        this.addEventListener(GRAPH_UI_EVENT_RESET_DEFAULTS, this.#onResetDefaults);
        this.addEventListener(GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT, this.#onTriggerOpenProject);
        this.addEventListener(GRAPH_UI_EVENT_TRIGGER_REGENERATE, this.#onTriggerRegenerate);

        // Subscribe to store and persist URL state on changes
        this.#unsubscribe = this.#store.subscribe((nextState) => {
            this.#state = nextState;
            replaceGraphVisualizationUiStateInCurrentUrl(nextState);
            this.requestUpdate();
        });
    }

    public override disconnectedCallback(): void {
        // Unregister all event listeners in reverse order of registration
        this.removeEventListener(GRAPH_UI_EVENT_TRIGGER_REGENERATE, this.#onTriggerRegenerate);
        this.removeEventListener(GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT, this.#onTriggerOpenProject);
        this.removeEventListener(GRAPH_UI_EVENT_RESET_DEFAULTS, this.#onResetDefaults);
        this.removeEventListener(GRAPH_UI_EVENT_CYCLE_LABEL_MODE, this.#onCycleLabelMode);
        this.removeEventListener(GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW, this.#onToggleGraphView);
        this.removeEventListener(GRAPH_UI_EVENT_SET_SEARCH_QUERY, this.#onSetSearchQuery);
        this.removeEventListener(GRAPH_UI_EVENT_SET_DOCS_VIEW, this.#onSetDocsView);
        this.removeEventListener(GRAPH_UI_EVENT_NAVIGATE_PAGE, this.#onNavigatePage);

        this.#unsubscribe?.();
        this.#unsubscribe = null;

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
                    ? html`<div class="error-banner" role="alert" tabindex="-1">${this.#state.errorMessage}</div>`
                    : null}
                <main>
                    <gm-graph-panel .model=${this.model} .state=${this.#state}></gm-graph-panel>
                    <gm-playground-panel .model=${this.model} .state=${this.#state}></gm-playground-panel>
                    <gm-docs-panel .model=${this.model} .state=${this.#state}></gm-docs-panel>
                    <gm-config-panel .model=${this.model} .state=${this.#state}></gm-config-panel>
                </main>
            </div>
        `;
    }
}
