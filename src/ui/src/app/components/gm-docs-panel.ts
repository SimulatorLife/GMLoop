import { html } from "lit";

import type { GraphVisualizationCliCatalogEntry, GraphVisualizationMcpToolCatalogEntry } from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiDocsView, GraphVisualizationUiState } from "../state/types.js";
import {
    createGraphVisualizationDocsPanelContent,
    type GraphVisualizationDocsPanelCatalogEntry
} from "./docs-panel-content.js";
import {
    createNoSearchResultsMessage,
    normalizeCatalogSearchQuery,
    searchCatalogEntries,
    searchCliEntries,
    searchMcpEntries
} from "./docs-search.js";
import { GRAPH_UI_EVENT_CLEAR_PAGE_ERROR } from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * Docs surface for CLI, MCP, linting, formatting, and codemods catalog entries.
 */
export class GmDocsPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    #onDismissErrorBanner = (): void => {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, {
                bubbles: true,
                composed: true,
                detail: { page: "docs" }
            })
        );
    };

    public connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener("gm-error-banner-dismiss", this.#onDismissErrorBanner);
    }

    public disconnectedCallback(): void {
        this.removeEventListener("gm-error-banner-dismiss", this.#onDismissErrorBanner);
        super.disconnectedCallback();
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

    #renderCatalogCard(entry: GraphVisualizationDocsPanelCatalogEntry) {
        return html`
            <gm-card class="catalog-card" .heading=${entry.title}>
                <p>${entry.description}</p>
                <div class="config-badge-row">
                    ${entry.badges.map((badge) => html`<gm-badge .label=${badge}></gm-badge>`)}
                </div>
            </gm-card>
        `;
    }

    #renderCatalogSubpage(parameters: {
        activeDocsView: GraphVisualizationUiDocsView;
        emptyMessage: string | null;
        entries: ReadonlyArray<GraphVisualizationDocsPanelCatalogEntry>;
        contentId: string;
        searchQuery: string;
        subpageId: string;
    }) {
        const { activeDocsView, emptyMessage, entries, contentId, searchQuery, subpageId } = parameters;
        const className = this.state?.activeDocsView === activeDocsView ? "docs-subpage" : "docs-subpage hidden";
        const searchResult = searchCatalogEntries(entries, searchQuery);

        return html`
            <div id=${subpageId} class=${className}>
                <div id=${contentId} class="docs-grid">
                    ${emptyMessage === null
                        ? searchResult.entries.length === 0
                            ? html`<p class="catalog-empty">
                                  ${createNoSearchResultsMessage(searchQuery, activeDocsView)}
                              </p>`
                            : searchResult.entries.map((entry) => this.#renderCatalogCard(entry))
                        : html`<p class="catalog-empty">${emptyMessage}</p>`}
                </div>
            </div>
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

        return html`
            <section id="docs-page" class=${docsPageClassName}>
                ${this.state.docsErrorMessage
                    ? html`<gm-error-banner .message=${this.state.docsErrorMessage}></gm-error-banner>`
                    : null}
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
                                        ${createNoSearchResultsMessage(searchQuery, "cli")}
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
                                        ${createNoSearchResultsMessage(searchQuery, "mcp")}
                                    </p>`
                                  : mcpSearchResult.entries.map((entry) => this.#renderMcpCard(entry))}
                        </div>
                    </div>
                    ${this.#renderCatalogSubpage({
                        activeDocsView: "linting",
                        contentId: "linting-content",
                        emptyMessage: docsPanelContent.lintingEmptyMessage,
                        entries: docsPanelContent.lintingEntries,
                        searchQuery,
                        subpageId: "linting-page"
                    })}
                    ${this.#renderCatalogSubpage({
                        activeDocsView: "formatting",
                        contentId: "formatting-content",
                        emptyMessage: docsPanelContent.formattingEmptyMessage,
                        entries: docsPanelContent.formattingEntries,
                        searchQuery,
                        subpageId: "formatting-page"
                    })}
                    ${this.#renderCatalogSubpage({
                        activeDocsView: "codemods",
                        contentId: "codemods-content",
                        emptyMessage: docsPanelContent.codemodsEmptyMessage,
                        entries: docsPanelContent.codemodsEntries,
                        searchQuery,
                        subpageId: "codemods-page"
                    })}
                </div>
            </section>
        `;
    }
}
