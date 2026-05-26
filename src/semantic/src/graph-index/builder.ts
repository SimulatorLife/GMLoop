import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { Core } from "@gmloop/core";

import { isProjectManifestPath } from "../project-index/constants.js";
import { buildProjectIndex } from "../project-index/index.js";
import { resolveGraphIndexConfig } from "./config.js";
import {
    GRAPH_INDEX_SCHEMA_VERSION,
    openExistingGraphIndexDatabase,
    openGraphIndexDatabase,
    readGraphIndexSchemaVersion
} from "./database.js";
import {
    cosineSimilarity,
    createGraphEmbeddingProvider,
    deserializeEmbeddingVector,
    ensureGraphEmbeddingModelAssets,
    serializeEmbeddingVector
} from "./embeddings.js";
import {
    getGraphDatabaseRuntimeInfo,
    type GraphDatabase,
    inspectGraphDatabaseIntegrity,
    optimizeGraphDatabase
} from "./sqlite-adapter.js";
import {
    createGraphAliases,
    createGraphNodeSnippet,
    createGraphNodeSummary,
    extractDocCommentFirstSentence
} from "./summary.js";
import type {
    GraphContextBundle,
    GraphDatabaseIntegrityStatus,
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
    declarationKinds?: Array<string>;
    declarations?: Array<Record<string, unknown>>;
    displayName?: string;
    enumKey?: string;
    enumName?: string;
    filePath?: string;
    id?: string;
    identifierId?: string;
    key?: string;
    name?: string;
    references?: Array<Record<string, unknown>>;
    resourcePath?: string;
    scopeId?: string;
};

type ProjectIndexScopeRecord = {
    displayName?: string | null;
    event?: { eventNum?: number | null; eventType?: number | null; name?: string | null } | null;
    filePaths?: Array<string>;
    id?: string;
    kind?: string;
    name?: string | null;
    resourcePath?: string | null;
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
        assetReferences?: Array<{ fromResourcePath?: string; propertyPath?: string; targetPath?: string }>;
    };
    resources?: Record<
        string,
        {
            gmlFiles?: Array<string>;
            layers?: Array<Record<string, unknown>>;
            name?: string;
            path?: string;
            resourceType?: string;
        }
    >;
    scopes?: Record<string, ProjectIndexScopeRecord>;
};

type ProjectionContext = {
    edgeRecords: Array<GraphEdgeRecord>;
    fileRecords: Array<{
        contentHash: string;
        indexedAt: string;
        mtimeMs: number | null;
        relativePath: string;
    }>;
    graphId: GraphIndexScope;
    nodeIdsByName: Map<string, Set<string>>;
    nodeIdsByScipSymbol: Map<string, string>;
    nodeIdsByScopeId: Map<string, string>;
    nodeRecords: Array<GraphNodeRecord>;
    projectIndex: ProjectIndexSnapshot;
    resourcePathByGmlFile: Map<string, string>;
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

const GRAPH_RESOURCE_NODE_KINDS = new Set<GraphNodeKind>([
    "anim_curve",
    "data_file",
    "extension",
    "font",
    "note",
    "object",
    "particle_system",
    "path",
    "project",
    "resource",
    "room",
    "script",
    "sequence",
    "shader",
    "sound",
    "sprite",
    "tileset",
    "timeline"
]);

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
            return `gml/enum/${identifierId ?? entry.key ?? name}`;
        }
        case "enum_member": {
            return `gml/enum-member/${identifierId ?? entry.key ?? name}`;
        }
        case "function": {
            return `gml/function/${identifierId ?? entry.key ?? entry.scopeId ?? name}`;
        }
        case "global_variable": {
            return `gml/var/global::${name}`;
        }
        case "instance_variable": {
            return `gml/var/instance::${entry.scopeId ?? entry.key ?? name}`;
        }
        case "local_variable": {
            return `gml/var/local::${entry.scopeId ?? entry.key ?? name}`;
        }
        case "struct_variable": {
            return `gml/var/struct::${entry.scopeId ?? entry.key ?? name}`;
        }
        case "file": {
            return `gml/file/${entry.filePath ?? entry.key ?? name}`;
        }
        case "anim_curve":
        case "constructor":
        case "data_file":
        case "extension":
        case "font":
        case "note":
        case "object":
        case "object_event":
        case "particle_system":
        case "path":
        case "project":
        case "resource":
        case "room":
        case "room_layer":
        case "script":
        case "sequence":
        case "shader":
        case "sound":
        case "sprite":
        case "tileset":
        case "timeline":
        case "struct": {
            return `gml/script/${name}`;
        }
    }
}

function createGraphNodeId(
    graphId: GraphIndexScope,
    category: "file" | "resource" | "scope" | "symbol",
    value: string
): string {
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

    const matchingNodes = [...candidateIds]
        .map((nodeId) => context.nodeRecords.find((node) => node.id === nodeId && node.kind === kind))
        .filter((node): node is GraphNodeRecord => node !== undefined);

    if (matchingNodes.length === 1) {
        return matchingNodes[0].id;
    }

    if (matchingNodes.length > 1) {
        const symbolNodes = matchingNodes.filter((node) => node.scipSymbol !== null);
        if (symbolNodes.length === 1) {
            return symbolNodes[0].id;
        }
    }

    return null;
}

function lookupUniqueFunctionOrScriptNodeByName(context: ProjectionContext, name: string): string | null {
    const functionNodeId = lookupUniqueNodeByNameAndKind(context, name, "function");
    if (functionNodeId) {
        return functionNodeId;
    }

    return lookupUniqueNodeByNameAndKind(context, name, "script");
}

