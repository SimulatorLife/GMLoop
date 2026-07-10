import { html } from "lit";

import type {
    GraphVisualizationCliCatalogEntry,
    GraphVisualizationLspToolCatalogEntry,
    GraphVisualizationMcpToolCatalogEntry
} from "../../graph/types.js";
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
    searchLspEntries,
    searchMcpEntries
} from "./docs-search.js";
import {
    GRAPH_UI_EVENT_CLEAR_PAGE_ERROR,
    GRAPH_UI_EVENT_SET_DOCS_VIEW,
    type GraphUiSetDocsViewDetail
} from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

const DOCS_VIEW_LABELS: Readonly<Record<GraphVisualizationUiDocsView, string>> = Object.freeze({
    cli: "CLI",
    lsp: "LSP",
    codemods: "Codemods",
    formatting: "Formatting",
    linting: "Linting",
    mcp: "MCP"
});

const DOCS_VIEW_ORDER: ReadonlyArray<GraphVisualizationUiDocsView> = Object.freeze([
    "cli",
    "lsp",
    "mcp",
    "linting",
    "formatting",
    "codemods"
]);

const DOCS_VIEW_CONTENT_IDS: Readonly<Record<GraphVisualizationUiDocsView, string>> = Object.freeze({
    cli: "cli-page",
    lsp: "lsp-page",
    codemods: "codemods-page",
    formatting: "formatting-page",
    linting: "linting-page",
    mcp: "docs-mcp-page"
});
const DOCS_SUBPAGE_CLASS = "docs-subpage";
const DOCS_HIDDEN_SUBPAGE_CLASS = "docs-subpage hidden";

/**
 * Docs surface for CLI, MCP, linting, formatting, and codemods catalog entries.
 */
