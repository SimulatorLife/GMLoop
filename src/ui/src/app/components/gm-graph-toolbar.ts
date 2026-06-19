import { html } from "lit";

import type { GraphVisualizationProjectWorkflow } from "../../graph/types.js";
import { type GraphVisualizationUiModel, hasLoadedGraphIndex, hasLoadedGraphProject } from "../contracts.js";
import { LIVE_RELOAD_RUNTIME_TAB_TARGET, resolveLiveReloadRuntimeUrl } from "../live-reload-runtime-tab.js";
import type { GraphVisualizationUiPage, GraphVisualizationUiState } from "../state/types.js";
import { createGraphVisualizationDocsPanelContent } from "./docs-panel-content.js";
import {
    createSearchResultSummary,
    normalizeCatalogSearchQuery,
    searchCatalogEntries,
    searchCliEntries,
    searchMcpEntries
} from "./docs-search.js";
import {
    GRAPH_UI_EVENT_CYCLE_LABEL_MODE,
    GRAPH_UI_EVENT_NAVIGATE_PAGE,
    GRAPH_UI_EVENT_RESET_DEFAULTS,
    GRAPH_UI_EVENT_SET_CONFIG_VIEW,
    GRAPH_UI_EVENT_SET_DOCS_VIEW,
    GRAPH_UI_EVENT_SET_SEARCH_QUERY,
    GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW,
    GRAPH_UI_EVENT_TRIGGER_FIX,
    GRAPH_UI_EVENT_TRIGGER_REGENERATE,
    GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD,
    GRAPH_UI_EVENT_TRIGGER_STOP_LIVE_RELOAD,
    type GraphUiNavigatePageDetail,
    type GraphUiSetConfigViewDetail,
    type GraphUiSetDocsViewDetail,
    type GraphUiSetSearchQueryDetail,
    type GraphUiTriggerFixDetail
} from "./events.js";
import {
    evaluateToolbarKeyboardShortcut,
    resolveKeyboardShortcutTarget,
    type ToolbarKeyboardShortcutAction
} from "./keyboard-shortcut-policy.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";
import { renderProcessButtonContent } from "./primitives/gm-button.js";
import type { GmStatusChipStatus } from "./primitives/gm-status-chip.js";

const CLASS_BTN_CHIP_ACTIVE = "gm-btn--chip active";
const CLASS_BTN_CHIP = "gm-btn--chip";

const LIVE_RELOAD_PAGE: GraphVisualizationUiPage = "live-reload";

