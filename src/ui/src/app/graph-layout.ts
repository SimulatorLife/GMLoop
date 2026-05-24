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

type GraphHierarchy = Readonly<{
    childrenMap: Map<string, Array<string>>;
    parentMap: Map<string, string>;
    projectNodes: ReadonlyArray<GraphVisualizationNodeRecord>;
}>;

type InitialGraphPosition = Readonly<{
    angle: number;
    x: number;
    y: number;
}>;

type SimulationNode = {
    id: string;
    radius: number;
    vx: number;
    vy: number;
    x: number;
    y: number;
};

function getNodeRadius(node: GraphVisualizationNodeRecord, connectionCount: number): number {
    if (node.kind === "project") {
        return PROJECT_NODE_RADIUS;
    }

    return DEFAULT_NODE_RADIUS + Math.min(8, Math.sqrt(connectionCount) * CONNECTION_RADIUS_WEIGHT);
}

function countGraphNodeConnections(edges: ReadonlyArray<GraphVisualizationEdgeRecord>): Map<string, number> {
    const connectionCounts = new Map<string, number>();
    for (const edge of edges) {
        connectionCounts.set(edge.source, (connectionCounts.get(edge.source) ?? 0) + 1);
        connectionCounts.set(edge.target, (connectionCounts.get(edge.target) ?? 0) + 1);
    }

    return connectionCounts;
}

function buildGraphHierarchy(
    nodes: ReadonlyArray<GraphVisualizationNodeRecord>,
    edges: ReadonlyArray<GraphVisualizationEdgeRecord>
): GraphHierarchy {
    const parentMap = new Map<string, string>();
    const childrenMap = new Map<string, Array<string>>();
    for (const edge of edges) {
        if (PROMOTABLE_HIERARCHY_EDGE_TYPES.has(edge.type) && !parentMap.has(edge.target)) {
            appendHierarchyChild(parentMap, childrenMap, edge.source, edge.target);
        }
    }

    const projectNodes = nodes.filter((node) => node.kind === "project");
    const defaultParentId = projectNodes.length > 0 ? projectNodes[0].id : null;
    for (const node of nodes) {
        if (node.kind !== "project" && !parentMap.has(node.id) && defaultParentId && node.id !== defaultParentId) {
            appendHierarchyChild(parentMap, childrenMap, defaultParentId, node.id);
        }
    }

    return { childrenMap, parentMap, projectNodes };
}

function appendHierarchyChild(
    parentMap: Map<string, string>,
    childrenMap: Map<string, Array<string>>,
    parentId: string,
    childId: string
): void {
    parentMap.set(childId, parentId);
    const children = childrenMap.get(parentId) ?? [];
    children.push(childId);
    childrenMap.set(parentId, children);
}

function seedInitialGraphPositions(
    nodes: ReadonlyArray<GraphVisualizationNodeRecord>,
    hierarchy: GraphHierarchy
): Map<string, InitialGraphPosition> {
    const initialPositions = new Map<string, InitialGraphPosition>();
    const visitedNodeIds = new Set<string>();

    for (const projectNode of hierarchy.projectNodes) {
        layoutHierarchyBranch(projectNode.id, 0, 0, null, 0, hierarchy, initialPositions, visitedNodeIds);
    }

    for (const node of nodes) {
        if (!visitedNodeIds.has(node.id)) {
            layoutHierarchyBranch(node.id, 0, 0, null, 1, hierarchy, initialPositions, visitedNodeIds);
        }
    }

    return initialPositions;
}

function layoutHierarchyBranch(
    nodeId: string,
    parentX: number,
    parentY: number,
    parentAngle: number | null,
    depth: number,
    hierarchy: GraphHierarchy,
    initialPositions: Map<string, InitialGraphPosition>,
    visitedNodeIds: Set<string>
): void {
    if (visitedNodeIds.has(nodeId)) {
        return;
    }
    visitedNodeIds.add(nodeId);

    const position = getInitialHierarchyPosition(
        nodeId,
        parentX,
        parentY,
        parentAngle,
        depth,
        hierarchy,
        initialPositions
    );
    initialPositions.set(nodeId, position);

    const children = hierarchy.childrenMap.get(nodeId) ?? [];
    for (const childId of children) {
        layoutHierarchyBranch(
            childId,
            position.x,
            position.y,
            position.angle,
            depth + 1,
            hierarchy,
            initialPositions,
            visitedNodeIds
        );
    }
}

