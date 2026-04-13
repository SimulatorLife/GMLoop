import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

import { Core } from "@gmloop/core";

import { buildProjectIndex } from "../project-index/index.js";
import { resolveGraphIndexConfig } from "./config.js";
import {
    GRAPH_INDEX_SCHEMA_VERSION,
    openExistingGraphIndexDatabase,
    openGraphIndexDatabase,
    readGraphIndexSchemaVersion,
    resetGraphIndexDatabase
} from "./database.js";
import {
    cosineSimilarity,
    createGraphEmbeddingProvider,
    deserializeEmbeddingVector,
    ensureGraphEmbeddingModelAssets,
    serializeEmbeddingVector
} from "./embeddings.js";
import {
    createGraphAliases,
    createGraphNodeSnippet,
    createGraphNodeSummary,
    extractDocCommentFirstSentence
} from "./summary.js";
import type {
    GraphContextBundle,
    GraphDoctorGraphStatus,
    GraphDoctorIssue,
    GraphDoctorReport,
    GraphEdgeRecord,
    GraphEdgeType,
    GraphEmbeddingsConfig,
    GraphIndexBuildOptions,
    GraphIndexBuildResult,
    GraphIndexHandle,
    GraphIndexScope,
    GraphNeighborRecord,
    GraphNodeKind,
    GraphNodeRecord,
    GraphSearchResponse,
    GraphSearchResult,
    GraphUsageRecord
} from "./types.js";

type ProjectIndexIdentifierEntry = {
    declarations?: Array<Record<string, unknown>>;
    displayName?: string;
    filePath?: string;
    id?: string;
    identifierId?: string;
    name?: string;
    references?: Array<Record<string, unknown>>;
    resourcePath?: string;
    scopeId?: string;
};

type ProjectIndexSnapshot = {
    files?: Record<
        string,
        {
            scopeId?: string | null;
            scriptCalls?: Array<{
                isResolved?: boolean;
                location?: { start?: Record<string, unknown>; end?: Record<string, unknown> };
                target?: { name?: string; resourcePath?: string | null; scopeId?: string | null };
            }>;
        }
    >;
    identifiers?: Record<string, Record<string, ProjectIndexIdentifierEntry>>;
    relationships?: {
        assetReferences?: Array<{ fromResourcePath?: string; targetPath?: string }>;
    };
    resources?: Record<string, { gmlFiles?: Array<string>; name?: string; path?: string; resourceType?: string }>;
    scopes?: Record<
        string,
        {
            displayName?: string | null;
            filePaths?: Array<string>;
            id?: string;
            kind?: string;
            name?: string | null;
            resourcePath?: string | null;
        }
    >;
};

type ProjectionContext = {
    database: DatabaseSync;
    edgeRecords: Array<GraphEdgeRecord>;
    graphId: GraphIndexScope;
    nodeIdsByName: Map<string, Set<string>>;
    nodeIdsByScipSymbol: Map<string, string>;
    nodeIdsByScopeId: Map<string, string>;
    nodeRecords: Array<GraphNodeRecord>;
    projectIndex: ProjectIndexSnapshot;
    rootPath: string;
};

type GraphLookupRow = {
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
};

function hashContent(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
    return Core.isObjectLike(value) ? (value as Record<string, unknown>) : {};
}

function getString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readLocationLine(location: Record<string, unknown> | null): number | null {
    return getNumber(location?.line);
}

function readLocationIndex(location: Record<string, unknown> | null): number | null {
    return getNumber(location?.index);
}

function readFirstDeclaration(entry: ProjectIndexIdentifierEntry): Record<string, unknown> | null {
    const declarations = Array.isArray(entry.declarations) ? entry.declarations : [];
    return declarations.length > 0 && Core.isObjectLike(declarations[0]) ? declarations[0] : null;
}

function resolveScipSymbol(kind: GraphNodeKind, name: string, entry: ProjectIndexIdentifierEntry): string {
    const identifierId = getString(entry.identifierId);
    if (identifierId?.startsWith("gml/")) {
        return identifierId;
    }

    switch (kind) {
        case "macro": {
            return `gml/macro/${name}`;
        }
        case "enum": {
            return `gml/enum/${name}`;
        }
        case "enum_member": {
            return `gml/enum-member/${name}`;
        }
        case "global_variable": {
            return `gml/var/global::${name}`;
        }
        case "instance_variable": {
            return `gml/var/${name}`;
        }
        case "constructor":
        case "file":
        case "object":
        case "object_event":
        case "resource":
        case "room":
        case "script":
        case "shader":
        case "sprite":
        case "struct": {
            return `gml/script/${name}`;
        }
    }
}

function createGraphNodeId(graphId: GraphIndexScope, category: "file" | "resource" | "symbol", value: string): string {
    if (category === "symbol") {
        return `${graphId}::${value}`;
    }

    return `${graphId}::${category}::${value}`;
}

function addNameIndexEntry(context: ProjectionContext, name: string, nodeId: string): void {
    const normalizedName = name.toLowerCase();
    const entries = Core.getOrCreateMapEntry(context.nodeIdsByName, normalizedName, () => new Set<string>());
    entries.add(nodeId);
}