function formatLiveReloadUptime(uptimeMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(uptimeMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
}

function resolveAutoGameStatusChipStatus(model: GraphVisualizationUiModel): GmStatusChipStatus {
    const status = model.autoGamePipeline?.status ?? "idle";
    if (status === "running") {
        return "running";
    }
    if (status === "success") {
        return "success";
    }
    if (status === "error") {
        return "error";
    }
    if (status === "blocked") {
        return "stopped";
    }
    return "not-running";
}

function resolveAutoGameStatusSummary(model: GraphVisualizationUiModel): string {
    if (model.autoGamePipeline?.statusText) {
        return model.autoGamePipeline.statusText;
    }
    return "Auto-game creation pipeline, AI skill readiness, MCP bridge status, and automation activity.";
}

function resolveLiveReloadStatusChipStatus(model: GraphVisualizationUiModel): GmStatusChipStatus {
    const watcherStatus =
        model.liveReload?.statusSnapshot?.watcherStatus ??
        (model.liveReload?.endpoints.statusUrl ? "offline" : "inactive");
    return watcherStatus === "inactive" ? "not-running" : watcherStatus;
}

function resolveLiveReloadStatusSummary(model: GraphVisualizationUiModel): string {
    if (model.liveReload === null) {
        return "Start live reload to launch the watcher, patch stream, and runtime bridge.";
    }

    const status = model.liveReload.statusSnapshot;
    if (status === null) {
        return "Waiting for the watcher to report its current status.";
    }

    const scanState = status.scanComplete ? "scan complete" : "scan in progress";
    return `Uptime ${formatLiveReloadUptime(status.uptimeMs)} with ${scanState}.`;
}

function resolveFixStatusChipStatus(
    model: GraphVisualizationUiModel,
    state: GraphVisualizationUiState
): GmStatusChipStatus {
    if (state.isFixPending) {
        return "running";
    }

    const effectiveStatus =
        state.fixStatus === "idle" && state.fixLogLines.length === 0 && model.lastFixRun !== null
            ? model.lastFixRun.status
            : state.fixStatus;

    if (effectiveStatus === "success") {
        return "success";
    }
    if (effectiveStatus === "error") {
        return "error";
    }
    return "not-running";
}

function resolveFixStatusSummary(state: GraphVisualizationUiState): string {
    const workflowLabel =
        state.fixWorkflow === "format"
            ? "Formatting"
            : state.fixWorkflow === "lint"
              ? "Linting"
              : state.fixWorkflow === "refactor"
                ? "Refactoring"
                : "Applying fixes";
    const completedWorkflowLabel =
        state.fixWorkflow === "format"
            ? "Formatting"
            : state.fixWorkflow === "lint"
              ? "Linting"
              : state.fixWorkflow === "refactor"
                ? "Refactoring"
                : "All fixes";

    if (state.isFixPending) {
        return `${workflowLabel} your project (this may take a while).`;
    }

    if (state.fixStatus === "success") {
        return `${completedWorkflowLabel} completed successfully.`;
    }

    if (state.fixStatus === "error") {
        return state.fixWorkflow === "fix"
            ? "Fixes encountered errors. Review the run log for details."
            : `${workflowLabel} encountered errors. Review the run log for details.`;
    }

    return "Run the opened project's gmloop-configured repair workflow.";
}

function resolveDocsStatusSummary(model: GraphVisualizationUiModel, state: GraphVisualizationUiState): string {
    const docsPanelContent = createGraphVisualizationDocsPanelContent(model.documentationCatalogs);
    if (state.activeDocsView === "cli") {
        return docsPanelContent.cliMetaText;
    }
    if (state.activeDocsView === "mcp") {
        return docsPanelContent.mcpMetaText;
    }
    if (state.activeDocsView === "linting") {
        return docsPanelContent.lintingMetaText;
    }
    if (state.activeDocsView === "formatting") {
        return docsPanelContent.formattingMetaText;
    }
    return docsPanelContent.codemodsMetaText;
}

/**
 * Return true when toolbar keyboard shortcuts should yield to native text entry.
 */
export function isToolbarKeyboardShortcutTextEntryTarget(target: EventTarget | null): boolean {
    if (typeof Element !== "undefined" && target instanceof Element) {
        if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
            return true;
        }

        if (target instanceof HTMLInputElement) {
            const inputType = target.type.toLowerCase();
            return !["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"].includes(
                inputType
            );
        }

        return typeof HTMLElement !== "undefined" && target instanceof HTMLElement && target.isContentEditable;
    }

    return false;
}

function resolveConfigStatusSummary(model: GraphVisualizationUiModel): string {
    const configPath = model.projectConfigurationCatalog?.gmloop.configPath;
    return configPath ? `Config path: ${configPath}` : "Config path: Not found";
}

/**
 * Graph surface toolbar controls and contextual page headings.
 */
