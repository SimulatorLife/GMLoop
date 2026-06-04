import { html } from "lit";

import type { GraphVisualizationCliCatalogEntry, GraphVisualizationMcpToolCatalogEntry } from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { createGraphVisualizationDocsPanelContent } from "./docs-panel-content.js";
import { normalizeCatalogSearchQuery, searchCliEntries, searchMcpEntries, searchRulesSections } from "./docs-search.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * Docs surface for CLI, MCP, and rules catalog entries.
 */
export class GmDocsPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

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

    #createNoSearchResultsMessage(query: string, activeDocsView: "cli" | "mcp" | "rules"): string {
        const catalogLabel = activeDocsView === "cli" ? "commands" : activeDocsView === "mcp" ? "tools" : "rules";
        return `No ${catalogLabel} match “${query}”.`;
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

        const docsPageClassName =
            this.state.activePage === "docs" ? "page content-page docs-page active" : "page content-page docs-page";
        const docsPanelContent = createGraphVisualizationDocsPanelContent(this.model.documentationCatalogs);
        const searchQuery = normalizeCatalogSearchQuery(this.state.searchQuery);
        const cliSearchResult = searchCliEntries(docsPanelContent.cliEntries, searchQuery);
        const mcpSearchResult = searchMcpEntries(docsPanelContent.mcpEntries, searchQuery);
        const rulesSearchResult = searchRulesSections(docsPanelContent.rulesSections, searchQuery);

        return html`
            <section id="docs-page" class=${docsPageClassName}>
                <div id="docs-content">
                    <div
                        id="cli-page"
                        class=${this.state.activeDocsView === "cli" ? "docs-subpage" : "docs-subpage hidden"}
                    >
                        <div id="cli-content" class="docs-grid">
                            ${docsPanelContent.cliEntries.length === 0
                                ? html`<p class="catalog-empty">No commands are available right now.</p>`
                                : cliSearchResult.entries.length === 0
                                  ? html`<p class="catalog-empty">
                                        ${this.#createNoSearchResultsMessage(searchQuery, "cli")}
                                    </p>`
                                  : cliSearchResult.entries.map((entry) => this.#renderCliCard(entry))}
                        </div>
                    </div>
                    <div
                        id="docs-mcp-page"
                        class=${this.state.activeDocsView === "mcp" ? "docs-subpage" : "docs-subpage hidden"}
                    >
                        <div id="mcp-content" class="docs-grid">
                            ${docsPanelContent.mcpEntries.length === 0
                                ? html`<p class="catalog-empty">No tools are available right now.</p>`
                                : mcpSearchResult.entries.length === 0
                                  ? html`<p class="catalog-empty">
                                        ${this.#createNoSearchResultsMessage(searchQuery, "mcp")}
                                    </p>`
                                  : mcpSearchResult.entries.map((entry) => this.#renderMcpCard(entry))}
                        </div>
                    </div>
                    <div
                        id="rules-page"
                        class=${this.state.activeDocsView === "rules" ? "docs-subpage" : "docs-subpage hidden"}
                    >
                        <div id="rules-content" class="docs-grid">
                            ${docsPanelContent.rulesEmptyMessage
                                ? html`<p class="catalog-empty">${docsPanelContent.rulesEmptyMessage}</p>`
                                : rulesSearchResult.sections.length === 0
                                  ? html`<p class="catalog-empty">
                                        ${this.#createNoSearchResultsMessage(searchQuery, "rules")}
                                    </p>`
                                  : rulesSearchResult.sections.map(
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
