import type { GraphDatabase } from "./sqlite-adapter.js";
import type { GraphEdgeType, GraphIndexScope, GraphNodeKind, GraphVisualizationData } from "./types.js";

/**
 * Export all nodes and edges from the graph database into a visualization-ready JSON payload.
 * Excludes large fields like vectors to minimize the payload size.
 */
export function exportGraphVisualizationData(database: GraphDatabase, projectRoot: string): GraphVisualizationData {
    // 1. Fetch graphs
    const graphsResult = database
        .prepare(
            `
            SELECT
                i.graph_id as graphId,
                i.node_count as nodeCount,
                i.edge_count as edgeCount,
                g.root_path as rootPath
            FROM index_state i
            JOIN graphs g ON i.graph_id = g.id
            ORDER BY i.graph_id ASC
        `
        )
        .all() as unknown as ReadonlyArray<{
        edgeCount: number;
        graphId: string;
        nodeCount: number;
        rootPath: string;
    }>;

    const graphs = graphsResult.map(
        (g) =>
            ({
                edgeCount: g.edgeCount,
                graphId: g.graphId as GraphIndexScope,
                nodeCount: g.nodeCount,
                rootPath: g.rootPath
            }) as const
    );

    // 2. Fetch nodes
    const nodesResult = database
        .prepare(
            `
            SELECT
                id,
                graph_id as graphId,
                kind,
                name,
                display_name as displayName,
                line_start as lineStart,
                line_end as lineEnd,
                relative_path as filePath,
                resource_path as resourcePath,
                scope_id as scopeId,
                scip_symbol as scipSymbol,
                summary,
                snippet
            FROM nodes
            WHERE kind NOT IN ('file', 'resource')
              AND (resource_path IS NULL OR resource_path NOT LIKE 'options/%')
              AND (relative_path IS NULL OR relative_path NOT LIKE '%.yy' AND relative_path NOT LIKE '%.yyp')
        `
        )
        .all() as unknown as ReadonlyArray<{
        displayName: string;
        filePath: string | null;
        graphId: string;
        id: string;
        kind: string;
        lineEnd: number | null;
        lineStart: number | null;
        name: string;
        resourcePath: string | null;
        scopeId: string | null;
        scipSymbol: string | null;
        snippet: string;
        summary: string;
    }>;

    const nodes = nodesResult.map(
        (n) =>
            ({
                displayName: n.displayName,
                filePath: n.filePath,
                graphId: n.graphId as GraphIndexScope,
                id: n.id,
                kind: n.kind as GraphNodeKind,
                lineEnd: n.lineEnd,
                lineStart: n.lineStart,
                name: n.name,
                resourcePath: n.resourcePath,
                scopeId: n.scopeId,
                scipSymbol: n.scipSymbol,
                snippet: n.snippet,
                summary: n.summary
            }) as const
    );
    const exportedNodeIds = new Set(nodes.map((node) => node.id));

    // 3. Fetch edges
    const edgesResult = database
        .prepare(
            `
            SELECT
                from_id as source,
                to_id as target,
                type
            FROM edges
        `
        )
        .all() as unknown as ReadonlyArray<{
        source: string;
        target: string;
        type: string;
    }>;

    const edges = edgesResult
        .filter((edge) => exportedNodeIds.has(edge.source) && exportedNodeIds.has(edge.target))
        .map(
            (edge) =>
                ({
                    source: edge.source,
                    target: edge.target,
                    type: edge.type as GraphEdgeType
                }) as const
        );

    return {
        edges,
        generatedAt: new Date().toISOString(),
        graphs,
        nodes,
        projectRoot
    };
}