function getInitialHierarchyPosition(
    nodeId: string,
    parentX: number,
    parentY: number,
    parentAngle: number | null,
    depth: number,
    hierarchy: GraphHierarchy,
    initialPositions: Map<string, InitialGraphPosition>
): InitialGraphPosition {
    if (depth === 0) {
        return { angle: parentAngle ?? 0, x: parentX, y: parentY };
    }

    const radius = depth === 1 ? 200 : depth === 2 ? 90 : 50;
    const parentId = hierarchy.parentMap.get(nodeId);
    const parentPosition = parentId ? initialPositions.get(parentId) : null;
    const parentActualAngle = parentPosition ? parentPosition.angle : 0;
    const siblings = parentId ? (hierarchy.childrenMap.get(parentId) ?? []) : [];
    const index = siblings.indexOf(nodeId);
    const count = siblings.length;

    if (parentAngle === null) {
        const theta = count > 1 ? (index / count) * Math.PI * 2 : 0;
        return {
            angle: theta,
            x: parentX + Math.cos(theta) * radius,
            y: parentY + Math.sin(theta) * radius
        };
    }

    const arcWidth = Math.PI * 0.8;
    const theta = count > 1 ? parentActualAngle - arcWidth / 2 + (index / (count - 1)) * arcWidth : parentActualAngle;
    return {
        angle: theta,
        x: parentX + Math.cos(theta) * radius,
        y: parentY + Math.sin(theta) * radius
    };
}

function createSimulationNodes(
    nodes: ReadonlyArray<GraphVisualizationNodeRecord>,
    connectionCounts: Map<string, number>,
    initialPositions: Map<string, InitialGraphPosition>
): Array<SimulationNode> {
    return nodes.map((node) => {
        const radius = getNodeRadius(node, connectionCounts.get(node.id) ?? 0);
        const position = initialPositions.get(node.id) ?? { angle: 0, x: 0, y: 0 };
        return {
            id: node.id,
            radius,
            vx: 0,
            vy: 0,
            x: position.x,
            y: position.y
        };
    });
}

function applyForceDirectedRefinement(
    simNodes: Array<SimulationNode>,
    simNodeById: Map<string, SimulationNode>,
    edges: ReadonlyArray<GraphVisualizationEdgeRecord>
): void {
    const iterations = 80;
    const gravityCoeff = 0.015;

    for (let iter = 0; iter < iterations; iter++) {
        const coolingRatio = 1 - iter / iterations;
        const maxStep = 25 * coolingRatio;

        resetSimulationVelocities(simNodes);
        applyPairRepulsion(simNodes);
        applyEdgeAttraction(edges, simNodeById);
        applyGravity(simNodes, gravityCoeff);
        updateSimulationPositions(simNodes, maxStep);
    }
}

function resetSimulationVelocities(simNodes: Array<SimulationNode>): void {
    for (const simNode of simNodes) {
        simNode.vx = 0;
        simNode.vy = 0;
    }
}

function applyPairRepulsion(simNodes: Array<SimulationNode>): void {
    for (let i = 0; i < simNodes.length; i++) {
        const nodeI = simNodes[i];
        for (let j = i + 1; j < simNodes.length; j++) {
            const nodeJ = simNodes[j];
            applyRepulsiveForce(nodeI, nodeJ);
        }
    }
}

function applyRepulsiveForce(nodeA: SimulationNode, nodeB: SimulationNode): void {
    const dx = nodeA.x - nodeB.x;
    const dy = nodeA.y - nodeB.y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq) || 1;
    const minDist = nodeA.radius + nodeB.radius + 35;
    const force = dist < minDist ? (350 * (minDist - dist)) / dist : 1000 / (distSq + 20);
    const fx = dist < minDist ? dx * force : (dx / dist) * force;
    const fy = dist < minDist ? dy * force : (dy / dist) * force;

    nodeA.vx += fx;
    nodeA.vy += fy;
    nodeB.vx -= fx;
    nodeB.vy -= fy;
}

function applyEdgeAttraction(
    edges: ReadonlyArray<GraphVisualizationEdgeRecord>,
    simNodeById: Map<string, SimulationNode>
): void {
    for (const edge of edges) {
        const nodeSource = simNodeById.get(edge.source);
        const nodeTarget = simNodeById.get(edge.target);
        if (!nodeSource || !nodeTarget) {
            continue;
        }

        applyAttractiveForce(edge.type, nodeSource, nodeTarget);
    }
}

