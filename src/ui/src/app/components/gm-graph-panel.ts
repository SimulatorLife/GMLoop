import { html, svg } from "lit";

import {
    buildGraphEdgeBatches,
    createGraphRenderBounds,
    cullGraphLayoutToViewport,
    type GraphViewportBounds,
    isGraphViewportCovered,
    shouldBatchGraphEdges,
    shouldRenderGraphLabels
} from "../../graph/graph-render-viewport.js";
import { projectGraphLayoutForSemanticZoom, resolveGraphSemanticZoomLevel } from "../../graph/graph-semantic-zoom.js";
import { EDGE_LINE_VISUAL_STYLES, NODE_VISUAL_STYLES } from "../../graph/graph-visualization-style-metadata.js";
import {
    createGraphLayout,
    filterGraphLayoutForDisplay,
    type GraphLayout,
    type GraphLayoutNode,
    type GraphLegendNodeKind,
    type GraphNodeKindLegendItem,
    type GraphVisualizationEdgeType,
    type GraphVisualizationGraphIndexBuildSummary,
    type GraphVisualizationNodeKind,
    listGraphEdgeTypes,
    listGraphNodeKindLegendItems,
    listGraphNodeKinds,
    resolveEffectiveGraphNodeKinds
} from "../../graph/index.js";
import {
    type GraphVisualizationUiModel,
    hasLoadedGraphIndex,
    readGraphVisualizationEdges,
    readGraphVisualizationNodes
} from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { EventBusManager } from "./event-bus-mixin.js";
import { GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, GRAPH_UI_EVENT_RESET_DEFAULTS } from "./events.js";
import { LifecycleParticipantsController } from "./lifecycle-participants-controller.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

const NODE_STYLE_BY_KIND = new Map(NODE_VISUAL_STYLES.map((style) => [style.kind, style]));
const EDGE_STYLE_BY_TYPE = new Map(EDGE_LINE_VISUAL_STYLES.map((style) => [style.type, style]));
const DEFAULT_DISABLED_NODE_KINDS = new Set<GraphLegendNodeKind>([
    "enum_member",
    "instance_variable",
    "local_variable",
    "note",
    "room_layer"
]);
const FOCUSED_NODE_ZOOM_SCALE = 2.4;
const FOCUS_CLEAR_ZOOM_SCALE = 0.55;

