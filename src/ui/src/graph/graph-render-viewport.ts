import type { GraphLayout, GraphLayoutEdge, GraphLayoutNode } from "./graph-layout.js";
import {
    GRAPH_RENDER_LABEL_MODES,
    type GraphRenderLabelMode,
    isGraphRenderLabelMode
} from "./graph-render-label-modes.js";
import type { GraphVisualizationEdgeType } from "./types.js";

const GRAPH_VIEWBOX_LEFT = -900;
const GRAPH_VIEWBOX_TOP = -700;
const GRAPH_VIEWBOX_WIDTH = 1800;
const GRAPH_VIEWBOX_HEIGHT = 1400;
const DEFAULT_OVERSCAN_FACTOR = 0.75;
const AUTO_LABEL_MIN_SCALE = 0.8;
const EDGE_BATCH_OVERVIEW_MAX_SCALE = 0.75;
const EDGE_BATCH_OVERVIEW_COUNT_THRESHOLD = 150;
const EDGE_BATCH_COUNT_THRESHOLD = 750;

export type GraphViewportTransform = Readonly<{
    panX: number;
    panY: number;
    zoomScale: number;
}>;

export type GraphViewportBounds = Readonly<{
    bottom: number;
    left: number;
    right: number;
    top: number;
}>;

export type GraphEdgeBatch = Readonly<{
    edgeCount: number;
    pathData: string;
    type: GraphVisualizationEdgeType;
}>;

/**
 * Convert the fixed SVG viewBox into graph-world coordinates for the current camera transform.
 */
export function calculateGraphViewportBounds(transform: GraphViewportTransform): GraphViewportBounds {
    const zoomScale = Math.max(transform.zoomScale, Number.EPSILON);
    const left = (GRAPH_VIEWBOX_LEFT - transform.panX) / zoomScale;
    const top = (GRAPH_VIEWBOX_TOP - transform.panY) / zoomScale;

    return {
        bottom: top + GRAPH_VIEWBOX_HEIGHT / zoomScale,
        left,
        right: left + GRAPH_VIEWBOX_WIDTH / zoomScale,
        top
    };
}

/**
 * Create an oversized render window so routine pan/zoom input can update only the SVG transform.
 * Lit needs to rebuild the graph DOM only after the visible viewport leaves this window.
 */
export function createGraphRenderBounds(
    transform: GraphViewportTransform,
    overscanFactor = DEFAULT_OVERSCAN_FACTOR
): GraphViewportBounds {
    const viewport = calculateGraphViewportBounds(transform);
    const width = viewport.right - viewport.left;
    const height = viewport.bottom - viewport.top;
    const horizontalOverscan = width * Math.max(0, overscanFactor);
    const verticalOverscan = height * Math.max(0, overscanFactor);

    return {
        bottom: viewport.bottom + verticalOverscan,
        left: viewport.left - horizontalOverscan,
        right: viewport.right + horizontalOverscan,
        top: viewport.top - verticalOverscan
    };
}

/**
 * Check whether the currently visible camera viewport is still covered by a previously rendered window.
 */
export function isGraphViewportCovered(
    transform: GraphViewportTransform,
    renderBounds: GraphViewportBounds | null
): boolean {
    if (renderBounds === null) {
        return false;
    }

    const viewport = calculateGraphViewportBounds(transform);
    return (
        viewport.left >= renderBounds.left &&
        viewport.right <= renderBounds.right &&
        viewport.top >= renderBounds.top &&
        viewport.bottom <= renderBounds.bottom
    );
}

function nodeIntersectsBounds(node: GraphLayoutNode, bounds: GraphViewportBounds): boolean {
    return (
        node.x + node.radius >= bounds.left &&
        node.x - node.radius <= bounds.right &&
        node.y + node.radius >= bounds.top &&
        node.y - node.radius <= bounds.bottom
    );
}

function edgeIntersectsBounds(edge: GraphLayoutEdge, bounds: GraphViewportBounds): boolean {
    const minX = Math.min(edge.sourceNode.x, edge.targetNode.x);
    const maxX = Math.max(edge.sourceNode.x, edge.targetNode.x);
    const minY = Math.min(edge.sourceNode.y, edge.targetNode.y);
    const maxY = Math.max(edge.sourceNode.y, edge.targetNode.y);

    return minX <= bounds.right && maxX >= bounds.left && minY <= bounds.bottom && maxY >= bounds.top;
}

