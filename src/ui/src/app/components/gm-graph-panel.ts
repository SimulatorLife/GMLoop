import { html } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * Graph surface with stable rendering anchors for graph runtime integration.
 */
export class GmGraphPanel extends LightDomLitElement {
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

        const graphPageClassName = this.state.activePage === "graph" ? "page active" : "page";
        const tooltipClassName = this.state.activeGraphView === "visual" ? "" : "hidden";
        const legendClassName = this.state.activeGraphView === "visual" ? "" : "hidden";
        const graphClassName = this.state.activeGraphView === "visual" ? "" : "hidden";
        const jsonClassName = this.state.activeGraphView === "json" ? "visible" : "";

        return html`
            <section id="graph-page" class=${graphPageClassName}>
                <svg id="graph" class=${graphClassName}>
                    <defs>
                        <marker
                            id="arrow-calls"
                            viewBox="0 -5 10 10"
                            refX="18"
                            refY="0"
                            markerWidth="6"
                            markerHeight="6"
                            orient="auto"
                        >
                            <path d="M0,-5L10,0L0,5"></path>
                        </marker>
                        <marker
                            id="arrow-inherits"
                            viewBox="0 -5 10 10"
                            refX="20"
                            refY="0"
                            markerWidth="8"
                            markerHeight="8"
                            orient="auto"
                        >
                            <path d="M0,-5L10,0L0,5"></path>
                        </marker>
                        <marker
                            id="arrow-depends_on"
                            viewBox="0 -5 10 10"
                            refX="18"
                            refY="0"
                            markerWidth="6"
                            markerHeight="6"
                            orient="auto"
                        >
                            <path d="M0,-5L10,0L0,5"></path>
                        </marker>
                    </defs>
                    <g id="container"></g>
                </svg>
                <div id="tooltip" class=${tooltipClassName}></div>
                <pre id="json-view" class=${jsonClassName}></pre>
                <aside id="legend" class=${legendClassName}></aside>
            </section>
        `;
    }
}
