import type { InitialGraphPosition } from "./graph-layout-hierarchy.js";
import type {
    GraphVisualizationEdgeRecord,
    GraphVisualizationEdgeType,
    GraphVisualizationNodeRecord
} from "./types.js";

const PROJECT_NODE_RADIUS = 17;
const DEFAULT_NODE_RADIUS = 9;
const CONNECTION_RADIUS_WEIGHT = 1.8;
const MIN_NODE_DISTANCE_PADDING = 80;
const CLOSE_NODE_REPULSION = 520;
const DISTANT_NODE_REPULSION = 1800;
const ALL_PAIRS_REPULSION_NODE_LIMIT = 180;
const LARGE_GRAPH_REPULSION_CELL_SIZE = 320;
const OVERLAP_RESOLUTION_PASSES = 90;
// Pushing exactly the measured overlap converges asymptotically for densely-coupled clusters
// (each pass only fixes one constraint at a time, re-creating tiny overlaps elsewhere).
// Overshooting the correction converges in a bounded number of passes instead.
const OVERLAP_RESOLUTION_OVERSHOOT = 1.5;
// Final coordinates are rounded to integers for rendering, which can pull two nodes up to
// ~1.5px closer together; targeting a slightly larger gap here absorbs that rounding.
const OVERLAP_RESOLUTION_ROUNDING_MARGIN = 2;

export type SimulationNode = {
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

export function countGraphNodeConnections(edges: ReadonlyArray<GraphVisualizationEdgeRecord>): Map<string, number> {
    const connectionCounts = new Map<string, number>();
    for (const edge of edges) {
        connectionCounts.set(edge.source, (connectionCounts.get(edge.source) ?? 0) + 1);
        connectionCounts.set(edge.target, (connectionCounts.get(edge.target) ?? 0) + 1);
    }

    return connectionCounts;
}

export function createSimulationNodes(
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

export function applyForceDirectedRefinement(
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
    if (simNodes.length <= ALL_PAIRS_REPULSION_NODE_LIMIT) {
        for (let i = 0; i < simNodes.length; i++) {
            const nodeI = simNodes[i];
            for (let j = i + 1; j < simNodes.length; j++) {
                const nodeJ = simNodes[j];
                applyRepulsiveForce(nodeI, nodeJ);
            }
        }
        return;
    }

    // Large semantic graphs can contain thousands of symbols. Applying distant
    // repulsion to every pair for every simulation iteration dominates startup
    // time while contributing only a tiny force between already-separated nodes.
    // Reuse the deterministic spatial grid so large layouts only evaluate local
    // neighborhoods; edge attraction and gravity continue to provide global shape.
    forEachNearbySimulationNodePair(simNodes, LARGE_GRAPH_REPULSION_CELL_SIZE, applyRepulsiveForce);
}

function applyRepulsiveForce(nodeA: SimulationNode, nodeB: SimulationNode): void {
    const dx = nodeA.x - nodeB.x;
    const dy = nodeA.y - nodeB.y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq) || 1;
    const minDist = nodeA.radius + nodeB.radius + MIN_NODE_DISTANCE_PADDING;
    const force =
        dist < minDist ? (CLOSE_NODE_REPULSION * (minDist - dist)) / dist : DISTANT_NODE_REPULSION / (distSq + 20);
    const fx = dist < minDist ? dx * force : (dx / dist) * force;
    const fy = dist < minDist ? dy * force : (dy / dist) * force;

    nodeA.vx += fx;
    nodeA.vy += fy;
    nodeB.vx -= fx;
    nodeB.vy -= fy;
}

/**
 * Buckets nodes into a uniform grid keyed by cell coordinates, sized so that any two nodes
 * within `cellSize` of each other always land in the same or an adjacent cell.
 */
function buildSpatialGrid(
    simNodes: ReadonlyArray<SimulationNode>,
    cellSize: number
): Map<string, Array<SimulationNode>> {
    const grid = new Map<string, Array<SimulationNode>>();
    for (const node of simNodes) {
        const key = spatialGridCellKey(Math.floor(node.x / cellSize), Math.floor(node.y / cellSize));
        const cell = grid.get(key);
        if (cell) {
            cell.push(node);
        } else {
            grid.set(key, [node]);
        }
    }

    return grid;
}

function spatialGridCellKey(cellX: number, cellY: number): string {
    return `${String(cellX)}:${String(cellY)}`;
}

function parseSpatialGridCellKey(cellKey: string): readonly [number, number] {
    const parts = cellKey.split(":").map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0];
}

