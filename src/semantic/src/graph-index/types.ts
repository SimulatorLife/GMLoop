export type GraphIndexScope = "project" | "toolset";

export type GraphEmbeddingsConfig = Readonly<{
    dimensions: number;
    enabled: boolean;
    modelCacheDir: string;
    provider: string;
}>;

export type GraphDatabaseRuntimeInfo = Readonly<{
    busyTimeoutMs: number;
    driver: "node:sqlite";
    foreignKeysEnabled: boolean;
    journalMode: string;
    runtimeStability: "stable";
    synchronousMode: string;
}>;

export type GraphDatabaseIntegrityStatus = Readonly<{
    foreignKeyViolationCount: number;
    ok: boolean;
    quickCheckResult: string;
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
    | "room_layer"
    | "script"
    | "sequence"
    | "shader"
    | "sound"
    | "sprite"
    | "struct"
    | "struct_variable"
    | "tileset"
    | "timeline";

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
    displayName: string;
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

export type GraphUsageRecord = Readonly<{
    edgeType: GraphEdgeType;
    from: GraphNodeRecord;
    location: Readonly<{
        lineEnd: number | null;
        lineStart: number | null;
    }>;
    to: GraphNodeRecord;
}>;

export type GraphNeighborRecord = Readonly<{
    direction: "incoming" | "outgoing";
    edgeType: GraphEdgeType;
    node: GraphNodeRecord;
}>;

export type GraphSearchResult = Readonly<{
    displayName: string;
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

/** Payload embedded in the visualization HTML as inline JSON. */
export type GraphVisualizationData = Readonly<{
    generatedAt: string;
    graphs: ReadonlyArray<
        Readonly<{
            edgeCount: number;
            graphId: GraphIndexScope;
            nodeCount: number;
            rootPath: string;
        }>
    >;
    edges: ReadonlyArray<
        Readonly<{
            source: string;
            target: string;
            type: GraphEdgeType;
        }>
    >;
    nodes: ReadonlyArray<
        Readonly<{
            displayName: string;
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
        }>
    >;
    projectRoot: string;
}>;

export type GraphDoctorIssue = Readonly<{
    code: string;
    message: string;
    severity: "error" | "warning";
}>;

export type GraphDoctorGraphStatus = Readonly<{
    edgeCount: number;
    embeddingCount: number;
    fileCount: number;
    graphId: GraphIndexScope;
    nodeCount: number;
    rootPath: string;
    staleFileCount: number;
}>;

export type GraphDoctorReport = Readonly<{
    databasePath: string;
    graphs: ReadonlyArray<GraphDoctorGraphStatus>;
    integrity: GraphDatabaseIntegrityStatus | null;
    issues: ReadonlyArray<GraphDoctorIssue>;
    runtime: GraphDatabaseRuntimeInfo | null;
}>;

export type GraphIndexHandle = Readonly<{
    close: () => void;
    config: GraphIndexConfig;
    doctor: () => GraphDoctorReport;
    getContext: (nodeId: string, depth?: number) => GraphContextBundle | null;
    getNeighbors: (nodeId: string, depth?: number) => ReadonlyArray<GraphNeighborRecord>;
    getNode: (nodeId: string) => GraphNodeRecord | null;
    getUsages: (nodeId: string, depth?: number) => ReadonlyArray<GraphUsageRecord>;
    search: (query: string, limit?: number) => GraphSearchResponse;
}>;

export type GraphIndexBuildResult = Readonly<{
    config: GraphIndexConfig;
    databasePath: string;
    graphIds: ReadonlyArray<GraphIndexScope>;
}>;
