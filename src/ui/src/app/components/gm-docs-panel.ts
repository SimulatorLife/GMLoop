import { html } from "lit";

import type { GraphVisualizationCliCatalogEntry, GraphVisualizationMcpToolCatalogEntry } from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { GRAPH_UI_EVENT_SET_DOCS_VIEW, type GraphUiSetDocsViewDetail } from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * Docs surface for CLI and MCP catalog entries.
 */
export class GmDocsPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    #emitDocsView(docsView: "cli" | "mcp"): void {
        this.dispatchEvent(
            new CustomEvent<GraphUiSetDocsViewDetail>(GRAPH_UI_EVENT_SET_DOCS_VIEW, {
                bubbles: true,
                composed: true,
                detail: { docsView }
            })
        );
    }

    #renderCliCard(entry: GraphVisualizationCliCatalogEntry) {
        return html`
            <gm-card class="catalog-card" .heading=${entry.displayName}>
                <p>${entry.description}</p>
                <code class="catalog-usage">${entry.usage}</code>
                <ul class="catalog-list">
                    ${entry.arguments.map(
                        (argumentValue) =>
                            html`<li class="catalog-item">
                                <code>${argumentValue.name}</code>: ${argumentValue.description}
                            </li>`
                    )}
                    ${entry.options.map(
                        (optionValue) =>
                            html`<li class="catalog-item">
                                <code>${optionValue.flags}</code>: ${optionValue.description}
                            </li>`
                    )}
                </ul>
            </gm-card>
        `;
    }

    #renderMcpCard(entry: GraphVisualizationMcpToolCatalogEntry) {
        return html`
            <gm-card class="catalog-card" .heading=${entry.commandDisplayName}>
                <p>${entry.description}</p>
                <ul class="catalog-list">
                    ${entry.fields.map(
                        (fieldValue) =>
                            html`<li class="catalog-item">
                                <code>${fieldValue.name}</code>: ${fieldValue.description}
                            </li>`
                    )}
                </ul>
            </gm-card>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const docsPageClassName = this.state.activePage === "docs" ? "page docs-page active" : "page docs-page";
        const catalogs = this.model.documentationCatalogs;
        const cliEntries = catalogs?.cliCommands ?? [];
        const mcpEntries = catalogs?.mcpTools ?? [];

        const docsMeta = catalogs
            ? `MCP server ${catalogs.mcpServer.name}@${catalogs.mcpServer.version} • ${cliEntries.length} CLI commands • ${mcpEntries.length} MCP tools`
            : "No documentation catalogs were provided by the host.";

        return html`
            <section id="docs-page" class=${docsPageClassName}>
                <div class="docs-toggle-row">
                    <button
                        id="docs-view-cli"
                        class=${this.state.activeDocsView === "cli" ? "top-nav-button active" : "top-nav-button"}
                        @click=${() => this.#emitDocsView("cli")}
                    >
                        CLI
                    </button>
                    <button
                        id="docs-view-mcp"
                        class=${this.state.activeDocsView === "mcp" ? "top-nav-button active" : "top-nav-button"}
                        @click=${() => this.#emitDocsView("mcp")}
                    >
                        MCP
                    </button>
                </div>
                <p id="docs-meta" class="docs-meta">${docsMeta}</p>
                <div id="docs-content">
                    <div
                        id="cli-page"
                        class=${this.state.activeDocsView === "cli" ? "docs-subpage" : "docs-subpage hidden"}
                    >
                        <div id="cli-content" class="docs-grid">
                            ${cliEntries.length === 0
                                ? html`<p class="catalog-empty">No CLI command catalog entries found.</p>`
                                : cliEntries.map((entry) => this.#renderCliCard(entry))}
                        </div>
                    </div>
                    <div
                        id="mcp-page"
                        class=${this.state.activeDocsView === "mcp" ? "docs-subpage" : "docs-subpage hidden"}
                    >
                        <div id="mcp-content" class="docs-grid">
                            ${mcpEntries.length === 0
                                ? html`<p class="catalog-empty">No MCP tool catalog entries found.</p>`
                                : mcpEntries.map((entry) => this.#renderMcpCard(entry))}
                        </div>
                    </div>
                </div>
            </section>
        `;
    }
}