// The 4 forward directions of a 3x3 neighborhood; combined with each cell's own occupants, every
// unordered pair of cells within one cell-width of each other is covered by exactly one of the
// two cells' forward scan, so no visited-pair bookkeeping is needed to avoid double-counting.
const FORWARD_NEIGHBOR_CELL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1]
];

/**
 * Visits each pair of nodes that could plausibly be within `cellSize` of one another exactly
 * once, without checking every pair — turns the O(n^2) all-pairs scan into an O(n) grid lookup.
 */
function forEachNearbySimulationNodePair(
    simNodes: ReadonlyArray<SimulationNode>,
    cellSize: number,
    visit: (nodeA: SimulationNode, nodeB: SimulationNode) => void
): void {
    const grid = buildSpatialGrid(simNodes, cellSize);

    for (const [cellKey, cellNodes] of grid) {
        visitPairsWithinCell(cellNodes, visit);
        visitPairsWithForwardNeighborCells(grid, cellKey, cellNodes, visit);
    }
}

function visitPairsWithinCell(
    cellNodes: ReadonlyArray<SimulationNode>,
    visit: (nodeA: SimulationNode, nodeB: SimulationNode) => void
): void {
    for (let i = 0; i < cellNodes.length; i++) {
        for (let j = i + 1; j < cellNodes.length; j++) {
            visit(cellNodes[i], cellNodes[j]);
        }
    }
}

function visitPairsWithForwardNeighborCells(
    grid: ReadonlyMap<string, ReadonlyArray<SimulationNode>>,
    cellKey: string,
    cellNodes: ReadonlyArray<SimulationNode>,
    visit: (nodeA: SimulationNode, nodeB: SimulationNode) => void
): void {
    const [cellX, cellY] = parseSpatialGridCellKey(cellKey);
    for (const [offsetX, offsetY] of FORWARD_NEIGHBOR_CELL_OFFSETS) {
        const neighborCell = grid.get(spatialGridCellKey(cellX + offsetX, cellY + offsetY));
        if (!neighborCell) {
            continue;
        }

        for (const nodeA of cellNodes) {
            for (const nodeB of neighborCell) {
                visit(nodeA, nodeB);
            }
        }
    }
}

/**
 * Deterministically separates any nodes still closer than their minimum allowed distance after
 * the spring simulation settles. The spring forces only tend toward non-overlapping positions;
 * this pass guarantees it, which matters most for large graphs where 80 iterations may not
 * fully converge.
 */
export function resolveOverlappingSimulationNodes(simNodes: Array<SimulationNode>): void {
    if (simNodes.length < 2) {
        return;
    }

    const maxRadius = simNodes.reduce((max, node) => Math.max(max, node.radius), 0);
    const cellSize = maxRadius * 2 + MIN_NODE_DISTANCE_PADDING + OVERLAP_RESOLUTION_ROUNDING_MARGIN;

    for (let pass = 0; pass < OVERLAP_RESOLUTION_PASSES; pass++) {
        let didResolveOverlap = false;

        forEachNearbySimulationNodePair(simNodes, cellSize, (nodeA, nodeB) => {
            if (separateOverlappingNodePair(nodeA, nodeB)) {
                didResolveOverlap = true;
            }
        });

        if (!didResolveOverlap) {
            return;
        }
    }
}

function separateOverlappingNodePair(nodeA: SimulationNode, nodeB: SimulationNode): boolean {
    const dx = nodeB.x - nodeA.x;
    const dy = nodeB.y - nodeA.y;
    const dist = Math.hypot(dx, dy);
    const minDist = nodeA.radius + nodeB.radius + MIN_NODE_DISTANCE_PADDING + OVERLAP_RESOLUTION_ROUNDING_MARGIN;
    if (dist >= minDist) {
        return false;
    }

    const angle = dist > 0 ? Math.atan2(dy, dx) : 0;
    const push = ((minDist - dist) / 2) * OVERLAP_RESOLUTION_OVERSHOOT;
    const pushX = Math.cos(angle) * push;
    const pushY = Math.sin(angle) * push;

    nodeA.x -= pushX;
    nodeA.y -= pushY;
    nodeB.x += pushX;
    nodeB.y += pushY;

    return true;
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
            restLength: nodeSource.radius + nodeTarget.radius + 90,
            stiffness: 0.08
        };
    }

    if (edgeType === "calls" || edgeType === "inherits") {
        return {
            restLength: 170,
            stiffness: 0.045
        };
    }

    return {
        restLength: 210,
        stiffness: 0.025
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

export function centerSimulationNodes(
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
