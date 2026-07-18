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
    GRAPH_UI_EVENT_INITIALIZE_AUTO_GAME_AGENT_PACK,
    GRAPH_UI_EVENT_LIVE_RELOAD_STATUS_CHANGED,
    GRAPH_UI_EVENT_NAVIGATE_PAGE,
    GRAPH_UI_EVENT_RESET_DEFAULTS,
    GRAPH_UI_EVENT_SAVE_CONFIG,
    GRAPH_UI_EVENT_SET_AUTO_GAME_SKILL_ENABLED,
    GRAPH_UI_EVENT_SET_CONFIG_VIEW,
    GRAPH_UI_EVENT_SET_DOCS_VIEW,
    GRAPH_UI_EVENT_SET_SEARCH_QUERY,
    GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW,
    GRAPH_UI_EVENT_TOGGLE_PLAYGROUND_CONTROLS,
    GRAPH_UI_EVENT_TRIGGER_CREATE_CONFIG,
    GRAPH_UI_EVENT_TRIGGER_FIX,
    GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT,
    GRAPH_UI_EVENT_TRIGGER_REGENERATE,
    GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD,
    GRAPH_UI_EVENT_TRIGGER_STOP_LIVE_RELOAD,
    type GraphUiClearPageErrorDetail,
    type GraphUiInitializeAutoGameAgentPackDetail,
    type GraphUiLiveReloadStatusChangedDetail,
    type GraphUiSaveConfigDetail,
    type GraphUiSetAutoGameSkillEnabledDetail,
    type GraphUiSetConfigViewDetail,
    type GraphUiTriggerFixDetail
} from "./events.js";
import { FixWorkflowReconnectParticipant } from "./fix-workflow-reconnect-participant.js";
import { GraphIndexProgressParticipant } from "./graph-index-progress-participant.js";
import { LifecycleParticipantsController } from "./lifecycle-participants-controller.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

const LIVE_RELOAD_ERROR_ACTION_TYPE = "set-live-reload-error";
const FIX_LOG_LINES_ACTION_TYPE = "set-fix-log-lines";
const FIX_PENDING_ACTION_TYPE = "set-fix-pending";
const FIX_STATUS_ACTION_TYPE = "set-fix-status";
const FIX_ERROR_ACTION_TYPE = "set-fix-error";
const PAGE_ERROR_ACTION_TYPE = "set-page-error";
const AUTO_GAME_OPERATION_PENDING_ACTION_TYPE = "set-auto-game-operation-pending";
const AUTO_GAME_PAGE: GraphVisualizationUiPage = "auto-game";

const PAGE_MAIN_SECTION_ID: Readonly<Record<GraphVisualizationUiPage, string>> = Object.freeze({
    config: "config-page",
    docs: "docs-page",
    fix: "fix-page",
    graph: "graph-page",
    "live-reload": "live-reload-page",
    [AUTO_GAME_PAGE]: "auto-game-page",
    playground: "playground-page"
});