export class GmGraphToolbar extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    #canUseGraphControls(): boolean {
        return this.model !== null && hasLoadedGraphIndex(this.model);
    }

    #onKeyDown = (event: KeyboardEvent): void => {
        if (!this.state) {
            return;
        }

        const action = evaluateToolbarKeyboardShortcut({
            canUseGraphControls: this.#canUseGraphControls(),
            hasModifier: event.altKey || event.metaKey || event.ctrlKey,
            hasSearchQuery: this.state.searchQuery.length > 0,
            isTextEntryTarget: isToolbarKeyboardShortcutTextEntryTarget(resolveKeyboardShortcutTarget(event)),
            key: event.key
        });

        this.#applyToolbarKeyboardShortcut(event, action);
    };

    #applyToolbarKeyboardShortcut(event: KeyboardEvent, action: ToolbarKeyboardShortcutAction): void {
        if (action.kind === "none") {
            return;
        }

        event.preventDefault();

        switch (action.kind) {
            case "clear-search": {
                this.#emitSearchQuery("");
                return;
            }
            case "toggle-graph-view": {
                this.#emitToggleGraphView();
                return;
            }
            case "cycle-label-mode": {
                this.#emitCycleLabelMode();
                return;
            }
            case "reset-defaults": {
                this.#emitResetDefaults();
                return;
            }
            case "navigate-page": {
                this.#emitNavigatePage(action.page);
            }
        }
    }

    #onSearchInput = (eventValue: Event): void => {
        const target = eventValue.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }
        this.#emitSearchQuery(target.value);
    };

    public connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener("keydown", this.#onKeyDown);
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();
        this.removeEventListener("keydown", this.#onKeyDown);
    }

    #emitSearchQuery(searchQuery: string): void {
        if (this.state?.activePage === "graph" && !this.#canUseGraphControls()) {
            return;
        }

        this.dispatchEvent(
            new CustomEvent<GraphUiSetSearchQueryDetail>(GRAPH_UI_EVENT_SET_SEARCH_QUERY, {
                bubbles: true,
                composed: true,
                detail: { searchQuery }
            })
        );
    }

    #emitDocsView(docsView: GraphVisualizationUiState["activeDocsView"]): void {
        this.dispatchEvent(
            new CustomEvent<GraphUiSetDocsViewDetail>(GRAPH_UI_EVENT_SET_DOCS_VIEW, {
                bubbles: true,
                composed: true,
                detail: { docsView }
            })
        );
    }

    #emitConfigView(configView: GraphVisualizationUiState["activeConfigView"]): void {
        this.dispatchEvent(
            new CustomEvent<GraphUiSetConfigViewDetail>(GRAPH_UI_EVENT_SET_CONFIG_VIEW, {
                bubbles: true,
                composed: true,
                detail: { configView }
            })
        );
    }

    #emitToggleGraphView(): void {
        if (!this.#canUseGraphControls()) {
            return;
        }

        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW, {
                bubbles: true,
                composed: true
            })
        );
    }

    #emitCycleLabelMode(): void {
        if (!this.#canUseGraphControls()) {
            return;
        }

        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_CYCLE_LABEL_MODE, {
                bubbles: true,
                composed: true
            })
        );
    }

    #emitNavigatePage(page: GraphVisualizationUiPage): void {
        if (page === "graph" && !this.#canUseGraphControls()) {
            return;
        }

        this.dispatchEvent(
            new CustomEvent<GraphUiNavigatePageDetail>(GRAPH_UI_EVENT_NAVIGATE_PAGE, {
                bubbles: true,
                composed: true,
                detail: { page }
            })
        );
    }

    #emitResetDefaults(): void {
        if (!this.#canUseGraphControls()) {
            return;
        }

        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_RESET_DEFAULTS, {
                bubbles: true,
                composed: true
            })
        );
    }

    #emitRegenerate(): void {
        if (!this.model || !hasLoadedGraphProject(this.model)) {
            return;
        }

        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_TRIGGER_REGENERATE, {
                bubbles: true,
                composed: true
            })
        );
    }

    #emitStartLiveReload(): void {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD, {
                bubbles: true,
                composed: true
            })
        );
    }

    #emitStopLiveReload(): void {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_TRIGGER_STOP_LIVE_RELOAD, {
                bubbles: true,
                composed: true
            })
        );
    }

    #emitFix(workflow: GraphVisualizationProjectWorkflow): void {
        if (!this.model || !hasLoadedGraphProject(this.model)) {
            return;
        }

        this.dispatchEvent(
            new CustomEvent<GraphUiTriggerFixDetail>(GRAPH_UI_EVENT_TRIGGER_FIX, {
                bubbles: true,
                composed: true,
                detail: { workflow }
            })
        );
    }

    #renderPendingBadge() {
        if (!this.state || this.state.pendingActionCount === 0) {
            return null;
        }

        return html`
            <span
                class="pending-badge"
                aria-label="${this.state.pendingActionCount} background operation${this.state.pendingActionCount > 1
                    ? "s"
                    : ""} in progress"
                role="status"
            >
                ${this.state.pendingActionCount}
            </span>
        `;
    }

    #renderPageStatus() {
        if (!this.model || !this.state) {
            return null;
        }

        if (this.state.activePage === "auto-game") {
            return html`<gm-status-chip .status=${resolveAutoGameStatusChipStatus(this.model)}></gm-status-chip>`;
        }

        if (this.state.activePage === LIVE_RELOAD_PAGE) {
            return html`<gm-status-chip .status=${resolveLiveReloadStatusChipStatus(this.model)}></gm-status-chip>`;
        }

        if (this.state.activePage === "fix") {
            return html`<gm-status-chip
                .status=${resolveFixStatusChipStatus(this.model, this.state)}
            ></gm-status-chip>`;
        }

        return null;
    }

    #renderDocsControls() {
        if (!this.model || !this.state) {
            return null;
        }

        const docsPanelContent = createGraphVisualizationDocsPanelContent(this.model.documentationCatalogs);
        const searchQuery = normalizeCatalogSearchQuery(this.state.searchQuery);
        const cliSearchResult = searchCliEntries(docsPanelContent.cliEntries, searchQuery);
        const mcpSearchResult = searchMcpEntries(docsPanelContent.mcpEntries, searchQuery);
        const lintingSearchResult = searchCatalogEntries(docsPanelContent.lintingEntries, searchQuery);
        const formattingSearchResult = searchCatalogEntries(docsPanelContent.formattingEntries, searchQuery);
        const codemodsSearchResult = searchCatalogEntries(docsPanelContent.codemodsEntries, searchQuery);
        const totalCount =
            this.state.activeDocsView === "cli"
                ? cliSearchResult.totalCount
                : this.state.activeDocsView === "mcp"
                  ? mcpSearchResult.totalCount
                  : this.state.activeDocsView === "linting"
                    ? lintingSearchResult.totalCount
                    : this.state.activeDocsView === "formatting"
                      ? formattingSearchResult.totalCount
                      : codemodsSearchResult.totalCount;
        const searchResultSummary = createSearchResultSummary(searchQuery, this.state.activeDocsView, totalCount);

        // Docs subview and catalog search controls stay in the shared page toolbar
        // so the Docs panel remains content-only and every tab has one control surface.
        return html`
            <div class="gm-view-selector" role="group" aria-label="Documentation view selector">
                <button
                    id="docs-view-cli"
                    aria-pressed=${this.state.activeDocsView === "cli"}
                    class=${this.state.activeDocsView === "cli" ? CLASS_BTN_CHIP_ACTIVE : CLASS_BTN_CHIP}
                    @click=${() => this.#emitDocsView("cli")}
                >
                    CLI
                </button>
                <button
                    id="docs-view-mcp"
                    aria-pressed=${this.state.activeDocsView === "mcp"}
                    class=${this.state.activeDocsView === "mcp" ? CLASS_BTN_CHIP_ACTIVE : CLASS_BTN_CHIP}
                    @click=${() => this.#emitDocsView("mcp")}
                >
                    MCP
                </button>
                <button
                    id="docs-view-linting"
                    aria-pressed=${this.state.activeDocsView === "linting"}
                    class=${this.state.activeDocsView === "linting" ? CLASS_BTN_CHIP_ACTIVE : CLASS_BTN_CHIP}
                    @click=${() => this.#emitDocsView("linting")}
                >
                    Linting
                </button>
                <button
                    id="docs-view-formatting"
                    aria-pressed=${this.state.activeDocsView === "formatting"}
                    class=${this.state.activeDocsView === "formatting" ? CLASS_BTN_CHIP_ACTIVE : CLASS_BTN_CHIP}
                    @click=${() => this.#emitDocsView("formatting")}
                >
                    Formatting
                </button>
                <button
                    id="docs-view-codemods"
                    aria-pressed=${this.state.activeDocsView === "codemods"}
                    class=${this.state.activeDocsView === "codemods" ? CLASS_BTN_CHIP_ACTIVE : CLASS_BTN_CHIP}
                    @click=${() => this.#emitDocsView("codemods")}
                >
                    Codemods
                </button>
            </div>
            <div class="docs-search-panel" role="search" aria-label="Filter documentation catalog">
                <label class="docs-search-label" for="docs-search-input">Search current docs view</label>
                <div class="docs-search-controls">
                    <input
                        id="docs-search-input"
                        class="docs-search-input"
                        type="search"
                        .value=${this.state.searchQuery}
                        aria-describedby="toolbar-subheading docs-search-summary"
                        placeholder="Search names, descriptions, flags, and badges"
                        @input=${this.#onSearchInput}
                    />
                    <button
                        class="docs-search-clear"
                        type="button"
                        ?disabled=${this.state.searchQuery.length === 0}
                        @click=${() => this.#emitSearchQuery("")}
                    >
                        Clear
                    </button>
                </div>
                <p id="docs-search-summary" class="docs-search-summary" aria-live="polite">${searchResultSummary}</p>
            </div>
        `;
    }

    #renderConfigControls() {
        if (!this.state) {
            return null;
        }

        return html`
            <div class="gm-view-selector" role="group" aria-label="Configuration view selector">
                <button
                    id="config-view-rendered"
                    type="button"
                    aria-pressed=${this.state.activeConfigView === "rendered"}
                    class=${this.state.activeConfigView === "rendered" ? CLASS_BTN_CHIP_ACTIVE : CLASS_BTN_CHIP}
                    @click=${() => this.#emitConfigView("rendered")}
                >
                    Rendered
                </button>
                <button
                    id="config-view-raw"
                    type="button"
                    aria-pressed=${this.state.activeConfigView === "raw"}
                    class=${this.state.activeConfigView === "raw" ? CLASS_BTN_CHIP_ACTIVE : CLASS_BTN_CHIP}
                    @click=${() => this.#emitConfigView("raw")}
                >
                    Raw JSON
                </button>
            </div>
        `;
    }

    #renderFixControls() {
        if (!this.model?.isServerMode || !hasLoadedGraphProject(this.model)) {
            return null;
        }

        const isPending = this.state?.isFixPending === true;
        const activeWorkflow = isPending ? (this.state?.fixWorkflow ?? null) : null;
        const workflows = [
            { id: "run-fix", label: "Fix", workflow: "fix" },
            { id: "run-format", label: "Format", workflow: "format" },
            {
                id: "run-refactor",
                label: "Refactor / Codemods",
                workflow: "refactor"
            },
            { id: "run-lint", label: "Lint", workflow: "lint" }
        ] as const;

        return html`
            <div class="toolbar-control-group toolbar-fix-controls">
                ${workflows.map(
                    (entry, index) => html`
                        <button
                            id=${entry.id}
                            type="button"
                            class=${index === 0 ? "gm-btn gm-btn--primary" : "gm-btn"}
                            ?disabled=${isPending}
                            aria-busy=${activeWorkflow === entry.workflow ? "true" : "false"}
                            @click=${() => this.#emitFix(entry.workflow)}
                        >
                            ${renderProcessButtonContent({
                                label: entry.label,
                                pending: activeWorkflow === entry.workflow
                            })}
                        </button>
                    `
                )}
            </div>
        `;
    }

    #renderLiveReloadControls() {
        if (!this.model?.isServerMode) {
            return null;
        }

        const hasActiveSession = this.model.liveReload !== null;
        const isStartPending = this.state?.isLiveReloadStartPending === true;
        const isStopPending = this.state?.isLiveReloadStopPending === true;
        const runtimeUrl = resolveLiveReloadRuntimeUrl(this.model.liveReload);
        const isRetry = this.state?.liveReloadErrorMessage !== null && !hasActiveSession;
        const isStopDisabled = !hasActiveSession || isStartPending || isStopPending;
        const startButtonTitle = isStartPending
            ? "Starting Live Reload"
            : isRetry
              ? "Retry Start"
              : hasActiveSession
                ? "Live Reload Running"
                : "Start Live Reload";
        const stopButtonTitle = hasActiveSession ? "Stop Live Reload" : "Live Reload Not Running";

        const playIcon = html`
            <svg class="live-reload-btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="5,3 19,12 5,21" />
            </svg>
        `;
        const restartIcon = html`
            <svg
                class="live-reload-btn-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.25"
                aria-hidden="true"
            >
                <path d="M4 4v16" />
                <polygon points="9,5 20,12 9,19" fill="currentColor" stroke="none" />
            </svg>
        `;
        const openRuntimeIcon = html`
            <svg
                class="live-reload-btn-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.25"
                aria-hidden="true"
            >
                <path d="M7 7h10v10" />
                <path d="M7 17 17 7" />
                <path d="M5 5v14h14" />
            </svg>
        `;
        const stopIcon = html`
            <svg class="live-reload-btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" />
            </svg>
        `;

        return html`
            <div class="toolbar-control-group live-reload-actions">
                <button
                    id="start-live-reload"
                    type="button"
                    class="live-reload-btn live-reload-btn--primary"
                    ?disabled=${isStartPending || hasActiveSession}
                    aria-busy=${isStartPending ? "true" : "false"}
                    title=${startButtonTitle}
                    @click=${() => this.#emitStartLiveReload()}
                >
                    ${renderProcessButtonContent({
                        idleVisual: isRetry ? playIcon : hasActiveSession ? restartIcon : playIcon,
                        label: "Start Live Reload",
                        pending: isStartPending,
                        visuallyHiddenLabel: true
                    })}
                </button>
                ${runtimeUrl === null
                    ? null
                    : html`
                          <a
                              id="open-live-reload-runtime"
                              class="live-reload-btn live-reload-btn--runtime"
                              href=${runtimeUrl}
                              target=${LIVE_RELOAD_RUNTIME_TAB_TARGET}
                              rel="noreferrer"
                              title="Open Runtime"
                          >
                              ${openRuntimeIcon}
                          </a>
                      `}
                <button
                    id="stop-live-reload"
                    type="button"
                    class="live-reload-btn live-reload-btn--destructive"
                    ?disabled=${isStopDisabled}
                    aria-busy=${isStopPending ? "true" : "false"}
                    title=${stopButtonTitle}
                    @click=${() => this.#emitStopLiveReload()}
                >
                    ${renderProcessButtonContent({
                        idleVisual: stopIcon,
                        label: "Stop Live Reload",
                        pending: isStopPending,
                        visuallyHiddenLabel: true
                    })}
                </button>
            </div>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const heading =
            this.state.activePage === "graph"
                ? "Graph Index"
                : this.state.activePage === "docs"
                  ? "Docs"
                  : this.state.activePage === "config"
                    ? "Config"
                    : this.state.activePage === "fix"
                      ? "Fix"
                      : this.state.activePage === "playground"
                        ? "Playground"
                        : this.state.activePage === "auto-game"
                          ? "Auto-Game"
                          : "Live Reload";
        const subheading =
            this.state.activePage === "graph"
                ? "Explore relationships across scripts, objects, events, and other project resources."
                : this.state.activePage === "docs"
                  ? resolveDocsStatusSummary(this.model, this.state)
                  : this.state.activePage === "config"
                    ? resolveConfigStatusSummary(this.model)
                    : this.state.activePage === "fix"
                      ? resolveFixStatusSummary(this.state)
                      : this.state.activePage === "playground"
                        ? "Interactive GML playground for parsing, formatting, and rule experiments."
                        : this.state.activePage === "auto-game"
                          ? resolveAutoGameStatusSummary(this.model)
                          : resolveLiveReloadStatusSummary(this.model);
        const hasLoadedIndex = hasLoadedGraphIndex(this.model);
        const hasLoadedProject = hasLoadedGraphProject(this.model);

        const graphControlsClassName =
            this.state.activePage === "graph" ? "toolbar-controls" : "toolbar-controls hidden";
        const liveReloadControlsClassName =
            this.state.activePage === LIVE_RELOAD_PAGE ? "toolbar-live-reload-controls" : "";
        const fixControlsClassName = this.state.activePage === "fix" ? "toolbar-fix-controls" : "";
        const docsControlsClassName = this.state.activePage === "docs" ? "toolbar-docs-controls" : "";
        const configControlsClassName = this.state.activePage === "config" ? "toolbar-config-controls" : "";

        return html`
            <div id="page-toolbar" class="page-toolbar">
                <div class="toolbar-heading-row">
                    <div class="toolbar-title">
                        <div class="toolbar-title-row">
                            <strong id="toolbar-heading">${heading}</strong>
                            ${this.#renderPageStatus()}
                        </div>
                        <span id="toolbar-subheading">${subheading}</span>
                    </div>
                    ${this.state.activePage === "config"
                        ? html`<div class=${configControlsClassName}>${this.#renderConfigControls()}</div>`
                        : null}
                    ${this.state.activePage === "fix"
                        ? html`<div class=${fixControlsClassName}>${this.#renderFixControls()}</div>`
                        : null}
                    ${this.state.activePage === LIVE_RELOAD_PAGE
                        ? html`<div id="live-reload-controls" class=${liveReloadControlsClassName}>
                              ${this.#renderLiveReloadControls()}
                          </div>`
                        : null}
                </div>
                ${this.state.activePage === "docs"
                    ? html`<div id="docs-controls" class=${docsControlsClassName}>${this.#renderDocsControls()}</div>`
                    : null}
                <div id="graph-controls" class=${graphControlsClassName}>
                    <div class="toolbar-control-group toolbar-search-group">
                        <input
                            id="search"
                            type="search"
                            aria-label="Search graph nodes"
                            .value=${this.state.searchQuery}
                            placeholder="Search nodes…"
                            ?disabled=${!hasLoadedIndex}
                            @input=${this.#onSearchInput}
                        />
                    </div>
                    <div class="toolbar-control-group">
                        <button
                            id="toggle-view"
                            class="gm-btn--chip"
                            aria-pressed=${this.state.activeGraphView === "json"}
                            ?disabled=${!hasLoadedIndex}
                            @click=${() => this.#emitToggleGraphView()}
                        >
                            ${this.state.activeGraphView === "visual" ? "JSON" : "Visual"}
                        </button>
                        <button
                            id="toggle-labels"
                            class="gm-btn--chip"
                            ?disabled=${!hasLoadedIndex}
                            @click=${() => this.#emitCycleLabelMode()}
                        >
                            Labels:
                            ${this.state.labelMode === "always"
                                ? "On"
                                : this.state.labelMode === "hidden"
                                  ? "Off"
                                  : "Auto"}
                        </button>
                    </div>
                    <div class="toolbar-control-group">
                        <button
                            id="reset-default"
                            class="gm-btn--chip"
                            ?disabled=${!hasLoadedIndex}
                            @click=${() => this.#emitResetDefaults()}
                        >
                            Reset
                        </button>
                        ${this.model.isServerMode
                            ? html`
                                  <button
                                      id="regenerate"
                                      class="gm-btn--chip"
                                      ?disabled=${this.state.isRegeneratePending || !hasLoadedProject}
                                      aria-busy=${this.state.isRegeneratePending ? "true" : "false"}
                                      @click=${() => this.#emitRegenerate()}
                                  >
                                      ${renderProcessButtonContent({
                                          label: "Regenerate",
                                          pending: this.state.isRegeneratePending
                                      })}
                                  </button>
                              `
                            : null}
                        ${this.#renderPendingBadge()}
                    </div>
                </div>
            </div>
        `;
    }
}
