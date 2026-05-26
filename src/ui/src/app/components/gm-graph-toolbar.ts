import { html } from "lit";
import { ref } from "lit/directives/ref.js";

import { type GraphVisualizationUiModel,hasLoadedGraphIndex, hasLoadedGraphProject } from "../contracts.js";
import type {
    GraphVisualizationUiMcpServerStatus,
    GraphVisualizationUiPage,
    GraphVisualizationUiState
} from "../state/types.js";
import {
    GRAPH_UI_EVENT_CYCLE_LABEL_MODE,
    GRAPH_UI_EVENT_NAVIGATE_PAGE,
    GRAPH_UI_EVENT_RESET_DEFAULTS,
    GRAPH_UI_EVENT_SET_SEARCH_QUERY,
    GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW,
    GRAPH_UI_EVENT_TRIGGER_REGENERATE,
    type GraphUiNavigatePageDetail,
    type GraphUiSetSearchQueryDetail
} from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

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

    #searchInput: HTMLInputElement | null = null;

    #canUseGraphControls(): boolean {
        return this.model !== null && hasLoadedGraphIndex(this.model);
    }

    #onKeyDown = (event: KeyboardEvent): void => {
        if (!this.state) {
            return;
        }

        if (event.key === "Escape" && this.state.searchQuery) {
            event.preventDefault();
            this.#emitSearchQuery("");
            return;
        }

        if (event.altKey || event.metaKey || event.ctrlKey) {
            return;
        }

        switch (event.key.toLowerCase()) {
            case "g": {
                if (document.activeElement === this.#searchInput) {
                    return;
                }
                if (!this.#canUseGraphControls()) {
                    return;
                }
                event.preventDefault();
                this.#emitToggleGraphView();
                break;
            }
            case "l": {
                if (document.activeElement === this.#searchInput) {
                    return;
                }
                if (!this.#canUseGraphControls()) {
                    return;
                }
                event.preventDefault();
                this.#emitCycleLabelMode();
                break;
            }
            case "r": {
                if (document.activeElement === this.#searchInput) {
                    return;
                }
                if (!this.#canUseGraphControls()) {
                    return;
                }
                event.preventDefault();
                this.#emitResetDefaults();
                break;
            }
            case "1": {
                if (!this.#canUseGraphControls()) {
                    return;
                }
                event.preventDefault();
                this.#emitNavigatePage("graph");
                break;
            }
            case "2": {
                event.preventDefault();
                this.#emitNavigatePage("docs");
                break;
            }
            case "3": {
                event.preventDefault();
                this.#emitNavigatePage("config");
                break;
            }
            case "4": {
                event.preventDefault();
                this.#emitNavigatePage("fix");
                break;
            }
            case "5": {
                event.preventDefault();
                this.#emitNavigatePage("playground");
                break;
            }
            case "6": {
                event.preventDefault();
                this.#emitNavigatePage("mcp");
                break;
            }
            case "7": {
                event.preventDefault();
                this.#emitNavigatePage("live-reload");
                break;
            }
        }
    };

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
        this.#searchInput = null;
    }

    #emitSearchQuery(searchQuery: string): void {
        if (!this.#canUseGraphControls()) {
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

    #getMcpStatusLabel(status: GraphVisualizationUiMcpServerStatus): string {
        if (status === "running") {
            return "Running";
        }
        if (status === "stopped") {
            return "Stopped";
        }
        return "Not Started";
    }

    #getMcpStatusDescription(status: GraphVisualizationUiMcpServerStatus): string {
        if (status === "running") {
            return "The MCP bridge is available for connected clients.";
        }
        if (status === "stopped") {
            return "The MCP bridge stopped. Restart it to continue.";
        }
        return "The MCP bridge has not started in this session yet.";
    }

    #renderMcpStatus() {
        if (!this.model || this.state?.activePage !== "mcp") {
            return null;
        }

        const status = this.model.mcpServerStatus;
        const statusClassName =
            status === "running"
                ? "mcp-runtime-status-chip running"
                : status === "stopped"
                  ? "mcp-runtime-status-chip stopped"
                  : "mcp-runtime-status-chip";

        return html`
            <div class="toolbar-status">
                <div class=${statusClassName} role="status" aria-label=${this.#getMcpStatusDescription(status)}>
                    <span class="mcp-runtime-status-dot" aria-hidden="true"></span>
                    <strong>${this.#getMcpStatusLabel(status)}</strong>
                </div>
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
                        : this.state.activePage === "mcp"
                          ? "MCP"
                          : "Live Reload";
        const subheading =
            this.state.activePage === "graph"
                ? "Explore relationships across scripts, objects, events, and other project resources."
                : this.state.activePage === "docs"
                  ? "Browse commands, tools, and rules that can help with your project."
                  : this.state.activePage === "config"
                    ? "Review the project settings and tool options currently in use."
                    : this.state.activePage === "fix"
                      ? "Run the opened project's gmloop-configured repair workflow."
                      : this.state.activePage === "playground"
                        ? "Interactive GML playground for parsing, formatting, and rule experiments."
                        : this.state.activePage === "mcp"
                          ? "Check tool access and connection status for integrations."
                          : "Track live-update activity and recent reload problems.";
        const hasLoadedIndex = hasLoadedGraphIndex(this.model);
        const hasLoadedProject = hasLoadedGraphProject(this.model);

        const graphControlsClassName =
            this.state.activePage === "graph" ? "toolbar-controls" : "toolbar-controls hidden";

        return html`
            <div id="page-toolbar" class="page-toolbar">
                <div class="toolbar-heading-row">
                    <div class="toolbar-title">
                        <strong id="toolbar-heading">${heading}</strong>
                        <span id="toolbar-subheading">${subheading}</span>
                    </div>
                    ${this.#renderMcpStatus()}
                </div>
                <div id="graph-controls" class=${graphControlsClassName}>
                    <div class="toolbar-control-group toolbar-search-group">
                        <input
                            id="search"
                            type="search"
                            aria-label="Search graph nodes"
                            .value=${this.state.searchQuery}
                            placeholder="Search nodes…"
                            ?disabled=${!hasLoadedIndex}
                            ${ref((element) => {
                                this.#searchInput = element as HTMLInputElement | null;
                            })}
                            @input=${this.#onSearchInput}
                        />
                    </div>
                    <div class="toolbar-control-group">
                        <button
                            id="toggle-view"
                            class="toolbar-chip-button"
                            aria-pressed=${this.state.activeGraphView === "json"}
                            ?disabled=${!hasLoadedIndex}
                            @click=${() => this.#emitToggleGraphView()}
                        >
                            ${this.state.activeGraphView === "visual" ? "JSON" : "Visual"}
                        </button>
                        <button
                            id="toggle-labels"
                            class="toolbar-chip-button"
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
                            class="toolbar-chip-button"
                            ?disabled=${!hasLoadedIndex}
                            @click=${() => this.#emitResetDefaults()}
                        >
                            Reset
                        </button>
                        ${this.model.isServerMode
                            ? html`
                                  <button
                                      id="regenerate"
                                      class="toolbar-chip-button"
                                      ?disabled=${this.state.isRegeneratePending || !hasLoadedProject}
                                      @click=${() => this.#emitRegenerate()}
                                  >
                                      <span class="button-content">
                                          ${this.state.isRegeneratePending
                                              ? html`<span class="button-spinner" aria-hidden="true"></span>`
                                              : null}
                                          <span class="button-label"
                                              >${this.state.isRegeneratePending ? "Regenerating…" : "Regenerate"}</span
                                          >
                                      </span>
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
