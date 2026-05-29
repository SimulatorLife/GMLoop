import { html } from "lit";

import type { GraphVisualizationCliCatalogEntry, GraphVisualizationMcpToolCatalogEntry } from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import {
    createGraphVisualizationDocsPanelContent,
    type GraphVisualizationDocsPanelRulesSection
} from "./docs-panel-content.js";
import { GRAPH_UI_EVENT_SET_DOCS_VIEW, type GraphUiSetDocsViewDetail } from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

type CatalogSearchResult<TEntry> = Readonly<{
    entries: ReadonlyArray<TEntry>;
    totalCount: number;
}>;

type RulesCatalogSearchResult = Readonly<{
    sections: ReadonlyArray<GraphVisualizationDocsPanelRulesSection>;
    totalCount: number;
}>;

function normalizeCatalogSearchQuery(query: string): string {
    return query.trim().toLowerCase();
}

function fieldMatchesSearchQuery(query: string, fieldValue: string): boolean {
    return fieldValue.toLowerCase().includes(query);
}

function fieldsMatchSearchQuery(query: string, fieldValues: ReadonlyArray<string>): boolean {
    if (query.length === 0) {
        return true;
    }

    return fieldValues.some((fieldValue) => fieldMatchesSearchQuery(query, fieldValue));
}

function searchCliEntries(
    entries: ReadonlyArray<GraphVisualizationCliCatalogEntry>,
    query: string
): CatalogSearchResult<GraphVisualizationCliCatalogEntry> {
    if (query.length === 0) {
        return { entries, totalCount: entries.length };
    }

    const filteredEntries = entries.filter((entry) =>
        fieldsMatchSearchQuery(query, [
            entry.description,
            entry.displayName,
            entry.usage,
            ...entry.arguments.flatMap((argumentValue) => [argumentValue.description, argumentValue.name]),
            ...entry.options.flatMap((optionValue) => [optionValue.description, optionValue.flags])
        ])
    );

    return { entries: filteredEntries, totalCount: filteredEntries.length };
}

function searchMcpEntries(
    entries: ReadonlyArray<GraphVisualizationMcpToolCatalogEntry>,
    query: string
): CatalogSearchResult<GraphVisualizationMcpToolCatalogEntry> {
    if (query.length === 0) {
        return { entries, totalCount: entries.length };
    }

    const filteredEntries = entries.filter((entry) =>
        fieldsMatchSearchQuery(query, [
            entry.commandDisplayName,
            entry.description,
            ...entry.fields.flatMap((fieldValue) => [fieldValue.description, fieldValue.name])
        ])
    );

    return { entries: filteredEntries, totalCount: filteredEntries.length };
}

function searchRulesSections(
    sections: ReadonlyArray<GraphVisualizationDocsPanelRulesSection>,
    query: string
): RulesCatalogSearchResult {
    if (query.length === 0) {
        return {
            sections,
            totalCount: sections.reduce((total, section) => total + section.items.length, 0)
        };
    }

    const filteredSections = sections.flatMap((section) => {
        const sectionMatches = fieldsMatchSearchQuery(query, [section.description, section.title]);
        const items = sectionMatches
            ? section.items
            : section.items.filter((item) => fieldsMatchSearchQuery(query, [item.detail, item.title, ...item.badges]));

        if (items.length === 0) {
            return [];
        }

        return [{ ...section, items }];
    });

    return {
        sections: filteredSections,
        totalCount: filteredSections.reduce((total, section) => total + section.items.length, 0)
    };
}

function createSearchResultSummary(query: string, activeDocsView: "cli" | "mcp" | "rules", totalCount: number): string {
    if (query.length === 0) {
        return "";
    }

    const itemLabel =
        activeDocsView === "cli"
            ? totalCount === 1
                ? "command"
                : "commands"
            : activeDocsView === "mcp"
              ? totalCount === 1
                  ? "tool"
                  : "tools"
              : totalCount === 1
                ? "rule or option"
                : "rules or options";

    return `Showing ${String(totalCount)} ${itemLabel} matching “${query}”.`;
}