function applyAttractiveForce(
    edgeType: GraphVisualizationEdgeType,
    nodeSource: SimulationNode,
    nodeTarget: SimulationNode
): void {
    const dx = nodeTarget.x - nodeSource.x;
    const dy = nodeTarget.y - nodeSource.y;
    const dist = Math.hypot(dx, dy) || 1;
    const { restLength, stiffness } = getEdgeForceProfile(edgeType, nodeSource, nodeTarget);
    const force = (stiffness * (dist - restLength)) / dist;
    const fx = dx * force;
    const fy = dy * force;

    nodeSource.vx += fx;
    nodeSource.vy += fy;
    nodeTarget.vx -= fx;
    nodeTarget.vy -= fy;
}

function getEdgeForceProfile(
    edgeType: GraphVisualizationEdgeType,
    nodeSource: SimulationNode,
    nodeTarget: SimulationNode
): Readonly<{ restLength: number; stiffness: number }> {
    if (edgeType === "contains" || edgeType === "defines") {
        return {
            restLength: nodeSource.radius + nodeTarget.radius + 25,
            stiffness: 0.12
        };
    }

    if (edgeType === "calls" || edgeType === "inherits") {
        return {
            restLength: 90,
            stiffness: 0.06
        };
    }

    return {
        restLength: 120,
        stiffness: 0.03
    };
}

function applyGravity(simNodes: Array<SimulationNode>, gravityCoeff: number): void {
    for (const simNode of simNodes) {
        simNode.vx -= simNode.x * gravityCoeff;
        simNode.vy -= simNode.y * gravityCoeff;
    }
}

function updateSimulationPositions(simNodes: Array<SimulationNode>, maxStep: number): void {
    for (const simNode of simNodes) {
        const stepLen = Math.hypot(simNode.vx, simNode.vy);
        if (stepLen > maxStep) {
            simNode.x += (simNode.vx / stepLen) * maxStep;
            simNode.y += (simNode.vy / stepLen) * maxStep;
        } else {
            simNode.x += simNode.vx;
            simNode.y += simNode.vy;
        }
    }
}

function centerSimulationNodes(
    simNodes: Array<SimulationNode>,
    simNodeById: Map<string, SimulationNode>,
    projectNodes: ReadonlyArray<GraphVisualizationNodeRecord>
): void {
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
}

function createLayoutNodes(
    nodes: ReadonlyArray<GraphVisualizationNodeRecord>,
    simNodeById: Map<string, SimulationNode>
): ReadonlyArray<GraphLayoutNode> {
    return nodes.map((node): GraphLayoutNode => {
        const simNode = getSimulationNodeForLayout(node.id, simNodeById);
        return {
            ...node,
            radius: simNode.radius,
            x: Math.round(simNode.x),
            y: Math.round(simNode.y)
        };
    });
}

function getSimulationNodeForLayout(nodeId: string, simNodeById: Map<string, SimulationNode>): SimulationNode {
    const simNode = simNodeById.get(nodeId);
    if (!simNode) {
        throw new Error(`Graph layout simulation did not create a node for '${nodeId}'.`);
    }

    return simNode;
}

function createLayoutEdges(
    layoutNodes: ReadonlyArray<GraphLayoutNode>,
    edges: ReadonlyArray<GraphVisualizationEdgeRecord>
): ReadonlyArray<GraphLayoutEdge> {
    const nodeById = new Map(layoutNodes.map((node) => [node.id, node]));
    return edges.flatMap((edge): ReadonlyArray<GraphLayoutEdge> => {
        const sourceNode = nodeById.get(edge.source);
        const targetNode = nodeById.get(edge.target);
        if (!sourceNode || !targetNode) {
            return [];
        }

        return [{ ...edge, sourceNode, targetNode }];
    });
}

/**
 * Create a deterministic graph layout for the Lit graph surface.
 */
export function createGraphLayout(
    nodes: ReadonlyArray<GraphVisualizationNodeRecord>,
    edges: ReadonlyArray<GraphVisualizationEdgeRecord>
): GraphLayout {
    const connectionCounts = countGraphNodeConnections(edges);
    const hierarchy = buildGraphHierarchy(nodes, edges);
    const initialPositions = seedInitialGraphPositions(nodes, hierarchy);
    const simNodes = createSimulationNodes(nodes, connectionCounts, initialPositions);
    const simNodeById = new Map(simNodes.map((node) => [node.id, node]));
    applyForceDirectedRefinement(simNodes, simNodeById, edges);
    centerSimulationNodes(simNodes, simNodeById, hierarchy.projectNodes);
    const layoutNodes = createLayoutNodes(nodes, simNodeById);

    return Object.freeze({
        edges: createLayoutEdges(layoutNodes, edges),
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
