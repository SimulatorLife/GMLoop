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
                summary,
                snippet
            FROM nodes
        `
        )
        .all() as unknown as ReadonlyArray<{
        displayName: string;
        graphId: string;
        id: string;
        kind: string;
        name: string;
        snippet: string;
        summary: string;
    }>;

    const nodes = nodesResult.map(
        (n) =>
            ({
                displayName: n.displayName,
                graphId: n.graphId as GraphIndexScope,
                id: n.id,
                kind: n.kind as GraphNodeKind,
                name: n.name,
                snippet: n.snippet,
                summary: n.summary
            }) as const
    );

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

    const edges = edgesResult.map(
        (e) =>
            ({
                source: e.source,
                target: e.target,
                type: e.type as GraphEdgeType
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
