import { html } from "lit";

import type { GraphVisualizationCliCatalogEntry, GraphVisualizationMcpToolCatalogEntry } from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { createGraphVisualizationDocsPanelContent } from "./docs-panel-content.js";
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

    #emitDocsView(docsView: "cli" | "mcp" | "rules"): void {
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
        const docsPanelContent = createGraphVisualizationDocsPanelContent(this.model.documentationCatalogs);
        const docsMeta =
            this.state.activeDocsView === "cli"
                ? docsPanelContent.cliMetaText
                : this.state.activeDocsView === "mcp"
                  ? docsPanelContent.mcpMetaText
                  : docsPanelContent.rulesMetaText;

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
                    <button
                        id="docs-view-rules"
                        class=${this.state.activeDocsView === "rules" ? "top-nav-button active" : "top-nav-button"}
                        @click=${() => this.#emitDocsView("rules")}
                    >
                        Rules
                    </button>
                </div>
                <p id="docs-meta" class="docs-meta">${docsMeta}</p>
                <div id="docs-content">
                    <div
                        id="cli-page"
                        class=${this.state.activeDocsView === "cli" ? "docs-subpage" : "docs-subpage hidden"}
                    >
                        <div id="cli-content" class="docs-grid">
                            ${docsPanelContent.cliEntries.length === 0
                                ? html`<p class="catalog-empty">No CLI command catalog entries found.</p>`
                                : docsPanelContent.cliEntries.map((entry) => this.#renderCliCard(entry))}
                        </div>
                    </div>
                    <div
                        id="mcp-page"
                        class=${this.state.activeDocsView === "mcp" ? "docs-subpage" : "docs-subpage hidden"}
                    >
                        <div id="mcp-content" class="docs-grid">
                            ${docsPanelContent.mcpEntries.length === 0
                                ? html`<p class="catalog-empty">No MCP tool catalog entries found.</p>`
                                : docsPanelContent.mcpEntries.map((entry) => this.#renderMcpCard(entry))}
                        </div>
                    </div>
                    <div
                        id="rules-page"
                        class=${this.state.activeDocsView === "rules" ? "docs-subpage" : "docs-subpage hidden"}
                    >
                        <div id="rules-content" class="docs-grid">
                            ${docsPanelContent.rulesEmptyMessage
                                ? html`<p class="catalog-empty">${docsPanelContent.rulesEmptyMessage}</p>`
                                : docsPanelContent.rulesSections.map(
                                      (section) => html`
                                          <gm-card class="catalog-card" .heading=${section.title}>
                                              <p>${section.description}</p>
                                              <ul class="catalog-list">
                                                  ${section.items.map(
                                                      (item) => html`
                                                          <li class="catalog-item">
                                                              <div class="config-badge-row">
                                                                  ${item.badges.map(
                                                                      (badge) =>
                                                                          html`<gm-badge .label=${badge}></gm-badge>`
                                                                  )}
                                                              </div>
                                                              <code>${item.title}</code>: ${item.detail}
                                                          </li>
                                                      `
                                                  )}
                                              </ul>
                                          </gm-card>
                                      `
                                  )}
                        </div>
                    </div>
                </div>
            </section>
        `;
    }
}