function lookupUniqueNodeByNameAndKind(context: ProjectionContext, name: string, kind: GraphNodeKind): string | null {
    const candidateIds = context.nodeIdsByName.get(name.toLowerCase());
    if (!candidateIds) {
        return null;
    }

    const matchingIds = [...candidateIds].filter((nodeId) =>
        context.nodeRecords.some((node) => node.id === nodeId && node.kind === kind)
    );

    return matchingIds.length === 1 ? matchingIds[0] : null;
}

function hasNodeNameAndKind(context: ProjectionContext, name: string, kind: GraphNodeKind): boolean {
    const candidateIds = context.nodeIdsByName.get(name.toLowerCase());
    if (!candidateIds) {
        return false;
    }

    return [...candidateIds].some((nodeId) =>
        context.nodeRecords.some((node) => node.id === nodeId && node.kind === kind)
    );
}

function registerNodeIndexes(context: ProjectionContext, node: GraphNodeRecord): void {
    addNameIndexEntry(context, node.name, node.id);
    addNameIndexEntry(context, node.displayName, node.id);

    if (node.scipSymbol) {
        context.nodeIdsByScipSymbol.set(node.scipSymbol, node.id);
    }

    if (node.scopeId) {
        context.nodeIdsByScopeId.set(node.scopeId, node.id);
    }
}

function normalizeIdentifierCollectionKind(collectionName: string): GraphNodeKind {
    switch (collectionName) {
        case "macros": {
            return "macro";
        }
        case "enums": {
            return "enum";
        }
        case "enumMembers": {
            return "enum_member";
        }
        case "globalVariables": {
            return "global_variable";
        }
        case "instanceVariables": {
            return "instance_variable";
        }
        default: {
            return "script";
        }
    }
}

function normalizeResourceKind(resourceType: string | null): GraphNodeKind {
    switch (resourceType) {
        case "GMObject": {
            return "object";
        }
        case "GMRoom": {
            return "room";
        }
        case "GMSprite": {
            return "sprite";
        }
        case "GMShader": {
            return "shader";
        }
        default: {
            return "resource";
        }
    }
}

function readSourceText(rootPath: string, relativePath: string | null): string | null {
    if (!relativePath) {
        return null;
    }

    const absolutePath = path.join(rootPath, relativePath);
    if (!existsSync(absolutePath)) {
        return null;
    }

    return readFileSync(absolutePath, "utf8");
}

function insertGraph(database: DatabaseSync, graphId: GraphIndexScope, rootPath: string): void {
    database
        .prepare(
            `
                INSERT OR REPLACE INTO graphs(id, scope, root_path, manifest_path, last_indexed_at, schema_version)
                VALUES (?, ?, ?, ?, ?, ?)
            `
        )
        .run(graphId, graphId, rootPath, null, new Date().toISOString(), 1);
}

function insertFileRecord(
    database: DatabaseSync,
    graphId: GraphIndexScope,
    rootPath: string,
    relativePath: string
): void {
    const absolutePath = path.join(rootPath, relativePath);
    const stats = existsSync(absolutePath) ? statSync(absolutePath) : null;
    const fileContents = readSourceText(rootPath, relativePath) ?? "";

    database
        .prepare(
            `
                INSERT OR REPLACE INTO files(graph_id, relative_path, content_hash, mtime_ms, indexed_at)
                VALUES (?, ?, ?, ?, ?)
            `
        )
        .run(graphId, relativePath, hashContent(fileContents), stats?.mtimeMs ?? null, new Date().toISOString());
}

