import { html } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * MCP surface that summarizes runtime status and available MCP tool metadata.
 */
export class GmMcpPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    #renderMcpStatusSummary(status: GraphVisualizationUiState["mcpServerStatus"]) {
        const isRunning = status === "running";
        const statusClassName = isRunning ? "mcp-runtime-status-chip running" : "mcp-runtime-status-chip";
        const statusLabel = isRunning ? "Running" : status === "stopped" ? "Stopped" : "Not Started";
        const statusDescription = isRunning
            ? "Connected tools are ready to use."
            : status === "stopped"
              ? "The tool connection stopped. Restart it to continue."
              : "Tool access has not started in this session yet.";

        return html`
            <gm-card class="catalog-card" .heading=${"Runtime Status"}>
                <p>${statusDescription}</p>
                <div class=${statusClassName}>
                    <span class="mcp-runtime-status-dot" aria-hidden="true"></span>
                    <strong>${statusLabel}</strong>
                </div>
            </gm-card>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const mcpCatalog = this.model.documentationCatalogs?.mcpServer ?? null;
        const mcpTools = this.model.documentationCatalogs?.mcpTools ?? [];
        const mcpPageClassName = this.state.activePage === "mcp" ? "page docs-page active" : "page docs-page";

        return html`
            <section id="mcp-page" class=${mcpPageClassName}>
                <p id="mcp-meta" class="docs-meta">
                    ${mcpCatalog
                        ? html`${mcpTools.length} connected tool${mcpTools.length === 1 ? "" : "s"} available`
                        : "Connected tool details are not available right now."}
                </p>
                <div id="mcp-content" class="docs-grid">
                    ${this.#renderMcpStatusSummary(this.model.mcpServerStatus)}
                    <gm-card class="catalog-card" .heading=${"Tool Call Feed"}>
                        <p>Recent tool activity is not shown here yet.</p>
                    </gm-card>
                    <gm-card class="catalog-card" .heading=${"Available Tools"}>
                        ${mcpTools.length === 0
                            ? html`<p class="catalog-empty">No tools are available right now.</p>`
                            : html`
                                  <ul class="catalog-list">
                                      ${mcpTools.map(
                                          (toolEntry) => html`
                                              <li class="catalog-item">
                                                  <strong>${toolEntry.commandDisplayName}</strong>
                                                  <p>${toolEntry.description}</p>
                                                  <div class="config-badge-row">
                                                      <gm-badge .label=${toolEntry.toolName}></gm-badge>
                                                      <gm-badge
                                                          .label=${`${String(toolEntry.fields.length)} field${toolEntry.fields.length === 1 ? "" : "s"}`}
                                                      ></gm-badge>
                                                  </div>
                                              </li>
                                          `
                                      )}
                                  </ul>
                              `}
                    </gm-card>
                </div>
            </section>
        `;
    }
}