/**
 * Docs surface for CLI, MCP, and rules catalog entries.
 */
export class GmDocsPanel extends LightDomLitElement {
    public static properties = {
        docsSearchQuery: { attribute: false, state: true },
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    protected accessor docsSearchQuery = "";

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

    #setDocsSearchQuery(value: string): void {
        this.docsSearchQuery = value;
    }

    #clearDocsSearchQuery(): void {
        this.docsSearchQuery = "";
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

        const docsPageClassName = this.state.activePage === "docs" ? "page docs-page active" : "page docs-page";
        const docsPanelContent = createGraphVisualizationDocsPanelContent(this.model.documentationCatalogs);
        const searchQuery = normalizeCatalogSearchQuery(this.docsSearchQuery);
        const cliSearchResult = searchCliEntries(docsPanelContent.cliEntries, searchQuery);
        const mcpSearchResult = searchMcpEntries(docsPanelContent.mcpEntries, searchQuery);
        const rulesSearchResult = searchRulesSections(docsPanelContent.rulesSections, searchQuery);
        const docsMeta =
            this.state.activeDocsView === "cli"
                ? docsPanelContent.cliMetaText
                : this.state.activeDocsView === "mcp"
                  ? docsPanelContent.mcpMetaText
                  : docsPanelContent.rulesMetaText;
        const searchResultSummary = createSearchResultSummary(
            searchQuery,
            this.state.activeDocsView,
            this.state.activeDocsView === "cli"
                ? cliSearchResult.totalCount
                : this.state.activeDocsView === "mcp"
                  ? mcpSearchResult.totalCount
                  : rulesSearchResult.totalCount
        );

        return html`
            <section id="docs-page" class=${docsPageClassName}>
                <div class="docs-toggle-row" role="group" aria-label="Documentation view selector">
                    <button
                        id="docs-view-cli"
                        aria-pressed=${this.state.activeDocsView === "cli"}
                        class=${this.state.activeDocsView === "cli" ? "top-nav-button active" : "top-nav-button"}
                        @click=${() => this.#emitDocsView("cli")}
                    >
                        CLI
                    </button>
                    <button
                        id="docs-view-mcp"
                        aria-pressed=${this.state.activeDocsView === "mcp"}
                        class=${this.state.activeDocsView === "mcp" ? "top-nav-button active" : "top-nav-button"}
                        @click=${() => this.#emitDocsView("mcp")}
                    >
                        MCP
                    </button>
                    <button
                        id="docs-view-rules"
                        aria-pressed=${this.state.activeDocsView === "rules"}
                        class=${this.state.activeDocsView === "rules" ? "top-nav-button active" : "top-nav-button"}
                        @click=${() => this.#emitDocsView("rules")}
                    >
                        Rules
                    </button>
                </div>
                <div class="docs-search-panel" role="search" aria-label="Filter documentation catalog">
                    <label class="docs-search-label" for="docs-search-input">Search current docs view</label>
                    <div class="docs-search-controls">
                        <input
                            id="docs-search-input"
                            class="docs-search-input"
                            type="search"
                            .value=${this.docsSearchQuery}
                            aria-describedby="docs-meta docs-search-summary"
                            placeholder="Search names, descriptions, flags, and badges"
                            @input=${(event: Event) =>
                                this.#setDocsSearchQuery((event.currentTarget as HTMLInputElement).value)}
                        />
                        <button
                            class="docs-search-clear"
                            type="button"
                            ?disabled=${this.docsSearchQuery.length === 0}
                            @click=${() => this.#clearDocsSearchQuery()}
                        >
                            Clear
                        </button>
                    </div>
                    <p id="docs-search-summary" class="docs-search-summary" aria-live="polite">
                        ${searchResultSummary}
                    </p>
                </div>
                <p id="docs-meta" class="docs-meta">${docsMeta}</p>
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
