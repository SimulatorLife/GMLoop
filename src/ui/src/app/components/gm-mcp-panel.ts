import { html } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { GRAPH_UI_EVENT_CLEAR_PAGE_ERROR } from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * MCP surface that displays server status and connection activity.
 */
export class GmMcpPanel extends LightDomLitElement {
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
                detail: { page: "mcp" }
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

    #renderServerMetadata() {
        const docsCatalogs = this.model?.documentationCatalogs;
        if (!docsCatalogs?.mcpServer) {
            return null;
        }

        return html`
            <gm-card class="catalog-card" .heading=${"Server Information"}>
                <dl class="gm-detail-list">
                    <div class="gm-detail-list__item">
                        <dt class="gm-detail-list__key">Name</dt>
                        <dd class="gm-detail-list__value">${docsCatalogs.mcpServer.name}</dd>
                    </div>
                    <div class="gm-detail-list__item">
                        <dt class="gm-detail-list__key">Version</dt>
                        <dd class="gm-detail-list__value">${docsCatalogs.mcpServer.version}</dd>
                    </div>
                </dl>
            </gm-card>
        `;
    }

    #renderActivityFeed() {
        return html`
            <gm-card class="catalog-card" .heading=${"Activity Feed"}>
                <p class="mcp-activity-empty">
                    MCP lifecycle events and tool call activity will appear here as the host reports server events.
                </p>
            </gm-card>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const mcpPageClassName = this.state.activePage === "mcp" ? "page content-page active" : "page content-page";

        return html`
            <section id="mcp-page" class=${mcpPageClassName}>
                ${this.state.mcpErrorMessage
                    ? html`<gm-error-banner .message=${this.state.mcpErrorMessage}></gm-error-banner>`
                    : null}
                <p id="mcp-meta" class="docs-meta">MCP bridge status and connection activity.</p>
                <div id="mcp-content" class="docs-grid">
                    ${this.#renderServerMetadata()} ${this.#renderActivityFeed()}
                </div>
            </section>
        `;
    }
}