/**
 * Root app shell that composes header, toolbar, and graph/docs/config surfaces.
 *
 * Event subscriptions and fix-workflow reconnect polling are managed by
 * lifecycle collaborators registered with `LifecycleParticipantsController`.
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
     */
    #eventBus: EventBusManager;

    #fixWorkflowReconnect: FixWorkflowReconnectParticipant;

    #graphIndexProgress: GraphIndexProgressParticipant;

    // ─── Private handlers (access #state and #store via closure) ───────────────

    /**
     * Route every top-level navigation request through the same reducer path
     * regardless of whether the destination page already has data behind it.
     *
     * Graph Index previously swallowed navigation events when no graph nodes
     * were loaded, leaving the visible tab button looking clickable while no
     * route change occurred. The graph surface owns an empty state that
     * already explains how to load or rebuild a graph, so the shell should
     * honour an explicit user request to land there and let the panel
     * decide what to render.
     */
    #onNavigatePage = (eventValue: Event): void => {
        if (!this.model) {
            return;
        }

        const targetPage = (eventValue as CustomEvent<{ page: GraphVisualizationUiPage }>).detail.page;

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

    #onInitializeAutoGameAgentPack = (eventValue: Event): void => {
        if (this.callbacks.onInitializeAutoGameAgentPack) {
            const options = (eventValue as CustomEvent<GraphUiInitializeAutoGameAgentPackDetail>).detail;
            void this.#runAutoGameSkillMutation("initialize-agent-pack", () =>
                this.callbacks.onInitializeAutoGameAgentPack?.(options)
            );
        }
    };

    #onSetAutoGameSkillEnabled = (eventValue: Event): void => {
        if (!this.callbacks.onSetAutoGameSkillEnabled) {
            return;
        }
        const { enabled, name } = (eventValue as CustomEvent<GraphUiSetAutoGameSkillEnabledDetail>).detail;
        void this.#runAutoGameSkillMutation("skill-toggle", () =>
            this.callbacks.onSetAutoGameSkillEnabled?.(name, enabled)
        );
    };

    #onDismissErrorBanner = (): void => {
        this.#store.dispatch({ type: "clear-error" });
    };

    #onTogglePlaygroundControls = (): void => {
        this.#store.dispatch({ type: "toggle-playground-controls" });
    };

    #onClearPageError = (event: Event): void => {
        const customEvent = event as CustomEvent<GraphUiClearPageErrorDetail>;
        this.#store.dispatch({ page: customEvent.detail.page, type: "clear-page-error" });
    };

    #onLiveReloadStatusChanged = (event: Event): void => {
        const status = (event as CustomEvent<GraphUiLiveReloadStatusChangedDetail>).detail.status;
        const liveReload = this.model?.liveReload;
        if (liveReload === undefined || liveReload === null) {
            return;
        }

        this.model = {
            ...this.model,
            liveReload: {
                ...liveReload,
                statusSnapshot: status
            }
        };
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

            { event: GRAPH_UI_EVENT_INITIALIZE_AUTO_GAME_AGENT_PACK, handler: this.#onInitializeAutoGameAgentPack },
            { event: GRAPH_UI_EVENT_SET_AUTO_GAME_SKILL_ENABLED, handler: this.#onSetAutoGameSkillEnabled },
            { event: GRAPH_UI_EVENT_LIVE_RELOAD_STATUS_CHANGED, handler: this.#onLiveReloadStatusChanged },
            { event: GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, handler: this.#onClearPageError },
            { event: GRAPH_UI_EVENT_TOGGLE_PLAYGROUND_CONTROLS, handler: this.#onTogglePlaygroundControls },
            { event: "dismiss", handler: this.#onDismissErrorBanner }
        ]);

        this.#fixWorkflowReconnect = new FixWorkflowReconnectParticipant({
            callbacks: {
                canReconnect: () => this.model?.isServerMode === true && !this.#state.isFixPending,
                onFinished: (workflow, status) => {
                    this.#store.dispatch({ pending: false, type: FIX_PENDING_ACTION_TYPE, workflow });
                    this.#store.dispatch({ status, type: FIX_STATUS_ACTION_TYPE });
                },
                onPollError: (error) => {
                    console.error("Error polling reconnected fix workflow progress:", error);
                },
                onProgress: (logLines) => {
                    this.#store.dispatch({ logLines, type: FIX_LOG_LINES_ACTION_TYPE });
                },
                onReconnectError: (error) => {
                    console.error("Failed to reconnect to active fix workflow:", error);
                },
                onReconnectStarted: (workflow, logLines) => {
                    this.#store.dispatch({ pending: true, type: FIX_PENDING_ACTION_TYPE, workflow });
                    this.#store.dispatch({ logLines, type: FIX_LOG_LINES_ACTION_TYPE });
                    this.#store.dispatch({ errorMessage: null, type: FIX_ERROR_ACTION_TYPE });
                }
            }
        });

        this.#graphIndexProgress = new GraphIndexProgressParticipant({
            callbacks: {
                canPoll: () => this.model !== null && this.model.isServerMode && this.model.loadedTarget !== null,
                onPollError: (error) => {
                    console.error("Error polling semantic graph-index progress:", error);
                },
                onProgress: (progress) => {
                    this.#store.dispatch({ progress, type: "set-graph-index-progress" });
                }
            }
        });

        // Subscribe to store and persist URL state on changes
        const unsubscribeStore = this.#store.subscribe((nextState) => {
            this.#state = nextState;
            replaceGraphVisualizationUiStateInCurrentUrl(nextState);
            this.requestUpdate();
        });

        new LifecycleParticipantsController(this, [
            createStoreUnsubscribeParticipant(unsubscribeStore),
            this.#eventBus,
            this.#graphIndexProgress,
            this.#fixWorkflowReconnect
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
        const isAlreadyPending =
            pendingType === "set-config-save-pending"
                ? this.#state.isConfigSavePending
                : pendingType === "set-open-project-pending"
                  ? this.#state.isOpenProjectPending
                  : this.#state.isRegeneratePending;
        if (isAlreadyPending) {
            return;
        }

        try {
            this.#store.dispatch({ pending: true, type: pendingType });
            this.#store.dispatch({ errorMessage: null, page, type: PAGE_ERROR_ACTION_TYPE });
            await hostAction();
        } catch (error) {
            const message = getUiErrorMessage(error, "Unknown error");
            this.#store.dispatch({ errorMessage: message, page, type: PAGE_ERROR_ACTION_TYPE });
        } finally {
            this.#store.dispatch({ pending: false, type: pendingType });
        }
    }

    async #startLiveReload(): Promise<void> {
        if (!this.model || !this.model.isServerMode) {
            return;
        }
        if (this.#state.isLiveReloadStartPending || this.#state.isLiveReloadStopPending) {
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
        if (
            !this.model ||
            this.model.liveReload === null ||
            this.#state.isLiveReloadStartPending ||
            this.#state.isLiveReloadStopPending
        ) {
            return;
        }

        try {
            this.#store.dispatch({ pending: true, type: "set-live-reload-stop-pending" });
            await this.callbacks.onStopLiveReload();
            this.model = {
                ...this.model,
                liveReload: null
            };
            this.#store.dispatch({ errorMessage: null, type: LIVE_RELOAD_ERROR_ACTION_TYPE });
        } catch (error) {
            const message = getUiErrorMessage(error, "Unknown live-reload stop error");
            this.#store.dispatch({ errorMessage: message, type: LIVE_RELOAD_ERROR_ACTION_TYPE });
        } finally {
            this.#store.dispatch({ pending: false, type: "set-live-reload-stop-pending" });
        }
    }

    async #runAutoGameSkillMutation(
        operation: "initialize-agent-pack" | "skill-toggle",
        hostAction: () => void | Promise<void>
    ): Promise<void> {
        if (
            !this.model ||
            !this.model.isServerMode ||
            !hasLoadedGraphProject(this.model) ||
            this.#state.autoGamePendingOperation !== null
        ) {
            return;
        }
        try {
            this.#store.dispatch({ operation, pending: true, type: AUTO_GAME_OPERATION_PENDING_ACTION_TYPE });
            this.#store.dispatch({ errorMessage: null, page: AUTO_GAME_PAGE, type: PAGE_ERROR_ACTION_TYPE });
            await hostAction();
        } catch (error) {
            const message = getUiErrorMessage(error, "Unknown Auto-Game skill error");
            this.#store.dispatch({ errorMessage: message, page: AUTO_GAME_PAGE, type: PAGE_ERROR_ACTION_TYPE });
        } finally {
            this.#store.dispatch({ operation, pending: false, type: AUTO_GAME_OPERATION_PENDING_ACTION_TYPE });
        }
    }

    async #runFixWorkflow(workflow: GraphVisualizationProjectWorkflow): Promise<void> {
        if (this.#state.isFixPending) {
            return;
        }

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
            this.#store.dispatch({ pending: true, type: FIX_PENDING_ACTION_TYPE, workflow });
            this.#store.dispatch({ errorMessage: null, type: FIX_ERROR_ACTION_TYPE });
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
            this.#store.dispatch({ status: result.status, type: FIX_STATUS_ACTION_TYPE });
        } catch (error) {
            const message = getUiErrorMessage(error, "Unknown fix workflow error");
            this.#store.dispatch({ errorMessage: message, type: FIX_ERROR_ACTION_TYPE });
            this.#store.dispatch({ status: "error", type: FIX_STATUS_ACTION_TYPE });
        } finally {
            clearInterval(fixWorkflowProgressTimer);
            this.#store.dispatch({ pending: false, type: FIX_PENDING_ACTION_TYPE, workflow });
        }
    }

    /** @internal */
    public getStoreForTest(): GraphVisualizationUiStore {
        return this.#store;
    }

    /** @internal */
    public getStateForTest(): GraphVisualizationUiState {
        return this.#state;
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

/**
 * Adapt a pre-registered store unsubscribe into a {@link LifecycleParticipant}
 * so the existing `LifecycleParticipantsController` wiring continues to work
 * without changing the order in which the host connects/disconnects.
 *
 * The `unsubscribe` callback must be captured eagerly during
 * `GmAppShell`'s constructor — the store subscription is what drives
 * `requestUpdate()` after every dispatched state change, so it has to be
 * live before any host-rendered children (and before `hostConnected`
 * fires) can observe the initial store state. Registering the
 * subscription inside `connect()` would mean the very first
 * `requestUpdate()` after construction never reaches Lit, leaving the
 * UI blank until something else triggered a render. Conversely,
 * deleting the `connect()` method would violate the
 * `LifecycleParticipant` contract enforced by
 * `./lifecycle-participants-controller.ts` and crash the controller's
 * for-loop on `hostConnected`. `disconnect()` is the only side that
 * performs real work and is nulled after the first call so that the
 * controller's reverse-order disconnect (or a defensive second call
 * during teardown) is always safe.
 */
function createStoreUnsubscribeParticipant(unsubscribe: () => void) {
    let cleanup: (() => void) | null = unsubscribe;
    return Object.freeze({
        connect(): void {
            // Intentionally empty: see the JSDoc above. The store
            // subscription is set up in the `GmAppShell` constructor
            // (so it is live for the initial render) and this
            // participant exists solely to honour the
            // `LifecycleParticipant` contract and to release that
            // subscription on disconnect. Moving the `subscribe()`
            // call here would break the initial render; removing this
            // method would break the controller's `for` loop.
        },
        disconnect(): void {
            cleanup?.();
            cleanup = null;
        }
    });
}
