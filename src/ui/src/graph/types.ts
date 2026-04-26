/**
 * Supported graph scopes that can be rendered in the graph-index UI.
 */
export type GraphVisualizationScope = "project" | "toolset";

/**
 * Node kinds rendered by the graph-index visualization UI.
 */
export type GraphVisualizationNodeKind =
    | "anim_curve"
    | "constructor"
    | "data_file"
    | "enum"
    | "enum_member"
    | "extension"
    | "file"
    | "font"
    | "function"
    | "global_variable"
    | "instance_variable"
    | "local_variable"
    | "macro"
    | "note"
    | "object"
    | "object_event"
    | "particle_system"
    | "path"
    | "project"
    | "resource"
    | "room"
    | "script"
    | "sequence"
    | "shader"
    | "sound"
    | "sprite"
    | "struct"
    | "struct_variable"
    | "tileset"
    | "timeline";

/**
 * Edge kinds rendered by the graph-index visualization UI.
 */
export type GraphVisualizationEdgeType =
    | "calls"
    | "contains"
    | "defines"
    | "depends_on"
    | "inherits"
    | "placed_in_room"
    | "references"
    | "uses_toolset";

/**
 * Graph metadata embedded into the graph-index visualization document.
 */
export type GraphVisualizationGraphRecord = Readonly<{
    edgeCount: number;
    graphId: GraphVisualizationScope;
    nodeCount: number;
    rootPath: string;
}>;

/**
 * Edge record embedded into the graph-index visualization document.
 */
export type GraphVisualizationEdgeRecord = Readonly<{
    source: string;
    target: string;
    type: GraphVisualizationEdgeType;
}>;

/**
 * Node record embedded into the graph-index visualization document.
 */
export type GraphVisualizationNodeRecord = Readonly<{
    displayName: string;
    graphId: GraphVisualizationScope;
    id: string;
    kind: GraphVisualizationNodeKind;
    name: string;
    snippet: string;
    summary: string;
}>;

/**
 * Typed graph payload consumed by the graph-index visualization renderer.
 */
export type GraphVisualizationData = Readonly<{
    edges: ReadonlyArray<GraphVisualizationEdgeRecord>;
    generatedAt: string;
    graphs: ReadonlyArray<GraphVisualizationGraphRecord>;
    nodes: ReadonlyArray<GraphVisualizationNodeRecord>;
    projectRoot: string;
}>;

/**
 * Options that control how the graph-index visualization HTML document is rendered.
 */
export type GraphVisualizationRenderOptions = Readonly<{
    isServerMode?: boolean;
    title: string;
}>;