/**
 * Cull graph SVG primitives outside the oversized render window. Edge culling uses segment bounds,
 * preserving relationships that cross the viewport even when both endpoint nodes are off-screen.
 */
export function cullGraphLayoutToViewport(layout: GraphLayout, bounds: GraphViewportBounds): GraphLayout {
    return Object.freeze({
        edges: layout.edges.filter((edge) => edgeIntersectsBounds(edge, bounds)),
        nodes: layout.nodes.filter((node) => nodeIntersectsBounds(node, bounds))
    });
}

/**
 * Auto labels are intentionally suppressed while zoomed out because text nodes are expensive and
 * unreadable at overview scale. The explicit always/hidden modes retain their exact semantics.
 *
 * Validates {@link labelMode} against the centralized {@link GRAPH_RENDER_LABEL_MODES} catalogue
 * and throws on unknown input rather than silently falling through to the `"auto"` zoom heuristic.
 * The exhaustive `switch` keeps the runtime check in sync with the compile-time union: when a new
 * mode is added to the tuple, TypeScript will flag the missing case here at build time.
 */
export function shouldRenderGraphLabels(labelMode: GraphRenderLabelMode, zoomScale: number): boolean {
    if (!isGraphRenderLabelMode(labelMode)) {
        throw new RangeError(
            `Unsupported graph label mode: ${JSON.stringify(labelMode)}. Expected one of: ${GRAPH_RENDER_LABEL_MODES.join(", ")}.`
        );
    }

    switch (labelMode) {
        case "always": {
            return true;
        }
        case "hidden": {
            return false;
        }
        case "auto": {
            return zoomScale >= AUTO_LABEL_MIN_SCALE;
        }
    }
}

/**
 * Large graphs collapse relationship lines into style-compatible path batches. Small graphs retain
 * individual directional markers even at ordinary zoom levels; overview batching begins only when
 * enough edges are present for the DOM reduction to materially improve rendering cost.
 */
export function shouldBatchGraphEdges(zoomScale: number, edgeCount: number): boolean {
    return (
        edgeCount >= EDGE_BATCH_COUNT_THRESHOLD ||
        (zoomScale < EDGE_BATCH_OVERVIEW_MAX_SCALE && edgeCount >= EDGE_BATCH_OVERVIEW_COUNT_THRESHOLD)
    );
}

function getEdgeIntersection(edge: GraphLayoutEdge): Readonly<{ x1: number; x2: number; y1: number; y2: number }> {
    const { sourceNode, targetNode } = edge;
    const dx = targetNode.x - sourceNode.x;
    const dy = targetNode.y - sourceNode.y;
    const distance = Math.hypot(dx, dy);

    if (distance === 0) {
        return { x1: sourceNode.x, x2: targetNode.x, y1: sourceNode.y, y2: targetNode.y };
    }

    const normalX = dx / distance;
    const normalY = dy / distance;
    return {
        x1: sourceNode.x + normalX * sourceNode.radius,
        x2: targetNode.x - normalX * targetNode.radius,
        y1: sourceNode.y + normalY * sourceNode.radius,
        y2: targetNode.y - normalY * targetNode.radius
    };
}

/**
 * Collapse many line elements into style-compatible path batches. Directional arrowheads are omitted
 * in batch mode; they return automatically when zoom/detail and graph size permit per-edge rendering.
 */
export function buildGraphEdgeBatches(edges: ReadonlyArray<GraphLayoutEdge>): ReadonlyArray<GraphEdgeBatch> {
    const batchByType = new Map<GraphVisualizationEdgeType, { edgeCount: number; pathParts: Array<string> }>();

    for (const edge of edges) {
        const geometry = getEdgeIntersection(edge);
        const pathPart = `M${String(geometry.x1)},${String(geometry.y1)}L${String(geometry.x2)},${String(geometry.y2)}`;
        const batch = batchByType.get(edge.type);
        if (batch) {
            batch.edgeCount += 1;
            batch.pathParts.push(pathPart);
        } else {
            batchByType.set(edge.type, { edgeCount: 1, pathParts: [pathPart] });
        }
    }

    return [...batchByType].map(([type, batch]) => ({
        edgeCount: batch.edgeCount,
        pathData: batch.pathParts.join(""),
        type
    }));
}

export { type GraphRenderLabelMode } from "./graph-render-label-modes.js";
