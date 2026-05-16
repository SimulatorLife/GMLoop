import { html } from "lit";

import { EDGE_LINE_VISUAL_STYLES, NODE_VISUAL_STYLES } from "../../graph/graph-visualization-style-metadata.js";
import type { GraphVisualizationEdgeType, GraphVisualizationNodeKind } from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import { createGraphLayout, type GraphLayoutNode, listGraphEdgeTypes, listGraphNodeKinds } from "../graph-layout.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

const NODE_STYLE_BY_KIND = new Map(NODE_VISUAL_STYLES.map((style) => [style.kind, style]));
const EDGE_STYLE_BY_TYPE = new Map(EDGE_LINE_VISUAL_STYLES.map((style) => [style.type, style]));

function formatNodeKindLabel(kind: string): string {
    return kind.replaceAll("_", " ");
}

function getNodeColor(kind: GraphVisualizationNodeKind): string {
    return NODE_STYLE_BY_KIND.get(kind)?.color ?? NODE_STYLE_BY_KIND.get("default")?.color ?? "#7f7f7f";
}

function getEdgeColor(type: GraphVisualizationEdgeType): string {
    return EDGE_STYLE_BY_TYPE.get(type)?.color ?? "#7f7f7f";
}

function getEdgeDashArray(type: GraphVisualizationEdgeType): string {
    const dashArray = EDGE_STYLE_BY_TYPE.get(type)?.dashArray ?? "none";
    return dashArray === "none" ? "" : dashArray;
}

function readGraphNodePathLabel(node: GraphLayoutNode): string | null {
    if (node.filePath !== null && node.resourcePath !== null) {
        return `${node.filePath} (resource: ${node.resourcePath})`;
    }

    return node.filePath ?? node.resourcePath;
}

/**
 * Graph surface with Lit-owned SVG rendering, filtering, search, JSON, and legend state.
 */
