import {
    buildGraphHierarchy,
    PROMOTABLE_HIERARCHY_EDGE_TYPES,
    seedInitialGraphPositions
} from "./graph-layout-hierarchy.js";
import {
    applyForceDirectedRefinement,
    centerSimulationNodes,
    countGraphNodeConnections,
    createSimulationNodes,
    resolveOverlappingSimulationNodes,
    type SimulationNode
} from "./graph-layout-simulation.js";
import type {
    GraphVisualizationEdgeRecord,
    GraphVisualizationEdgeType,
    GraphVisualizationNodeKind,
    GraphVisualizationNodeRecord
} from "./types.js";

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

export type GraphNodeKindLegendItem = Readonly<{
    children: ReadonlyArray<GraphNodeKindLegendItem>;
    kind: GraphLegendNodeKind;
    level: number;
}>;

export type GraphLegendNodeKind = GraphVisualizationNodeKind | "resource";

const GRAPH_NODE_KIND_LEGEND_CATALOG: ReadonlyArray<GraphVisualizationNodeKind> = Object.freeze([
    "anim_curve",
    "data_file",
    "enum",
    "enum_member",
    "extension",
    "font",
    "folder",
    "function",
    "global_variable",
    "instance_variable",
    "local_variable",
    "macro",
    "note",
    "object",
    "object_event",
    "particle_system",
    "path",
    "room",
    "room_layer",
    "room_instance",
    "script",
    "sequence",
    "shader",
    "sound",
    "sprite",
    "struct",
    "struct_variable",
    "texture_group",
    "tileset",
    "timeline"
]);
const RESOURCE_CHILD_NODE_KINDS: ReadonlyArray<GraphVisualizationNodeKind> = Object.freeze([
    "anim_curve",
    "data_file",
    "extension",
    "font",
    "folder",
    "note",
    "object",
    "particle_system",
    "path",
    "room",
    "script",
    "sequence",
    "shader",
    "sound",
    "sprite",
    "texture_group",
    "tileset",
    "timeline"
]);
const LEGEND_PARENT_KIND_BY_CHILD_KIND = new Map<GraphVisualizationNodeKind, GraphLegendNodeKind>([
    ...RESOURCE_CHILD_NODE_KINDS.map((kind) => [kind, "resource"] as const),
    ["enum_member", "enum"],
    ["instance_variable", "object"],
    ["object_event", "object"],
    ["room_layer", "room"],
    ["room_instance", "room_layer"],
    ["struct_variable", "struct"]
]);

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
    resolveOverlappingSimulationNodes(simNodes);
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
): ReadonlyArray<GraphLegendNodeKind> {
    const presentKinds = new Set(nodes.map((node) => node.kind));
    const catalogKinds = new Set<GraphLegendNodeKind>(["resource", ...GRAPH_NODE_KIND_LEGEND_CATALOG]);

    for (const kind of presentKinds) {
        if (kind !== "project" && kind !== "file") {
            catalogKinds.add(kind);
        }
    }

    return Array.from(catalogKinds).toSorted();
}

function createLegendItem(
    kind: GraphLegendNodeKind,
    childrenByKind: ReadonlyMap<GraphLegendNodeKind, ReadonlyArray<GraphLegendNodeKind>>,
    level: number
): GraphNodeKindLegendItem {
    return Object.freeze({
        children: (childrenByKind.get(kind) ?? []).map((childKind) =>
            createLegendItem(childKind, childrenByKind, level + 1)
        ),
        kind,
        level
    });
}

/**
 * Group graph node kinds into the same parent/child concepts used by graph containment.
 */
export function listGraphNodeKindLegendItems(
    nodes: ReadonlyArray<GraphVisualizationNodeRecord>
): ReadonlyArray<GraphNodeKindLegendItem> {
    const nodeKinds = new Set(listGraphNodeKinds(nodes));
    const childrenByKind = new Map<GraphLegendNodeKind, Array<GraphLegendNodeKind>>();
    const rootKinds = new Set<GraphLegendNodeKind>();

    for (const kind of nodeKinds) {
        if (kind === "resource") {
            rootKinds.add(kind);
            continue;
        }

        const parentKind = LEGEND_PARENT_KIND_BY_CHILD_KIND.get(kind) ?? null;
        if (parentKind && nodeKinds.has(parentKind)) {
            const children = childrenByKind.get(parentKind) ?? [];
            children.push(kind);
            childrenByKind.set(parentKind, children);
        } else {
            rootKinds.add(kind);
        }
    }

    for (const children of childrenByKind.values()) {
        children.sort();
    }

    return [...rootKinds].toSorted().map((kind) => createLegendItem(kind, childrenByKind, 0));
}

function collectDisabledAncestorKinds(
    kind: GraphVisualizationNodeKind,
    availableNodeKinds: ReadonlySet<GraphLegendNodeKind>,
    enabledNodeKinds: ReadonlySet<GraphLegendNodeKind>
): ReadonlyArray<GraphLegendNodeKind> {
    const disabledAncestors: Array<GraphLegendNodeKind> = [];
    let currentKind: GraphLegendNodeKind = kind;

    while (true) {
        if (currentKind === "resource") {
            return disabledAncestors;
        }

        const parentKind = LEGEND_PARENT_KIND_BY_CHILD_KIND.get(currentKind);
        if (!parentKind || !availableNodeKinds.has(parentKind)) {
            return disabledAncestors;
        }

        if (!enabledNodeKinds.has(parentKind)) {
            disabledAncestors.push(parentKind);
        }

        currentKind = parentKind;
    }
}

/**
 * Apply legend parent overrides while preserving each child kind's own toggle state.
 */
export function resolveEffectiveGraphNodeKinds(
    nodes: ReadonlyArray<GraphVisualizationNodeRecord>,
    enabledNodeKinds: ReadonlySet<GraphLegendNodeKind>
): ReadonlySet<GraphVisualizationNodeKind> {
    const availableNodeKinds = new Set(listGraphNodeKinds(nodes));
    const effectiveNodeKinds = new Set<GraphVisualizationNodeKind>();

    for (const kind of GRAPH_NODE_KIND_LEGEND_CATALOG) {
        if (!availableNodeKinds.has(kind)) {
            continue;
        }
        const disabledAncestorKinds = collectDisabledAncestorKinds(kind, availableNodeKinds, enabledNodeKinds);
        if (enabledNodeKinds.has(kind) && disabledAncestorKinds.length === 0) {
            effectiveNodeKinds.add(kind);
        }
    }

    return effectiveNodeKinds;
}

/**
 * Group graph edge types for legend display.
 */
export function listGraphEdgeTypes(
    edges: ReadonlyArray<GraphVisualizationEdgeRecord>
): ReadonlyArray<GraphVisualizationEdgeType> {
    return Array.from(new Set(edges.map((edge) => edge.type))).toSorted();
}
