import type { GraphLayout, GraphLayoutEdge, GraphLayoutNode } from "./graph-layout.js";
import { buildGraphHierarchy } from "./graph-layout-hierarchy.js";

export type GraphSemanticZoomLevel = "overview" | "resource" | "symbol" | "detail";

export type GraphSemanticZoomEdge = GraphLayoutEdge &
    Readonly<{
        aggregateCount: number;
    }>;

export type GraphSemanticZoomLayout = Readonly<{
    edges: ReadonlyArray<GraphSemanticZoomEdge>;
    nodes: ReadonlyArray<GraphLayoutNode>;
}>;

const OVERVIEW_MAX_DEPTH = 1;
const RESOURCE_MAX_DEPTH = 2;
const SYMBOL_MAX_DEPTH = 3;
const OVERVIEW_MAX_SCALE = 0.55;
const RESOURCE_MAX_SCALE = 1.2;
const SYMBOL_MAX_SCALE = 3.5;

/**
 * Map camera scale to a stable semantic level. The thresholds deliberately keep
 * project/resources visible first, then progressively reveal owned symbols.
 */
export function resolveGraphSemanticZoomLevel(zoomScale: number): GraphSemanticZoomLevel {
    if (zoomScale <= OVERVIEW_MAX_SCALE) {
        return "overview";
    }
    if (zoomScale <= RESOURCE_MAX_SCALE) {
        return "resource";
    }
    if (zoomScale <= SYMBOL_MAX_SCALE) {
        return "symbol";
    }

    return "detail";
}

function readMaxHierarchyDepth(level: GraphSemanticZoomLevel): number {
    switch (level) {
        case "overview": {
            return OVERVIEW_MAX_DEPTH;
        }
        case "resource": {
            return RESOURCE_MAX_DEPTH;
        }
        case "symbol": {
            return SYMBOL_MAX_DEPTH;
        }
        case "detail": {
            return Number.POSITIVE_INFINITY;
        }
    }
}

function readFocusDescendantDepth(level: GraphSemanticZoomLevel): number {
    switch (level) {
        case "overview": {
            return 1;
        }
        case "resource": {
            return 2;
        }
        case "symbol": {
            return 3;
        }
        case "detail": {
            return Number.POSITIVE_INFINITY;
        }
    }
}

function readHierarchyDepth(
    nodeId: string,
    parentMap: ReadonlyMap<string, string>,
    depthByNodeId: Map<string, number>,
    visitingNodeIds: Set<string>
): number {
    const cachedDepth = depthByNodeId.get(nodeId);
    if (cachedDepth !== undefined) {
        return cachedDepth;
    }

    const parentId = parentMap.get(nodeId);
    if (!parentId || visitingNodeIds.has(nodeId)) {
        depthByNodeId.set(nodeId, 0);
        return 0;
    }

    visitingNodeIds.add(nodeId);
    const depth = readHierarchyDepth(parentId, parentMap, depthByNodeId, visitingNodeIds) + 1;
    visitingNodeIds.delete(nodeId);
    depthByNodeId.set(nodeId, depth);
    return depth;
}

function buildHierarchyDepths(
    nodes: ReadonlyArray<GraphLayoutNode>,
    parentMap: ReadonlyMap<string, string>
): Map<string, number> {
    const depthByNodeId = new Map<string, number>();
    for (const node of nodes) {
        readHierarchyDepth(node.id, parentMap, depthByNodeId, new Set<string>());
    }

    return depthByNodeId;
}

function isHierarchyDescendantOrSelf(
    nodeId: string,
    ancestorId: string,
    parentMap: ReadonlyMap<string, string>
): boolean {
    let currentNodeId: string | undefined = nodeId;
    const visitedNodeIds = new Set<string>();

    while (currentNodeId && !visitedNodeIds.has(currentNodeId)) {
        if (currentNodeId === ancestorId) {
            return true;
        }

        visitedNodeIds.add(currentNodeId);
        currentNodeId = parentMap.get(currentNodeId);
    }

    return false;
}

function addVisibleAncestors(
    nodeId: string,
    parentMap: ReadonlyMap<string, string>,
    displayNodeIds: ReadonlySet<string>,
    projectedNodeIds: Set<string>
): void {
    let currentNodeId: string | undefined = nodeId;
    const visitedNodeIds = new Set<string>();

    while (currentNodeId && !visitedNodeIds.has(currentNodeId)) {
        visitedNodeIds.add(currentNodeId);
        if (displayNodeIds.has(currentNodeId)) {
            projectedNodeIds.add(currentNodeId);
        }
        currentNodeId = parentMap.get(currentNodeId);
    }
}

