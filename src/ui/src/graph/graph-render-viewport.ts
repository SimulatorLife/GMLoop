import type { GraphLayout, GraphLayoutEdge, GraphLayoutNode } from "./graph-layout.js";
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
const PARALLEL_EDGE_LANE_SPACING = 24;
const MAX_PARALLEL_EDGE_LANE_OFFSET = 96;

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

export type GraphRenderLabelMode = "always" | "auto" | "hidden";

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
 */
export function shouldRenderGraphLabels(labelMode: GraphRenderLabelMode, zoomScale: number): boolean {
    if (labelMode === "always") {
        return true;
    }
    if (labelMode === "hidden") {
        return false;
    }

    return zoomScale >= AUTO_LABEL_MIN_SCALE;
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

function readCanonicalEdgePairKey(edge: GraphLayoutEdge): string {
    return edge.source <= edge.target ? `${edge.source}\u0000${edge.target}` : `${edge.target}\u0000${edge.source}`;
}

function readEdgeRouteSortKey(edge: GraphLayoutEdge): string {
    return `${edge.source}\u0000${edge.target}\u0000${edge.type}`;
}

/**
 * Assign deterministic curved lanes to relationships that connect the same pair of nodes. This
 * prevents reciprocal and multi-type relationships from being painted directly on top of one
 * another in dense batched views while keeping single relationships straight.
 */
function buildParallelEdgeLaneOffsets(edges: ReadonlyArray<GraphLayoutEdge>): Map<GraphLayoutEdge, number> {
    const edgesByPair = new Map<string, Array<GraphLayoutEdge>>();
    for (const edge of edges) {
        const pairKey = readCanonicalEdgePairKey(edge);
        const pairEdges = edgesByPair.get(pairKey) ?? [];
        pairEdges.push(edge);
        edgesByPair.set(pairKey, pairEdges);
    }

    const offsetByEdge = new Map<GraphLayoutEdge, number>();
    for (const pairEdges of edgesByPair.values()) {
        if (pairEdges.length < 2) {
            continue;
        }

        const sortedEdges = pairEdges.toSorted((left, right) =>
            readEdgeRouteSortKey(left).localeCompare(readEdgeRouteSortKey(right))
        );
        const centerIndex = (sortedEdges.length - 1) / 2;
        for (let index = 0; index < sortedEdges.length; index++) {
            const edge = sortedEdges[index];
            const canonicalOffset = Math.max(
                -MAX_PARALLEL_EDGE_LANE_OFFSET,
                Math.min(MAX_PARALLEL_EDGE_LANE_OFFSET, (index - centerIndex) * PARALLEL_EDGE_LANE_SPACING)
            );
            const directionMultiplier = edge.source <= edge.target ? 1 : -1;
            offsetByEdge.set(edge, canonicalOffset * directionMultiplier);
        }
    }

    return offsetByEdge;
}

function createRoutedEdgePathPart(edge: GraphLayoutEdge, laneOffset: number): string {
    const geometry = getEdgeIntersection(edge);
    if (laneOffset === 0) {
        return `M${String(geometry.x1)},${String(geometry.y1)}L${String(geometry.x2)},${String(geometry.y2)}`;
    }

    const dx = geometry.x2 - geometry.x1;
    const dy = geometry.y2 - geometry.y1;
    const distance = Math.hypot(dx, dy) || 1;
    const perpendicularX = -dy / distance;
    const perpendicularY = dx / distance;
    const controlX = (geometry.x1 + geometry.x2) / 2 + perpendicularX * laneOffset;
    const controlY = (geometry.y1 + geometry.y2) / 2 + perpendicularY * laneOffset;
    return `M${String(geometry.x1)},${String(geometry.y1)}Q${String(controlX)},${String(controlY)},${String(geometry.x2)},${String(geometry.y2)}`;
}

/**
 * Collapse many line elements into style-compatible path batches. Directional arrowheads are omitted
 * in batch mode; they return automatically when zoom/detail and graph size permit per-edge rendering.
 * Parallel relationships are routed through separate curved lanes so distinct semantics remain legible.
 */
export function buildGraphEdgeBatches(edges: ReadonlyArray<GraphLayoutEdge>): ReadonlyArray<GraphEdgeBatch> {
    const pathPartsByType = new Map<GraphVisualizationEdgeType, Array<string>>();
    const edgeCountByType = new Map<GraphVisualizationEdgeType, number>();
    const laneOffsetByEdge = buildParallelEdgeLaneOffsets(edges);

    for (const edge of edges) {
        const pathParts = pathPartsByType.get(edge.type) ?? [];
        pathParts.push(createRoutedEdgePathPart(edge, laneOffsetByEdge.get(edge) ?? 0));
        pathPartsByType.set(edge.type, pathParts);
        edgeCountByType.set(edge.type, (edgeCountByType.get(edge.type) ?? 0) + 1);
    }

    return [...pathPartsByType.entries()].map(([type, pathParts]) => ({
        edgeCount: edgeCountByType.get(type) ?? 0,
        pathData: pathParts.join(""),
        type
    }));
}
