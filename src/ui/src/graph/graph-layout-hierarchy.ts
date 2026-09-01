import type {
    GraphVisualizationEdgeRecord,
    GraphVisualizationEdgeType,
    GraphVisualizationNodeRecord
} from "./types.js";

const ROOT_HIERARCHY_RADIUS = 320;
const SECOND_LEVEL_HIERARCHY_RADIUS = 150;
const DEEP_HIERARCHY_RADIUS = 95;

export const PROMOTABLE_HIERARCHY_EDGE_TYPES = new Set<GraphVisualizationEdgeType>(["contains", "defines"]);

export type GraphHierarchy = Readonly<{
    childrenMap: Map<string, Array<string>>;
    parentMap: Map<string, string>;
    projectNodes: ReadonlyArray<GraphVisualizationNodeRecord>;
}>;

export type InitialGraphPosition = Readonly<{
    angle: number;
    x: number;
    y: number;
}>;

export function buildGraphHierarchy(
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

export function seedInitialGraphPositions(
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

    const radius =
        depth === 1 ? ROOT_HIERARCHY_RADIUS : depth === 2 ? SECOND_LEVEL_HIERARCHY_RADIUS : DEEP_HIERARCHY_RADIUS;
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
