import { html } from "lit";

import {
    createNoopGraphVisualizationUiCallbacks,
    type GraphVisualizationUiCallbacks,
    type GraphVisualizationUiModel
} from "../contracts.js";
import { GraphVisualizationUiStore } from "../state/store.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import {
    GRAPH_UI_EVENT_CYCLE_LABEL_MODE,
    GRAPH_UI_EVENT_NAVIGATE_PAGE,
    GRAPH_UI_EVENT_RESET_DEFAULTS,
    GRAPH_UI_EVENT_SET_DOCS_VIEW,
    GRAPH_UI_EVENT_SET_SEARCH_QUERY,
    GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW,
    GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT,
    GRAPH_UI_EVENT_TRIGGER_REGENERATE,
    type GraphUiNavigatePageDetail,
    type GraphUiSetDocsViewDetail,
    type GraphUiSetSearchQueryDetail
} from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * Root app shell that composes header, toolbar, and graph/docs/config surfaces.
 */
export class GmAppShell extends LightDomLitElement {
    public static properties = {
        callbacks: { attribute: false },
        model: { attribute: false }
    };

    public accessor callbacks: GraphVisualizationUiCallbacks = createNoopGraphVisualizationUiCallbacks();

    public accessor model: GraphVisualizationUiModel | null = null;

    #state: GraphVisualizationUiState;

    #store = new GraphVisualizationUiStore();

    #unsubscribe: (() => void) | null = null;

    readonly #onNavigatePage = (eventValue: Event): void => {
        this.#handleNavigatePage(eventValue as CustomEvent<GraphUiNavigatePageDetail>);
    };

    readonly #onSetDocsView = (eventValue: Event): void => {
        this.#handleSetDocsView(eventValue as CustomEvent<GraphUiSetDocsViewDetail>);
    };

    readonly #onSetSearchQuery = (eventValue: Event): void => {
        this.#handleSetSearchQuery(eventValue as CustomEvent<GraphUiSetSearchQueryDetail>);
    };

    readonly #onToggleGraphView = (): void => {
        this.#handleToggleGraphView();
    };

    readonly #onCycleLabelMode = (): void => {
        this.#handleCycleLabelMode();
    };

    readonly #onResetDefaults = (): void => {
        this.#handleResetDefaults();
    };

    readonly #onTriggerOpenProject = (): void => {
        this.#handleTriggerOpenProject();
    };

    readonly #onTriggerRegenerate = (): void => {
        this.#handleTriggerRegenerate();
    };

    public constructor() {
        super();
        this.#state = this.#store.getState();
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener(GRAPH_UI_EVENT_NAVIGATE_PAGE, this.#onNavigatePage);
        this.addEventListener(GRAPH_UI_EVENT_SET_DOCS_VIEW, this.#onSetDocsView);
        this.addEventListener(GRAPH_UI_EVENT_SET_SEARCH_QUERY, this.#onSetSearchQuery);
        this.addEventListener(GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW, this.#onToggleGraphView);
        this.addEventListener(GRAPH_UI_EVENT_CYCLE_LABEL_MODE, this.#onCycleLabelMode);
        this.addEventListener(GRAPH_UI_EVENT_RESET_DEFAULTS, this.#onResetDefaults);
        this.addEventListener(GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT, this.#onTriggerOpenProject);
        this.addEventListener(GRAPH_UI_EVENT_TRIGGER_REGENERATE, this.#onTriggerRegenerate);
        this.#unsubscribe = this.#store.subscribe((nextState) => {
            this.#state = nextState;
            this.requestUpdate();
        });
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();
        this.removeEventListener(GRAPH_UI_EVENT_NAVIGATE_PAGE, this.#onNavigatePage);
        this.removeEventListener(GRAPH_UI_EVENT_SET_DOCS_VIEW, this.#onSetDocsView);
        this.removeEventListener(GRAPH_UI_EVENT_SET_SEARCH_QUERY, this.#onSetSearchQuery);
        this.removeEventListener(GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW, this.#onToggleGraphView);
        this.removeEventListener(GRAPH_UI_EVENT_CYCLE_LABEL_MODE, this.#onCycleLabelMode);
        this.removeEventListener(GRAPH_UI_EVENT_RESET_DEFAULTS, this.#onResetDefaults);
        this.removeEventListener(GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT, this.#onTriggerOpenProject);
        this.removeEventListener(GRAPH_UI_EVENT_TRIGGER_REGENERATE, this.#onTriggerRegenerate);
        this.#unsubscribe?.();
        this.#unsubscribe = null;
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
            const message = error instanceof Error ? error.message : String(error);
            this.#store.dispatch({ errorMessage: message, type: "set-error" });
        } finally {
            this.#store.dispatch({ pending: false, type: pendingType });
        }
    }

    #handleNavigatePage(eventValue: CustomEvent<GraphUiNavigatePageDetail>): void {
        this.#store.dispatch({ page: eventValue.detail.page, type: "navigate-page" });
    }

    #handleSetDocsView(eventValue: CustomEvent<GraphUiSetDocsViewDetail>): void {
        this.#store.dispatch({ docsView: eventValue.detail.docsView, type: "set-docs-view" });
    }

    #handleSetSearchQuery(eventValue: CustomEvent<GraphUiSetSearchQueryDetail>): void {
        this.#store.dispatch({ searchQuery: eventValue.detail.searchQuery, type: "set-search-query" });
    }

    #handleToggleGraphView(): void {
        this.#store.dispatch({ type: "toggle-graph-view" });
    }

    #handleCycleLabelMode(): void {
        this.#store.dispatch({ type: "cycle-label-mode" });
    }

    #handleResetDefaults(): void {
        this.#store.dispatch({ type: "reset-defaults" });
    }

    #handleTriggerOpenProject(): void {
        void this.#runHostActionWithPendingState("set-open-project-pending", this.callbacks.onOpenProject);
    }

    #handleTriggerRegenerate(): void {
        void this.#runHostActionWithPendingState("set-regenerate-pending", this.callbacks.onRegenerate);
    }

    protected render() {
        if (!this.model) {
            return html``;
        }

        return html`
            <div id="app-shell">
                <gm-app-header .model=${this.model} .state=${this.#state}></gm-app-header>
                <gm-graph-toolbar .model=${this.model} .state=${this.#state}></gm-graph-toolbar>
                ${this.#state.errorMessage
                    ? html`<div class="error-banner" role="alert">${this.#state.errorMessage}</div>`
                    : null}
                <main>
                    <gm-graph-panel .model=${this.model} .state=${this.#state}></gm-graph-panel>
                    <gm-docs-panel .model=${this.model} .state=${this.#state}></gm-docs-panel>
                    <gm-config-panel .model=${this.model} .state=${this.#state}></gm-config-panel>
                </main>
            </div>
        `;
    }
}
