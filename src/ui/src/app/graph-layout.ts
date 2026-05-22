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
const PROMOTABLE_HIERARCHY_EDGE_TYPES = new Set<GraphVisualizationEdgeType>(["contains", "defines"]);

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

function buildHierarchyParentIdsByNode(edges: ReadonlyArray<GraphLayoutEdge>): Map<string, Array<string>> {
    const parentIdsByNode = new Map<string, Array<string>>();
    for (const edge of edges) {
        if (!PROMOTABLE_HIERARCHY_EDGE_TYPES.has(edge.type)) {
            continue;
        }

        const parentIds = parentIdsByNode.get(edge.targetNode.id) ?? [];
        parentIds.push(edge.sourceNode.id);
        parentIdsByNode.set(edge.targetNode.id, parentIds);
    }

    return parentIdsByNode;
}

function findNearestVisibleHierarchyAncestorId(
    nodeId: string,
    parentIdsByNode: Map<string, Array<string>>,
    visibleNodeIds: Set<string>
): string | null {
    const visitedNodeIds = new Set<string>([nodeId]);
    const pendingNodeIds = [...(parentIdsByNode.get(nodeId) ?? [])];

    while (pendingNodeIds.length > 0) {
        const currentNodeId = pendingNodeIds.shift();
        if (!currentNodeId || visitedNodeIds.has(currentNodeId)) {
            continue;
        }

        if (visibleNodeIds.has(currentNodeId)) {
            return currentNodeId;
        }

        visitedNodeIds.add(currentNodeId);
        pendingNodeIds.push(...(parentIdsByNode.get(currentNodeId) ?? []));
    }

    return null;
}

/**
 * Apply node-kind, edge-type, and search filters to a laid-out graph while
 * preserving visible leaf nodes whose hierarchy parents are hidden. When a
 * parent chain is hidden, leaf edges are promoted to the nearest visible
 * hierarchy ancestor so symbols do not disappear from the visual graph.
 */
export function filterGraphLayoutForDisplay(parameters: {
    enabledEdgeTypes: ReadonlySet<GraphVisualizationEdgeType>;
    enabledNodeKinds: ReadonlySet<GraphVisualizationNodeKind>;
    layout: GraphLayout;
    matchesNode: (node: GraphLayoutNode) => boolean;
}): GraphLayout {
    const { enabledEdgeTypes, enabledNodeKinds, layout, matchesNode } = parameters;
    const visibleNodes = layout.nodes.filter(
        (node) => node.kind === "project" || (enabledNodeKinds.has(node.kind) && matchesNode(node))
    );
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const visibleNodeById = new Map(visibleNodes.map((node) => [node.id, node]));
    const parentIdsByNode = buildHierarchyParentIdsByNode(layout.edges);
    const visibleEdges: Array<GraphLayoutEdge> = [];
    const visibleEdgeKeys = new Set<string>();

    for (const edge of layout.edges) {
        if (!enabledEdgeTypes.has(edge.type) || !visibleNodeIds.has(edge.targetNode.id)) {
            continue;
        }

        const sourceNodeId = visibleNodeIds.has(edge.sourceNode.id)
            ? edge.sourceNode.id
            : PROMOTABLE_HIERARCHY_EDGE_TYPES.has(edge.type)
              ? findNearestVisibleHierarchyAncestorId(edge.sourceNode.id, parentIdsByNode, visibleNodeIds)
              : null;
        if (!sourceNodeId || sourceNodeId === edge.targetNode.id) {
            continue;
        }

        const sourceNode = visibleNodeById.get(sourceNodeId);
        const targetNode = visibleNodeById.get(edge.targetNode.id);
        if (!sourceNode || !targetNode) {
            continue;
        }

        const edgeKey = `${sourceNode.id}\u0000${targetNode.id}\u0000${edge.type}`;
        if (visibleEdgeKeys.has(edgeKey)) {
            continue;
        }

        visibleEdgeKeys.add(edgeKey);
        visibleEdges.push({
            source: sourceNode.id,
            sourceNode,
            target: targetNode.id,
            targetNode,
            type: edge.type
        });
    }

    return Object.freeze({
        edges: visibleEdges,
        nodes: visibleNodes
    });
}

/**
 * Group graph node kinds for legend display.
 */
export function listGraphNodeKinds(
    nodes: ReadonlyArray<GraphVisualizationNodeRecord>
): ReadonlyArray<GraphVisualizationNodeKind> {
    return Array.from(new Set(nodes.map((node) => node.kind).filter((kind) => kind !== "project"))).toSorted();
}

/**
 * Group graph edge types for legend display.
 */
export function listGraphEdgeTypes(
    edges: ReadonlyArray<GraphVisualizationEdgeRecord>
): ReadonlyArray<GraphVisualizationEdgeType> {
    return Array.from(new Set(edges.map((edge) => edge.type))).toSorted();
}