function insertNodeRecord(database: DatabaseSync, node: GraphNodeRecord): void {
    database
        .prepare(
            `
                INSERT OR REPLACE INTO nodes(
                    id, graph_id, kind, name, display_name, scip_symbol, relative_path, resource_path, scope_id,
                    line_start, line_end, summary, snippet, content_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
        )
        .run(
            node.id,
            node.graphId,
            node.kind,
            node.name,
            node.displayName,
            node.scipSymbol,
            node.filePath,
            node.resourcePath,
            node.scopeId,
            node.lineStart,
            node.lineEnd,
            node.summary,
            node.snippet,
            hashContent(`${node.summary}\n${node.snippet}`)
        );

    database
        .prepare("INSERT OR REPLACE INTO node_fts(id, name, display_name, summary, content) VALUES (?, ?, ?, ?, ?)")
        .run(node.id, node.name, node.displayName, node.summary, `${node.summary}\n${node.snippet}`);

    for (const alias of createGraphAliases(node.name, node.filePath, node.resourcePath)) {
        database
            .prepare("INSERT OR REPLACE INTO aliases(alias, node_id, source) VALUES (?, ?, ?)")
            .run(alias.toLowerCase(), node.id, "derived");
    }
}

function insertEdgeRecord(database: DatabaseSync, edge: GraphEdgeRecord): void {
    database
        .prepare("INSERT OR IGNORE INTO edges(from_id, to_id, type, ordinal) VALUES (?, ?, ?, 0)")
        .run(edge.fromId, edge.toId, edge.type);
}

function createNodeRecord(parameters: {
    displayName?: string | null;
    filePath?: string | null;
    graphId: GraphIndexScope;
    id: string;
    kind: GraphNodeKind;
    lineEnd?: number | null;
    lineStart?: number | null;
    name: string;
    resourcePath?: string | null;
    scopeId?: string | null;
    scipSymbol?: string | null;
    snippet?: string;
    summary: string;
}): GraphNodeRecord {
    return Object.freeze({
        displayName: parameters.displayName ?? parameters.name,
        filePath: parameters.filePath ?? null,
        graphId: parameters.graphId,
        id: parameters.id,
        kind: parameters.kind,
        lineEnd: parameters.lineEnd ?? null,
        lineStart: parameters.lineStart ?? null,
        name: parameters.name,
        resourcePath: parameters.resourcePath ?? null,
        scopeId: parameters.scopeId ?? null,
        scipSymbol: parameters.scipSymbol ?? null,
        snippet: parameters.snippet ?? "",
        summary: parameters.summary
    });
}

function projectResources(context: ProjectionContext): void {
    const resources = asRecord(context.projectIndex.resources);

    for (const [resourcePath, rawRecord] of Object.entries(resources)) {
        const resourceRecord = asRecord(rawRecord);
        const name =
            getString(resourceRecord.name) ?? path.posix.basename(resourcePath, path.posix.extname(resourcePath));
        const kind = normalizeResourceKind(getString(resourceRecord.resourceType));
        const nodeId = createGraphNodeId(context.graphId, "resource", resourcePath);
        const node = createNodeRecord({
            displayName: name,
            graphId: context.graphId,
            id: nodeId,
            kind,
            name,
            resourcePath,
            summary: createGraphNodeSummary({
                kind,
                name,
                resourcePath
            })
        });

        context.nodeRecords.push(node);
        registerNodeIndexes(context, node);

        const gmlFiles = Array.isArray(resourceRecord.gmlFiles) ? resourceRecord.gmlFiles : [];
        for (const gmlFile of gmlFiles) {
            if (typeof gmlFile !== "string") {
                continue;
            }

            const fileNodeId = createGraphNodeId(context.graphId, "file", gmlFile);
            context.edgeRecords.push({ fromId: node.id, toId: fileNodeId, type: "contains" });
        }
    }
}

function projectFiles(context: ProjectionContext): void {
    const files = asRecord(context.projectIndex.files);
    for (const relativePath of Object.keys(files)) {
        insertFileRecord(context.database, context.graphId, context.rootPath, relativePath);
        const nodeId = createGraphNodeId(context.graphId, "file", relativePath);
        const node = createNodeRecord({
            displayName: relativePath,
            filePath: relativePath,
            graphId: context.graphId,
            id: nodeId,
            kind: "file",
            name: path.posix.basename(relativePath),
            summary: createGraphNodeSummary({
                filePath: relativePath,
                kind: "file",
                name: path.posix.basename(relativePath)
            }),
            snippet: ""
        });
        context.nodeRecords.push(node);
        registerNodeIndexes(context, node);
    }
}

function projectIdentifierCollections(context: ProjectionContext): void {
    const identifiers = asRecord(context.projectIndex.identifiers);

    for (const [collectionName, collectionValue] of Object.entries(identifiers)) {
        const kind = normalizeIdentifierCollectionKind(collectionName);
        const collection = asRecord(collectionValue);

        for (const [collectionKey, rawEntry] of Object.entries(collection)) {
            const entry = asRecord(rawEntry) as ProjectIndexIdentifierEntry;
            const name = getString(entry.name) ?? collectionKey;
            const declaration = readFirstDeclaration(entry);
            const declarationStart = readLocationIndex(asRecord(declaration?.start));
            const declarationEnd = readLocationIndex(asRecord(declaration?.end));
            const filePath =
                getString(declaration?.filePath) ??
                getString(entry.filePath) ??
                getString((Array.isArray(entry.references) ? entry.references[0] : null)?.filePath);
            const scipSymbol = resolveScipSymbol(kind, name, entry);
            const sourceText = readSourceText(context.rootPath, filePath);
            const displayName = getString(entry.displayName) ?? name;
            const scopeId = getString(entry.scopeId) ?? getString(entry.id);
            const node = createNodeRecord({
                displayName,
                filePath,
                graphId: context.graphId,
                id: createGraphNodeId(context.graphId, "symbol", scipSymbol),
                kind,
                lineEnd: readLocationLine(asRecord(declaration?.end)),
                lineStart: readLocationLine(asRecord(declaration?.start)),
                name,
                resourcePath: getString(entry.resourcePath),
                scopeId,
                scipSymbol,
                snippet: createGraphNodeSnippet(sourceText, declarationStart, declarationEnd),
                summary: createGraphNodeSummary({
                    docCommentSummary: extractDocCommentFirstSentence(sourceText, declarationStart),
                    filePath,
                    kind,
                    name,
                    resourcePath: getString(entry.resourcePath)
                })
            });

            context.nodeRecords.push(node);
            registerNodeIndexes(context, node);

            if (node.resourcePath) {
                context.edgeRecords.push({
                    fromId: createGraphNodeId(context.graphId, "resource", node.resourcePath),
                    toId: node.id,
                    type: "defines"
                });
            }

            if (filePath) {
                context.edgeRecords.push({
                    fromId: createGraphNodeId(context.graphId, "file", filePath),
                    toId: node.id,
                    type: "defines"
                });
            }
        }
    }
}

function projectRelationshipEdges(context: ProjectionContext): void {
    const files = asRecord(context.projectIndex.files);
    for (const [relativePath, rawFileRecord] of Object.entries(files)) {
        const fileRecord = asRecord(rawFileRecord);
        const scriptCalls = Array.isArray(fileRecord.scriptCalls) ? fileRecord.scriptCalls : [];
        const callerFileNodeId = createGraphNodeId(context.graphId, "file", relativePath);
        const callerScopeId = getString(fileRecord.scopeId);
        const callerNodeId = callerScopeId
            ? (context.nodeIdsByScopeId.get(callerScopeId) ?? callerFileNodeId)
            : callerFileNodeId;

        for (const rawCall of scriptCalls) {
            const callRecord = asRecord(rawCall);
            const targetName = getString(asRecord(callRecord.target).name);
            if (!targetName) {
                continue;
            }

            const targetScopeId = getString(asRecord(callRecord.target).scopeId);
            const targetNodeId = targetScopeId
                ? (context.nodeIdsByScopeId.get(targetScopeId) ?? null)
                : lookupUniqueNodeByNameAndKind(context, targetName, "script");
            if (targetNodeId) {
                context.edgeRecords.push({ fromId: callerNodeId, toId: targetNodeId, type: "calls" });
            }
        }
    }

    const assetReferences = Array.isArray(context.projectIndex.relationships?.assetReferences)
        ? context.projectIndex.relationships?.assetReferences
        : [];

    for (const rawReference of assetReferences) {
        const reference = asRecord(rawReference);
        const fromResourcePath = getString(reference.fromResourcePath);
        const targetPath = getString(reference.targetPath);
        if (!fromResourcePath || !targetPath) {
            continue;
        }

        context.edgeRecords.push({
            fromId: createGraphNodeId(context.graphId, "resource", fromResourcePath),
            toId: createGraphNodeId(context.graphId, "resource", targetPath),
            type: "references"
        });
    }
}

function addCrossGraphEdges(
    database: DatabaseSync,
    projectContext: ProjectionContext | null,
    toolsetContext: ProjectionContext | null
): Array<GraphEdgeRecord> {
    if (!projectContext || !toolsetContext) {
        return [];
    }

    const crossEdges: Array<GraphEdgeRecord> = [];
    const projectFileRecords = asRecord(projectContext.projectIndex.files);

    for (const [relativePath, rawFileRecord] of Object.entries(projectFileRecords)) {
        const fileRecord = asRecord(rawFileRecord);
        const scriptCalls = Array.isArray(fileRecord.scriptCalls) ? fileRecord.scriptCalls : [];
        const projectCallerFileNodeId = createGraphNodeId("project", "file", relativePath);
        const callerScopeId = getString(fileRecord.scopeId);
        const projectCallerNodeId = callerScopeId
            ? (projectContext.nodeIdsByScopeId.get(callerScopeId) ?? projectCallerFileNodeId)
            : projectCallerFileNodeId;

        for (const rawCall of scriptCalls) {
            const targetName = getString(asRecord(asRecord(rawCall).target).name);
            if (!targetName) {
                continue;
            }

            if (hasNodeNameAndKind(projectContext, targetName, "script")) {
                continue;
            }

            const toolsetTargetNodeId = lookupUniqueNodeByNameAndKind(toolsetContext, targetName, "script");
            if (!toolsetTargetNodeId) {
                continue;
            }

            crossEdges.push({
                fromId: projectCallerNodeId,
                toId: toolsetTargetNodeId,
                type: "uses_toolset"
            });
        }
    }

    for (const edge of crossEdges) {
        insertEdgeRecord(database, edge);
    }

    return crossEdges;
}

function persistProjection(
    database: DatabaseSync,
    context: ProjectionContext,
    embeddingsConfig: GraphEmbeddingsConfig,
    buildDurationMs: number
): void {
    const embeddingProvider = embeddingsConfig.enabled ? createGraphEmbeddingProvider(embeddingsConfig) : null;

    for (const node of context.nodeRecords) {
        insertNodeRecord(database, node);
        if (embeddingProvider) {
            const vector = embeddingProvider.embedText(`${node.kind} ${node.name} ${node.summary} ${node.snippet}`);
            database
                .prepare(
                    "INSERT OR REPLACE INTO embeddings(node_id, model_id, dimensions, vector_blob, content_hash) VALUES (?, ?, ?, ?, ?)"
                )
                .run(
                    node.id,
                    embeddingsConfig.provider,
                    vector.length,
                    serializeEmbeddingVector(vector),
                    hashContent(node.summary + node.snippet)
                );
        }
    }

    for (const edge of context.edgeRecords) {
        insertEdgeRecord(database, edge);
    }

    database
        .prepare(
            `
                INSERT OR REPLACE INTO index_state(graph_id, file_count, node_count, edge_count, embedding_model, build_duration_ms)
                VALUES (?, ?, ?, ?, ?, ?)
            `
        )
        .run(
            context.graphId,
            Object.keys(asRecord(context.projectIndex.files)).length,
            context.nodeRecords.length,
            context.edgeRecords.length,
            embeddingsConfig.enabled ? embeddingsConfig.provider : "disabled",
            Math.round(buildDurationMs)
        );
}

function createProjectionContext(
    database: DatabaseSync,
    graphId: GraphIndexScope,
    rootPath: string,
    projectIndex: ProjectIndexSnapshot
): ProjectionContext {
    return {
        database,
        edgeRecords: [],
        graphId,
        nodeIdsByName: new Map(),
        nodeIdsByScipSymbol: new Map(),
        nodeIdsByScopeId: new Map(),
        nodeRecords: [],
        projectIndex,
        rootPath
    };
}

function queryNodeById(database: DatabaseSync, nodeId: string): GraphNodeRecord | null {
    const row = database
        .prepare(
            `
                SELECT id, graph_id AS graphId, kind, name, display_name AS displayName,
                       relative_path AS filePath, resource_path AS resourcePath,
                       scope_id AS scopeId, scip_symbol AS scipSymbol, line_start AS lineStart, line_end AS lineEnd,
                       summary, snippet
                FROM nodes
                WHERE id = ?
            `
        )
        .get(nodeId) as GraphLookupRow | undefined;

    if (!row) {
        return null;
    }

    return createNodeRecord({
        displayName: row.displayName,
        filePath: row.filePath,
        graphId: row.graphId,
        id: row.id,
        kind: row.kind,
        lineEnd: row.lineEnd,
        lineStart: row.lineStart,
        name: row.name,
        resourcePath: row.resourcePath,
        scopeId: row.scopeId,
        scipSymbol: row.scipSymbol,
        snippet: row.snippet,
        summary: row.summary
    });
}

function listNodeNeighbors(database: DatabaseSync, nodeId: string, depth = 1): Array<GraphNeighborRecord> {
    const visited = new Set<string>([nodeId]);
    const collected: Array<GraphNeighborRecord> = [];
    const pending: Array<{ currentId: string; level: number }> = [{ currentId: nodeId, level: 0 }];

    while (pending.length > 0) {
        const current = pending.shift();
        if (!current || current.level >= depth) {
            continue;
        }

        const outgoingRows = database
            .prepare("SELECT to_id AS targetId, type FROM edges WHERE from_id = ?")
            .all(current.currentId) as Array<{ targetId: string; type: GraphEdgeType }>;
        const incomingRows = database
            .prepare("SELECT from_id AS sourceId, type FROM edges WHERE to_id = ?")
            .all(current.currentId) as Array<{ sourceId: string; type: GraphEdgeType }>;

        for (const outgoing of outgoingRows) {
            if (visited.has(outgoing.targetId)) {
                continue;
            }

            visited.add(outgoing.targetId);
            const neighborNode = queryNodeById(database, outgoing.targetId);
            if (neighborNode) {
                collected.push({ direction: "outgoing", edgeType: outgoing.type, node: neighborNode });
                pending.push({ currentId: outgoing.targetId, level: current.level + 1 });
            }
        }

        for (const incoming of incomingRows) {
            if (visited.has(incoming.sourceId)) {
                continue;
            }

            visited.add(incoming.sourceId);
            const neighborNode = queryNodeById(database, incoming.sourceId);
            if (neighborNode) {
                collected.push({ direction: "incoming", edgeType: incoming.type, node: neighborNode });
                pending.push({ currentId: incoming.sourceId, level: current.level + 1 });
            }
        }
    }

    return collected;
}

function listUsageRecords(database: DatabaseSync, nodeId: string, depth = 1): Array<GraphUsageRecord> {
    const incomingNeighbors = listNodeNeighbors(database, nodeId, depth).filter(
        (entry) =>
            entry.direction === "incoming" &&
            (entry.edgeType === "calls" ||
                entry.edgeType === "uses_toolset" ||
                entry.edgeType === "references" ||
                entry.edgeType === "depends_on")
    );
    const target = queryNodeById(database, nodeId);
    if (!target) {
        return [];
    }

    return incomingNeighbors.map((entry) =>
        Object.freeze({
            edgeType: entry.edgeType,
            from: entry.node,
            location: Object.freeze({
                lineEnd: entry.node.lineEnd,
                lineStart: entry.node.lineStart
            }),
            to: target
        })
    );
}

function rankSemanticMatches(
    database: DatabaseSync,
    query: string,
    candidateScores: Map<string, number>,
    embeddingsConfig: GraphEmbeddingsConfig
): void {
    if (!embeddingsConfig.enabled) {
        return;
    }

    const queryVector = createGraphEmbeddingProvider(embeddingsConfig).embedText(query);
    const embeddingRows = database
        .prepare("SELECT node_id AS nodeId, vector_blob AS vectorBlob FROM embeddings")
        .all() as Array<{ nodeId: string; vectorBlob: Buffer }>;

    for (const row of embeddingRows) {
        const similarity = cosineSimilarity(queryVector, deserializeEmbeddingVector(row.vectorBlob));
        const currentScore = candidateScores.get(row.nodeId) ?? 0;
        candidateScores.set(row.nodeId, currentScore + similarity * 2);
    }
}

function applyGraphProximityBoost(database: DatabaseSync, candidateScores: Map<string, number>): void {
    const highConfidenceNodeIds = [...candidateScores.entries()]
        .filter(([, score]) => score >= 5)
        .map(([nodeId]) => nodeId);

    for (const nodeId of highConfidenceNodeIds) {
        const neighborRows = database
            .prepare(
                "SELECT to_id AS nodeId FROM edges WHERE from_id = ? UNION SELECT from_id AS nodeId FROM edges WHERE to_id = ?"
            )
            .all(nodeId, nodeId) as Array<{ nodeId: string }>;

        for (const neighbor of neighborRows) {
            const currentScore = candidateScores.get(neighbor.nodeId) ?? 0;
            candidateScores.set(neighbor.nodeId, currentScore + 1);
        }
    }
}

function createSafeFtsQuery(rawQuery: string): string {
    return rawQuery
        .replaceAll(/[^a-zA-Z0-9_]+/g, " ")
        .trim()
        .split(/\s+/u)
        .filter((token) => token.length > 0)
        .map((token) => `"${token.replaceAll('"', '""')}"`)
        .join(" OR ");
}

function refreshIndexStateEdgeCounts(database: DatabaseSync): void {
    const graphRows = database.prepare("SELECT id FROM graphs").all() as Array<{ id: string }>;
    for (const row of graphRows) {
        const edgeCount = database
            .prepare(
                `
                    SELECT COUNT(*) AS edgeCount
                    FROM edges
                    WHERE from_id IN (SELECT id FROM nodes WHERE graph_id = ?)
                       OR to_id IN (SELECT id FROM nodes WHERE graph_id = ?)
                `
            )
            .get(row.id, row.id) as { edgeCount: number };
        database.prepare("UPDATE index_state SET edge_count = ? WHERE graph_id = ?").run(edgeCount.edgeCount, row.id);
    }
}

function resetDatabaseWhenSchemaIsIncompatible(databasePath: string): void {
    if (!existsSync(databasePath)) {
        return;
    }

    const database = new DatabaseSync(databasePath);
    try {
        const schemaVersion = readGraphIndexSchemaVersion(database);
        if (schemaVersion !== GRAPH_INDEX_SCHEMA_VERSION) {
            database.close();
            rmSync(databasePath, { force: true });
        }
    } finally {
        try {
            database.close();
        } catch {
            // The database may have already been closed before removing an incompatible file.
        }
    }
}

/**
 * Build or rebuild the SQLite-backed graph index.
 */
export async function buildGraphIndex(options: GraphIndexBuildOptions): Promise<GraphIndexBuildResult> {
    const config = resolveGraphIndexConfig(options);
    if (options.rebuild && existsSync(config.databasePath)) {
        rmSync(config.databasePath, { force: true });
    }
    resetDatabaseWhenSchemaIsIncompatible(config.databasePath);

    const database = openGraphIndexDatabase(config.databasePath);
    resetGraphIndexDatabase(database);
    if (config.embeddings.enabled) {
        ensureGraphEmbeddingModelAssets(config.embeddings);
    }
    const buildStart = performance.now();

    const projectIndex = (await buildProjectIndex(config.projectRoot)) as ProjectIndexSnapshot;
    const projectContext = createProjectionContext(database, "project", config.projectRoot, projectIndex);
    insertGraph(database, "project", config.projectRoot);
    projectFiles(projectContext);
    projectResources(projectContext);
    projectIdentifierCollections(projectContext);
    projectRelationshipEdges(projectContext);

    let toolsetContext: ProjectionContext | null = null;
    if (config.toolsetRoot) {
        const toolsetIndex = (await buildProjectIndex(config.toolsetRoot)) as ProjectIndexSnapshot;
        toolsetContext = createProjectionContext(database, "toolset", config.toolsetRoot, toolsetIndex);
        insertGraph(database, "toolset", config.toolsetRoot);
        projectFiles(toolsetContext);
        projectResources(toolsetContext);
        projectIdentifierCollections(toolsetContext);
        projectRelationshipEdges(toolsetContext);
    }

    const buildDurationMs = performance.now() - buildStart;
    persistProjection(database, projectContext, config.embeddings, buildDurationMs);

    if (toolsetContext) {
        persistProjection(database, toolsetContext, config.embeddings, buildDurationMs);
    }

    addCrossGraphEdges(database, projectContext, toolsetContext);
    refreshIndexStateEdgeCounts(database);
    database.close();

    const graphIds: Array<GraphIndexScope> = config.toolsetRoot ? ["project", "toolset"] : ["project"];
    return Object.freeze({
        config,
        databasePath: config.databasePath,
        graphIds
    });
}

/**
 * Open the graph-index database for query operations.
 */
export function openGraphIndex(options: GraphIndexBuildOptions): GraphIndexHandle {
    const config = resolveGraphIndexConfig(options);
    const database = openExistingGraphIndexDatabase(config.databasePath);

    return Object.freeze({
        close(): void {
            database.close();
        },
        config,
        doctor(): GraphDoctorReport {
            return doctorGraphIndex(options);
        },
        getContext(nodeId: string, depth = 1): GraphContextBundle | null {
            return getGraphContext({ ...options, depth, nodeId });
        },
        getNeighbors(nodeId: string, depth = 1): ReadonlyArray<GraphNeighborRecord> {
            return getGraphNeighbors({ ...options, depth, nodeId });
        },
        getNode(nodeId: string): GraphNodeRecord | null {
            return getGraphNode({ ...options, nodeId });
        },
        getUsages(nodeId: string, depth = 1): ReadonlyArray<GraphUsageRecord> {
            return getGraphUsages({ ...options, depth, nodeId });
        },
        search(query: string, limit = 10): GraphSearchResponse {
            return searchGraphIndex({ ...options, limit, query });
        }
    });
}

/**
 * Retrieve a graph node by its stable graph-qualified identifier.
 */
export function getGraphNode(
    options: GraphIndexBuildOptions & {
        nodeId: string;
    }
): GraphNodeRecord | null {
    const config = resolveGraphIndexConfig(options);
    const database = openExistingGraphIndexDatabase(config.databasePath);

    try {
        return queryNodeById(database, options.nodeId);
    } finally {
        database.close();
    }
}

/**
 * Search the graph index using exact, alias, lexical, embedding, and
 * graph-proximity scoring.
 */
export function searchGraphIndex(
    options: GraphIndexBuildOptions & {
        limit?: number;
        query: string;
    }
): GraphSearchResponse {
    const config = resolveGraphIndexConfig(options);
    const database = openExistingGraphIndexDatabase(config.databasePath);
    const candidateScores = new Map<string, number>();
    const normalizedQuery = options.query.trim();
    const lowerQuery = normalizedQuery.toLowerCase();
    const limit = Math.max(1, options.limit ?? 10);

    try {
        if (normalizedQuery.includes("::")) {
            const exactNode = queryNodeById(database, normalizedQuery);
            if (exactNode) {
                candidateScores.set(exactNode.id, 10);
            }
        }

        const exactRows = database
            .prepare("SELECT id FROM nodes WHERE name = ? OR scip_symbol = ?")
            .all(normalizedQuery, normalizedQuery) as Array<{ id: string }>;
        for (const row of exactRows) {
            candidateScores.set(row.id, (candidateScores.get(row.id) ?? 0) + 5);
        }

        const aliasRows = database
            .prepare("SELECT node_id AS nodeId FROM aliases WHERE alias = ?")
            .all(lowerQuery) as Array<{ nodeId: string }>;
        for (const row of aliasRows) {
            candidateScores.set(row.nodeId, (candidateScores.get(row.nodeId) ?? 0) + 3);
        }

        const ftsQuery = createSafeFtsQuery(normalizedQuery);
        if (ftsQuery.length > 0) {
            const lexicalRows = database
                .prepare(
                    "SELECT id, ABS(bm25(node_fts)) AS lexicalRank FROM node_fts WHERE node_fts MATCH ? ORDER BY lexicalRank ASC LIMIT ?"
                )
                .all(ftsQuery, Math.max(limit * 4, 20)) as Array<{ id: string; lexicalRank: number }>;
            for (const row of lexicalRows) {
                candidateScores.set(row.id, (candidateScores.get(row.id) ?? 0) + Math.max(0.5, 3 - row.lexicalRank));
            }
        }

        rankSemanticMatches(database, normalizedQuery, candidateScores, config.embeddings);
        applyGraphProximityBoost(database, candidateScores);

        const results = [...candidateScores.entries()]
            .sort((left, right) => right[1] - left[1])
            .slice(0, limit)
            .map(([nodeId, score]) => {
                const node = queryNodeById(database, nodeId);
                if (!node) {
                    return null;
                }

                return {
                    displayName: node.displayName,
                    graphId: node.graphId,
                    id: node.id,
                    kind: node.kind,
                    name: node.name,
                    score,
                    snippet: node.snippet,
                    summary: node.summary
                } satisfies GraphSearchResult;
            })
            .filter((entry): entry is GraphSearchResult => entry !== null);

        return Object.freeze({
            query: normalizedQuery,
            results
        });
    } finally {
        database.close();
    }
}

/**
 * Retrieve a graph node and its neighborhood grouped into an AI-friendly
 * context bundle.
 */
export function getGraphContext(
    options: GraphIndexBuildOptions & {
        depth?: number;
        nodeId: string;
    }
): GraphContextBundle | null {
    const config = resolveGraphIndexConfig(options);
    const database = openExistingGraphIndexDatabase(config.databasePath);

    try {
        const target = queryNodeById(database, options.nodeId);
        if (!target) {
            return null;
        }

        const neighbors = listNodeNeighbors(database, options.nodeId, Math.max(1, options.depth ?? 1));
        return Object.freeze({
            neighbors: Object.freeze({
                calledBy: neighbors
                    .filter((entry) => entry.direction === "incoming" && entry.edgeType === "calls")
                    .map((entry) => entry.node),
                calls: neighbors
                    .filter((entry) => entry.direction === "outgoing" && entry.edgeType === "calls")
                    .map((entry) => entry.node),
                references: neighbors
                    .filter((entry) => entry.edgeType === "references" || entry.edgeType === "depends_on")
                    .map((entry) => entry.node),
                relatedResources: neighbors
                    .filter(
                        (entry) =>
                            entry.node.kind === "resource" || entry.node.kind === "object" || entry.node.kind === "room"
                    )
                    .map((entry) => entry.node),
                toolsetDependencies: neighbors
                    .filter((entry) => entry.edgeType === "uses_toolset" || entry.node.graphId === "toolset")
                    .map((entry) => entry.node)
            }),
            summary: target.summary,
            target
        });
    } finally {
        database.close();
    }
}

/**
 * Retrieve the neighborhood around a graph node.
 */
export function getGraphNeighbors(
    options: GraphIndexBuildOptions & {
        depth?: number;
        nodeId: string;
    }
): ReadonlyArray<GraphNeighborRecord> {
    const config = resolveGraphIndexConfig(options);
    const database = openExistingGraphIndexDatabase(config.databasePath);

    try {
        return listNodeNeighbors(database, options.nodeId, Math.max(1, options.depth ?? 1));
    } finally {
        database.close();
    }
}

/**
 * Retrieve incoming usage-style relationships for a graph node.
 */
export function getGraphUsages(
    options: GraphIndexBuildOptions & {
        depth?: number;
        nodeId: string;
    }
): ReadonlyArray<GraphUsageRecord> {
    const config = resolveGraphIndexConfig(options);
    const database = openExistingGraphIndexDatabase(config.databasePath);

    try {
        return listUsageRecords(database, options.nodeId, Math.max(1, options.depth ?? 1));
    } finally {
        database.close();
    }
}

/**
 * Inspect the graph database and report high-signal health issues.
 */
export function doctorGraphIndex(options: GraphIndexBuildOptions): GraphDoctorReport {
    const config = resolveGraphIndexConfig(options);
    const issues: Array<GraphDoctorIssue> = [];

    if (!existsSync(config.databasePath)) {
        issues.push({
            code: "GRAPH_DB_MISSING",
            message: `Graph database not found at ${config.databasePath}. Run 'gmloop graph index' first.`,
            severity: "error"
        });

        return Object.freeze({
            databasePath: config.databasePath,
            graphs: [],
            issues
        });
    }

    const database = openExistingGraphIndexDatabase(config.databasePath);
    try {
        const schemaVersion = readGraphIndexSchemaVersion(database);
        if (schemaVersion !== GRAPH_INDEX_SCHEMA_VERSION) {
            issues.push({
                code: "GRAPH_SCHEMA_INCOMPATIBLE",
                message: `Graph database schema ${String(schemaVersion)} is incompatible with expected schema ${String(GRAPH_INDEX_SCHEMA_VERSION)}. Run 'gmloop graph index --rebuild'.`,
                severity: "error"
            });
        }

        const graphRows = database
            .prepare("SELECT id AS graphId, root_path AS rootPath FROM graphs ORDER BY id")
            .all() as Array<{
            graphId: GraphIndexScope;
            rootPath: string;
        }>;
        const graphs: Array<GraphDoctorGraphStatus> = graphRows.map((row) => {
            let staleFileCount = 0;
            if (!existsSync(row.rootPath)) {
                issues.push({
                    code: "GRAPH_ROOT_MISSING",
                    message: `Indexed graph root no longer exists: ${row.rootPath}`,
                    severity: "warning"
                });
            }

            const fileRows = database
                .prepare(
                    "SELECT relative_path AS relativePath, content_hash AS contentHash FROM files WHERE graph_id = ?"
                )
                .all(row.graphId) as Array<{ contentHash: string | null; relativePath: string }>;
            for (const fileRow of fileRows) {
                const sourceText = readSourceText(row.rootPath, fileRow.relativePath);
                if (sourceText === null || hashContent(sourceText) !== fileRow.contentHash) {
                    staleFileCount += 1;
                }
            }

            if (staleFileCount > 0) {
                issues.push({
                    code: "GRAPH_DB_STALE",
                    message: `${String(staleFileCount)} indexed file(s) changed or disappeared under ${row.rootPath}. Run 'gmloop graph index --rebuild'.`,
                    severity: "warning"
                });
            }

            const counts = database
                .prepare("SELECT COUNT(*) AS fileCount FROM files WHERE graph_id = ?")
                .get(row.graphId) as { fileCount: number };
            const nodeCounts = database
                .prepare("SELECT COUNT(*) AS nodeCount FROM nodes WHERE graph_id = ?")
                .get(row.graphId) as { nodeCount: number };
            const edgeCounts = database
                .prepare(
                    `
                        SELECT COUNT(*) AS edgeCount
                        FROM edges
                        WHERE from_id IN (SELECT id FROM nodes WHERE graph_id = ?)
                           OR to_id IN (SELECT id FROM nodes WHERE graph_id = ?)
                    `
                )
                .get(row.graphId, row.graphId) as { edgeCount: number };
            const embeddingCounts = database
                .prepare(
                    `
                        SELECT COUNT(*) AS embeddingCount
                        FROM embeddings
                        WHERE node_id IN (SELECT id FROM nodes WHERE graph_id = ?)
                    `
                )
                .get(row.graphId) as { embeddingCount: number };

            return Object.freeze({
                edgeCount: edgeCounts.edgeCount,
                embeddingCount: embeddingCounts.embeddingCount,
                fileCount: counts.fileCount,
                graphId: row.graphId,
                nodeCount: nodeCounts.nodeCount,
                rootPath: row.rootPath,
                staleFileCount
            });
        });

        const embeddingRows = database.prepare("SELECT DISTINCT model_id AS modelId FROM embeddings").all() as Array<{
            modelId: string;
        }>;
        if (config.embeddings.enabled && embeddingRows.length === 0) {
            issues.push({
                code: "GRAPH_EMBEDDINGS_MISSING",
                message: "No embeddings were found in the graph index.",
                severity: "warning"
            });
        }

        return Object.freeze({
            databasePath: config.databasePath,
            graphs,
            issues
        });
    } finally {
        database.close();
    }
}
