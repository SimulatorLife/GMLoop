import { html } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * MCP surface that summarizes live server connection and activity status.
 */
export class GmMcpPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const mcpPageClassName = this.state.activePage === "mcp" ? "page docs-page active" : "page docs-page";

        return html`
            <section id="mcp-page" class=${mcpPageClassName}>
                <p id="mcp-meta" class="docs-meta">
                    Live MCP server status, connection health, and future activity updates.
                </p>
                <div id="mcp-content" class="docs-grid">
                    <gm-card class="catalog-card" .heading=${"Tool Call Feed"}>
                        <p>No live MCP tool calls have been observed in this UI session yet.</p>
                    </gm-card>
                    <gm-card class="catalog-card" .heading=${"Connection Updates"}>
                        <p>MCP lifecycle updates will appear here as the host reports server events.</p>
                    </gm-card>
                </div>
            </section>
        `;
    }
}
