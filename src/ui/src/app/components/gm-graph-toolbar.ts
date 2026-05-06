import { html } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import {
    GRAPH_UI_EVENT_CYCLE_LABEL_MODE,
    GRAPH_UI_EVENT_RESET_DEFAULTS,
    GRAPH_UI_EVENT_SET_SEARCH_QUERY,
    GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW,
    GRAPH_UI_EVENT_TRIGGER_REGENERATE,
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

    #emitSearchQuery(searchQuery: string): void {
        this.dispatchEvent(
            new CustomEvent<GraphUiSetSearchQueryDetail>(GRAPH_UI_EVENT_SET_SEARCH_QUERY, {
                bubbles: true,
                composed: true,
                detail: { searchQuery }
            })
        );
    }

    #emitToggleGraphView(): void {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW, {
                bubbles: true,
                composed: true
            })
        );
    }

    #emitCycleLabelMode(): void {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_CYCLE_LABEL_MODE, {
                bubbles: true,
                composed: true
            })
        );
    }

    #emitResetDefaults(): void {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_RESET_DEFAULTS, {
                bubbles: true,
                composed: true
            })
        );
    }

    #emitRegenerate(): void {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_TRIGGER_REGENERATE, {
                bubbles: true,
                composed: true
            })
        );
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const heading =
            this.state.activePage === "graph" ? "Graph Index" : this.state.activePage === "docs" ? "Docs" : "Config";
        const subheading =
            this.state.activePage === "graph"
                ? "Interactive graph exploration controls for the current graph index."
                : this.state.activePage === "docs"
                  ? "CLI and MCP reference material generated from the active workspace."
                  : "Project and tooling configuration metadata loaded for the active root.";

        const graphControlsClassName =
            this.state.activePage === "graph" ? "toolbar-controls" : "toolbar-controls hidden";

        return html`
            <div id="page-toolbar" class="page-toolbar">
                <div class="toolbar-title">
                    <strong id="toolbar-heading">${heading}</strong>
                    <span id="toolbar-subheading">${subheading}</span>
                </div>
                <div id="graph-controls" class=${graphControlsClassName}>
                    <input
                        id="search"
                        type="search"
                        aria-label="Search graph nodes"
                        .value=${this.state.searchQuery}
                        placeholder="Search nodes…"
                        @input=${(eventValue: Event) => {
                            const target = eventValue.target;
                            if (!(target instanceof HTMLInputElement)) {
                                return;
                            }
                            this.#emitSearchQuery(target.value);
                        }}
                    />
                    <button
                        id="toggle-view"
                        aria-pressed=${this.state.activeGraphView === "json"}
                        @click=${() => this.#emitToggleGraphView()}
                    >
                        ${this.state.activeGraphView === "visual" ? "JSON" : "Visual"}
                    </button>
                    <button id="toggle-labels" @click=${() => this.#emitCycleLabelMode()}>
                        Labels:
                        ${this.state.labelMode === "always" ? "On" : this.state.labelMode === "hidden" ? "Off" : "Auto"}
                    </button>
                    <button id="reset-default" @click=${() => this.#emitResetDefaults()}>Reset</button>
                    ${this.model.isServerMode
                        ? html`
                              <button
                                  id="regenerate"
                                  ?disabled=${this.state.isRegeneratePending}
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
                </div>
            </div>
        `;
    }
}