function formatNodeKindLabel(kind: string): string {
    return kind
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function getNodeColor(kind: GraphVisualizationNodeKind): string {
    return NODE_STYLE_BY_KIND.get(kind)?.color ?? NODE_STYLE_BY_KIND.get("default")?.color ?? "#7f7f7f";
}

function getEdgeColor(type: GraphVisualizationEdgeType): string {
    return EDGE_STYLE_BY_TYPE.get(type)?.color ?? "#7f7f7f";
}

/**
 * Render legend swatches with the same line semantics used on graph edges so
 * relationship categories remain visually distinguishable in filter controls.
 */
function getEdgeLegendLineStyle(type: GraphVisualizationEdgeType): string {
    const edgeStyle = EDGE_STYLE_BY_TYPE.get(type);
    const borderWidth = edgeStyle?.legendBorderWidth ?? "2px";
    const borderStyle = edgeStyle?.legendBorderStyle ?? "solid";
    const color = edgeStyle?.color ?? "#7f7f7f";
    return `border-top: ${borderWidth} ${borderStyle} ${color};`;
}

function getEdgeDashArray(type: GraphVisualizationEdgeType): string {
    const dashArray = EDGE_STYLE_BY_TYPE.get(type)?.dashArray ?? "none";
    return dashArray === "none" ? "" : dashArray;
}

function readEdgeArrowMarkerId(type: GraphVisualizationEdgeType): string {
    return `arrow-${type}`;
}

function readGraphEdgeAggregateCount(edge: GraphLayout["edges"][number]): number {
    const aggregateCount = Reflect.get(edge, "aggregateCount");
    return typeof aggregateCount === "number" && aggregateCount > 0 ? aggregateCount : 1;
}

function readGraphNodePathLabel(node: GraphLayoutNode): string | null {
    if (node.filePath !== null && node.resourcePath !== null) {
        return `${node.filePath} (resource: ${node.resourcePath})`;
    }

    return node.filePath ?? node.resourcePath;
}

function readGraphNodeLocationLabel(node: GraphLayoutNode): string | null {
    if (node.lineStart === null) {
        return null;
    }

    if (node.lineEnd !== null && node.lineEnd !== node.lineStart) {
        return `lines ${String(node.lineStart)}-${String(node.lineEnd)}`;
    }

    return `line ${String(node.lineStart)}`;
}

/**
 * Graph surface with Lit-owned SVG rendering, filtering, search, JSON, and legend state.
 *
 * Lifecycle wiring is delegated to injected collaborators so this class
 * does not deepen the {@link LightDomLitElement} subclass with
 * `connectedCallback` / `disconnectedCallback` overrides. The two event
 * subscriptions — the `gmloop-reset-defaults` page-level event and the
 * `gm-error-banner-dismiss` element-local event — are owned by an
 * {@link EventBusManager} registered through a
 * {@link LifecycleParticipantsController}, matching the pattern used by
 * `GmGraphToolbar`, `GmLiveReloadPanel`, and the other workspace panels.
 * The class therefore keeps only the `render` override that Lit
 * requires, and the public connect/disconnect behaviour is identical to
 * the previous hand-rolled lifecycle methods.
 */
export class GmGraphPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    public layoutCalculationCount = 0;

    public filterCalculationCount = 0;

    #enabledNodeKinds = new Set<GraphLegendNodeKind>();
    #enabledEdgeTypes = new Set<GraphVisualizationEdgeType>();
    #selectedNodeId: string | null = null;
    #focusedNodeId: string | null = null;
    #lastModelReference: GraphVisualizationUiModel | null = null;
    #initializedFiltersForModel = false;

    #cachedModel: GraphVisualizationUiModel | null = null;
    #cachedLayout: GraphLayout | null = null;
    #cachedLayoutNodeById = new Map<string, GraphLayoutNode>();
    #cachedNodeItems: ReadonlyArray<GraphNodeKindLegendItem> | null = null;
    #cachedEdgeTypes: ReadonlyArray<GraphVisualizationEdgeType> | null = null;
    #cachedVisibleLayout: GraphLayout | null = null;
    #cachedRenderedLayout: GraphLayout | null = null;
    #cachedRenderBounds: GraphViewportBounds | null = null;
    #cachedJsonValue: string | null = null;
    #lastSearchQuery = "";

    #panX = 0;
    #panY = 0;
    #zoomScale = 1;
    #isDragging = false;
    #startX = 0;
    #startY = 0;

    #onResetDefaults = (): void => {
        this.#syncFilterDefaults(true);
        this.#panX = 0;
        this.#panY = 0;
        this.#zoomScale = 1;
        this.#selectedNodeId = null;
        this.#focusedNodeId = null;
        this.#cachedVisibleLayout = null;
        this.#invalidateRenderedViewport();
        this.requestUpdate();
    };

    #onDismissErrorBanner = (): void => {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, {
                bubbles: true,
                composed: true,
                detail: { page: "graph" }
            })
        );
    };

    public constructor() {
        super();
        new LifecycleParticipantsController(this, [
            new EventBusManager(this, [
                { event: GRAPH_UI_EVENT_RESET_DEFAULTS, handler: this.#onResetDefaults },
                { event: "gm-error-banner-dismiss", handler: this.#onDismissErrorBanner }
            ])
        ]);
    }

    #getViewportTransform() {
        return {
            panX: this.#panX,
            panY: this.#panY,
            zoomScale: this.#zoomScale
        };
    }

    #invalidateRenderedViewport(): void {
        this.#cachedRenderedLayout = null;
        this.#cachedRenderBounds = null;
    }

    #applyViewportTransform(): void {
        const container = this.querySelector<SVGGElement>("g#container");
        if (container) {
            container.setAttribute(
                "transform",
                `translate(${String(this.#panX)},${String(this.#panY)}) scale(${String(this.#zoomScale)})`
            );
        }
    }

    #refreshViewportRenderIfNeeded(): void {
        if (isGraphViewportCovered(this.#getViewportTransform(), this.#cachedRenderBounds)) {
            return;
        }

        this.#invalidateRenderedViewport();
        this.requestUpdate();
    }

    #syncFilterDefaults(force = false): void {
        if (!this.model) {
            return;
        }

        const modelChanged = this.#lastModelReference !== this.model;
        if (modelChanged) {
            this.#lastModelReference = this.model;
            this.#initializedFiltersForModel = false;
        }

        if (!this.#initializedFiltersForModel || force) {
            const graphNodes = readGraphVisualizationNodes(this.model);
            const graphEdges = readGraphVisualizationEdges(this.model);

            if (graphNodes.length > 0 || force) {
                this.#enabledNodeKinds.clear();
                for (const kind of listGraphNodeKinds(graphNodes)) {
                    if (!DEFAULT_DISABLED_NODE_KINDS.has(kind)) {
                        this.#enabledNodeKinds.add(kind);
                    }
                }
                this.#initializedFiltersForModel = true;
            }
            if (graphEdges.length > 0 || force) {
                this.#enabledEdgeTypes.clear();
                for (const type of listGraphEdgeTypes(graphEdges)) {
                    this.#enabledEdgeTypes.add(type);
                }
            }
            this.#cachedVisibleLayout = null;
            this.#invalidateRenderedViewport();
        }
    }

    #onPointerDown = (event: PointerEvent): void => {
        if (event.button !== 0) {
            return;
        }

        const svgElement = event.currentTarget as SVGElement;
        svgElement.setPointerCapture(event.pointerId);

        this.#isDragging = true;
        this.#startX = event.clientX - this.#panX;
        this.#startY = event.clientY - this.#panY;
    };

    #onPointerMove = (event: PointerEvent): void => {
        if (!this.#isDragging) {
            return;
        }

        this.#panX = event.clientX - this.#startX;
        this.#panY = event.clientY - this.#startY;
        this.#applyViewportTransform();
        this.#refreshViewportRenderIfNeeded();
    };

    #onPointerUp = (event: PointerEvent): void => {
        if (!this.#isDragging) {
            return;
        }

        const svgElement = event.currentTarget as SVGElement;
        svgElement.releasePointerCapture(event.pointerId);
        this.#isDragging = false;
    };

    #onWheel = (event: WheelEvent): void => {
        event.preventDefault();

        const svgElement = this.querySelector("svg#graph");
        if (!svgElement || !this.state) {
            return;
        }

        const rect = svgElement.getBoundingClientRect();
        const mouseX = event.clientX - rect.left - rect.width / 2;
        const mouseY = event.clientY - rect.top - rect.height / 2;
        const previousScale = this.#zoomScale;
        const previousSemanticLevel = resolveGraphSemanticZoomLevel(previousScale);
        const previousLabelsVisible = shouldRenderGraphLabels(this.state.labelMode, previousScale);
        const renderedEdgeCount = this.#cachedRenderedLayout?.edges.length ?? 0;
        const previousBatchMode = shouldBatchGraphEdges(previousScale, renderedEdgeCount);
        const hadFocus = this.#focusedNodeId !== null;

        const zoomFactor = 1.1;
        const newScale = event.deltaY < 0 ? this.#zoomScale * zoomFactor : this.#zoomScale / zoomFactor;
        const finalScale = Math.max(0.15, Math.min(8, newScale));

        this.#panX = mouseX - (mouseX - this.#panX) * (finalScale / this.#zoomScale);
        this.#panY = mouseY - (mouseY - this.#panY) * (finalScale / this.#zoomScale);
        this.#zoomScale = finalScale;
        if (finalScale <= FOCUS_CLEAR_ZOOM_SCALE) {
            this.#focusedNodeId = null;
        }
        this.#applyViewportTransform();

        const semanticLevelChanged = previousSemanticLevel !== resolveGraphSemanticZoomLevel(finalScale);
        const focusChanged = hadFocus && this.#focusedNodeId === null;
        if (semanticLevelChanged || focusChanged) {
            this.#invalidateRenderedViewport();
            this.requestUpdate();
            return;
        }

        const labelsVisible = shouldRenderGraphLabels(this.state.labelMode, finalScale);
        const batchMode = shouldBatchGraphEdges(finalScale, renderedEdgeCount);
        if (labelsVisible !== previousLabelsVisible || batchMode !== previousBatchMode) {
            this.requestUpdate();
        }
        this.#refreshViewportRenderIfNeeded();
    };

    #getEdgeIntersection(source: GraphLayoutNode, target: GraphLayoutNode) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.hypot(dx, dy);

        if (dist === 0) {
            return { x1: source.x, y1: source.y, x2: target.x, y2: target.y };
        }

        const nx = dx / dist;
        const ny = dy / dist;

        return {
            x1: source.x + nx * source.radius,
            y1: source.y + ny * source.radius,
            x2: target.x - nx * target.radius,
            y2: target.y - ny * target.radius
        };
    }

    protected toggleNodeKind(kind: GraphLegendNodeKind): void {
        if (this.#enabledNodeKinds.has(kind)) {
            this.#enabledNodeKinds.delete(kind);
        } else {
            this.#enabledNodeKinds.add(kind);
        }
        this.#cachedVisibleLayout = null;
        this.#invalidateRenderedViewport();
        this.requestUpdate();
    }

    #toggleEdgeType(type: GraphVisualizationEdgeType): void {
        if (this.#enabledEdgeTypes.has(type)) {
            this.#enabledEdgeTypes.delete(type);
        } else {
            this.#enabledEdgeTypes.add(type);
        }
        this.#cachedVisibleLayout = null;
        this.#invalidateRenderedViewport();
        this.requestUpdate();
    }

    protected selectNode(nodeId: string): void {
        this.#selectedNodeId = nodeId;
        this.requestUpdate();
    }

    protected focusNode(nodeId: string): void {
        const node = this.#cachedLayoutNodeById.get(nodeId);
        if (!node) {
            return;
        }

        const targetScale = Math.max(this.#zoomScale, FOCUSED_NODE_ZOOM_SCALE);
        this.#selectedNodeId = nodeId;
        this.#focusedNodeId = nodeId;
        this.#panX = -node.x * targetScale;
        this.#panY = -node.y * targetScale;
        this.#zoomScale = targetScale;
        this.#invalidateRenderedViewport();
        this.requestUpdate();
    }

    #clearFocus = (): void => {
        this.#focusedNodeId = null;
        this.#invalidateRenderedViewport();
        this.requestUpdate();
    };

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
                ${
                    isStartupLoading
                        ? html`<div id="graph-empty-state-indicator" class="graph-empty-state-indicator">
                              <span class="loading-spinner graph-empty-state-spinner" aria-hidden="true"></span>
                              <span>${startupState.message}</span>
                          </div>`
                        : null
                }
                ${
                    isStartupError
                        ? html`<div class="graph-empty-state-error">
                              <strong>${startupState.message}</strong>
                              ${startupState.detail ? html`<p>${startupState.detail}</p>` : null}
                          </div>`
                        : null
                }
                <strong
                    >${
                        this.model?.loadedTarget
                            ? "No graph nodes are available for the current project."
                            : "Open a GameMaker project to start exploring the graph."
                    }</strong
                >
                <p>
                    ${
                        this.model?.loadedTarget
                            ? "Rebuild the graph data or open another project to keep exploring here."
                            : "Use Open .yyp... to load a GameMaker project, then return here for graph search, filters, and visualization controls."
                    }
                </p>
            </div>
        `;
    }

    #renderSemanticIndexBuildSummary(summary: GraphVisualizationGraphIndexBuildSummary) {
        const totalFiles = summary.cacheHitCount + summary.cacheMissCount;
        const cacheDetail =
            totalFiles > 0
                ? `${String(summary.cacheHitCount)} of ${String(totalFiles)} files reused from cache, ${String(summary.cacheMissCount)} parsed fresh`
                : null;
        const slowestFiles = summary.slowestFiles.slice(0, 5);
        return html`
            <div class="graph-index-progress-summary">
                <span
                    >Indexed in
                    ${Math.round(summary.totalDurationMs).toLocaleString()}ms${cacheDetail ? ` — ${cacheDetail}` : ""}</span
                >
                ${
                    slowestFiles.length > 0
                        ? html`
                              <gm-collapsible
                                  class="graph-index-progress-slowest-files"
                                  .summary=${"Slowest files"}
                                  .content=${html`
                                      <ul>
                                          ${slowestFiles.map(
                                              (file) => html`
                                                  <li>
                                                      <span class="graph-index-progress-slowest-file-path"
                                                          >${file.relativePath}</span
                                                      >
                                                      <span class="graph-index-progress-slowest-file-duration"
                                                          >${Math.round(file.durationMs).toLocaleString()}ms</span
                                                      >
                                                  </li>
                                              `
                                          )}
                                      </ul>
                                  `}
                              ></gm-collapsible>
                          `
                        : null
                }
            </div>
        `;
    }

    #renderSemanticIndexProgress() {
        const progress = this.state?.graphIndexProgress;
        if (progress === null || progress === undefined || progress.status === "idle") {
            return null;
        }

        const isRunning = progress.status === "running";
        const title = isRunning
            ? "Semantic analysis in progress"
            : progress.status === "success"
              ? "Semantic analysis complete"
              : "Semantic analysis failed";
        const detail =
            progress.current !== null && progress.total !== null
                ? `Parsing GML files: ${String(progress.current)} / ${String(progress.total)}`
                : "Preparing the shared semantic index…";
        const recentLogLines = progress.logLines.slice(-3);
        return html`
            <div
                class="graph-index-progress"
                role="status"
                aria-live="polite"
                aria-busy=${isRunning ? "true" : "false"}
            >
                <strong>${title}</strong>
                <span>${detail}</span>
                ${
                    recentLogLines.length > 0
                        ? html`<ul>
                              ${recentLogLines.map((line) => html`<li>${line}</li>`)}
                          </ul>`
                        : null
                }
                ${progress.summary ? this.#renderSemanticIndexBuildSummary(progress.summary) : null}
            </div>
        `;
    }

    #renderLegendNodeItem(item: GraphNodeKindLegendItem) {
        const childContent =
            item.children.length === 0
                ? null
                : html`<div class="filter-children">
                      ${item.children.map((child) => this.#renderLegendNodeItem(child))}
                  </div>`;

        return html`
            <div class="filter-node-item" data-kind=${item.kind} data-level=${String(item.level)}>
                <label class=${`filter-item${item.level > 0 ? " child-filter-item" : ""}`}>
                    <input
                        type="checkbox"
                        .checked=${this.#enabledNodeKinds.has(item.kind)}
                        @change=${() => this.toggleNodeKind(item.kind)}
                    />
                    ${
                        item.kind === "resource"
                            ? html`<span class="legend-swatch legend-swatch-group" aria-hidden="true"></span>`
                            : html`<span class="legend-swatch" style=${`background:${getNodeColor(item.kind)}`}></span>`
                    }
                    <span>${formatNodeKindLabel(item.kind)}</span>
                </label>
                ${childContent}
            </div>
        `;
    }

    #renderLegend(
        nodeItems: ReadonlyArray<GraphNodeKindLegendItem>,
        edgeTypes: ReadonlyArray<GraphVisualizationEdgeType>
    ) {
        return html`
            <aside id="legend" aria-label="Graph filters">
                <div class="filter-section">
                    <strong>Nodes</strong>
                    ${nodeItems.map((item) => this.#renderLegendNodeItem(item))}
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
                                <span class="legend-line" style=${getEdgeLegendLineStyle(type)}></span>
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
        const locationLabel = readGraphNodeLocationLabel(node);
        const isFocused = this.#focusedNodeId === node.id;
        return html`
            <div id="tooltip" class="visible" role="dialog" aria-live="polite" data-selected-node-id=${node.id}>
                <h3>${node.displayName}</h3>
                <div>${node.kind} | ${node.graphId}</div>
                ${node.scipSymbol ? html`<div>symbol: ${node.scipSymbol}</div>` : null}
                ${node.scopeId ? html`<div>scope: ${node.scopeId}</div>` : null}
                ${pathLabel ? html`<div>${pathLabel}</div>` : null}
                ${locationLabel ? html`<div>${locationLabel}</div>` : null}
                ${node.summary ? html`<p>${node.summary}</p>` : null}
                ${node.snippet ? html`<pre>${node.snippet}</pre>` : null}
                ${
                    isFocused
                        ? html`<button type="button" @click=${this.#clearFocus}>Exit focused view</button>`
                        : html`<div>Double-click the node to zoom into its semantic hierarchy.</div>`
                }
            </div>
        `;
    }

    #renderGraphEdges(layout: GraphLayout) {
        if (shouldBatchGraphEdges(this.#zoomScale, layout.edges.length)) {
            return buildGraphEdgeBatches(layout.edges).map(
                (batch) => svg`
                    <path
                        class="link link-batch"
                        d=${batch.pathData}
                        fill="none"
                        stroke=${getEdgeColor(batch.type)}
                        stroke-dasharray=${getEdgeDashArray(batch.type)}
                        data-edge-count=${String(batch.edgeCount)}
                        data-edge-type=${batch.type}
                    ></path>
                `
            );
        }

        return layout.edges.map((edge) => {
            const geometry = this.#getEdgeIntersection(edge.sourceNode, edge.targetNode);
            const aggregateCount = readGraphEdgeAggregateCount(edge);
            return svg`
                <line
                    class="link"
                    data-aggregate-count=${String(aggregateCount)}
                    x1=${String(geometry.x1)}
                    y1=${String(geometry.y1)}
                    x2=${String(geometry.x2)}
                    y2=${String(geometry.y2)}
                    stroke=${getEdgeColor(edge.type)}
                    stroke-width=${String(Math.min(6, 1 + Math.log2(aggregateCount)))}
                    stroke-dasharray=${getEdgeDashArray(edge.type)}
                    marker-end=${`url(#${readEdgeArrowMarkerId(edge.type)})`}
                ></line>
            `;
        });
    }

    #renderGraphSurface(layout: GraphLayout, isVisualView: boolean) {
        if (!this.state) {
            return html``;
        }

        const renderLabels = shouldRenderGraphLabels(this.state.labelMode, this.#zoomScale);
        return html`
            <svg
                id="graph"
                class=${isVisualView ? "" : "hidden"}
                viewBox="-900 -700 1800 1400"
                role="img"
                aria-label="GameMaker project graph"
                style="touch-action: none;"
                @pointerdown=${this.#onPointerDown}
                @pointermove=${this.#onPointerMove}
                @pointerup=${this.#onPointerUp}
                @pointercancel=${this.#onPointerUp}
                @wheel=${this.#onWheel}
            >
                <defs>
                    ${EDGE_LINE_VISUAL_STYLES.map(
                        (edgeStyle) => svg`
                            <marker
                                id=${readEdgeArrowMarkerId(edgeStyle.type)}
                                viewBox="0 -5 10 10"
                                refX="10"
                                refY="0"
                                markerWidth="6"
                                markerHeight="6"
                                orient="auto"
                            >
                                <path d="M0,-5L10,0L0,5" fill=${edgeStyle.color}></path>
                            </marker>
                        `
                    )}
                </defs>
                <g id="container" transform=${`translate(${this.#panX},${this.#panY}) scale(${this.#zoomScale})`}>
                    ${this.#renderGraphEdges(layout)}
                    ${layout.nodes.map(
                        (node) => svg`
                            <g class="node-group" transform=${`translate(${node.x},${node.y})`}>
                                <circle
                                    class=${`node node-${node.kind}${node.graphId === "toolset" ? " toolset" : ""}${this.#selectedNodeId === node.id ? " highlighted" : ""}`}
                                    r=${String(node.radius)}
                                    fill=${getNodeColor(node.kind)}
                                    tabindex="0"
                                    role="button"
                                    aria-label=${node.displayName}
                                    @pointerdown=${(event: PointerEvent) => {
                                        event.stopPropagation();
                                    }}
                                    @click=${() => this.selectNode(node.id)}
                                    @dblclick=${(event: MouseEvent) => {
                                        event.stopPropagation();
                                        this.focusNode(node.id);
                                    }}
                                    @keydown=${(event: KeyboardEvent) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            this.selectNode(node.id);
                                        }
                                    }}
                                ></circle>
                                ${renderLabels ? svg`<text x=${String(node.radius + 5)} y="4">${node.displayName}</text>` : null}
                            </g>
                        `
                    )}
                </g>
            </svg>
        `;
    }

    #renderJsonView(jsonValue: string, isVisualView: boolean) {
        return html`
            <div id="json-view-shell" class=${isVisualView ? "" : "visible"}>
                <gm-json-viewer
                    id="json-view"
                    .value=${jsonValue}
                    copyAccessibleLabel="Copy graph JSON to clipboard"
                    copyLabel="Copy JSON"
                ></gm-json-viewer>
            </div>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        this.#syncFilterDefaults();

        const graphNodes = readGraphVisualizationNodes(this.model);
        const graphEdges = readGraphVisualizationEdges(this.model);
        const modelChanged = this.#cachedModel !== this.model;
        if (modelChanged) {
            this.#cachedModel = this.model;
            this.layoutCalculationCount++;
            this.#cachedLayout = createGraphLayout(graphNodes, graphEdges);
            this.#cachedLayoutNodeById = new Map(this.#cachedLayout.nodes.map((node) => [node.id, node]));
            this.#cachedNodeItems = listGraphNodeKindLegendItems(graphNodes);
            this.#cachedEdgeTypes = listGraphEdgeTypes(graphEdges);
            this.#cachedVisibleLayout = null;
            this.#cachedJsonValue = null;
            this.#invalidateRenderedViewport();
            if (this.#focusedNodeId && !this.#cachedLayoutNodeById.has(this.#focusedNodeId)) {
                this.#focusedNodeId = null;
            }
        }

        const query = this.state.searchQuery.trim().toLowerCase();
        if (query !== this.#lastSearchQuery) {
            this.#lastSearchQuery = query;
            this.#cachedVisibleLayout = null;
            this.#cachedJsonValue = null;
            this.#invalidateRenderedViewport();
        }

        if (this.#cachedVisibleLayout === null) {
            this.filterCalculationCount++;
            this.#cachedVisibleLayout = filterGraphLayoutForDisplay({
                enabledEdgeTypes: this.#enabledEdgeTypes,
                enabledNodeKinds: resolveEffectiveGraphNodeKinds(graphNodes, this.#enabledNodeKinds),
                layout: this.#cachedLayout,
                matchesNode: (node) => this.#matchesSearch(node)
            });
            this.#cachedJsonValue = null;
            this.#invalidateRenderedViewport();
        }

        const graphPageClassName = this.state.activePage === "graph" ? "page content-page active" : "page content-page";
        const layout = this.#cachedLayout;
        const nodeItems = this.#cachedNodeItems;
        const edgeTypes = this.#cachedEdgeTypes;
        const selectedNode =
            this.#selectedNodeId === null ? null : (this.#cachedLayoutNodeById.get(this.#selectedNodeId) ?? null);
        const isVisualView = this.state.activeGraphView === "visual";

        let renderedLayout = this.#cachedRenderedLayout;
        if (
            renderedLayout === null ||
            !isGraphViewportCovered(this.#getViewportTransform(), this.#cachedRenderBounds)
        ) {
            const semanticLayout = projectGraphLayoutForSemanticZoom({
                displayLayout: this.#cachedVisibleLayout,
                focusNodeId: this.#focusedNodeId,
                sourceLayout: layout,
                zoomScale: this.#zoomScale
            });
            this.#cachedRenderBounds = createGraphRenderBounds(this.#getViewportTransform());
            renderedLayout = cullGraphLayoutToViewport(semanticLayout, this.#cachedRenderBounds);
            this.#cachedRenderedLayout = renderedLayout;
        }

        if (this.#cachedJsonValue === null) {
            this.#cachedJsonValue = JSON.stringify(
                { edges: this.#cachedVisibleLayout.edges, nodes: this.#cachedVisibleLayout.nodes },
                null,
                2
            );
        }
        const jsonValue = this.#cachedJsonValue;

        return html`
            <section id="graph-page" class=${graphPageClassName}>
                ${
                    this.state.graphErrorMessage || this.state.errorMessage
                        ? html`<gm-error-banner
                              .message=${this.state.graphErrorMessage || this.state.errorMessage}
                          ></gm-error-banner>`
                        : null
                }
                ${
                    this.state.isRegeneratePending
                        ? html`
                              <div class="loading-overlay" role="status" aria-live="polite">
                                  <div class="loading-indicator">
                                      <span class="loading-spinner" aria-hidden="true"></span>
                                      <span class="loading-message">Regenerating graph index…</span>
                                  </div>
                              </div>
                          `
                        : null
                }
                ${this.#renderSemanticIndexProgress()}
                ${hasLoadedGraphIndex(this.model) ? null : this.#renderEmptyState()}
                ${this.#renderGraphSurface(renderedLayout, isVisualView)}
                ${this.#renderJsonView(jsonValue, isVisualView)}
                ${isVisualView ? this.#renderLegend(nodeItems, edgeTypes) : null}
                ${isVisualView ? this.#renderSelectedNode(selectedNode) : null}
            </section>
        `;
    }
}
