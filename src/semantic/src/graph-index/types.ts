export type GraphIndexScope = "project" | "toolset";

export type GraphEmbeddingsConfig = Readonly<{
    dimensions: number;
    enabled: boolean;
    modelCacheDir: string;
    provider: string;
}>;

export type GraphIndexConfig = Readonly<{
    databasePath: string;
    embeddings: GraphEmbeddingsConfig;
    projectRoot: string;
    toolsetRoot: string | null;
}>;

export type GraphIndexBuildOptions = Readonly<{
    databasePath?: string | null;
    rebuild?: boolean;
    projectConfig?: Record<string, unknown> | null;
    projectRoot: string;
    toolsetRoot?: string | null;
}>;

export type GraphNodeKind =
    | "constructor"
    | "enum"
    | "enum_member"
    | "file"
    | "global_variable"
    | "instance_variable"
    | "macro"
    | "object"
    | "object_event"
    | "resource"
    | "room"
    | "script"
    | "shader"
    | "sprite"
    | "struct";

export type GraphEdgeType =
    | "calls"
    | "contains"
    | "defines"
    | "depends_on"
    | "inherits"
    | "placed_in_room"
    | "references"
    | "uses_toolset";

export type GraphNodeRecord = Readonly<{
    filePath: string | null;
    graphId: GraphIndexScope;
    id: string;
    kind: GraphNodeKind;
    lineEnd: number | null;
    lineStart: number | null;
    name: string;
    resourcePath: string | null;
    scopeId: string | null;
    scipSymbol: string | null;
    snippet: string;
    summary: string;
}>;

export type GraphEdgeRecord = Readonly<{
    fromId: string;
    toId: string;
    type: GraphEdgeType;
}>;

export type GraphNeighborRecord = Readonly<{
    direction: "incoming" | "outgoing";
    edgeType: GraphEdgeType;
    node: GraphNodeRecord;
}>;

export type GraphSearchResult = Readonly<{
    graphId: GraphIndexScope;
    id: string;
    kind: GraphNodeKind;
    name: string;
    score: number;
    snippet: string;
    summary: string;
}>;

export type GraphSearchResponse = Readonly<{
    query: string;
    results: ReadonlyArray<GraphSearchResult>;
}>;

export type GraphContextBundle = Readonly<{
    neighbors: Readonly<{
        calledBy: ReadonlyArray<GraphNodeRecord>;
        calls: ReadonlyArray<GraphNodeRecord>;
        references: ReadonlyArray<GraphNodeRecord>;
        relatedResources: ReadonlyArray<GraphNodeRecord>;
        toolsetDependencies: ReadonlyArray<GraphNodeRecord>;
    }>;
    summary: string;
    target: GraphNodeRecord;
}>;

export type GraphDoctorIssue = Readonly<{
    code: string;
    message: string;
    severity: "error" | "warning";
}>;

export type GraphDoctorGraphStatus = Readonly<{
    fileCount: number;
    graphId: GraphIndexScope;
    nodeCount: number;
    rootPath: string;
}>;

export type GraphDoctorReport = Readonly<{
    databasePath: string;
    graphs: ReadonlyArray<GraphDoctorGraphStatus>;
    issues: ReadonlyArray<GraphDoctorIssue>;
}>;

export type GraphIndexHandle = Readonly<{
    close: () => void;
    config: GraphIndexConfig;
}>;

export type GraphIndexBuildResult = Readonly<{
    config: GraphIndexConfig;
    databasePath: string;
    graphIds: ReadonlyArray<GraphIndexScope>;
}>;