export class GmDocsPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false },
        showInternalMcpTools: { type: Boolean, state: true }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    public accessor showInternalMcpTools = false;

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

    #emitDocsView(docsView: GraphVisualizationUiDocsView): void {
        this.dispatchEvent(
            new CustomEvent<GraphUiSetDocsViewDetail>(GRAPH_UI_EVENT_SET_DOCS_VIEW, {
                bubbles: true,
                composed: true,
                detail: { docsView }
            })
        );
    }

    #renderViewButton(
        activeDocsView: GraphVisualizationUiDocsView,
        docsView: GraphVisualizationUiDocsView,
        count: number
    ) {
        const isActive = activeDocsView === docsView;
        return html`
            <button
                id=${`docs-view-${docsView}`}
                class=${isActive ? "docs-nav-button active" : "docs-nav-button"}
                type="button"
                role="tab"
                aria-selected=${isActive}
                aria-controls=${DOCS_VIEW_CONTENT_IDS[docsView]}
                tabindex=${isActive ? "0" : "-1"}
                @click=${() => this.#emitDocsView(docsView)}
                @keydown=${(event: KeyboardEvent) => {
                    void this.#onDocsViewKeyDown(event, docsView);
                }}
            >
                <span class="docs-nav-label">${DOCS_VIEW_LABELS[docsView]}</span>
                <span class="docs-nav-count">${count}</span>
            </button>
        `;
    }

    async #onDocsViewKeyDown(event: KeyboardEvent, docsView: GraphVisualizationUiDocsView): Promise<void> {
        const nextDocsView = resolveKeyboardDocsView(event.key, docsView);
        if (nextDocsView === docsView) {
            return;
        }

        event.preventDefault();
        this.#emitDocsView(nextDocsView);
        await this.updateComplete;
        this.querySelector<HTMLButtonElement>(`#docs-view-${nextDocsView}`)?.focus();
    }

    #renderDocsControls(parameters: {
        activeDocsView: GraphVisualizationUiDocsView;
        counts: Readonly<Record<GraphVisualizationUiDocsView, number>>;
    }) {
        return html`
            <aside class="docs-sidebar" aria-label="Documentation sections">
                <div class="docs-sidebar-heading">Reference</div>
                <div class="docs-nav" role="tablist" aria-label="Documentation view selector">
                    ${this.#renderViewButton(parameters.activeDocsView, "cli", parameters.counts.cli)}
                    ${this.#renderViewButton(parameters.activeDocsView, "lsp", parameters.counts.lsp)}
                    ${this.#renderViewButton(parameters.activeDocsView, "mcp", parameters.counts.mcp)}
                    ${this.#renderViewButton(parameters.activeDocsView, "linting", parameters.counts.linting)}
                    ${this.#renderViewButton(parameters.activeDocsView, "formatting", parameters.counts.formatting)}
                    ${this.#renderViewButton(parameters.activeDocsView, "codemods", parameters.counts.codemods)}
                </div>
            </aside>
        `;
    }

    #resolveCliCopyValue(entry: GraphVisualizationCliCatalogEntry): string {
        const projectRoot = this.model?.loadedTarget?.projectRoot ?? null;
        if (projectRoot === null) {
            return entry.usage;
        }

        return `gmloop ${entry.commandPath.join(" ")} --path ${quoteShellArgument(projectRoot)}`;
    }

    #renderCliEntry(entry: GraphVisualizationCliCatalogEntry) {
        const copyValue = this.#resolveCliCopyValue(entry);
        return html`
            <article class="docs-reference-entry">
                <div class="docs-entry-main">
                    <h3>${entry.displayName}</h3>
                    <p>${entry.description}</p>
                </div>
                <div class="docs-usage-shell">
                    <code class="docs-usage">${copyValue}</code>
                    <gm-copy-button
                        class="docs-usage-copy-button"
                        .value=${copyValue}
                        accessibleLabel=${`Copy runnable ${entry.displayName} command`}
                        label="Copy"
                        ?hideLabel=${true}
                    ></gm-copy-button>
                </div>
                ${entry.arguments.length > 0 || entry.options.length > 0
                    ? html`<details class="docs-detail-container">
                          <summary>Arguments and options</summary>
                          <dl class="docs-detail-list">
                              ${entry.arguments.map(
                                  (argumentValue) =>
                                      html`<div class="docs-detail-row">
                                          <dt><code>${argumentValue.name}</code></dt>
                                          <dd>${argumentValue.description}</dd>
                                      </div>`
                              )}
                              ${entry.options.map(
                                  (optionValue) =>
                                      html`<div class="docs-detail-row">
                                          <dt><code>${optionValue.flags}</code></dt>
                                          <dd>${optionValue.description}</dd>
                                      </div>`
                              )}
                          </dl>
                      </details>`
                    : null}
            </article>
        `;
    }

    #renderMcpEntry(entry: GraphVisualizationMcpToolCatalogEntry) {
        return html`
            <article class="docs-reference-entry">
                <div class="docs-entry-main">
                    <div class="docs-entry-heading">
                        <h3>${entry.commandDisplayName}</h3>
                        ${entry.internal ? html`<gm-badge .label=${"internal"} tone="muted"></gm-badge>` : null}
                    </div>
                    <p>${entry.description}</p>
                </div>
                <div class="docs-usage-shell">
                    <code class="docs-usage">${entry.toolName}</code>
                    <gm-copy-button
                        class="docs-usage-copy-button"
                        .value=${entry.toolName}
                        accessibleLabel=${`Copy ${entry.commandDisplayName} tool name`}
                        label="Copy"
                        ?hideLabel=${true}
                    ></gm-copy-button>
                </div>
                ${entry.fields.length > 0
                    ? html`<details class="docs-detail-container">
                          <summary>Fields</summary>
                          <dl class="docs-detail-list">
                              ${entry.fields.map(
                                  (fieldValue) =>
                                      html`<div class="docs-detail-row">
                                          <dt><code>${fieldValue.name}</code></dt>
                                          <dd>${fieldValue.description}</dd>
                                      </div>`
                              )}
                          </dl>
                      </details>`
                    : null}
            </article>
        `;
    }

    #renderLspEntry(entry: GraphVisualizationLspToolCatalogEntry) {
        return html`
            <article class="docs-reference-entry">
                <div class="docs-entry-main">
                    <div class="docs-entry-heading">
                        <h3>${entry.displayName}</h3>
                    </div>
                    <p>${entry.description}</p>
                </div>
                <div class="docs-usage-shell">
                    <code class="docs-usage">${entry.name}</code>
                    <gm-copy-button
                        class="docs-usage-copy-button"
                        .value=${entry.name}
                        accessibleLabel=${`Copy ${entry.displayName} tool name`}
                        label="Copy"
                        ?hideLabel=${true}
                    ></gm-copy-button>
                </div>
                ${entry.fields.length > 0
                    ? html`<details class="docs-detail-container">
                          <summary>Fields</summary>
                          <dl class="docs-detail-list">
                              ${entry.fields.map(
                                  (fieldValue) =>
                                      html`<div class="docs-detail-row">
                                          <dt>
                                              <code>${fieldValue.name}</code>${fieldValue.required
                                                  ? html` <span class="docs-field-required" title="Required">*</span>`
                                                  : null}
                                          </dt>
                                          <dd>
                                              ${fieldValue.description}
                                              ${fieldValue.choices && fieldValue.choices.length > 0
                                                  ? html`<div class="docs-field-choices">
                                                        Choices:
                                                        ${fieldValue.choices
                                                            .map((c) => html`<code>${c}</code>`)
                                                            .reduce((acc, x) => html`${acc}, ${x}`)}
                                                    </div>`
                                                  : null}
                                              ${fieldValue.default === undefined
                                                  ? null
                                                  : html`<div class="docs-field-default">
                                                        Default: <code>${JSON.stringify(fieldValue.default)}</code>
                                                    </div>`}
                                          </dd>
                                      </div>`
                              )}
                          </dl>
                      </details>`
                    : null}
            </article>
        `;
    }

    #renderCatalogEntry(entry: GraphVisualizationDocsPanelCatalogEntry) {
        return html`
            <article class="docs-reference-entry">
                <div class="docs-entry-main">
                    <div class="docs-entry-heading">
                        <h3>${entry.title}</h3>
                        <div class="docs-badge-row">
                            ${entry.badges.map((badge) => html`<gm-badge .label=${badge}></gm-badge>`)}
                        </div>
                    </div>
                    <p>${entry.description}</p>
                </div>
                <div class="docs-usage-shell">
                    <code class="docs-usage">${entry.title}</code>
                    <gm-copy-button
                        class="docs-usage-copy-button"
                        .value=${entry.title}
                        accessibleLabel=${`Copy ${entry.title} identifier`}
                        label="Copy"
                        ?hideLabel=${true}
                    ></gm-copy-button>
                </div>
            </article>
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
        const className =
            this.state?.activeDocsView === activeDocsView ? DOCS_SUBPAGE_CLASS : DOCS_HIDDEN_SUBPAGE_CLASS;
        const searchResult = searchCatalogEntries(entries, searchQuery);

        return html`
            <div id=${subpageId} class=${className} role="tabpanel" aria-labelledby=${`docs-view-${activeDocsView}`}>
                <div id=${contentId} class="docs-reference-list">
                    ${emptyMessage === null
                        ? searchResult.entries.length === 0
                            ? html`<p class="catalog-empty">
                                  ${createNoSearchResultsMessage(searchQuery, activeDocsView)}
                              </p>`
                            : searchResult.entries.map((entry) => this.#renderCatalogEntry(entry))
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
        const lspSearchResult = searchLspEntries(docsPanelContent.lspEntries, searchQuery);
        const filteredMcpEntries = this.showInternalMcpTools
            ? docsPanelContent.mcpEntries
            : docsPanelContent.mcpEntries.filter((entry) => !entry.internal);
        const mcpSearchResult = searchMcpEntries(filteredMcpEntries, searchQuery);
        const lintingSearchResult = searchCatalogEntries(docsPanelContent.lintingEntries, searchQuery);
        const formattingSearchResult = searchCatalogEntries(docsPanelContent.formattingEntries, searchQuery);
        const codemodsSearchResult = searchCatalogEntries(docsPanelContent.codemodsEntries, searchQuery);
        const counts: Readonly<Record<GraphVisualizationUiDocsView, number>> = {
            cli: cliSearchResult.totalCount,
            lsp: lspSearchResult.totalCount,
            codemods: codemodsSearchResult.totalCount,
            formatting: formattingSearchResult.totalCount,
            linting: lintingSearchResult.totalCount,
            mcp: mcpSearchResult.totalCount
        };
        return html`
            <section id="docs-page" class=${docsPageClassName}>
                ${this.state.docsErrorMessage
                    ? html`<gm-error-banner .message=${this.state.docsErrorMessage}></gm-error-banner>`
                    : null}
                <div id="docs-content" class="docs-layout">
                    ${this.#renderDocsControls({
                        activeDocsView: this.state.activeDocsView,
                        counts
                    })}
                    <main class="docs-main" aria-label="Documentation content">
                        <div
                            id="cli-page"
                            class=${this.state.activeDocsView === "cli" ? "docs-subpage" : "docs-subpage hidden"}
                            role="tabpanel"
                            aria-labelledby="docs-view-cli"
                        >
                            <div id="cli-content" class="docs-reference-list">
                                ${docsPanelContent.cliEntries.length === 0
                                    ? html`<p class="catalog-empty">No commands are available right now.</p>`
                                    : cliSearchResult.entries.length === 0
                                      ? html`<p class="catalog-empty">
                                            ${createNoSearchResultsMessage(searchQuery, "cli")}
                                        </p>`
                                      : cliSearchResult.entries.map((entry) => this.#renderCliEntry(entry))}
                            </div>
                        </div>
                        <div
                            id="lsp-page"
                            class=${this.state.activeDocsView === "lsp"
                                ? DOCS_SUBPAGE_CLASS
                                : DOCS_HIDDEN_SUBPAGE_CLASS}
                            role="tabpanel"
                            aria-labelledby="docs-view-lsp"
                        >
                            <div id="lsp-content" class="docs-reference-list">
                                ${docsPanelContent.lspEntries.length === 0
                                    ? html`<p class="catalog-empty">No LSP tools are available right now.</p>`
                                    : lspSearchResult.entries.length === 0
                                      ? html`<p class="catalog-empty">
                                            ${createNoSearchResultsMessage(searchQuery, "lsp")}
                                        </p>`
                                      : lspSearchResult.entries.map((entry) => this.#renderLspEntry(entry))}
                            </div>
                        </div>
                        <div
                            id="docs-mcp-page"
                            class=${this.state.activeDocsView === "mcp"
                                ? DOCS_SUBPAGE_CLASS
                                : DOCS_HIDDEN_SUBPAGE_CLASS}
                            role="tabpanel"
                            aria-labelledby="docs-view-mcp"
                        >
                            ${docsPanelContent.mcpEntries.some((e) => e.internal)
                                ? html`<div class="docs-subpage-toolbar">
                                      <label class="docs-toggle-label" for="mcp-toggle-internal">
                                          <input
                                              id="mcp-toggle-internal"
                                              type="checkbox"
                                              .checked=${this.showInternalMcpTools}
                                              @change=${(event: Event) => {
                                                  const target = event.target;
                                                  if (target instanceof HTMLInputElement) {
                                                      this.showInternalMcpTools = target.checked;
                                                  }
                                              }}
                                          />
                                          <span>Show internal tools (for reference only)</span>
                                      </label>
                                  </div>`
                                : null}
                            <div id="mcp-content" class="docs-reference-list">
                                ${filteredMcpEntries.length === 0
                                    ? html`<p class="catalog-empty">No tools are available right now.</p>`
                                    : mcpSearchResult.entries.length === 0
                                      ? html`<p class="catalog-empty">
                                            ${createNoSearchResultsMessage(searchQuery, "mcp")}
                                        </p>`
                                      : mcpSearchResult.entries.map((entry) => this.#renderMcpEntry(entry))}
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
                    </main>
                </div>
            </section>
        `;
    }
}

function quoteShellArgument(argumentValue: string): string {
    if (/^[\w./:@%+=,-]+$/u.test(argumentValue)) {
        return argumentValue;
    }

    return `'${argumentValue.replaceAll("'", String.raw`'\''`)}'`;
}

function resolveKeyboardDocsView(
    key: string,
    currentDocsView: GraphVisualizationUiDocsView
): GraphVisualizationUiDocsView {
    if (key === "Home") {
        return DOCS_VIEW_ORDER[0];
    }

    if (key === "End") {
        return DOCS_VIEW_ORDER.at(-1) ?? currentDocsView;
    }

    const currentIndex = DOCS_VIEW_ORDER.indexOf(currentDocsView);
    if (key === "ArrowDown" || key === "ArrowRight") {
        return DOCS_VIEW_ORDER[(currentIndex + 1) % DOCS_VIEW_ORDER.length];
    }

    if (key === "ArrowUp" || key === "ArrowLeft") {
        return DOCS_VIEW_ORDER[(currentIndex - 1 + DOCS_VIEW_ORDER.length) % DOCS_VIEW_ORDER.length];
    }

    return currentDocsView;
}
