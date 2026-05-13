/**
 * Supported graph scopes that can be rendered in the graph-index UI.
 */
export type GraphVisualizationScope = "project" | "toolset";

/**
 * MCP server connection status for the local GMLoop MCP server.
 */
export type GraphVisualizationMcpServerStatus = "not-started" | "running" | "stopped";

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
    filePath: string | null;
    graphId: GraphVisualizationScope;
    id: string;
    kind: GraphVisualizationNodeKind;
    name: string;
    resourcePath: string | null;
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
    documentationCatalogs?: GraphVisualizationDocumentationCatalogs;
    isServerMode?: boolean;
    loadedTarget?: GraphVisualizationLoadedTarget;
    mcpServerStatus?: GraphVisualizationMcpServerStatus;
    projectConfigurationCatalog?: GraphVisualizationProjectConfigurationCatalog;
    title: string;
}>;

/**
 * A single file emitted by the graph visualization renderer bundle.
 */
export type GraphVisualizationBundleFile = Readonly<{
    bytes: Uint8Array;
    contentType: string;
    relativePath: string;
}>;

/**
 * Filesystem-ready artifact returned by the graph visualization bundle renderer.
 */
export type GraphVisualizationBundleArtifact = Readonly<{
    entryHtmlPath: string;
    files: ReadonlyArray<GraphVisualizationBundleFile>;
}>;

/**
 * Summary of the current path input selection loaded by the UI host.
 */
export type GraphVisualizationLoadedTarget = Readonly<{
    activePath: string;
    projectRoot: string;
    selectedPaths: ReadonlyArray<string>;
    source: "cli-path" | "finder-open" | "working-directory";
}>;

export type GraphVisualizationCliCatalogArgument = Readonly<{
    choices: ReadonlyArray<string>;
    description: string;
    name: string;
    required: boolean;
    variadic: boolean;
}>;

export type GraphVisualizationCliCatalogOption = Readonly<{
    attributeName: string;
    boolean: boolean;
    choices: ReadonlyArray<string>;
    description: string;
    flags: string;
    long: string | undefined;
    short: string | undefined;
    variadic: boolean;
}>;

export type GraphVisualizationCliCatalogEntry = Readonly<{
    arguments: ReadonlyArray<GraphVisualizationCliCatalogArgument>;
    commandPath: ReadonlyArray<string>;
    description: string;
    displayName: string;
    options: ReadonlyArray<GraphVisualizationCliCatalogOption>;
    usage: string;
}>;

export type GraphVisualizationMcpToolCatalogField = Readonly<{
    attributeName: string;
    choices: ReadonlyArray<string>;
    description: string;
    kind: "argument" | "option";
    multiple: boolean;
    name: string;
    required: boolean;
    valueType: "boolean" | "string";
}>;

export type GraphVisualizationMcpToolCatalogEntry = Readonly<{
    commandDisplayName: string;
    description: string;
    fields: ReadonlyArray<GraphVisualizationMcpToolCatalogField>;
    toolName: string;
}>;

export type GraphVisualizationDocumentationCatalogs = Readonly<{
    cliCommands: ReadonlyArray<GraphVisualizationCliCatalogEntry>;
    mcpServer: Readonly<{
        name: string;
        version: string;
    }>;
    mcpTools: ReadonlyArray<GraphVisualizationMcpToolCatalogEntry>;
    workspaceRules: Readonly<{
        formatOptions: ReadonlyArray<
            Readonly<{
                defaultValue: boolean | number | string;
                description: string;
                name: string;
            }>
        >;
        lintRules: ReadonlyArray<
            Readonly<{
                description: string;
                fixable: "code" | "whitespace" | null;
                ruleId: string;
            }>
        >;
        refactorCodemods: ReadonlyArray<
            Readonly<{
                description: string;
                id: string;
                requiresSemanticProjectIndex: boolean;
            }>
        >;
    }>;
}>;

export type GraphVisualizationProjectConfigurationEntry = Readonly<{
    description: string;
    name: string;
    source: "configured" | "default";
    value: unknown;
}>;

export type GraphVisualizationProjectConfigurationLintRuleEntry = Readonly<{
    description: string;
    fixable: "code" | "whitespace" | null;
    level: string;
    options: Readonly<Record<string, unknown>>;
    ruleId: string;
}>;

export type GraphVisualizationProjectConfigurationRefactorCodemodEntry = Readonly<{
    config: unknown;
    description: string;
    enabled: boolean;
    id: string;
    requiresSemanticProjectIndex: boolean;
}>;

export type GraphVisualizationProjectConfigurationCatalog = Readonly<{
    format: Readonly<{
        entries: ReadonlyArray<GraphVisualizationProjectConfigurationEntry>;
    }>;
    githubRepositoryUrl: string;
    gmloop: Readonly<{
        configPath: string | null;
        exists: boolean;
        projectRoot: string;
        rawConfig: Readonly<Record<string, unknown>>;
    }>;
    lint: Readonly<{
        rules: ReadonlyArray<GraphVisualizationProjectConfigurationLintRuleEntry>;
        ruleset: string | null;
    }>;
    refactor: Readonly<{
        codemods: ReadonlyArray<GraphVisualizationProjectConfigurationRefactorCodemodEntry>;
    }>;
}>;