function collectProjectedNodeIds(parameters: {
    depthByNodeId: ReadonlyMap<string, number>;
    displayLayout: GraphLayout;
    focusNodeId: string | null;
    level: GraphSemanticZoomLevel;
    parentMap: ReadonlyMap<string, string>;
}): Set<string> {
    const { depthByNodeId, displayLayout, focusNodeId, level, parentMap } = parameters;
    const displayNodeIds = new Set(displayLayout.nodes.map((node) => node.id));
    const projectedNodeIds = new Set<string>();
    const usableFocusNodeId = focusNodeId && displayNodeIds.has(focusNodeId) ? focusNodeId : null;

    if (!usableFocusNodeId) {
        const maxDepth = readMaxHierarchyDepth(level);
        for (const node of displayLayout.nodes) {
            if (node.kind === "project" || (depthByNodeId.get(node.id) ?? 0) <= maxDepth) {
                projectedNodeIds.add(node.id);
            }
        }
        return projectedNodeIds;
    }

    const focusDepth = depthByNodeId.get(usableFocusNodeId) ?? 0;
    const descendantDepth = readFocusDescendantDepth(level);

    for (const node of displayLayout.nodes) {
        const nodeDepth = depthByNodeId.get(node.id) ?? 0;
        if (node.kind === "project" || nodeDepth <= OVERVIEW_MAX_DEPTH) {
            projectedNodeIds.add(node.id);
            continue;
        }

        if (
            isHierarchyDescendantOrSelf(node.id, usableFocusNodeId, parentMap) &&
            nodeDepth - focusDepth <= descendantDepth
        ) {
            projectedNodeIds.add(node.id);
        }
    }

    addVisibleAncestors(usableFocusNodeId, parentMap, displayNodeIds, projectedNodeIds);
    return projectedNodeIds;
}

function findProjectedRepresentativeId(
    nodeId: string,
    parentMap: ReadonlyMap<string, string>,
    projectedNodeIds: ReadonlySet<string>
): string | null {
    let currentNodeId: string | undefined = nodeId;
    const visitedNodeIds = new Set<string>();

    while (currentNodeId && !visitedNodeIds.has(currentNodeId)) {
        if (projectedNodeIds.has(currentNodeId)) {
            return currentNodeId;
        }

        visitedNodeIds.add(currentNodeId);
        currentNodeId = parentMap.get(currentNodeId);
    }

    return null;
}

function aggregateProjectedEdges(
    displayLayout: GraphLayout,
    parentMap: ReadonlyMap<string, string>,
    projectedNodes: ReadonlyArray<GraphLayoutNode>,
    projectedNodeIds: ReadonlySet<string>
): ReadonlyArray<GraphSemanticZoomEdge> {
    const projectedNodeById = new Map(projectedNodes.map((node) => [node.id, node]));
    const edgeByKey = new Map<string, GraphSemanticZoomEdge>();

    for (const edge of displayLayout.edges) {
        const sourceId = findProjectedRepresentativeId(edge.sourceNode.id, parentMap, projectedNodeIds);
        const targetId = findProjectedRepresentativeId(edge.targetNode.id, parentMap, projectedNodeIds);
        if (!sourceId || !targetId || sourceId === targetId) {
            continue;
        }

        const sourceNode = projectedNodeById.get(sourceId);
        const targetNode = projectedNodeById.get(targetId);
        if (!sourceNode || !targetNode) {
            continue;
        }

        const edgeKey = `${sourceId}\u0000${targetId}\u0000${edge.type}`;
        const existingEdge = edgeByKey.get(edgeKey);
        if (existingEdge) {
            edgeByKey.set(edgeKey, { ...existingEdge, aggregateCount: existingEdge.aggregateCount + 1 });
            continue;
        }

        edgeByKey.set(edgeKey, {
            ...edge,
            aggregateCount: 1,
            source: sourceId,
            sourceNode,
            target: targetId,
            targetNode
        });
    }

    return [...edgeByKey.values()];
}

/**
 * Project the filtered graph into a semantic level-of-detail view. Hidden
 * descendants collapse into their nearest visible hierarchy ancestor and
 * duplicate relationships are bundled into one edge with an aggregate count.
 */
export function projectGraphLayoutForSemanticZoom(parameters: {
    displayLayout: GraphLayout;
    focusNodeId: string | null;
    sourceLayout: GraphLayout;
    zoomScale: number;
}): GraphSemanticZoomLayout {
    const { displayLayout, focusNodeId, sourceLayout, zoomScale } = parameters;
    const hierarchy = buildGraphHierarchy(sourceLayout.nodes, sourceLayout.edges);
    const depthByNodeId = buildHierarchyDepths(sourceLayout.nodes, hierarchy.parentMap);
    const level = resolveGraphSemanticZoomLevel(zoomScale);
    const projectedNodeIds = collectProjectedNodeIds({
        depthByNodeId,
        displayLayout,
        focusNodeId,
        level,
        parentMap: hierarchy.parentMap
    });
    const projectedNodes = displayLayout.nodes.filter((node) => projectedNodeIds.has(node.id));

    return Object.freeze({
        edges: aggregateProjectedEdges(displayLayout, hierarchy.parentMap, projectedNodes, projectedNodeIds),
        nodes: projectedNodes
    });
}
