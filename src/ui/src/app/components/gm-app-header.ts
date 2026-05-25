import { html, nothing } from "lit";

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
    static readonly #ARIA_CURRENT_PAGE = "page";

    #getAriaCurrentForPage(page: GraphVisualizationUiPage): string | typeof nothing {
        if (!this.state || this.state.activePage !== page) {
            return nothing;
        }
        return GmAppHeader.#ARIA_CURRENT_PAGE;
    }

    #getMcpStatusLabel(status: GraphVisualizationUiState["mcpServerStatus"]): string {
        if (status === "running") {
            return "MCP Running";
        }
        if (status === "stopped") {
            return "MCP Stopped";
        }
        return "MCP Not Started";
    }

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
        const liveReloadPage: GraphVisualizationUiPage = "live-reload";
        const activePath = loadedTarget?.activePath ?? this.model.title;
        const mcpStatusLabel = this.#getMcpStatusLabel(this.model.mcpServerStatus);
        const mcpStatusClass =
            this.model.mcpServerStatus === "running"
                ? "mcp-status-badge running"
                : this.model.mcpServerStatus === "stopped"
                  ? "mcp-status-badge stopped"
                  : "mcp-status-badge not-started";

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
                                        Tools for exploring and improving GameMaker projects.
                                    </div>
                                </div>
                            </div>
                            <div class="header-actions">
                                <div class=${mcpStatusClass} role="status" aria-label="MCP server status">
                                    <span class="mcp-status-dot" aria-hidden="true"></span>
                                    <span class="mcp-status-label">${mcpStatusLabel}</span>
                                </div>
                                <a
                                    id="manual-link"
                                    class="header-icon-link"
                                    href="https://manual.gamemaker.io/"
                                    rel="noreferrer"
                                    target="_blank"
                                    aria-label="Open GameMaker manual"
                                    title="Open GameMaker manual"
                                >
                                    <svg class="header-link-icon" viewBox="0 0 24 24" aria-hidden="true">
                                        <path
                                            d="M3.5 5.25A2.75 2.75 0 0 1 6.25 2.5h11.5A2.75 2.75 0 0 1 20.5 5.25v13.5a.75.75 0 0 1-1.17.62A4.73 4.73 0 0 0 16.75 18H6.25A2.75 2.75 0 0 1 3.5 15.25v-10ZM6.25 4a1.25 1.25 0 0 0-1.25 1.25v10a1.25 1.25 0 0 0 1.25 1.25h10.5c.79 0 1.56.16 2.25.46V5.25A1.25 1.25 0 0 0 17.75 4H6.25Zm1.5 2.75c0-.41.34-.75.75-.75h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1-.75-.75Zm0 3.5c0-.41.34-.75.75-.75h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1-.75-.75Zm0 3.5c0-.41.34-.75.75-.75h4.5a.75.75 0 0 1 0 1.5H8.5a.75.75 0 0 1-.75-.75Z"
                                        ></path>
                                    </svg>
                                </a>
                                <a
                                    id="github-link"
                                    class="header-icon-link"
                                    href="https://github.com/SimulatorLife/GMLoop"
                                    rel="noreferrer"
                                    target="_blank"
                                    aria-label="Open GMLoop GitHub repository"
                                    title="Open GMLoop GitHub repository"
                                >
                                    <svg class="header-link-icon" viewBox="0 0 24 24" aria-hidden="true">
                                        <path
                                            d="M12 1.5C6.2 1.5 1.5 6.32 1.5 12.26c0 4.76 3.04 8.8 7.26 10.22.53.1.72-.24.72-.52 0-.26-.01-1.12-.01-2.03-2.96.66-3.58-1.29-3.58-1.29-.48-1.27-1.18-1.6-1.18-1.6-.97-.68.07-.67.07-.67 1.07.08 1.64 1.15 1.64 1.15.95 1.68 2.49 1.2 3.1.91.1-.71.37-1.2.68-1.47-2.36-.28-4.85-1.21-4.85-5.38 0-1.19.41-2.17 1.08-2.93-.11-.28-.47-1.4.1-2.92 0 0 .88-.29 2.89 1.12A9.8 9.8 0 0 1 12 6.57c.87 0 1.75.12 2.57.36 2.01-1.42 2.89-1.12 2.89-1.12.57 1.52.21 2.64.1 2.92.67.76 1.08 1.74 1.08 2.93 0 4.18-2.5 5.09-4.88 5.36.39.34.73 1 .73 2.02 0 1.46-.01 2.63-.01 2.99 0 .29.19.63.73.52 4.21-1.42 7.24-5.46 7.24-10.22C22.5 6.32 17.8 1.5 12 1.5Z"
                                        ></path>
                                    </svg>
                                </a>
                            </div>
                        </div>
                        <div class="header-navigation-row">
                            <nav class="top-nav" aria-label="Primary">
                                <button
                                    id="tab-graph"
                                    aria-pressed=${this.state.activePage === "graph"}
                                    aria-current=${this.#getAriaCurrentForPage("graph")}
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
                                    aria-current=${this.#getAriaCurrentForPage("docs")}
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
                                    aria-current=${this.#getAriaCurrentForPage("config")}
                                    class=${this.state.activePage === "config"
                                        ? `${GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS} active`
                                        : GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS}
                                    @click=${() => this.#emitNavigatePage("config")}
                                >
                                    Config
                                </button>
                                <button
                                    id="tab-fix"
                                    aria-pressed=${this.state.activePage === "fix"}
                                    aria-current=${this.#getAriaCurrentForPage("fix")}
                                    class=${this.state.activePage === "fix"
                                        ? `${GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS} active`
                                        : GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS}
                                    @click=${() => this.#emitNavigatePage("fix")}
                                >
                                    Fix
                                </button>
                                <button
                                    id="tab-playground"
                                    aria-pressed=${this.state.activePage === "playground"}
                                    aria-current=${this.#getAriaCurrentForPage("playground")}
                                    class=${this.state.activePage === "playground"
                                        ? `${GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS} active`
                                        : GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS}
                                    @click=${() => this.#emitNavigatePage("playground")}
                                >
                                    Playground
                                </button>
                                <button
                                    id="tab-mcp"
                                    aria-pressed=${this.state.activePage === "mcp"}
                                    aria-current=${this.#getAriaCurrentForPage("mcp")}
                                    class=${this.state.activePage === "mcp"
                                        ? `${GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS} active`
                                        : GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS}
                                    @click=${() => this.#emitNavigatePage("mcp")}
                                >
                                    MCP
                                </button>
                                <button
                                    id="tab-live-reload"
                                    aria-pressed=${this.state.activePage === liveReloadPage}
                                    aria-current=${this.#getAriaCurrentForPage(liveReloadPage)}
                                    class=${this.state.activePage === liveReloadPage
                                        ? `${GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS} active`
                                        : GmAppHeader.#TOP_NAV_BUTTON_BASE_CLASS}
                                    @click=${() => this.#emitNavigatePage(liveReloadPage)}
                                >
                                    Live Reload
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
                            <span class="loaded-path-value">${activePath}</span>
                        </div>
                    </div>
                </div>
            </header>
        `;
    }
}
