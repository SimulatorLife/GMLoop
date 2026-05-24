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

    // 1. Build hierarchy parent/child relationships based on contains and defines edge types.
    // Parent direction: source is parent, target is child.
    const parentMap = new Map<string, string>();
    const childrenMap = new Map<string, string[]>();
    for (const edge of edges) {
        if ((edge.type === "contains" || edge.type === "defines") && !parentMap.has(edge.target)) {
                parentMap.set(edge.target, edge.source);
                const children = childrenMap.get(edge.source) ?? [];
                children.push(edge.target);
                childrenMap.set(edge.source, children);
            }
    }

    // Find project nodes (roots)
    const projectNodes = nodes.filter((node) => node.kind === "project");

    // For any node that is not project and does not have a parent, assign its parent to the first project node if available.
    const defaultParentId = projectNodes.length > 0 ? projectNodes[0].id : null;
    for (const node of nodes) {
        if (node.kind !== "project" && !parentMap.has(node.id) && defaultParentId && node.id !== defaultParentId) {
                parentMap.set(node.id, defaultParentId);
                const children = childrenMap.get(defaultParentId) ?? [];
                children.push(node.id);
                childrenMap.set(defaultParentId, children);
            }
    }

    // 2. Initialize positions using hierarchical tree layout
    const initialPositions = new Map<string, { x: number; y: number; angle: number }>();
    const visited = new Set<string>();

    function layoutTree(nodeId: string, px: number, py: number, parentAngle: number | null, depth: number) {
        if (visited.has(nodeId)) {
            return;
        }
        visited.add(nodeId);

        let x = px;
        let y = py;
        let angle = parentAngle ?? 0;

        if (depth > 0) {
            // Place node around its parent
            const radius = depth === 1 ? 200 : depth === 2 ? 90 : 50;
            const parentId = parentMap.get(nodeId);
            const parentNodePos = parentId ? initialPositions.get(parentId) : null;
            const parentActualAngle = parentNodePos ? parentNodePos.angle : 0;

            const siblings = parentId ? (childrenMap.get(parentId) ?? []) : [];
            const index = siblings.indexOf(nodeId);
            const count = siblings.length;

            if (parentAngle === null) {
                // If parent is root, distribute children evenly on full circle
                const theta = count > 1 ? (index / count) * Math.PI * 2 : 0;
                x = px + Math.cos(theta) * radius;
                y = py + Math.sin(theta) * radius;
                angle = theta;
            } else {
                // Distribute in an arc centered around parentActualAngle pointing outwards
                const arcWidth = Math.PI * 0.8; // ~144 degrees
                let theta = parentActualAngle;
                if (count > 1) {
                    theta = parentActualAngle - arcWidth / 2 + (index / (count - 1)) * arcWidth;
                }
                x = px + Math.cos(theta) * radius;
                y = py + Math.sin(theta) * radius;
                angle = theta;
            }
        }

        initialPositions.set(nodeId, { x, y, angle });

        const children = childrenMap.get(nodeId) ?? [];
        for (const childId of children) {
            layoutTree(childId, x, y, angle, depth + 1);
        }
    }

    // Start layouts from project roots
    for (const projectNode of projectNodes) {
        layoutTree(projectNode.id, 0, 0, null, 0);
    }

    // In case there are any leftover nodes not connected to anything
    for (const node of nodes) {
        if (!visited.has(node.id)) {
            layoutTree(node.id, 0, 0, null, 1);
        }
    }

    // Copy to mutable structure for force simulation
    const simNodes = nodes.map((node) => {
        const radius = getNodeRadius(node, connectionCounts.get(node.id) ?? 0);
        const pos = initialPositions.get(node.id) ?? { x: 0, y: 0, angle: 0 };
        return {
            id: node.id,
            kind: node.kind,
            radius,
            x: pos.x,
            y: pos.y,
            vx: 0,
            vy: 0
        };
    });

    const simNodeById = new Map(simNodes.map((n) => [n.id, n]));

    // 3. Deterministic Force-Directed Refinement Simulation
    const iterations = 80;
    const gravityCoeff = 0.015;

    for (let iter = 0; iter < iterations; iter++) {
        // Temperature damping (cooling factor)
        const t = 1 - iter / iterations;
        const maxStep = 25 * t;

        // Reset velocities
        for (const sn of simNodes) {
            sn.vx = 0;
            sn.vy = 0;
        }

        // A. Repulsive forces between all pairs
        for (let i = 0; i < simNodes.length; i++) {
            const nodeI = simNodes[i];
            for (let j = i + 1; j < simNodes.length; j++) {
                const nodeJ = simNodes[j];
                const dx = nodeI.x - nodeJ.x;
                const dy = nodeI.y - nodeJ.y;
                const distSq = dx * dx + dy * dy;
                const dist = Math.sqrt(distSq) || 1;

                const minDist = nodeI.radius + nodeJ.radius + 35;
                if (dist < minDist) {
                    const force = (350 * (minDist - dist)) / dist;
                    const fx = dx * force;
                    const fy = dy * force;
                    nodeI.vx += fx;
                    nodeI.vy += fy;
                    nodeJ.vx -= fx;
                    nodeJ.vy -= fy;
                } else {
                    const force = 1000 / (distSq + 20);
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    nodeI.vx += fx;
                    nodeI.vy += fy;
                    nodeJ.vx -= fx;
                    nodeJ.vy -= fy;
                }
            }
        }

        // B. Attractive forces along edges
        for (const edge of edges) {
            const nodeSource = simNodeById.get(edge.source);
            const nodeTarget = simNodeById.get(edge.target);
            if (!nodeSource || !nodeTarget) {
                continue;
            }

            const dx = nodeTarget.x - nodeSource.x;
            const dy = nodeTarget.y - nodeSource.y;
            const dist = Math.hypot(dx, dy) || 1;

            let restLength = 120;
            let stiffness = 0.03;

            if (edge.type === "contains" || edge.type === "defines") {
                restLength = nodeSource.radius + nodeTarget.radius + 25;
                stiffness = 0.12;
            } else if (edge.type === "calls" || edge.type === "inherits") {
                restLength = 90;
                stiffness = 0.06;
            }

            const force = (stiffness * (dist - restLength)) / dist;
            const fx = dx * force;
            const fy = dy * force;

            nodeSource.vx += fx;
            nodeSource.vy += fy;
            nodeTarget.vx -= fx;
            nodeTarget.vy -= fy;
        }

        // C. Gravity (pull towards 0, 0)
        for (const sn of simNodes) {
            sn.vx -= sn.x * gravityCoeff;
            sn.vy -= sn.y * gravityCoeff;
        }

        // D. Update positions
        for (const sn of simNodes) {
            const stepLen = Math.hypot(sn.vx, sn.vy);
            if (stepLen > maxStep) {
                sn.x += (sn.vx / stepLen) * maxStep;
                sn.y += (sn.vy / stepLen) * maxStep;
            } else {
                sn.x += sn.vx;
                sn.y += sn.vy;
            }
        }
    }

    // 4. Centering: Center on first project node, or centroid
    let cx = 0;
    let cy = 0;
    const projectSimNode = projectNodes.length > 0 ? simNodeById.get(projectNodes[0].id) : null;
    if (projectSimNode) {
        cx = projectSimNode.x;
        cy = projectSimNode.y;
    } else {
        let sx = 0;
        let sy = 0;
        for (const sn of simNodes) {
            sx += sn.x;
            sy += sn.y;
        }
        if (simNodes.length > 0) {
            cx = sx / simNodes.length;
            cy = sy / simNodes.length;
        }
    }

    for (const sn of simNodes) {
        sn.x -= cx;
        sn.y -= cy;
    }

    // 5. Construct Layout Nodes
    const layoutNodes = nodes.map((node): GraphLayoutNode => {
        const sn = simNodeById.get(node.id);
        return {
            ...node,
            radius: sn.radius,
            x: Math.round(sn.x),
            y: Math.round(sn.y)
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
