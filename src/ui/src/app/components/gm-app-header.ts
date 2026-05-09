import { html } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
import { hasLoadedGraphIndex } from "../graph-availability.js";
import type { GraphVisualizationUiPage, GraphVisualizationUiState } from "../state/types.js";
import {
    GRAPH_UI_EVENT_NAVIGATE_PAGE,
    GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT,
    type GraphUiNavigatePageDetail
} from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * Header, navigation, and loaded-target summary for graph/docs/config surfaces.
 */
export class GmAppHeader extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    static readonly #TOP_NAV_BUTTON_BASE_CLASS = "top-nav-button";

    #emitNavigatePage(page: GraphVisualizationUiPage): void {
        if (!this.model) {
            return;
        }

        if (page === "graph" && !hasLoadedGraphIndex(this.model)) {
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

    #emitOpenProject(): void {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT, {
                bubbles: true,
                composed: true
            })
        );
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const loadedTarget = this.model.loadedTarget;
        const hasLoadedIndex = hasLoadedGraphIndex(this.model);
        const activePath = loadedTarget?.activePath ?? this.model.title;
        const loadedSource = loadedTarget?.source ?? "working-directory";
        const selectedPaths = loadedTarget?.selectedPaths ?? [];
        const selectedPathSummary =
            selectedPaths.length === 0
                ? "None"
                : `${String(selectedPaths.length)} item${selectedPaths.length === 1 ? "" : "s"}`;

        return html`
            <header id="app-header" class="app-header">
                <div class="topbar-row">
                    <div class="header-primary">
                        <div class="header-identity-row">
                            <div class="brand-block">
                                <div class="brand-mark">GM</div>
                                <div class="brand-copy">
                                    <h1 class="brand-title">GMLoop</h1>
                                    <div class="brand-subtitle">
                                        Workspace UI driven directly from live CLI and MCP catalogs.
                                    </div>
                                </div>
                            </div>
                            <div class="header-actions">
                                <a
                                    id="github-link"
                                    class="github-link"
                                    href="https://github.com/SimulatorLife/GMLoop"
                                    rel="noreferrer"
                                    target="_blank"
                                >
                                    GitHub Repo
                                </a>
                            </div>
                        </div>
                        <div class="header-navigation-row">
                            <nav class="top-nav" aria-label="Primary">
                                <button
                                    id="tab-graph"
                                    aria-pressed=${this.state.activePage === "graph"}
                                    ?disabled=${!hasLoadedIndex}
                                    class=${this.state.activePage === "graph"
                                        ? `${GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS} active`
                                        : GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS}
                                    @click=${() => this.#emitNavigatePage("graph")}
                                >
                                    Graph Index
                                </button>
                                <button
                                    id="tab-docs"
                                    aria-pressed=${this.state.activePage === "docs"}
                                    class=${this.state.activePage === "docs"
                                        ? `${GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS} active`
                                        : GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS}
                                    @click=${() => this.#emitNavigatePage("docs")}
                                >
                                    Docs
                                </button>
                                <button
                                    id="tab-config"
                                    aria-pressed=${this.state.activePage === "config"}
                                    class=${this.state.activePage === "config"
                                        ? `${GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS} active`
                                        : GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS}
                                    @click=${() => this.#emitNavigatePage("config")}
                                >
                                    Config
                                </button>
                                <button
                                    id="tab-playground"
                                    aria-pressed=${this.state.activePage === "playground"}
                                    class=${this.state.activePage === "playground"
                                        ? `${GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS} active`
                                        : GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS}
                                    @click=${() => this.#emitNavigatePage("playground")}
                                >
                                    Playground
                                </button>
                            </nav>
                        </div>
                    </div>
                    <div class="loaded-target-stack">
                        <div class="loaded-target-actions">
                            <button
                                id="open-project"
                                class="open-button"
                                ?disabled=${this.state.isOpenProjectPending}
                                @click=${() => this.#emitOpenProject()}
                            >
                                <span class="button-content">
                                    ${this.state.isOpenProjectPending
                                        ? html`<span class="button-spinner" aria-hidden="true"></span>`
                                        : null}
                                    <span class="button-label"
                                        >${this.state.isOpenProjectPending ? "Opening…" : "Open..."}</span
                                    >
                                </span>
                            </button>
                        </div>
                        <div id="loaded-target" class="loaded-path">
                            <span class="loaded-path-label">Active</span>
                            <span class="loaded-path-value">${activePath}</span>
                        </div>
                        <div id="loaded-source" class="loaded-path">
                            <span class="loaded-path-label">Source</span>
                            <span class="loaded-path-value">${loadedSource}</span>
                        </div>
                        <div id="loaded-selected" class="loaded-path">
                            <span class="loaded-path-label">Selected</span>
                            <span
                                class=${selectedPaths.length > 0 ? "loaded-path-value" : "loaded-path-value is-empty"}
                            >
                                ${selectedPathSummary}
                            </span>
                        </div>
                    </div>
                </div>
            </header>
        `;
    }
}
