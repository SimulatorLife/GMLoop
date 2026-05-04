import { html } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
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

    #emitNavigatePage(page: GraphVisualizationUiPage): void {
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
        const activePath = loadedTarget?.activePath ?? this.model.title;
        const loadedSource = loadedTarget?.source ?? "working-directory";
        const selectedPaths = loadedTarget?.selectedPaths ?? [];
        const selectedPathSummary = selectedPaths.length > 0 ? selectedPaths.join(", ") : "None";

        return html`
            <header id="app-header" class="app-header">
                <div class="topbar-row">
                    <div class="brand-block">
                        <div class="brand-mark">GM</div>
                        <div class="brand-copy">
                            <h1 class="brand-title">GMLoop</h1>
                            <div class="brand-subtitle">
                                Workspace UI driven directly from live CLI and MCP catalogs.
                            </div>
                        </div>
                        <div class="top-nav-cluster">
                            <nav class="top-nav" aria-label="Primary">
                                <button
                                    id="tab-graph"
                                    class=${this.state.activePage === "graph"
                                        ? "top-nav-button active"
                                        : "top-nav-button"}
                                    @click=${() => this.#emitNavigatePage("graph")}
                                >
                                    Graph Index
                                </button>
                                <button
                                    id="tab-docs"
                                    class=${this.state.activePage === "docs"
                                        ? "top-nav-button active"
                                        : "top-nav-button"}
                                    @click=${() => this.#emitNavigatePage("docs")}
                                >
                                    Docs
                                </button>
                                <button
                                    id="tab-config"
                                    class=${this.state.activePage === "config"
                                        ? "top-nav-button active"
                                        : "top-nav-button"}
                                    @click=${() => this.#emitNavigatePage("config")}
                                >
                                    Config
                                </button>
                            </nav>
                            <a
                                id="github-link"
                                class="github-link"
                                href="https://github.com/SimulatorLife/GMLoop"
                                rel="noreferrer"
                                target="_blank"
                            >
                                GitHub Repo
                            </a>
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
                    </div>
                    <div class="loaded-target-stack">
                        <div id="loaded-target" class="loaded-path"><strong>Active:</strong> ${activePath}</div>
                        <div id="loaded-source" class="loaded-path"><strong>Source:</strong> ${loadedSource}</div>
                        <div id="loaded-selected" class="loaded-path">
                            <strong>Selected:</strong> ${selectedPathSummary}
                        </div>
                    </div>
                </div>
            </header>
        `;
    }
}