function lookupNodeByScipSymbol(context: ProjectionContext, scipSymbol: string): string | null {
    return context.nodeIdsByScipSymbol.get(scipSymbol) ?? null;
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

function hasFunctionOrScriptNodeByName(context: ProjectionContext, name: string): boolean {
    return hasNodeNameAndKind(context, name, "function") || hasNodeNameAndKind(context, name, "script");
}

function findEnclosingCallableNodeId(
    context: ProjectionContext,
    filePath: string | null,
    locationLine: number | null
): string | null {
    if (!filePath || locationLine === null) {
        return null;
    }

    const candidates = context.nodeRecords.filter(
        (node) =>
            node.filePath === filePath &&
            (node.kind === "function" || node.kind === "script" || node.kind === "struct") &&
            node.lineStart !== null &&
            node.lineEnd !== null &&
            locationLine >= node.lineStart &&
            locationLine <= node.lineEnd
    );
    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((left, right) => {
        const leftSpan = (left.lineEnd ?? left.lineStart ?? 0) - (left.lineStart ?? 0);
        const rightSpan = (right.lineEnd ?? right.lineStart ?? 0) - (right.lineStart ?? 0);
        return leftSpan - rightSpan;
    });

    return candidates[0]?.id ?? null;
}

function findFunctionNodeByNameInFile(
    context: ProjectionContext,
    filePath: string | null,
    functionName: string
): string | null {
    if (!filePath) {
        return null;
    }

    const matches = context.nodeRecords.filter(
        (node) => node.kind === "function" && node.filePath === filePath && node.name === functionName
    );
    return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}

function findPrimaryFunctionNodeForFile(
    context: ProjectionContext,
    filePath: string | null,
    scriptName: string | null
): string | null {
    if (!filePath || !scriptName) {
        return null;
    }

    return findFunctionNodeByNameInFile(context, filePath, scriptName);
}

function resolveScopedFileOwnerNodeId(
    context: ProjectionContext,
    filePath: string | null,
    fallbackOwnerNodeId: string,
    scopeId: string | null,
    locationLine: number | null
): string {
    const enclosingCallableNodeId = findEnclosingCallableNodeId(context, filePath, locationLine);
    if (enclosingCallableNodeId) {
        return enclosingCallableNodeId;
    }

    if (scopeId) {
        const scopedNodeId = context.nodeIdsByScopeId.get(scopeId);
        if (scopedNodeId) {
            const scopedNode = context.nodeRecords.find((node) => node.id === scopedNodeId) ?? null;
            if (scopedNode?.kind === "script" && locationLine === null) {
                const primaryFunctionNodeId = findPrimaryFunctionNodeForFile(context, filePath, scopedNode.name);
                if (primaryFunctionNodeId) {
                    return primaryFunctionNodeId;
                }
            }
            if (scopedNode && !scopedNode.kind.endsWith("_variable")) {
                return scopedNodeId;
            }
        }
    }

    return resolveFileSemanticOwnerNodeId(context, filePath) ?? fallbackOwnerNodeId;
}

function resolveCallerNodeId(
    context: ProjectionContext,
    relativePath: string,
    callerOwnerNodeId: string,
    callRecord: Record<string, unknown>,
    fallbackScopeId: string | null
): string {
    const callLocationLine = readLocationLine(asRecord(asRecord(callRecord.location).start));
    const callerFilePath = getString(asRecord(callRecord.from).filePath) ?? relativePath;
    const callerScopeId = getString(asRecord(callRecord.from).scopeId) ?? fallbackScopeId;
    if (callerScopeId === null && callLocationLine === null) {
        const callerResourcePath = resolveResourcePathForFile(context, callerFilePath);
        const callerScriptNode =
            callerResourcePath === null
                ? null
                : (context.nodeRecords.find(
                      (node) =>
                          node.kind === "script" && node.resourcePath === callerResourcePath && node.scipSymbol !== null
                  ) ?? null);
        const primaryFunctionNodeId = findPrimaryFunctionNodeForFile(
            context,
            callerFilePath,
            callerScriptNode?.name ?? null
        );
        if (primaryFunctionNodeId) {
            return primaryFunctionNodeId;
        }
    }
    return resolveScopedFileOwnerNodeId(context, callerFilePath, callerOwnerNodeId, callerScopeId, callLocationLine);
}

function resolveCallTargetNodeId(
    context: ProjectionContext,
    callRecord: Record<string, unknown>,
    targetName: string,
    relativePath: string
): string | null {
    const targetRecord = asRecord(callRecord.target);
    const targetIdentifierId = getString(targetRecord.identifierId);
    const targetScopeId = getString(targetRecord.scopeId);
    const targetKind = getString(callRecord.kind);
    const callerFilePath = getString(asRecord(callRecord.from).filePath) ?? relativePath;

    if (targetKind === "function" && targetIdentifierId) {
        const functionScipSymbol = `gml/function/${targetIdentifierId}`;
        const functionNodeId = lookupNodeByScipSymbol(context, functionScipSymbol);
        if (functionNodeId) {
            return functionNodeId;
        }
    }

    if (targetScopeId) {
        return context.nodeIdsByScopeId.get(targetScopeId) ?? null;
    }

    const sameFileFunctionNodeId = findFunctionNodeByNameInFile(context, callerFilePath, targetName);
    if (sameFileFunctionNodeId) {
        return sameFileFunctionNodeId;
    }

    if (targetKind === "function") {
        return lookupUniqueNodeByNameAndKind(context, targetName, "function");
    }

    if (targetKind === "script") {
        return lookupUniqueNodeByNameAndKind(context, targetName, "script");
    }

    return lookupUniqueFunctionOrScriptNodeByName(context, targetName);
}

function registerNodeIndexes(context: ProjectionContext, node: GraphNodeRecord): void {
    addNameIndexEntry(context, node.name, node.id);
    addNameIndexEntry(context, node.displayName, node.id);

    if (node.scipSymbol) {
        context.nodeIdsByScipSymbol.set(node.scipSymbol, node.id);
    }

    if (node.scopeId && node.kind !== "function" && !node.kind.endsWith("_variable")) {
        context.nodeIdsByScopeId.set(node.scopeId, node.id);
    }
}

function resolveResourcePathForFile(context: ProjectionContext, filePath: string | null): string | null {
    if (!filePath) {
        return null;
    }

    const indexedResourcePath = context.resourcePathByGmlFile.get(filePath);
    if (indexedResourcePath) {
        return indexedResourcePath;
    }

    return inferResourcePathFromSiblingDirectory(context, filePath);
}

function inferResourcePathFromSiblingDirectory(context: ProjectionContext, filePath: string): string | null {
    const resources = asRecord(context.projectIndex.resources);
    if (filePath in resources) {
        return filePath;
    }

    const fileDirectory = path.posix.dirname(filePath);
    const fileDirectoryName = path.posix.basename(fileDirectory);
    const siblingResourcePaths = Object.keys(resources).filter(
        (resourcePath) => path.posix.dirname(resourcePath) === fileDirectory
    );
    if (siblingResourcePaths.length === 0) {
        return null;
    }

    if (siblingResourcePaths.length === 1) {
        return siblingResourcePaths[0] ?? null;
    }

    return (
        siblingResourcePaths.find(
            (resourcePath) => path.posix.basename(resourcePath, path.posix.extname(resourcePath)) === fileDirectoryName
        ) ?? null
    );
}

function resolveEnumOwnerNodeId(context: ProjectionContext, entry: ProjectIndexIdentifierEntry): string | null {
    const enumKey = getString(entry.enumKey);
    if (enumKey) {
        return lookupNodeByScipSymbol(context, `gml/enum/enum:${enumKey}`);
    }

    const enumName = getString(entry.enumName);
    return enumName ? lookupUniqueNodeByNameAndKind(context, enumName, "enum") : null;
}

function resolveFileSemanticOwnerNodeId(context: ProjectionContext, filePath: string | null): string | null {
    const resourcePath = resolveResourcePathForFile(context, filePath);
    if (!resourcePath) {
        return null;
    }

    const scriptNode = context.nodeRecords.find(
        (node) => node.kind === "script" && node.resourcePath === resourcePath && node.scipSymbol !== null
    );
    return scriptNode?.id ?? createGraphNodeId(context.graphId, "resource", resourcePath);
}

function resolveProjectRootNodeId(context: ProjectionContext): string | null {
    return context.nodeRecords.find((node) => node.kind === "project")?.id ?? null;
}

function normalizeIdentifierCollectionKind(collectionName: string): GraphNodeKind | null {
    switch (collectionName) {
        case "scripts": {
            return "script";
        }
        case "functions": {
            return "function";
        }
        case "structs": {
            return "struct";
        }
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
        case "localVariables": {
            return "local_variable";
        }
        case "structVariables": {
            return "struct_variable";
        }
        default: {
            return "script";
        }
    }
}

function normalizeResourceKind(resourceType: string | null): GraphNodeKind {
    switch (resourceType) {
        case "GMAnimCurve": {
            return "anim_curve";
        }
        case "GMExtension": {
            return "extension";
        }
        case "GMFont": {
            return "font";
        }
        case "GMIncludedFile": {
            return "data_file";
        }
        case "GMProject": {
            return "project";
        }
        case "GMNotes": {
            return "note";
        }
        case "GMObject": {
            return "object";
        }
        case "GMParticleSystem": {
            return "particle_system";
        }
        case "GMPath": {
            return "path";
        }
        case "GMRoom": {
            return "room";
        }
        case "GMRInstanceLayer": {
            return "room_layer";
        }
        case "GMRBackgroundLayer": {
            return "room_layer";
        }
        case "GMScript": {
            return "script";
        }
        case "GMSequence": {
            return "sequence";
        }
        case "GMSprite": {
            return "sprite";
        }
        case "GMShader": {
            return "shader";
        }
        case "GMSound": {
            return "sound";
        }
        case "GMTileSet": {
            return "tileset";
        }
        case "GMTimeline": {
            return "timeline";
        }
        default: {
            return "resource";
        }
    }
}

function isGraphResourceProjectionEligible(resourcePath: string, resourceRecord: Record<string, unknown>): boolean {
    if (resourcePath.split("/")[0] === "options") {
        return false;
    }

    const resourceType = getString(resourceRecord.resourceType);
    if (resourceType === "GMIncludedFile" && !resourcePath.startsWith("datafiles/")) {
        return false;
    }

    return resourceType === null || !/^GM[A-Za-z0-9]*Options$/u.test(resourceType);
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

function insertGraph(database: GraphDatabase, graphId: GraphIndexScope, rootPath: string): void {
    database
        .prepare(
            `
                INSERT OR REPLACE INTO graphs(id, scope, root_path, manifest_path, last_indexed_at, schema_version)
                VALUES (?, ?, ?, ?, ?, ?)
            `
        )
        .run(graphId, graphId, rootPath, null, new Date().toISOString(), GRAPH_INDEX_SCHEMA_VERSION);
}

function createFileRecord(
    rootPath: string,
    relativePath: string
): {
    contentHash: string;
    indexedAt: string;
    mtimeMs: number | null;
    relativePath: string;
} {
    const absolutePath = path.join(rootPath, relativePath);
    const stats = existsSync(absolutePath) ? statSync(absolutePath) : null;
    const fileContents = readSourceText(rootPath, relativePath) ?? "";
    return {
        contentHash: hashContent(fileContents),
        indexedAt: new Date().toISOString(),
        mtimeMs: stats?.mtimeMs ?? null,
        relativePath
    };
}

function insertFileRecord(
    database: GraphDatabase,
    graphId: GraphIndexScope,
    fileRecord: ProjectionContext["fileRecords"][number]
): void {
    database
        .prepare(
            `
                INSERT OR REPLACE INTO files(graph_id, relative_path, content_hash, mtime_ms, indexed_at)
                VALUES (?, ?, ?, ?, ?)
            `
        )
        .run(graphId, fileRecord.relativePath, fileRecord.contentHash, fileRecord.mtimeMs, fileRecord.indexedAt);
}

function insertNodeRecord(database: GraphDatabase, node: GraphNodeRecord): void {
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

function insertEdgeRecord(database: GraphDatabase, edge: GraphEdgeRecord): void {
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

function mergeScriptIdentifierIntoResourceNode(parameters: {
    context: ProjectionContext;
    displayName: string;
    filePath: string | null;
    lineEnd: number | null;
    lineStart: number | null;
    resourcePath: string | null;
    scopeId: string | null;
    scipSymbol: string;
    snippet: string;
    summary: string;
}): boolean {
    const { context, displayName, filePath, lineEnd, lineStart, resourcePath, scopeId, scipSymbol, snippet, summary } =
        parameters;
    if (!resourcePath) {
        return false;
    }

    const resourceNodeId = createGraphNodeId(context.graphId, "resource", resourcePath);
    const resourceNodeIndex = context.nodeRecords.findIndex(
        (node) => node.id === resourceNodeId && node.kind === "script"
    );
    if (resourceNodeIndex === -1) {
        return false;
    }

    const existingResourceNode = context.nodeRecords[resourceNodeIndex];
    if (!existingResourceNode) {
        return false;
    }

    context.nodeRecords[resourceNodeIndex] = createNodeRecord({
        displayName: existingResourceNode.displayName,
        filePath: filePath ?? existingResourceNode.filePath,
        graphId: existingResourceNode.graphId,
        id: existingResourceNode.id,
        kind: existingResourceNode.kind,
        lineEnd: lineEnd ?? existingResourceNode.lineEnd,
        lineStart: lineStart ?? existingResourceNode.lineStart,
        name: existingResourceNode.name,
        resourcePath: existingResourceNode.resourcePath,
        scopeId: scopeId ?? existingResourceNode.scopeId,
        scipSymbol,
        snippet: snippet.length > 0 ? snippet : existingResourceNode.snippet,
        summary
    });

    addNameIndexEntry(context, displayName, resourceNodeId);
    context.nodeIdsByScipSymbol.set(scipSymbol, resourceNodeId);
    if (scopeId) {
        context.nodeIdsByScopeId.set(scopeId, resourceNodeId);
    }

    return true;
}

function projectResources(context: ProjectionContext): void {
    const resources = asRecord(context.projectIndex.resources);
    let projectNodeId: string | null = null;
    const containedResourceNodeIds = new Set<string>();

    for (const [resourcePath, rawRecord] of Object.entries(resources)) {
        const resourceRecord = asRecord(rawRecord);
        if (!isGraphResourceProjectionEligible(resourcePath, resourceRecord)) {
            continue;
        }

        const name =
            getString(resourceRecord.name) ?? path.posix.basename(resourcePath, path.posix.extname(resourcePath));
        const kind = normalizeResourceKind(getString(resourceRecord.resourceType));
        const gmlFiles = Array.isArray(resourceRecord.gmlFiles) ? resourceRecord.gmlFiles : [];
        const primaryGmlFile = gmlFiles.find(
            (gmlFile): gmlFile is string => typeof gmlFile === "string" && gmlFile.trim().length > 0
        );
        const nodeId = createGraphNodeId(context.graphId, "resource", resourcePath);
        const node = createNodeRecord({
            displayName: name,
            filePath: kind === "script" ? (primaryGmlFile ?? null) : null,
            graphId: context.graphId,
            id: nodeId,
            kind,
            name,
            resourcePath,
            scipSymbol: kind === "script" ? `gml/script/${name}` : null,
            summary: createGraphNodeSummary({
                filePath: kind === "script" ? (primaryGmlFile ?? null) : null,
                kind,
                name,
                resourcePath
            })
        });

        context.nodeRecords.push(node);
        registerNodeIndexes(context, node);

        if (kind === "project") {
            projectNodeId = node.id;
        } else {
            containedResourceNodeIds.add(node.id);
        }

        for (const gmlFile of gmlFiles) {
            if (typeof gmlFile !== "string") {
                continue;
            }

            context.resourcePathByGmlFile.set(gmlFile, resourcePath);
        }
    }

    if (projectNodeId) {
        for (const resourceNodeId of containedResourceNodeIds) {
            context.edgeRecords.push({ fromId: projectNodeId, toId: resourceNodeId, type: "contains" });
        }
    }
}

function createObjectEventDisplayName(scopeRecord: ProjectIndexScopeRecord): string | null {
    const displayName = getString(scopeRecord.displayName);
    if (displayName) {
        return displayName;
    }

    return getString(scopeRecord.name);
}

function createObjectEventName(scopeRecord: ProjectIndexScopeRecord, firstFilePath: string | null): string | null {
    const name = getString(scopeRecord.name);
    if (name) {
        return name;
    }

    const eventRecord = asRecord(scopeRecord.event);
    const eventName = getString(eventRecord.name);
    if (eventName) {
        return eventName;
    }

    if (firstFilePath) {
        return path.posix.basename(firstFilePath, path.posix.extname(firstFilePath));
    }

    return null;
}

function projectObjectEventScopes(context: ProjectionContext): void {
    const scopes = asRecord(context.projectIndex.scopes);

    for (const rawScopeRecord of Object.values(scopes)) {
        const scopeRecord = asRecord(rawScopeRecord) as ProjectIndexScopeRecord;
        if (scopeRecord.kind !== "objectEvent") {
            continue;
        }

        const scopeId = getString(scopeRecord.id);
        const resourcePath = getString(scopeRecord.resourcePath);
        const filePath_ = (Array.isArray(scopeRecord.filePaths) ? scopeRecord.filePaths : []).find(
            (filePath): filePath is string => typeof filePath === "string" && filePath.trim().length > 0
        );
        const firstFilePath = filePath_ ?? null;
        const name = createObjectEventName(scopeRecord, firstFilePath);
        if (!scopeId || !resourcePath || !name) {
            continue;
        }

        const displayName = createObjectEventDisplayName(scopeRecord) ?? name;
        const node = createNodeRecord({
            displayName,
            filePath: firstFilePath,
            graphId: context.graphId,
            id: createGraphNodeId(context.graphId, "scope", scopeId),
            kind: "object_event",
            name,
            resourcePath,
            scopeId,
            summary: createGraphNodeSummary({
                filePath: firstFilePath,
                kind: "object_event",
                name,
                resourcePath
            })
        });

        context.nodeRecords.push(node);
        registerNodeIndexes(context, node);
        context.edgeRecords.push({
            fromId: createGraphNodeId(context.graphId, "resource", resourcePath),
            toId: node.id,
            type: "contains"
        });
    }
}

function projectRoomLayerScopes(context: ProjectionContext): void {
    const resources = asRecord(context.projectIndex.resources);

    for (const [resourcePath, rawRecord] of Object.entries(resources)) {
        const resourceRecord = asRecord(rawRecord);
        const resourceType = getString(resourceRecord.resourceType);

        if (resourceType !== "GMRoom") {
            continue;
        }

        const roomNodeId = createGraphNodeId(context.graphId, "resource", resourcePath);
        const layers = asRecord(resourceRecord.layers);
        if (!Array.isArray(layers)) {
            continue;
        }

        for (const rawLayer of layers) {
            const layer = asRecord(rawLayer);
            const layerResourceType = getString(layer.resourceType);
            const layerName = getString(layer.name);

            if (!isGraphRoomLayerResourceType(layerResourceType) || !layerName) {
                continue;
            }

            const scopeId = `scope:room-layer:${resourcePath}:${layerName}`;
            const node = createNodeRecord({
                displayName: createRoomLayerDisplayName(layerName, layerResourceType),
                filePath: null,
                graphId: context.graphId,
                id: createGraphNodeId(context.graphId, "scope", scopeId),
                kind: "room_layer",
                name: layerName,
                resourcePath,
                scopeId,
                summary: createGraphNodeSummary({
                    filePath: null,
                    kind: "room_layer",
                    name: layerName,
                    resourcePath
                })
            });

            context.nodeRecords.push(node);
            registerNodeIndexes(context, node);
            context.edgeRecords.push({
                fromId: roomNodeId,
                toId: node.id,
                type: "contains"
            });
        }
    }
}

function isGraphRoomLayerResourceType(resourceType: string | null): resourceType is string {
    return typeof resourceType === "string" && /^GMR[A-Za-z0-9]+Layer$/u.test(resourceType);
}

function createRoomLayerDisplayName(layerName: string, layerResourceType: string): string {
    const layerTypeLabel = layerResourceType.replace(/^GMR/u, "").replace(/Layer$/u, " Layer");
    return `${layerName} (${layerTypeLabel})`;
}

function projectFileRecords(context: ProjectionContext): void {
    const files = asRecord(context.projectIndex.files);
    for (const relativePath of Object.keys(files)) {
        context.fileRecords.push(createFileRecord(context.rootPath, relativePath));
    }
}

function projectIdentifierCollections(context: ProjectionContext): void {
    const identifiers = asRecord(context.projectIndex.identifiers);

    for (const [collectionName, collectionValue] of Object.entries(identifiers)) {
        const kind = normalizeIdentifierCollectionKind(collectionName);
        if (!kind) {
            continue;
        }

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
            const resourcePath = getString(entry.resourcePath) ?? resolveResourcePathForFile(context, filePath);
            const scipSymbol = resolveScipSymbol(kind, name, entry);
            const sourceText = readSourceText(context.rootPath, filePath);
            const displayName = getString(entry.displayName) ?? name;
            const scopeId = getString(entry.scopeId) ?? getString(entry.id);
            const snippet = createGraphNodeSnippet(sourceText, declarationStart, declarationEnd);
            const summary = createGraphNodeSummary({
                docCommentSummary: extractDocCommentFirstSentence(sourceText, declarationStart),
                filePath,
                kind,
                name,
                resourcePath
            });
            if (
                kind === "script" &&
                mergeScriptIdentifierIntoResourceNode({
                    context,
                    displayName,
                    filePath,
                    lineEnd: readLocationLine(asRecord(declaration?.end)),
                    lineStart: readLocationLine(asRecord(declaration?.start)),
                    resourcePath,
                    scopeId,
                    scipSymbol,
                    snippet,
                    summary
                })
            ) {
                continue;
            }
            const node = createNodeRecord({
                displayName,
                filePath,
                graphId: context.graphId,
                id: createGraphNodeId(context.graphId, "symbol", scipSymbol),
                kind,
                lineEnd: readLocationLine(asRecord(declaration?.end)),
                lineStart: readLocationLine(asRecord(declaration?.start)),
                name,
                resourcePath,
                scopeId,
                scipSymbol,
                snippet,
                summary
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

            if (kind === "enum_member") {
                const enumNodeId = resolveEnumOwnerNodeId(context, entry);
                if (enumNodeId) {
                    context.edgeRecords.push({
                        fromId: enumNodeId,
                        toId: node.id,
                        type: "defines"
                    });
                }
            }
        }
    }
}

function projectGlobalVariableReferenceEdges(context: ProjectionContext): void {
    projectIdentifierOwnershipEdges(context, "globalVariables", "global_variable");
    projectIdentifierOwnershipEdges(context, "macros", "macro");
    projectIdentifierOwnershipEdges(context, "localVariables", "local_variable");
}

function projectIdentifierOwnershipEdges(
    context: ProjectionContext,
    collectionName: "globalVariables" | "localVariables" | "macros",
    kind: "global_variable" | "local_variable" | "macro"
): void {
    const identifiers = asRecord(context.projectIndex.identifiers?.[collectionName]);

    for (const entryValue of Object.values(identifiers)) {
        const entry = asRecord(entryValue) as ProjectIndexIdentifierEntry;
        const name = getString(entry.name);
        if (!name) {
            continue;
        }

        const targetScipSymbol = resolveScipSymbol(kind, name, entry);
        const targetNodeId = context.nodeIdsByScipSymbol.get(targetScipSymbol) ?? null;
        if (!targetNodeId) {
            continue;
        }

        const declarations = Array.isArray(entry.declarations) ? entry.declarations : [];
        for (const rawDeclaration of declarations) {
            const declaration = asRecord(rawDeclaration);
            const filePath = getString(declaration.filePath) ?? getString(entry.filePath);
            if (!filePath) {
                continue;
            }

            const scopeId = getString(declaration.scopeId) ?? getString(entry.scopeId);
            const locationLine = readLocationLine(asRecord(declaration.start));
            const sourceNodeId = resolveScopedFileOwnerNodeId(
                context,
                filePath,
                resolveProjectRootNodeId(context) ?? targetNodeId,
                scopeId,
                locationLine
            );
            context.edgeRecords.push({
                fromId: sourceNodeId,
                toId: targetNodeId,
                type: "defines"
            });
        }

        const references = Array.isArray(entry.references) ? entry.references : [];
        for (const rawReference of references) {
            const reference = asRecord(rawReference);
            const filePath = getString(reference.filePath) ?? getString(entry.filePath);
            if (!filePath) {
                continue;
            }

            const scopeId = getString(reference.scopeId) ?? getString(entry.scopeId);
            const locationLine = readLocationLine(asRecord(reference.start));
            const sourceNodeId = resolveScopedFileOwnerNodeId(
                context,
                filePath,
                resolveProjectRootNodeId(context) ?? targetNodeId,
                scopeId,
                locationLine
            );
            context.edgeRecords.push({
                fromId: sourceNodeId,
                toId: targetNodeId,
                type: "references"
            });
        }
    }
}

function projectRelationshipEdges(context: ProjectionContext): void {
    const files = asRecord(context.projectIndex.files);
    for (const [relativePath, rawFileRecord] of Object.entries(files)) {
        const fileRecord = asRecord(rawFileRecord);
        const scriptCalls = Array.isArray(fileRecord.scriptCalls) ? fileRecord.scriptCalls : [];
        const callerOwnerNodeId =
            resolveFileSemanticOwnerNodeId(context, relativePath) ?? resolveProjectRootNodeId(context);
        if (!callerOwnerNodeId) {
            continue;
        }

        for (const rawCall of scriptCalls) {
            const callRecord = asRecord(rawCall);
            const targetName = getString(asRecord(callRecord.target).name);
            if (!targetName) {
                continue;
            }

            const callerNodeId = resolveCallerNodeId(
                context,
                relativePath,
                callerOwnerNodeId,
                callRecord,
                getString(fileRecord.scopeId)
            );
            const targetNodeId = resolveCallTargetNodeId(context, callRecord, targetName, relativePath);
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

        const edgeType = classifyAssetReferenceEdgeType(reference);
        context.edgeRecords.push({
            fromId: resolveAssetReferenceSourceNodeId(context, reference, fromResourcePath, edgeType),
            toId: createGraphNodeId(context.graphId, "resource", targetPath),
            type: edgeType
        });
    }

    projectGlobalVariableReferenceEdges(context);
}

function resolveAssetReferenceSourceNodeId(
    context: ProjectionContext,
    reference: Record<string, unknown>,
    fromResourcePath: string,
    edgeType: GraphEdgeType
): string {
    if (edgeType !== "placed_in_room") {
        return createGraphNodeId(context.graphId, "resource", fromResourcePath);
    }

    const roomLayerNodeId = resolveRoomLayerNodeIdFromAssetReference(context, reference, fromResourcePath);
    return roomLayerNodeId ?? createGraphNodeId(context.graphId, "resource", fromResourcePath);
}

function resolveRoomLayerNodeIdFromAssetReference(
    context: ProjectionContext,
    reference: Record<string, unknown>,
    roomResourcePath: string
): string | null {
    const propertyPath = getString(reference.propertyPath);
    if (!propertyPath) {
        return null;
    }

    const layerMatch = /^layers\.(\d+)\./u.exec(propertyPath);
    const layerIndex = Number(layerMatch?.[1]);
    if (!Number.isInteger(layerIndex) || layerIndex < 0) {
        return null;
    }

    const roomRecord = asRecord(asRecord(context.projectIndex.resources)[roomResourcePath]);
    const layers = roomRecord.layers;
    if (!Array.isArray(layers) || layerIndex >= layers.length) {
        return null;
    }

    const layerRecord = asRecord(layers[layerIndex]);
    const layerName = getString(layerRecord.name);
    const layerResourceType = getString(layerRecord.resourceType);
    if (!layerName || !isGraphRoomLayerResourceType(layerResourceType)) {
        return null;
    }

    return createGraphNodeId(context.graphId, "scope", `scope:room-layer:${roomResourcePath}:${layerName}`);
}

function classifyAssetReferenceEdgeType(reference: Record<string, unknown>): GraphEdgeType {
    const propertyPath = getString(reference.propertyPath);
    if (propertyPath?.endsWith("parentObjectId")) {
        return "inherits";
    }

    const fromResourcePath = getString(reference.fromResourcePath);
    const targetPath = getString(reference.targetPath);
    if (fromResourcePath?.startsWith("rooms/") && targetPath?.startsWith("objects/")) {
        return "placed_in_room";
    }

    return fromResourcePath && isProjectManifestPath(fromResourcePath) ? "contains" : "references";
}

function addCrossGraphEdges(
    database: GraphDatabase,
    projectContext: ProjectionContext | null,
    toolsetContext: ProjectionContext | null
): Array<GraphEdgeRecord> {
    if (!projectContext || !toolsetContext) {
        return [];
    }

    const crossEdges: Array<GraphEdgeRecord> = [];
    const projectIndexedFiles = asRecord(projectContext.projectIndex.files);

    for (const [relativePath, rawFileRecord] of Object.entries(projectIndexedFiles)) {
        const fileRecord = asRecord(rawFileRecord);
        const scriptCalls = Array.isArray(fileRecord.scriptCalls) ? fileRecord.scriptCalls : [];
        const projectCallerOwnerNodeId =
            resolveFileSemanticOwnerNodeId(projectContext, relativePath) ?? resolveProjectRootNodeId(projectContext);
        if (!projectCallerOwnerNodeId) {
            continue;
        }

        for (const rawCall of scriptCalls) {
            const callRecord = asRecord(rawCall);
            const targetName = getString(asRecord(callRecord.target).name);
            if (!targetName) {
                continue;
            }

            const targetKind = getString(callRecord.kind);
            if (targetKind === "function" || hasFunctionOrScriptNodeByName(projectContext, targetName)) {
                continue;
            }

            const projectCallerNodeId = resolveCallerNodeId(
                projectContext,
                relativePath,
                projectCallerOwnerNodeId,
                callRecord,
                getString(fileRecord.scopeId)
            );
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

function removeDanglingEdges(context: ProjectionContext): void {
    const nodeIds = new Set(context.nodeRecords.map((node) => node.id));
    context.edgeRecords = context.edgeRecords.filter((edge) => nodeIds.has(edge.fromId) && nodeIds.has(edge.toId));
}

function persistProjection(
    database: GraphDatabase,
    context: ProjectionContext,
    embeddingsConfig: GraphEmbeddingsConfig,
    buildDurationMs: number
): void {
    const embeddingProvider = embeddingsConfig.enabled ? createGraphEmbeddingProvider(embeddingsConfig) : null;

    insertGraph(database, context.graphId, context.rootPath);

    for (const fileRecord of context.fileRecords) {
        insertFileRecord(database, context.graphId, fileRecord);
    }

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
    graphId: GraphIndexScope,
    rootPath: string,
    projectIndex: ProjectIndexSnapshot
): ProjectionContext {
    return {
        edgeRecords: [],
        fileRecords: [],
        graphId,
        nodeIdsByName: new Map(),
        nodeIdsByScipSymbol: new Map(),
        nodeIdsByScopeId: new Map(),
        nodeRecords: [],
        projectIndex,
        resourcePathByGmlFile: new Map(),
        rootPath
    };
}

function queryNodeById(database: GraphDatabase, nodeId: string): GraphNodeRecord | null {
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

function listNodeNeighbors(database: GraphDatabase, nodeId: string, depth = 1): Array<GraphNeighborRecord> {
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

function listUsageRecords(database: GraphDatabase, nodeId: string, depth = 1): Array<GraphUsageRecord> {
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
    database: GraphDatabase,
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

function applyGraphProximityBoost(database: GraphDatabase, candidateScores: Map<string, number>): void {
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

function refreshIndexStateEdgeCounts(database: GraphDatabase): void {
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

function readIndexedFileHashes(database: GraphDatabase, graphId: GraphIndexScope): Map<string, string> {
    const rows = database
        .prepare("SELECT relative_path AS relativePath, content_hash AS contentHash FROM files WHERE graph_id = ?")
        .all(graphId) as Array<{ contentHash: string | null; relativePath: string }>;
    return new Map(rows.map((row) => [row.relativePath, row.contentHash ?? ""]));
}

function shouldReprojectGraph(
    database: GraphDatabase,
    context: ProjectionContext,
    embeddingsConfig: GraphEmbeddingsConfig
): boolean {
    const graphRow = database.prepare("SELECT root_path AS rootPath FROM graphs WHERE id = ?").get(context.graphId) as
        | { rootPath: string }
        | undefined;
    if (!graphRow || graphRow.rootPath !== context.rootPath) {
        return true;
    }

    const indexStateRow = database
        .prepare("SELECT embedding_model AS embeddingModel FROM index_state WHERE graph_id = ?")
        .get(context.graphId) as { embeddingModel: string } | undefined;
    if (!indexStateRow) {
        return true;
    }

    const expectedEmbeddingModel = embeddingsConfig.enabled ? embeddingsConfig.provider : "disabled";
    if (indexStateRow.embeddingModel !== expectedEmbeddingModel) {
        return true;
    }

    const indexedFileHashes = readIndexedFileHashes(database, context.graphId);
    if (indexedFileHashes.size !== context.fileRecords.length) {
        return true;
    }

    for (const fileRecord of context.fileRecords) {
        if (indexedFileHashes.get(fileRecord.relativePath) !== fileRecord.contentHash) {
            return true;
        }
    }

    return false;
}

function deleteGraphProjection(database: GraphDatabase, graphId: GraphIndexScope): void {
    database.prepare("DELETE FROM node_fts WHERE id IN (SELECT id FROM nodes WHERE graph_id = ?)").run(graphId);
    database.prepare("DELETE FROM graphs WHERE id = ?").run(graphId);
}

function rebuildGraphProjectionIfNeeded(
    database: GraphDatabase,
    context: ProjectionContext,
    embeddingsConfig: GraphEmbeddingsConfig,
    buildDurationMs: number
): boolean {
    if (!shouldReprojectGraph(database, context, embeddingsConfig)) {
        return false;
    }

    deleteGraphProjection(database, context.graphId);
    persistProjection(database, context, embeddingsConfig, buildDurationMs);
    return true;
}

function readGraphDatabaseIntegrityStatus(database: GraphDatabase): GraphDatabaseIntegrityStatus {
    const integrity = inspectGraphDatabaseIntegrity(database);
    return Object.freeze({
        foreignKeyViolationCount: integrity.foreignKeyViolationCount,
        ok: integrity.ok,
        quickCheckResult: integrity.quickCheckResult
    });
}

/**
 * Build or rebuild the SQLite-backed graph index.
 */
export async function buildGraphIndex(options: GraphIndexBuildOptions): Promise<GraphIndexBuildResult> {
    const config = resolveGraphIndexConfig(options);
    if (options.rebuild && existsSync(config.databasePath)) {
        rmSync(config.databasePath, { force: true });
    }

    const database = openGraphIndexDatabase(config.databasePath);

    // Guard the database handle with a finally block so it is always closed,
    // even when an async indexing step (e.g. buildProjectIndex) throws, or when
    // a synchronous step such as ensureGraphEmbeddingModelAssets throws.  Without
    // this, any error thrown between the openGraphIndexDatabase call above and the
    // database.close() call silently leaks the SQLite file descriptor and leaves
    // the WAL/SHM journal files in an inconsistent state.
    try {
        if (config.embeddings.enabled) {
            ensureGraphEmbeddingModelAssets(config.embeddings);
        }
        const buildStart = performance.now();
        const projectIndex = (await buildProjectIndex(config.projectRoot)) as ProjectIndexSnapshot;
        const projectContext = createProjectionContext("project", config.projectRoot, projectIndex);
        projectResources(projectContext);
        projectObjectEventScopes(projectContext);
        projectRoomLayerScopes(projectContext);
        projectFileRecords(projectContext);
        projectIdentifierCollections(projectContext);
        projectRelationshipEdges(projectContext);
        removeDanglingEdges(projectContext);

        let toolsetContext: ProjectionContext | null = null;
        if (config.toolsetRoot) {
            const toolsetIndex = (await buildProjectIndex(config.toolsetRoot)) as ProjectIndexSnapshot;
            toolsetContext = createProjectionContext("toolset", config.toolsetRoot, toolsetIndex);
            projectResources(toolsetContext);
            projectObjectEventScopes(toolsetContext);
            projectRoomLayerScopes(toolsetContext);
            projectFileRecords(toolsetContext);
            projectIdentifierCollections(toolsetContext);
            projectRelationshipEdges(toolsetContext);
            removeDanglingEdges(toolsetContext);
        }

        const buildDurationMs = performance.now() - buildStart;
        rebuildGraphProjectionIfNeeded(database, projectContext, config.embeddings, buildDurationMs);
        if (toolsetContext) {
            rebuildGraphProjectionIfNeeded(database, toolsetContext, config.embeddings, buildDurationMs);
        }

        database.prepare("DELETE FROM edges WHERE type = 'uses_toolset'").run();
        addCrossGraphEdges(database, projectContext, toolsetContext);
        refreshIndexStateEdgeCounts(database);
        optimizeGraphDatabase(database);
    } finally {
        database.close();
    }

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
            .prepare("SELECT id, scip_symbol AS scipSymbol FROM nodes WHERE name = ? OR scip_symbol = ?")
            .all(normalizedQuery, normalizedQuery) as Array<{ id: string; scipSymbol: string | null }>;
        for (const row of exactRows) {
            candidateScores.set(row.id, (candidateScores.get(row.id) ?? 0) + (row.scipSymbol ? 7 : 5));
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
                    .filter((entry) => GRAPH_RESOURCE_NODE_KINDS.has(entry.node.kind))
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
            integrity: null,
            issues,
            runtime: null
        });
    }

    const database = openExistingGraphIndexDatabase(config.databasePath);
    try {
        const runtime = getGraphDatabaseRuntimeInfo(database);
        const integrity = readGraphDatabaseIntegrityStatus(database);
        const schemaVersion = readGraphIndexSchemaVersion(database);
        if (schemaVersion !== GRAPH_INDEX_SCHEMA_VERSION) {
            issues.push({
                code: "GRAPH_SCHEMA_INCOMPATIBLE",
                message: `Graph database schema ${String(schemaVersion)} is incompatible with expected schema ${String(GRAPH_INDEX_SCHEMA_VERSION)}. Run 'gmloop graph index --force'.`,
                severity: "error"
            });
        }
        if (!integrity.ok) {
            issues.push({
                code: "GRAPH_DB_INTEGRITY",
                message: `Graph database integrity check returned '${integrity.quickCheckResult}' with ${String(integrity.foreignKeyViolationCount)} foreign-key violation(s). Run 'gmloop graph index --force'.`,
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
                    message: `${String(staleFileCount)} indexed file(s) changed or disappeared under ${row.rootPath}. Run 'gmloop graph index --force'.`,
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
            integrity,
            issues,
            runtime
        });
    } finally {
        database.close();
    }
}

export const __graphIndexBuilderTest__ = Object.freeze({
    createSafeFtsQuery,
    resolveScipSymbol
});
