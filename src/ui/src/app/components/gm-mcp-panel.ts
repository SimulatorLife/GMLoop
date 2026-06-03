import { html } from "lit";

import type { GraphVisualizationMcpToolCatalogEntry } from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiMcpServerStatus, GraphVisualizationUiState } from "../state/types.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * MCP surface that displays server status, available tools, and connection activity.
 */
export class GmMcpPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    #getServerStatusLabel(status: GraphVisualizationUiMcpServerStatus): string {
        if (status === "running") {
            return "Running";
        }
        if (status === "stopped") {
            return "Stopped";
        }
        return "Not Started";
    }

    #getServerStatusDescription(status: GraphVisualizationUiMcpServerStatus): string {
        if (status === "running") {
            return "The MCP bridge is available for connected clients.";
        }
        if (status === "stopped") {
            return "The MCP bridge stopped. Restart it to continue.";
        }
        return "The MCP bridge has not started in this session yet.";
    }

    #renderServerStatusChip(status: GraphVisualizationUiMcpServerStatus) {
        const chipClassName =
            status === "running"
                ? "mcp-server-status-chip running"
                : status === "stopped"
                  ? "mcp-server-status-chip stopped"
                  : "mcp-server-status-chip not-started";

        return html`
            <div class=${chipClassName} role="status" aria-label=${this.#getServerStatusDescription(status)}>
                <span class="mcp-server-status-dot" aria-hidden="true"></span>
                <strong>${this.#getServerStatusLabel(status)}</strong>
            </div>
        `;
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

    #renderToolCard(entry: GraphVisualizationMcpToolCatalogEntry) {
        return html`
            <li class="mcp-tool-item">
                <strong>${entry.commandDisplayName}</strong>
                <span>${entry.description}</span>
                ${entry.fields.length > 0
                    ? html`
                          <ul class="catalog-list" style="margin-top: 8px; padding-left: 16px;">
                              ${entry.fields.map(
                                  (field) => html`
                                      <li class="catalog-item">
                                          <code>${field.name}</code>
                                          : ${field.description}
                                      </li>
                                  `
                              )}
                          </ul>
                      `
                    : null}
            </li>
        `;
    }

    #renderAvailableTools() {
        const docsCatalogs = this.model?.documentationCatalogs;
        const mcpTools = docsCatalogs?.mcpTools ?? [];
        const hasTools = mcpTools.length > 0;

        return html`
            <gm-card class="catalog-card" .heading=${`Available Tools (${String(mcpTools.length)})`}>
                ${hasTools
                    ? html`<ul class="mcp-tool-list">
                          ${mcpTools.map((entry) => this.#renderToolCard(entry))}
                      </ul>`
                    : html`<p class="mcp-activity-empty">No tools are available right now.</p>`}
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
        const serverStatus = this.state.mcpServerStatus;

        return html`
            <section id="mcp-page" class=${mcpPageClassName}>
                <p id="mcp-meta" class="docs-meta">MCP bridge status, available tools, and connection activity.</p>
                <div id="mcp-content" class="docs-grid">
                    <gm-card class="catalog-card" .heading=${"Server Status"}>
                        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                            ${this.#renderServerStatusChip(serverStatus)}
                        </div>
                        <p style="margin-top: 12px; color: var(--gm-text-secondary); font-size: var(--gm-text-sm);">
                            ${this.#getServerStatusDescription(serverStatus)}
                        </p>
                    </gm-card>
                    ${this.#renderServerMetadata()} ${this.#renderAvailableTools()} ${this.#renderActivityFeed()}
                </div>
            </section>
        `;
    }
}
