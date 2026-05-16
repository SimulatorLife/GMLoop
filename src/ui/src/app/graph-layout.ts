import type {
    GraphVisualizationEdgeRecord,
    GraphVisualizationEdgeType,
    GraphVisualizationNodeKind,
    GraphVisualizationNodeRecord
} from "../graph/types.js";

export type GraphLayoutNode = GraphVisualizationNodeRecord &
    Readonly<{
        radius: number;
        x: number;
        y: number;
    }>;

export type GraphLayoutEdge = GraphVisualizationEdgeRecord &
    Readonly<{
        sourceNode: GraphLayoutNode;
        targetNode: GraphLayoutNode;
    }>;

export type GraphLayout = Readonly<{
    edges: ReadonlyArray<GraphLayoutEdge>;
    nodes: ReadonlyArray<GraphLayoutNode>;
}>;

const PROJECT_NODE_RADIUS = 17;
const DEFAULT_NODE_RADIUS = 9;
const CONNECTION_RADIUS_WEIGHT = 1.8;

function getNodeRadius(node: GraphVisualizationNodeRecord, connectionCount: number): number {
    if (node.kind === "project") {
        return PROJECT_NODE_RADIUS;
    }

    return DEFAULT_NODE_RADIUS + Math.min(8, Math.sqrt(connectionCount) * CONNECTION_RADIUS_WEIGHT);
}

function getCircularPoint(index: number, count: number, radius: number): Readonly<{ x: number; y: number }> {
    if (count <= 1) {
        return { x: 0, y: 0 };
    }

    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
    };
}

/**
 * Create a deterministic graph layout for the Lit graph surface.
 */
export function createGraphLayout(
    nodes: ReadonlyArray<GraphVisualizationNodeRecord>,
    edges: ReadonlyArray<GraphVisualizationEdgeRecord>
): GraphLayout {
    const connectionCounts = new Map<string, number>();
    for (const edge of edges) {
        connectionCounts.set(edge.source, (connectionCounts.get(edge.source) ?? 0) + 1);
        connectionCounts.set(edge.target, (connectionCounts.get(edge.target) ?? 0) + 1);
    }

    const projectNodes = nodes.filter((node) => node.kind === "project");
    const regularNodes = nodes.filter((node) => node.kind !== "project");
    const orderedNodes = [...projectNodes, ...regularNodes];
    const layoutRadius = Math.max(180, Math.min(720, orderedNodes.length * 18));
    const layoutNodes = orderedNodes.map((node, index): GraphLayoutNode => {
        const point =
            node.kind === "project" ? { x: 0, y: 0 } : getCircularPoint(index, orderedNodes.length, layoutRadius);
        return {
            ...node,
            radius: getNodeRadius(node, connectionCounts.get(node.id) ?? 0),
            x: point.x,
            y: point.y
        };
    });
    const nodeById = new Map(layoutNodes.map((node) => [node.id, node]));
    const layoutEdges = edges.flatMap((edge): ReadonlyArray<GraphLayoutEdge> => {
        const sourceNode = nodeById.get(edge.source);
        const targetNode = nodeById.get(edge.target);
        if (!sourceNode || !targetNode) {
            return [];
        }

        return [{ ...edge, sourceNode, targetNode }];
    });

    return Object.freeze({
        edges: layoutEdges,
        nodes: layoutNodes
    });
}

/**
 * Group graph node kinds for legend display.
 */
export function listGraphNodeKinds(
    nodes: ReadonlyArray<GraphVisualizationNodeRecord>
): ReadonlyArray<GraphVisualizationNodeKind> {
    return Array.from(new Set(nodes.map((node) => node.kind))).toSorted();
}

/**
 * Group graph edge types for legend display.
 */
export function listGraphEdgeTypes(
    edges: ReadonlyArray<GraphVisualizationEdgeRecord>
): ReadonlyArray<GraphVisualizationEdgeType> {
    return Array.from(new Set(edges.map((edge) => edge.type))).toSorted();
}