export class GmGraphPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    #enabledNodeKinds = new Set<GraphVisualizationNodeKind>();
    #enabledEdgeTypes = new Set<GraphVisualizationEdgeType>();
    #selectedNodeId: string | null = null;

    protected updated(): void {
        this.#syncFilterDefaults();
    }

    #syncFilterDefaults(): void {
        if (!this.model) {
            return;
        }

        for (const kind of listGraphNodeKinds(this.model.data.nodes)) {
            if (!this.#enabledNodeKinds.has(kind)) {
                this.#enabledNodeKinds.add(kind);
            }
        }

        for (const type of listGraphEdgeTypes(this.model.data.edges)) {
            if (!this.#enabledEdgeTypes.has(type)) {
                this.#enabledEdgeTypes.add(type);
            }
        }
    }

    #toggleNodeKind(kind: GraphVisualizationNodeKind): void {
        if (this.#enabledNodeKinds.has(kind)) {
            this.#enabledNodeKinds.delete(kind);
        } else {
            this.#enabledNodeKinds.add(kind);
        }
        this.requestUpdate();
    }

    #toggleEdgeType(type: GraphVisualizationEdgeType): void {
        if (this.#enabledEdgeTypes.has(type)) {
            this.#enabledEdgeTypes.delete(type);
        } else {
            this.#enabledEdgeTypes.add(type);
        }
        this.requestUpdate();
    }

    #selectNode(nodeId: string): void {
        this.#selectedNodeId = this.#selectedNodeId === nodeId ? null : nodeId;
        this.requestUpdate();
    }

    #matchesSearch(node: GraphLayoutNode): boolean {
        const query = this.state?.searchQuery.trim().toLowerCase() ?? "";
        if (query.length === 0) {
            return true;
        }

        const pathLabel = readGraphNodePathLabel(node) ?? "";
        return [node.name, node.displayName, node.kind, node.summary, pathLabel].some((value) =>
            value.toLowerCase().includes(query)
        );
    }

    #renderEmptyState() {
        const startupState = this.model?.startupState ?? null;
        const isStartupLoading = startupState?.phase === "loading";
        const isStartupError = startupState?.phase === "error";
        return html`
            <div id="graph-empty-state" class="graph-empty-state" role="status" aria-live="polite">
                ${isStartupLoading
                    ? html`<div id="graph-empty-state-indicator" class="graph-empty-state-indicator">
                          <span class="loading-spinner graph-empty-state-spinner" aria-hidden="true"></span>
                          <span>${startupState.message}</span>
                      </div>`
                    : null}
                ${isStartupError
                    ? html`<div class="graph-empty-state-error">
                          <strong>${startupState.message}</strong>
                          ${startupState.detail ? html`<p>${startupState.detail}</p>` : null}
                      </div>`
                    : null}
                <strong
                    >${this.model?.loadedTarget
                        ? "No graph nodes are available for the current project."
                        : "Open a GameMaker project to start exploring the graph."}</strong
                >
                <p>
                    ${this.model?.loadedTarget
                        ? "Rebuild the graph data or open another project to keep exploring here."
                        : "Use Open... to load a project, then return here for graph search, filters, and visualization controls."}
                </p>
            </div>
        `;
    }

    #renderLegend(
        nodeKinds: ReadonlyArray<GraphVisualizationNodeKind>,
        edgeTypes: ReadonlyArray<GraphVisualizationEdgeType>
    ) {
        const legendClassName = this.state?.activeGraphView === "visual" ? "" : "hidden";
        return html`
            <aside id="legend" class=${legendClassName} aria-label="Graph filters">
                <div class="filter-section">
                    <strong>Nodes</strong>
                    ${nodeKinds.map(
                        (kind) => html`
                            <label class="filter-item">
                                <input
                                    type="checkbox"
                                    .checked=${this.#enabledNodeKinds.has(kind)}
                                    @change=${() => this.#toggleNodeKind(kind)}
                                />
                                <span class="legend-swatch" style=${`background:${getNodeColor(kind)}`}></span>
                                <span>${formatNodeKindLabel(kind)}</span>
                            </label>
                        `
                    )}
                </div>
                <div class="filter-section">
                    <strong>Edges</strong>
                    ${edgeTypes.map(
                        (type) => html`
                            <label class="filter-item">
                                <input
                                    type="checkbox"
                                    .checked=${this.#enabledEdgeTypes.has(type)}
                                    @change=${() => this.#toggleEdgeType(type)}
                                />
                                <span class="legend-line" style=${`border-color:${getEdgeColor(type)}`}></span>
                                <span>${formatNodeKindLabel(type)}</span>
                            </label>
                        `
                    )}
                </div>
            </aside>
        `;
    }

    #renderSelectedNode(node: GraphLayoutNode | null) {
        if (node === null) {
            return html``;
        }

        const pathLabel = readGraphNodePathLabel(node);
        return html`
            <div id="tooltip" class="visible">
                <h3>${node.displayName}</h3>
                <div>${node.kind} | ${node.graphId}</div>
                ${pathLabel ? html`<div>${pathLabel}</div>` : null}
                ${node.summary ? html`<p>${node.summary}</p>` : null}
            </div>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        this.#syncFilterDefaults();
        const graphPageClassName = this.state.activePage === "graph" ? "page active" : "page";
        const layout = createGraphLayout(this.model.data.nodes, this.model.data.edges);
        const nodeKinds = listGraphNodeKinds(this.model.data.nodes);
        const edgeTypes = listGraphEdgeTypes(this.model.data.edges);
        const visibleNodes = layout.nodes.filter(
            (node) => this.#enabledNodeKinds.has(node.kind) && this.#matchesSearch(node)
        );
        const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
        const visibleEdges = layout.edges.filter(
            (edge) =>
                this.#enabledEdgeTypes.has(edge.type) &&
                visibleNodeIds.has(edge.sourceNode.id) &&
                visibleNodeIds.has(edge.targetNode.id)
        );
        const selectedNode = visibleNodes.find((node) => node.id === this.#selectedNodeId) ?? null;
        const jsonValue = JSON.stringify({ edges: visibleEdges, nodes: visibleNodes }, null, 2);

        return html`
            <section id="graph-page" class=${graphPageClassName}>
                ${this.state.isRegeneratePending
                    ? html`
                          <div class="loading-overlay" role="status" aria-live="polite">
                              <div class="loading-indicator">
                                  <span class="loading-spinner" aria-hidden="true"></span>
                                  <span class="loading-message">Regenerating graph index…</span>
                              </div>
                          </div>
                      `
                    : null}
                ${this.model.data.nodes.length === 0 ? this.#renderEmptyState() : null}
                <svg
                    id="graph"
                    class=${this.state.activeGraphView === "visual" ? "" : "hidden"}
                    viewBox="-900 -700 1800 1400"
                    role="img"
                    aria-label="GameMaker project graph"
                >
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
                    <g id="container">
                        ${visibleEdges.map(
                            (edge) => html`
                                <line
                                    class="link"
                                    x1=${String(edge.sourceNode.x)}
                                    y1=${String(edge.sourceNode.y)}
                                    x2=${String(edge.targetNode.x)}
                                    y2=${String(edge.targetNode.y)}
                                    stroke=${getEdgeColor(edge.type)}
                                    stroke-dasharray=${getEdgeDashArray(edge.type)}
                                    marker-end=${edge.type === "calls"
                                        ? "url(#arrow-calls)"
                                        : edge.type === "inherits"
                                          ? "url(#arrow-inherits)"
                                          : edge.type === "depends_on"
                                            ? "url(#arrow-depends_on)"
                                            : ""}
                                ></line>
                            `
                        )}
                        ${visibleNodes.map(
                            (node) => html`
                                <g class="node-group" transform=${`translate(${node.x},${node.y})`}>
                                    <circle
                                        class=${`node node-${node.kind}${node.graphId === "toolset" ? " toolset" : ""}${this.#selectedNodeId === node.id ? " highlighted" : ""}`}
                                        r=${String(node.radius)}
                                        fill=${getNodeColor(node.kind)}
                                        tabindex="0"
                                        role="button"
                                        aria-label=${node.displayName}
                                        @click=${() => this.#selectNode(node.id)}
                                        @keydown=${(event: KeyboardEvent) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                this.#selectNode(node.id);
                                            }
                                        }}
                                    ></circle>
                                    ${this.state.labelMode === "hidden"
                                        ? null
                                        : html`<text x=${String(node.radius + 5)} y="4">${node.displayName}</text>`}
                                </g>
                            `
                        )}
                    </g>
                </svg>
                <pre id="json-view" class=${this.state.activeGraphView === "json" ? "visible" : ""}>${jsonValue}</pre>
                ${this.#renderLegend(nodeKinds, edgeTypes)} ${this.#renderSelectedNode(selectedNode)}
            </section>
        `;
    }
}
