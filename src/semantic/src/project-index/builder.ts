import path from "node:path";

import { Core } from "@gmloop/core";

import { loadBuiltInIdentifiers } from "../symbols/built-in-identifiers.js";
import { createProjectIndexAbortGuard, PROJECT_INDEX_BUILD_ABORT_MESSAGE } from "./abort-guard.js";
import { getDefaultProjectIndexCacheMaxSize, loadProjectIndexCache, saveProjectIndexCache } from "./cache.js";
import { clampConcurrency } from "./concurrency.js";
import { createProjectIndexCoordinator as createProjectIndexCoordinatorCore } from "./coordinator.js";
import { defaultFsFacade, type ProjectIndexFsFacade, runWithMissingPathFallback } from "./fs-facade.js";
import { resolveProjectIndexParser } from "./gml-parser-facade.js";
import { assertValidIdentifierRole, IdentifierRole } from "./identifier-roles.js";
import { createIdentifierSink, type IdentifierSink, type IdentifierSinkRole } from "./identifier-sink.js";
import { createProjectIndexMetrics, finalizeProjectIndexMetrics } from "./metrics.js";
import { logProjectIndexDebug, type ProjectIndexLogger } from "./project-index-logger.js";
import { scanProjectTree } from "./project-tree.js";
import { analyseResourceFiles, createFileScopeDescriptor } from "./resource-analysis.js";

type BuildProjectIndexFunction = (
    projectRoot: string,
    fsFacade?: ProjectIndexFsFacade,
    options?: Record<string, unknown>
) => Promise<unknown>;

type ProjectIndexCoordinatorOptions = {
    fsFacade?: ProjectIndexFsFacade | null;
    loadCache?: typeof loadProjectIndexCache;
    saveCache?: typeof saveProjectIndexCache;
    buildIndex?: BuildProjectIndexFunction;
    cacheMaxSizeBytes?: number | null;
    getDefaultCacheMaxSize?: typeof getDefaultProjectIndexCacheMaxSize;
};

const IDENTIFIER_DECLARATION_LOCATION_KEYS = Symbol("identifierDeclarationLocationKeys");

const IDENTIFIER_COLLECTION_NAMES = Object.freeze({
    scripts: "scripts",
    functions: "functions",
    structs: "structs",
    macros: "macros",
    enums: "enums",
    enumMembers: "enumMembers",
    globalVariables: "globalVariables",
    instanceVariables: "instanceVariables",
    localVariables: "localVariables",
    structVariables: "structVariables"
});

/**
 * Create shallow clones of common entry collections stored on project index
 * records (for example declaration/reference lists). Guarding against
 * non-object input keeps the helper resilient when callers forward values
 * sourced from partially populated caches.
 */
function cloneEntryCollections(entry, ...keys) {
    const source = Core.isObjectLike(entry) ? entry : {};
    return Object.fromEntries(keys.map((key) => [key, Core.cloneObjectEntries(source[key])]));
}
export function createProjectIndexCoordinator(options: ProjectIndexCoordinatorOptions = {}) {
    const {
        fsFacade = defaultFsFacade,
        loadCache = loadProjectIndexCache,
        saveCache = saveProjectIndexCache,
        buildIndex = buildProjectIndex,
        cacheMaxSizeBytes,
        getDefaultCacheMaxSize = getDefaultProjectIndexCacheMaxSize
    } = options;
    return createProjectIndexCoordinatorCore({
        fsFacade,
        loadCache,
        saveCache,
        buildIndex,
        cacheMaxSizeBytes,
        getDefaultCacheMaxSize
    });
}
function cloneIdentifierDeclaration(declaration) {
    if (!Core.isObjectLike(declaration)) {
        return null;
    }
    return {
        start: Core.cloneLocation(declaration.start),
        end: Core.cloneLocation(declaration.end),
        scopeId: declaration.scopeId ?? null
    };
}
type IdentifierDeclarationRecord = ReturnType<typeof cloneIdentifierDeclaration>;
type ProjectIdentifierRecord = {
    name: string | null;
    start: ReturnType<typeof Core.cloneLocation>;
    end: ReturnType<typeof Core.cloneLocation>;
    scopeId: string | null;
    classifications: Array<string>;
    declaration: IdentifierDeclarationRecord;
    isGlobalIdentifier: boolean;
    isBuiltIn?: boolean;
    reason?: string | null;
    isSynthetic?: boolean;
    filePath?: string | null;
};
function createIdentifierRecord(node): ProjectIdentifierRecord {
    return {
        name: node?.name ?? null,
        start: Core.cloneLocation(node?.start),
        end: Core.cloneLocation(node?.end),
        scopeId: node?.scopeId ?? null,
        classifications: Core.asArray(node?.classifications).filter((value) => typeof value === "string"),
        declaration: cloneIdentifierDeclaration(node?.declaration),
        isGlobalIdentifier: node?.isGlobalIdentifier === true,
        isBuiltIn: node?.isBuiltIn === true,
        reason: null,
        isSynthetic: node?.isSynthetic === true
    };
}
function cloneIdentifierForCollections(record, filePath) {
    return {
        name: record?.name ?? null,
        filePath: filePath ?? null,
        scopeId: record?.scopeId ?? null,
        start: Core.cloneLocation(record?.start),
        end: Core.cloneLocation(record?.end),
        classifications: Core.asArray(record?.classifications).filter((value) => typeof value === "string"),
        declaration: record?.declaration ? { ...record.declaration } : null,
        isBuiltIn: record?.isBuiltIn ?? false,
        reason: record?.reason ?? null,
        isSynthetic: record?.isSynthetic ?? false,
        isGlobalIdentifier: record?.isGlobalIdentifier ?? false
    };
}
function ensureCollectionEntry(map, key, initializer) {
    return Core.getOrCreateMapEntry(map, key, initializer);
}
function ensureIdentifierCollectionEntry({ collection, key, identifierId, initializer }) {
    return ensureCollectionEntry(collection, key, () => {
        const initializerValue = typeof initializer === "function" ? initializer() : initializer;
        const {
            declarations: initialDeclarations,
            references: initialReferences,
            ...rest
        } = Core.isObjectLike(initializerValue) ? initializerValue : {};
        const declarations = Core.toMutableArray(initialDeclarations, { clone: true });
        const references = Core.toMutableArray(initialReferences, { clone: true });
        return {
            identifierId,
            declarations,
            references,
            ...rest
        };
    });
}
function recordIdentifierCollectionRole({
    entry,
    identifierRecord,
    filePath,
    role,
    collectionName,
    collectionKey,
    identifierSink
}) {
    if (!entry || !identifierRecord) {
        return;
    }

    const validatedRole = assertValidIdentifierRole(role);
    const clone = cloneIdentifierForCollections(identifierRecord, filePath);

    const sinkRole: IdentifierSinkRole = validatedRole === IdentifierRole.DECLARATION ? "declarations" : "references";

    const shouldSinkRecord = sinkRole !== "declarations" || clone?.isSynthetic !== true;

    if (identifierSink && shouldSinkRecord) {
        identifierSink.append({
            collection: collectionName,
            key: collectionKey,
            role: sinkRole,
            payload: clone
        });
    }

    const targetArray = sinkRole === "declarations" ? entry.declarations : entry.references;
    targetArray?.push?.(clone);

    if (!identifierSink || !Array.isArray(targetArray)) {
        return;
    }

    const retainedEntriesPerKey = identifierSink.getRetainedEntriesPerKey();
    while (targetArray.length > retainedEntriesPerKey) {
        targetArray.shift();
    }
}
function ensureIdentifierEntryWithRole({
    collection,
    key,
    identifierId,
    initializer,
    metadata,
    identifierRecord,
    filePath,
    role,
    collectionName,
    identifierSink
}) {
    const entry = ensureIdentifierCollectionEntry({
        collection,
        key,
        identifierId,
        initializer
    });
    if (!entry) {
        return null;
    }
    assignIdentifierEntryMetadata(entry, metadata);
    recordIdentifierCollectionRole({
        entry,
        identifierRecord,
        filePath,
        role,
        collectionName,
        collectionKey: key,
        identifierSink
    });
    return entry;
}
function assignIdentifierEntryMetadata(entry, metadata) {
    if (!Core.isObjectLike(entry)) {
        return entry;
    }
    const { identifierId, name, displayName, resourcePath, enumName, scopeId, scopeKind } = metadata ?? {};
    if (identifierId !== undefined && !entry.identifierId) {
        entry.identifierId = identifierId;
    }
    if (name && !entry.name) {
        entry.name = name;
    }
    if (displayName && !entry.displayName) {
        entry.displayName = displayName;
    }
    if (resourcePath && !entry.resourcePath) {
        entry.resourcePath = resourcePath;
    }
    if (enumName && !entry.enumName) {
        entry.enumName = enumName;
    }
    if (scopeId !== undefined && !entry.scopeId) {
        entry.scopeId = scopeId;
    }
    if (scopeKind !== undefined && !entry.scopeKind) {
        entry.scopeKind = scopeKind;
    }
    return entry;
}
function createIdentifierCollections() {
    return {
        scripts: new Map(),
        functions: new Map(),
        structs: new Map(),
        macros: new Map(),
        enums: new Map(),
        enumMembers: new Map(),
        globalVariables: new Map(),
        instanceVariables: new Map(),
        localVariables: new Map(),
        structVariables: new Map()
    };
}
function buildIdentifierId(scope, value) {
    if (!scope || typeof scope !== "string") {
        return null;
    }
    if (typeof value !== "string" || value.length === 0) {
        return null;
    }
    return `${scope}:${value}`;
}
function computeLineOffsets(source) {
    const offsets = [0];
    if (typeof source !== "string" || source.length === 0) {
        return offsets;
    }
    for (const { index, length } of Core.getLineBreakSpans(source)) {
        offsets.push(index + length);
    }
    return offsets;
}
function buildLocationFromIndex(index, lineOffsets) {
    if (typeof index !== "number" || index < 0) {
        return null;
    }
    const offsets = Array.isArray(lineOffsets) ? lineOffsets : [0];
    let low = 0;
    let high = offsets.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const value = offsets[mid];
        if (value <= index) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    const resolvedLineIndex = Core.clamp(high, 0, offsets.length - 1);
    const lineStart = offsets[resolvedLineIndex] ?? 0;
    const lineNumber = resolvedLineIndex + 1;
    const column = index - lineStart;
    return {
        line: lineNumber,
        column,
        index
    };
}
function findIdentifierLocation({ source, name, searchStart, searchEnd, lineOffsets }) {
    if (typeof source !== "string" || typeof name !== "string") {
        return null;
    }
    const effectiveStart = Math.max(0, searchStart ?? 0);
    const effectiveEnd = Math.min(source.length, searchEnd === undefined ? source.length : searchEnd);
    let index = source.indexOf(name, effectiveStart);
    while (index !== -1 && index < effectiveEnd) {
        const before = index > 0 ? source[index - 1] : "";
        const after = index + name.length < source.length ? source[index + name.length] : "";
        if (Core.isIdentifierBoundaryCharacter(before) && Core.isIdentifierBoundaryCharacter(after)) {
            const start = buildLocationFromIndex(index, lineOffsets);
            const end = buildLocationFromIndex(index + Math.max(0, name.length - 1), lineOffsets);
            if (start && end) {
                return { start, end };
            }
        }
        index = source.indexOf(name, index + 1);
    }
    return null;
}
function removeSyntheticScriptDeclarations(collection, { name, scopeId }) {
    if (!Array.isArray(collection)) {
        return;
    }
    for (let index = collection.length - 1; index >= 0; index -= 1) {
        const entry = collection[index];
        if (!entry || !entry.isSynthetic) {
            continue;
        }
        if (name && entry.name && entry.name !== name) {
            continue;
        }
        if (scopeId && entry.scopeId && entry.scopeId !== scopeId) {
            continue;
        }
        collection.splice(index, 1);
    }
}
function createFunctionLikeIdentifierRecord({ node, scopeRecord, fileRecord, classification, source, lineOffsets }) {
    if (!node || !scopeRecord || !fileRecord) {
        return null;
    }
    const rawName = typeof node.id === "string" ? node.id : typeof node.id?.name === "string" ? node.id.name : null;
    if (!rawName) {
        return null;
    }
    const headerStart = node.start?.index ?? 0;
    const headerEnd = node.body?.start?.index ?? node.end?.index ?? source?.length ?? 0;
    const location = findIdentifierLocation({
        source,
        name: rawName,
        searchStart: headerStart,
        searchEnd: headerEnd,
        lineOffsets
    });
    if (!location) {
        return null;
    }
    const classificationArray = Core.toArray(classification);
    const classificationTags = ["identifier", "declaration"];
    for (const tag of classificationArray) {
        if (tag) {
            Core.pushUnique(classificationTags, tag);
        }
    }
    const start = Core.cloneLocation(location.start);
    const end = Core.cloneLocation(location.end);
    return {
        name: rawName,
        start,
        end,
        scopeId: scopeRecord.id,
        classifications: classificationTags,
        declaration: {
            start: Core.cloneLocation(start),
            end: Core.cloneLocation(end),
            scopeId: scopeRecord.id
        },
        isBuiltIn: false,
        isSynthetic: false,
        filePath: fileRecord.filePath
    };
}
function createEnumLookup(ast, filePath) {
    const enumDeclarations = new Map();
    const memberDeclarations = new Map();
    const visitStack = [ast];
    const seen = new Set();
    while (visitStack.length > 0) {
        const node = visitStack.pop();
        if (!Core.isObjectLike(node)) {
            continue;
        }
        if (seen.has(node)) {
            continue;
        }
        seen.add(node);
        if (node.type === "EnumDeclaration") {
            const enumData = collectEnumDeclarationData(node, filePath);
            if (enumData) {
                enumDeclarations.set(enumData.enumEntry.key, enumData.enumEntry);
                for (const memberEntry of enumData.memberEntries) {
                    memberDeclarations.set(memberEntry.key, memberEntry);
                }
            }
        }
        const values = Object.values(node);
        for (const value of values) {
            pushNodeValueChildren(visitStack, value);
        }
    }
    return { enumDeclarations, memberDeclarations };
}

function collectEnumDeclarationData(node: any, filePath: string | null) {
    const enumIdentifier = node.name;
    if (!Core.isIdentifierNode(enumIdentifier)) {
        return null;
    }

    const enumKey = Core.buildFileLocationKey(filePath, enumIdentifier.start);
    if (!enumKey) {
        return null;
    }

    const enumEntry = {
        key: enumKey,
        name: enumIdentifier.name ?? null,
        filePath: filePath ?? null
    };

    const memberEntries = [];
    for (const member of Core.asArray(node.members)) {
        const memberEntry = buildEnumMemberEntry(member, enumKey, filePath);
        if (memberEntry) {
            memberEntries.push(memberEntry);
        }
    }

    return { enumEntry, memberEntries };
}

function buildEnumMemberEntry(member: unknown, enumKey: string, filePath: string | null) {
    if (!Core.isObjectLike(member)) {
        return null;
    }

    const memberNode = member as Record<string, unknown>;
    const memberIdentifier = memberNode.name;
    if (!Core.isIdentifierNode(memberIdentifier)) {
        return null;
    }

    const memberKey = Core.buildFileLocationKey(filePath, memberIdentifier.start);
    if (!memberKey) {
        return null;
    }

    return {
        key: memberKey,
        name: memberIdentifier.name ?? null,
        enumKey,
        filePath: filePath ?? null
    };
}
function ensureScriptEntry(identifierCollections, descriptor) {
    if (!descriptor || !descriptor.id || descriptor.kind !== "script") {
        return null;
    }
    const identifierId = buildIdentifierId("script", descriptor.id);
    return ensureIdentifierCollectionEntry({
        collection: identifierCollections.scripts,
        key: descriptor.id,
        identifierId,
        initializer: () => ({
            id: descriptor.id,
            name: descriptor.name ?? null,
            displayName: descriptor.displayName ?? descriptor.name ?? descriptor.id,
            resourcePath: descriptor.resourcePath ?? null,
            declarationKinds: []
        })
    });
}
function createFunctionLikeCollectionKey(filePath, declarationRecord) {
    const locationKey = Core.buildFileLocationKey(filePath, declarationRecord?.start);
    if (locationKey) {
        return locationKey;
    }

    if (declarationRecord?.scopeId && declarationRecord?.name) {
        return `${declarationRecord.scopeId}:${declarationRecord.name}`;
    }

    return declarationRecord?.name ?? null;
}
function registerFunctionLikeSymbolDeclaration({
    collection,
    collectionName,
    identifierCollections,
    declarationRecord,
    filePath,
    kind,
    identifierSink
}) {
    if (!identifierCollections || !declarationRecord?.name) {
        return;
    }

    const collectionKey = createFunctionLikeCollectionKey(filePath, declarationRecord);
    if (!collectionKey) {
        return;
    }

    const identifierId = buildIdentifierId(kind, collectionKey);
    const entry = ensureIdentifierCollectionEntry({
        collection,
        key: collectionKey,
        identifierId,
        initializer: () => ({
            key: collectionKey,
            name: declarationRecord.name,
            displayName: declarationRecord.name,
            filePath: filePath ?? null,
            scopeId: declarationRecord.scopeId ?? null
        })
    });

    assignIdentifierEntryMetadata(entry, {
        identifierId,
        name: declarationRecord.name,
        displayName: declarationRecord.name,
        scopeId: declarationRecord.scopeId ?? null
    });

    recordIdentifierCollectionRole({
        entry,
        identifierRecord: declarationRecord,
        filePath,
        role: IdentifierRole.DECLARATION,
        collectionName,
        collectionKey,
        identifierSink
    });
}
function registerFunctionDeclaration({ identifierCollections, declarationRecord, filePath, identifierSink }) {
    registerFunctionLikeSymbolDeclaration({
        collection: identifierCollections.functions,
        collectionName: IDENTIFIER_COLLECTION_NAMES.functions,
        identifierCollections,
        declarationRecord,
        filePath,
        kind: "function",
        identifierSink
    });
}
function registerStructDeclaration({ identifierCollections, declarationRecord, filePath, identifierSink }) {
    registerFunctionLikeSymbolDeclaration({
        collection: identifierCollections.structs,
        collectionName: IDENTIFIER_COLLECTION_NAMES.structs,
        identifierCollections,
        declarationRecord,
        filePath,
        kind: "struct",
        identifierSink
    });
}
function ensureDeclarationLocationKeySet(entry): Set<string> {
    if (!entry[IDENTIFIER_DECLARATION_LOCATION_KEYS]) {
        entry[IDENTIFIER_DECLARATION_LOCATION_KEYS] = new Set<string>();
    }

    return entry[IDENTIFIER_DECLARATION_LOCATION_KEYS] as Set<string>;
}
function registerScriptDeclaration({ identifierCollections, descriptor, declarationRecord, filePath, identifierSink }) {
    const entry = ensureScriptEntry(identifierCollections, descriptor);
    if (!entry) {
        return;
    }
    const identifierId = buildIdentifierId("script", descriptor?.id ?? "");
    assignIdentifierEntryMetadata(entry, {
        identifierId,
        name: descriptor?.name ?? null,
        displayName: descriptor?.displayName ?? null,
        resourcePath: descriptor?.resourcePath ?? null
    });
    if (!declarationRecord) {
        return;
    }

    const clone = cloneIdentifierForCollections(declarationRecord, filePath);
    const declarationLocationKeySet = ensureDeclarationLocationKeySet(entry);
    const locationKey = Core.buildLocationKey(clone.start);

    if (locationKey && declarationLocationKeySet.has(locationKey)) {
        return;
    }

    if (clone && clone.isSynthetic !== true) {
        entry.declarations = entry.declarations.filter((existing) => existing && existing.isSynthetic !== true);
    }

    if (locationKey) {
        declarationLocationKeySet.add(locationKey);
    }

    recordIdentifierCollectionRole({
        entry,
        identifierRecord: clone,
        filePath,
        role: IdentifierRole.DECLARATION,
        collectionName: IDENTIFIER_COLLECTION_NAMES.scripts,
        collectionKey: descriptor.id,
        identifierSink
    });

    const declarationTags = Core.asArray(clone?.classifications);
    for (const tag of declarationTags) {
        if (tag && tag !== "identifier" && tag !== "declaration" && !entry.declarationKinds.includes(tag)) {
            entry.declarationKinds.push(tag);
        }
    }
}
/**
 * Ensures script scopes have a declaration even when the backing GML file
 * omits an explicit declaration. Keeps the project index builder focused on
 * orchestration by handling the bookkeeping here.
 */
function ensureSyntheticScriptDeclaration({
    scopeDescriptor,
    scopeRecord,
    fileRecord,
    identifierCollections,
    filePath,
    identifierSink
}) {
    if (!scopeDescriptor || scopeDescriptor.kind !== "script" || !fileRecord || fileRecord.hasSyntheticDeclaration) {
        return;
    }
    const syntheticDeclaration = {
        name: scopeDescriptor.name,
        start: null,
        end: null,
        scopeId: scopeRecord.id,
        classifications: ["identifier", "declaration", "script"],
        isBuiltIn: false,
        isSynthetic: true
    };
    fileRecord.declarations.push({ ...syntheticDeclaration });
    scopeRecord.declarations.push({ ...syntheticDeclaration });
    fileRecord.hasSyntheticDeclaration = true;
    registerScriptDeclaration({
        identifierCollections,
        descriptor: scopeDescriptor,
        declarationRecord: syntheticDeclaration,
        filePath,
        identifierSink
    });
}
function cloneScriptReference(callRecord) {
    if (!callRecord) {
        return null;
    }
    return {
        filePath: callRecord.from?.filePath ?? null,
        scopeId: callRecord.from?.scopeId ?? null,
        targetName: callRecord.target?.name ?? null,
        targetResourcePath: callRecord.target?.resourcePath ?? null,
        location: {
            start: Core.cloneLocation(callRecord.location?.start),
            end: Core.cloneLocation(callRecord.location?.end)
        },
        isResolved: Boolean(callRecord.isResolved)
    };
}
function registerScriptReference({ identifierCollections, callRecord, identifierSink }) {
    const targetScopeId = callRecord?.target?.scopeId;
    if (!targetScopeId) {
        return;
    }
    const identifierId = buildIdentifierId("script", targetScopeId);
    const entry = ensureIdentifierCollectionEntry({
        collection: identifierCollections.scripts,
        key: targetScopeId,
        identifierId,
        initializer: () => ({
            id: targetScopeId,
            name: callRecord.target?.name ?? null,
            displayName: callRecord.target?.name ? `script.${callRecord.target.name}` : targetScopeId,
            resourcePath: callRecord.target?.resourcePath ?? null
        })
    });
    assignIdentifierEntryMetadata(entry, {
        identifierId,
        name: callRecord.target?.name ?? null,
        resourcePath: callRecord.target?.resourcePath ?? null
    });
    const reference = cloneScriptReference(callRecord);
    recordIdentifierCollectionRole({
        entry,
        identifierRecord: reference,
        filePath: reference?.filePath,
        role: IdentifierRole.REFERENCE,
        collectionName: IDENTIFIER_COLLECTION_NAMES.scripts,
        collectionKey: targetScopeId,
        identifierSink
    });
}
function recordScriptCallMetricsAndReferences({ relationships, metrics, identifierCollections, identifierSink }) {
    const scriptCalls = relationships?.scriptCalls ?? [];
    for (const callRecord of scriptCalls) {
        metrics.counters.increment("scriptCalls.total");
        if (callRecord.isResolved) {
            metrics.counters.increment("scriptCalls.resolved");
        } else {
            metrics.counters.increment("scriptCalls.unresolved");
        }
        registerScriptReference({
            identifierCollections,
            callRecord,
            identifierSink
        });
    }
}
function mapToObject(map, transform, { sortEntries = true } = {}) {
    const entries = [...map.entries()];
    const orderedEntries = sortEntries
        ? entries.toSorted(([a], [b]) => (typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : 0))
        : entries;
    return Object.fromEntries(orderedEntries.map(([key, value]) => [key, transform(value, key)]));
}
function registerMacroOccurrence({ identifierCollections, identifierRecord, filePath, role, identifierSink }) {
    if (!identifierRecord?.name) {
        return;
    }
    const validatedRole = assertValidIdentifierRole(role);
    const identifierId = buildIdentifierId("macro", identifierRecord.name);
    ensureIdentifierEntryWithRole({
        collection: identifierCollections.macros,
        key: identifierRecord.name,
        collectionName: IDENTIFIER_COLLECTION_NAMES.macros,
        identifierId,
        initializer: () => ({
            name: identifierRecord.name
        }),
        metadata: { identifierId },
        identifierRecord,
        filePath,
        role: validatedRole,
        identifierSink
    });
}
function registerEnumOccurrence({
    identifierCollections,
    identifierRecord,
    filePath,
    role,
    enumLookup,
    identifierSink
}) {
    const validatedRole = assertValidIdentifierRole(role);
    const targetLocation =
        validatedRole === IdentifierRole.REFERENCE ? identifierRecord?.declaration?.start : identifierRecord?.start;
    const enumKey = Core.buildFileLocationKey(filePath, targetLocation);
    if (!enumKey) {
        return;
    }
    const enumInfo = enumLookup?.enumDeclarations?.get(enumKey) ?? null;
    const identifierId = buildIdentifierId("enum", enumKey);
    const enumName = enumInfo ? (enumInfo.name ?? identifierRecord?.name ?? null) : null;
    ensureIdentifierEntryWithRole({
        collection: identifierCollections.enums,
        key: enumKey,
        collectionName: IDENTIFIER_COLLECTION_NAMES.enums,
        identifierId,
        initializer: () => ({
            key: enumKey,
            name: enumInfo?.name ?? identifierRecord?.name ?? null,
            filePath: enumInfo?.filePath ?? filePath ?? null
        }),
        metadata: {
            identifierId,
            name: enumName
        },
        identifierRecord,
        filePath,
        role: validatedRole,
        identifierSink
    });
}
function registerEnumMemberOccurrence({
    identifierCollections,
    identifierRecord,
    filePath,
    role,
    enumLookup,
    identifierSink
}) {
    const validatedRole = assertValidIdentifierRole(role);
    const targetLocation =
        validatedRole === IdentifierRole.REFERENCE ? identifierRecord?.declaration?.start : identifierRecord?.start;
    const memberKey = Core.buildFileLocationKey(filePath, targetLocation);
    if (!memberKey) {
        return;
    }
    const memberInfo = enumLookup?.memberDeclarations?.get(memberKey) ?? null;
    const enumKey = memberInfo?.enumKey ?? null;
    const identifierId = buildIdentifierId("enum-member", memberKey);
    const enumName = memberInfo?.enumKey ? (enumLookup?.enumDeclarations?.get(memberInfo.enumKey)?.name ?? null) : null;
    ensureIdentifierEntryWithRole({
        collection: identifierCollections.enumMembers,
        key: memberKey,
        collectionName: IDENTIFIER_COLLECTION_NAMES.enumMembers,
        identifierId,
        initializer: () => ({
            key: memberKey,
            name: memberInfo?.name ?? identifierRecord?.name ?? null,
            enumKey,
            enumName: memberInfo?.enumKey
                ? (enumLookup?.enumDeclarations?.get(memberInfo.enumKey)?.name ?? null)
                : null,
            filePath: memberInfo?.filePath ?? filePath ?? null
        }),
        metadata: {
            identifierId,
            enumName
        },
        identifierRecord,
        filePath,
        role: validatedRole,
        identifierSink
    });
}
function registerGlobalOccurrence({ identifierCollections, identifierRecord, filePath, role, identifierSink }) {
    if (!identifierRecord?.name) {
        return;
    }
    const validatedRole = assertValidIdentifierRole(role);
    const identifierId = buildIdentifierId("global", identifierRecord.name);
    ensureIdentifierEntryWithRole({
        collection: identifierCollections.globalVariables,
        key: identifierRecord.name,
        collectionName: IDENTIFIER_COLLECTION_NAMES.globalVariables,
        identifierId,
        initializer: () => ({
            name: identifierRecord.name
        }),
        metadata: { identifierId },
        identifierRecord,
        filePath,
        role: validatedRole,
        identifierSink
    });
}
function registerInstanceOccurrence({
    identifierCollections,
    identifierRecord,
    filePath,
    role,
    scopeDescriptor,
    identifierSink
}) {
    if (!identifierRecord?.name) {
        return;
    }
    const validatedRole = assertValidIdentifierRole(role);
    const key = `${scopeDescriptor?.id ?? "instance"}:${identifierRecord.name}`;
    const identifierId = buildIdentifierId("instance", key);
    ensureIdentifierEntryWithRole({
        collection: identifierCollections.instanceVariables,
        key,
        collectionName: IDENTIFIER_COLLECTION_NAMES.instanceVariables,
        identifierId,
        initializer: () => ({
            key,
            name: identifierRecord.name,
            scopeId: scopeDescriptor?.id ?? null,
            scopeKind: scopeDescriptor?.kind ?? null
        }),
        metadata: {
            identifierId,
            scopeId: scopeDescriptor?.id ?? null,
            scopeKind: scopeDescriptor?.kind ?? null
        },
        identifierRecord,
        filePath,
        role: validatedRole,
        identifierSink
    });
}
function getIdentifierDeclarationScopeId(identifierRecord) {
    return identifierRecord?.declaration?.scopeId ?? identifierRecord?.scopeId ?? null;
}
function createScopedVariableKey(identifierRecord) {
    if (!identifierRecord?.name) {
        return null;
    }

    const declarationScopeId = getIdentifierDeclarationScopeId(identifierRecord);
    if (!declarationScopeId) {
        return null;
    }

    return `${declarationScopeId}:${identifierRecord.name}`;
}
function registerScopedVariableOccurrence({
    collection,
    collectionName,
    identifierCollections,
    identifierRecord,
    filePath,
    role,
    kind,
    identifierSink
}) {
    const collectionKey = createScopedVariableKey(identifierRecord);
    if (!identifierCollections || !collectionKey || !identifierRecord?.name) {
        return;
    }

    const validatedRole = assertValidIdentifierRole(role);
    const declarationScopeId = getIdentifierDeclarationScopeId(identifierRecord);
    const identifierId = buildIdentifierId(kind, collectionKey);

    ensureIdentifierEntryWithRole({
        collection,
        key: collectionKey,
        collectionName,
        identifierId,
        initializer: () => ({
            key: collectionKey,
            name: identifierRecord.name,
            scopeId: declarationScopeId,
            scopeKind: null
        }),
        metadata: {
            identifierId,
            scopeId: declarationScopeId,
            scopeKind: null
        },
        identifierRecord,
        filePath,
        role: validatedRole,
        identifierSink
    });
}
function registerLocalVariableOccurrence({ identifierCollections, identifierRecord, filePath, role, identifierSink }) {
    registerScopedVariableOccurrence({
        collection: identifierCollections.localVariables,
        collectionName: IDENTIFIER_COLLECTION_NAMES.localVariables,
        identifierCollections,
        identifierRecord,
        filePath,
        role,
        kind: "local",
        identifierSink
    });
}
function registerStructVariableOccurrence({ identifierCollections, identifierRecord, filePath, role, identifierSink }) {
    registerScopedVariableOccurrence({
        collection: identifierCollections.structVariables,
        collectionName: IDENTIFIER_COLLECTION_NAMES.structVariables,
        identifierCollections,
        identifierRecord,
        filePath,
        role,
        kind: "struct-variable",
        identifierSink
    });
}
function shouldTreatAsInstance({ identifierRecord, role, scopeDescriptor }) {
    if (!identifierRecord) {
        return false;
    }
    const validatedRole = assertValidIdentifierRole(role);
    if (validatedRole !== IdentifierRole.REFERENCE) {
        return false;
    }
    if (!scopeDescriptor || scopeDescriptor.kind !== "objectEvent") {
        return false;
    }
    const classifications = Core.asArray(identifierRecord?.classifications);
    if (classifications.includes("global")) {
        return false;
    }
    if (identifierRecord.declaration && identifierRecord.declaration.scopeId) {
        return false;
    }
    if (identifierRecord.isBuiltIn) {
        return false;
    }
    if (!classifications.includes("reference")) {
        return false;
    }
    return true;
}
function shouldTreatAsScopedVariable(identifierRecord, role) {
    if (!identifierRecord?.name) {
        return false;
    }

    const validatedRole = assertValidIdentifierRole(role);
    const classifications = Core.asArray(identifierRecord?.classifications);
    if (!classifications.includes("variable")) {
        return false;
    }

    if (classifications.includes("global") || identifierRecord.isGlobalIdentifier) {
        return false;
    }

    if (validatedRole === IdentifierRole.DECLARATION) {
        return Boolean(identifierRecord.scopeId);
    }

    return Boolean(identifierRecord.declaration?.scopeId);
}
function shouldTreatAsStructVariable(identifierRecord, structVariableDeclarationScopeIds) {
    const declarationScopeId = getIdentifierDeclarationScopeId(identifierRecord);
    return Boolean(declarationScopeId && structVariableDeclarationScopeIds?.has(declarationScopeId));
}
function registerIdentifierOccurrence({
    identifierCollections,
    identifierRecord,
    filePath,
    role,
    enumLookup,
    scopeDescriptor,
    structVariableDeclarationScopeIds,
    identifierSink
}) {
    if (!identifierRecord || !identifierCollections) {
        return;
    }
    const validatedRole = assertValidIdentifierRole(role);
    const classifications = Core.asArray(identifierRecord?.classifications);
    if (validatedRole === IdentifierRole.DECLARATION && classifications.includes("script")) {
        registerScriptDeclaration({
            identifierCollections,
            descriptor: scopeDescriptor,
            declarationRecord: identifierRecord,
            filePath,
            identifierSink
        });
    }
    if (validatedRole === IdentifierRole.DECLARATION && classifications.includes("struct")) {
        registerStructDeclaration({
            identifierCollections,
            declarationRecord: {
                ...identifierRecord,
                classifications: ["identifier", "declaration", "struct"]
            },
            filePath,
            identifierSink
        });
    }
    if (classifications.includes("macro")) {
        registerMacroOccurrence({
            identifierCollections,
            identifierRecord,
            filePath,
            role: validatedRole,
            identifierSink
        });
    }
    if (classifications.includes("enum")) {
        registerEnumOccurrence({
            identifierCollections,
            identifierRecord,
            filePath,
            role: validatedRole,
            enumLookup,
            identifierSink
        });
    }
    if (classifications.includes("enum-member")) {
        registerEnumMemberOccurrence({
            identifierCollections,
            identifierRecord,
            filePath,
            role: validatedRole,
            enumLookup,
            identifierSink
        });
    }
    if (classifications.includes("variable") && classifications.includes("global")) {
        registerGlobalOccurrence({
            identifierCollections,
            identifierRecord,
            filePath,
            role: validatedRole,
            identifierSink
        });
    }
    if (
        shouldTreatAsScopedVariable(identifierRecord, validatedRole) &&
        !shouldTreatAsInstance({
            identifierRecord,
            role: validatedRole,
            scopeDescriptor
        })
    ) {
        if (shouldTreatAsStructVariable(identifierRecord, structVariableDeclarationScopeIds)) {
            registerStructVariableOccurrence({
                identifierCollections,
                identifierRecord,
                filePath,
                role: validatedRole,
                identifierSink
            });
        } else {
            registerLocalVariableOccurrence({
                identifierCollections,
                identifierRecord,
                filePath,
                role: validatedRole,
                identifierSink
            });
        }
    }
    if (
        shouldTreatAsInstance({
            identifierRecord,
            role: validatedRole,
            scopeDescriptor
        })
    ) {
        registerInstanceOccurrence({
            identifierCollections,
            identifierRecord,
            filePath,
            role: IdentifierRole.REFERENCE,
            scopeDescriptor,
            identifierSink
        });
    }
}
function registerInstanceAssignment({
    identifierCollections,
    identifierRecord,
    filePath,
    scopeDescriptor,
    identifierSink
}) {
    if (!identifierCollections || !identifierRecord || !identifierRecord.name) {
        return;
    }
    const identifierKey = `${scopeDescriptor?.id ?? "instance"}:${identifierRecord.name}`;
    const identifierId = buildIdentifierId("instance", identifierKey);
    const entry = ensureIdentifierCollectionEntry({
        collection: identifierCollections.instanceVariables,
        key: identifierKey,
        identifierId,
        initializer: () => ({
            key: identifierKey,
            name: identifierRecord.name,
            scopeId: scopeDescriptor?.id ?? null,
            scopeKind: scopeDescriptor?.kind ?? null
        })
    });
    assignIdentifierEntryMetadata(entry, {
        identifierId,
        scopeId: scopeDescriptor?.id ?? null,
        scopeKind: scopeDescriptor?.kind ?? null
    });
    const clone = cloneIdentifierForCollections(identifierRecord, filePath);
    const declarationLocationKeySet = ensureDeclarationLocationKeySet(entry);
    const currentKey = Core.buildLocationKey(clone.start);

    if (currentKey && declarationLocationKeySet.has(currentKey)) {
        return;
    }

    if (currentKey) {
        declarationLocationKeySet.add(currentKey);
    }

    recordIdentifierCollectionRole({
        entry,
        identifierRecord: clone,
        filePath,
        role: IdentifierRole.DECLARATION,
        collectionName: IDENTIFIER_COLLECTION_NAMES.instanceVariables,
        collectionKey: identifierKey,
        identifierSink
    });
}
function ensureScopeRecord(scopeMap, descriptor) {
    return Core.getOrCreateMapEntry(scopeMap, descriptor.id, () => ({
        id: descriptor.id,
        kind: descriptor.kind,
        name: descriptor.name,
        displayName: descriptor.displayName,
        resourcePath: descriptor.resourcePath,
        event: descriptor.event ?? null,
        filePaths: [],
        declarations: [],
        references: [],
        ignoredIdentifiers: [],
        scriptCalls: []
    }));
}
function ensureFileRecord(filesMap, relativePath, scopeId) {
    return Core.getOrCreateMapEntry(filesMap, relativePath, () => ({
        filePath: relativePath,
        scopeId,
        declarations: [],
        references: [],
        ignoredIdentifiers: [],
        scriptCalls: []
    }));
}
function traverseAst(root, visitor) {
    if (!Core.isObjectLike(root)) {
        return;
    }
    const stack = [root];
    const seen = new WeakSet();
    while (stack.length > 0) {
        const node = stack.pop();
        if (!Core.isObjectLike(node)) {
            continue;
        }
        if (seen.has(node)) {
            continue;
        }
        seen.add(node);
        visitor(node);
        for (const key of Object.keys(node)) {
            pushNodeValueChildren(stack, node[key]);
        }
    }
}

function pushNodeValueChildren(stack: Array<any>, value: unknown) {
    if (!value || typeof value !== "object") {
        return;
    }

    if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i -= 1) {
            const child = value[i];
            if (Core.isObjectLike(child)) {
                stack.push(child);
            }
        }
        return;
    }

    if (Core.isObjectLike(value)) {
        stack.push(value);
    }
}
function handleFunctionLikeDeclarationNode({
    node,
    scopeDescriptor,
    scopeRecord,
    fileRecord,
    identifierCollections,
    sourceContents,
    lineOffsets,
    identifierSink
}) {
    if (node?.type !== "FunctionDeclaration" && node?.type !== "ConstructorDeclaration") {
        return;
    }
    const classificationTags =
        node.type === "ConstructorDeclaration" ? ["constructor", "struct", "script"] : ["script"];
    const declarationRecord = createFunctionLikeIdentifierRecord({
        node,
        scopeRecord,
        fileRecord,
        classification: classificationTags,
        source: sourceContents,
        lineOffsets
    });
    if (!declarationRecord) {
        return;
    }

    if (node.type === "ConstructorDeclaration") {
        registerStructDeclaration({
            identifierCollections,
            declarationRecord: {
                ...declarationRecord,
                classifications: ["identifier", "declaration", "struct"]
            },
            filePath: fileRecord?.filePath ?? null,
            identifierSink
        });
    } else {
        registerFunctionDeclaration({
            identifierCollections,
            declarationRecord: {
                ...declarationRecord,
                classifications: ["identifier", "declaration", "function"]
            },
            filePath: fileRecord?.filePath ?? null,
            identifierSink
        });
    }

    if (scopeDescriptor?.kind !== "script") {
        return;
    }

    const removalDescriptor = {
        name: declarationRecord.name,
        scopeId: scopeRecord.id
    };
    removeSyntheticScriptDeclarations(fileRecord.declarations, removalDescriptor);
    removeSyntheticScriptDeclarations(scopeRecord.declarations, removalDescriptor);
    const declarationKey = Core.buildLocationKey(declarationRecord.start);
    const fileHasExisting = fileRecord.declarations.some(
        (existing) => Core.buildLocationKey(existing.start) === declarationKey
    );
    if (!fileHasExisting) {
        fileRecord.declarations.push({ ...declarationRecord });
    }
    const scopeHasExisting = scopeRecord.declarations.some(
        (existing) => Core.buildLocationKey(existing.start) === declarationKey
    );
    if (!scopeHasExisting) {
        scopeRecord.declarations.push({ ...declarationRecord });
    }
    registerScriptDeclaration({
        identifierCollections,
        descriptor: scopeDescriptor,
        declarationRecord,
        filePath: fileRecord?.filePath ?? null,
        identifierSink
    });
}
function handleIdentifierNode({
    node,
    builtInNames,
    fileRecord,
    scopeRecord,
    identifierCollections,
    enumLookup,
    scopeDescriptor,
    metrics,
    structVariableDeclarationScopeIds,
    identifierSink
}) {
    if (node?.type !== "Identifier" || !Array.isArray(node.classifications)) {
        return false;
    }
    const identifierRecord = createIdentifierRecord(node);
    const isBuiltIn = builtInNames.has(identifierRecord.name);
    identifierRecord.isBuiltIn = isBuiltIn;
    metrics?.counters?.increment("identifiers.encountered");
    if (isBuiltIn) {
        metrics?.counters?.increment("identifiers.builtInSkipped");
        identifierRecord.reason = "built-in";
        recordIgnoredIdentifier(fileRecord, identifierRecord);
        return true;
    }
    const isDeclaration = identifierRecord.classifications.includes("declaration");
    const isReference = identifierRecord.classifications.includes("reference");
    if (isDeclaration) {
        metrics?.counters?.increment("identifiers.declarations");
        fileRecord.declarations.push(identifierRecord);
        scopeRecord.declarations.push(identifierRecord);
        registerIdentifierOccurrence({
            identifierCollections,
            identifierRecord,
            filePath: fileRecord?.filePath ?? null,
            role: IdentifierRole.DECLARATION,
            enumLookup,
            scopeDescriptor: scopeDescriptor ?? scopeRecord,
            structVariableDeclarationScopeIds,
            identifierSink
        });
    }
    if (isReference) {
        metrics?.counters?.increment("identifiers.references");
        fileRecord.references.push(identifierRecord);
        scopeRecord.references.push(identifierRecord);
        registerIdentifierOccurrence({
            identifierCollections,
            identifierRecord,
            filePath: fileRecord?.filePath ?? null,
            role: IdentifierRole.REFERENCE,
            enumLookup,
            scopeDescriptor: scopeDescriptor ?? scopeRecord,
            structVariableDeclarationScopeIds,
            identifierSink
        });
    }
    return false;
}
function handleCallExpressionNode({
    node,
    builtInNames,
    fileRecord,
    scopeRecord,
    relationships,
    scriptNameToScopeId,
    scriptNameToResourcePath,
    metrics
}) {
    if (node?.type !== "CallExpression") {
        return;
    }
    const callee = Core.getCallExpressionIdentifier(node);
    const calleeName = callee?.name ?? null;
    if (!calleeName || builtInNames.has(calleeName)) {
        return;
    }
    recordFunctionOrScriptCall({
        builtInNames,
        callee,
        calleeName,
        fileRecord,
        metrics,
        relationships,
        scopeRecord,
        scriptNameToResourcePath,
        scriptNameToScopeId
    });
}

function resolveCallTargetKind(identifierNode) {
    const declarationClassifications = Core.asArray(identifierNode?.declaration?.classifications).filter(
        (value) => typeof value === "string"
    );
    const identifierClassifications = Core.asArray(identifierNode?.classifications).filter(
        (value) => typeof value === "string"
    );
    const classifications = new Set([...declarationClassifications, ...identifierClassifications]);

    if (classifications.has("function")) {
        return "function";
    }

    if (classifications.has("script")) {
        return "script";
    }

    return null;
}

function recordFunctionOrScriptCall({
    builtInNames,
    callee,
    calleeName,
    fileRecord,
    metrics,
    relationships,
    scopeRecord,
    scriptNameToResourcePath,
    scriptNameToScopeId
}) {
    if (!calleeName || builtInNames.has(calleeName)) {
        return;
    }

    const declaredTargetScopeId = callee?.declaration?.scopeId ?? null;
    const resolvedTargetKind = resolveCallTargetKind(callee);
    const fallbackTargetScopeId = scriptNameToScopeId.get(calleeName) ?? null;
    const targetScopeId = declaredTargetScopeId ?? fallbackTargetScopeId;
    const targetKind = resolvedTargetKind ?? "script";
    const targetIdentifierId =
        targetKind === "function"
            ? buildIdentifierId("function", createFunctionLikeCollectionKey(fileRecord.filePath, callee?.declaration))
            : null;
    const targetResourcePath =
        targetKind === "script" && targetScopeId ? (scriptNameToResourcePath.get(calleeName) ?? null) : null;
    const callRecord = {
        kind: targetKind,
        from: {
            filePath: fileRecord.filePath,
            scopeId: scopeRecord.id
        },
        target: {
            identifierId: targetIdentifierId,
            name: calleeName,
            scopeId: targetScopeId,
            resourcePath: targetResourcePath
        },
        isResolved: Boolean(targetScopeId),
        location: {
            start: Core.cloneLocation(callee?.start ?? null),
            end: Core.cloneLocation(callee?.end ?? null)
        }
    };

    fileRecord.scriptCalls.push(callRecord);
    scopeRecord.scriptCalls.push(callRecord);
    relationships.scriptCalls.push(callRecord);
    metrics?.counters?.increment("scriptCalls.discovered");
}

function handleNewExpressionScriptCall({
    node,
    builtInNames,
    fileRecord,
    scopeRecord,
    relationships,
    scriptNameToScopeId,
    scriptNameToResourcePath,
    metrics
}) {
    if (node?.type !== "NewExpression" || node.expression?.type !== "Identifier") {
        return;
    }
    const callee = node.expression;
    const calleeName = callee.name;
    if (typeof calleeName !== "string" || builtInNames.has(calleeName)) {
        return;
    }
    recordFunctionOrScriptCall({
        builtInNames,
        callee,
        calleeName,
        fileRecord,
        metrics,
        relationships,
        scopeRecord,
        scriptNameToResourcePath,
        scriptNameToScopeId
    });
}
function handleConstructorParentScriptCall({
    node,
    builtInNames,
    fileRecord,
    scopeRecord,
    relationships,
    scriptNameToScopeId,
    scriptNameToResourcePath,
    metrics
}) {
    if (node?.type !== "ConstructorParentClause" || typeof node.id !== "string") {
        return;
    }

    const calleeName = node.id;
    if (!calleeName || builtInNames.has(calleeName)) {
        return;
    }
    const callee = {
        classifications: ["script"],
        declaration: {
            scopeId: scriptNameToScopeId.get(calleeName) ?? null
        },
        end: node.idLocation?.end ?? null,
        name: calleeName,
        start: node.idLocation?.start ?? null
    };
    const parentStart = Core.cloneLocation(node.idLocation?.start ?? null);
    const parentEnd = Core.cloneLocation(node.idLocation?.end ?? null);
    if (parentStart === null || parentEnd === null) {
        return;
    }
    parentEnd.index -= 1;
    if (typeof parentEnd.column === "number") {
        parentEnd.column -= 1;
    }
    recordFunctionOrScriptCall({
        builtInNames,
        callee: {
            ...callee,
            end: parentEnd,
            start: parentStart
        },
        calleeName,
        fileRecord,
        metrics,
        relationships,
        scopeRecord,
        scriptNameToResourcePath,
        scriptNameToScopeId
    });
}
function handleObjectEventAssignmentNode({
    node,
    scopeDescriptor,
    identifierCollections,
    builtInNames,
    fileRecord,
    scopeRecord,
    metrics,
    identifierSink
}) {
    if (
        node?.type !== "AssignmentExpression" ||
        node.left?.type !== "Identifier" ||
        scopeDescriptor?.kind !== "objectEvent"
    ) {
        return;
    }
    const leftRecord = createIdentifierRecord(node.left);
    const classifications = Core.asArray(leftRecord?.classifications);
    const isGlobalAssignment = classifications.includes("global") || leftRecord.isGlobalIdentifier;
    const hasDeclaration = Boolean(leftRecord.declaration && leftRecord.declaration.scopeId);
    if (
        identifierCollections &&
        !isGlobalAssignment &&
        !hasDeclaration &&
        leftRecord.name &&
        !builtInNames.has(leftRecord.name)
    ) {
        registerInstanceAssignment({
            identifierCollections,
            identifierRecord: leftRecord,
            filePath: fileRecord?.filePath ?? null,
            scopeDescriptor: scopeDescriptor ?? scopeRecord,
            identifierSink
        });
        metrics?.counters?.increment("identifiers.instanceAssignments");
    }
}
function collectConstructorVariableDeclarationScopeIds(ast) {
    const scopeIds = new Set();

    const visit = (node, insideConstructor) => {
        if (!Core.isObjectLike(node)) {
            return;
        }

        const nodeType = node.type;
        if (
            insideConstructor &&
            (nodeType === "FunctionDeclaration" ||
                nodeType === "ConstructorDeclaration" ||
                nodeType === "StructDeclaration")
        ) {
            return;
        }

        if (
            insideConstructor &&
            nodeType === "Identifier" &&
            Array.isArray(node.classifications) &&
            node.classifications.includes("declaration") &&
            node.classifications.includes("variable")
        ) {
            const declarationScopeId = node.declaration?.scopeId ?? node.scopeId ?? null;
            if (declarationScopeId) {
                scopeIds.add(declarationScopeId);
            }
        }

        const childInsideConstructor = insideConstructor || nodeType === "ConstructorDeclaration";
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                for (const child of value) {
                    visit(child, childInsideConstructor);
                }
                continue;
            }

            visit(value, childInsideConstructor);
        }
    };

    visit(ast, false);
    return scopeIds;
}
function analyseGmlAst({
    ast,
    builtInNames,
    scopeRecord,
    fileRecord,
    relationships,
    scriptNameToScopeId,
    scriptNameToResourcePath,
    identifierCollections,
    scopeDescriptor,
    metrics = null,
    sourceContents = "",
    lineOffsets = null,
    structVariableDeclarationScopeIds = new Set(),
    identifierSink
}) {
    const enumLookup = createEnumLookup(ast, fileRecord?.filePath ?? null);
    traverseAst(ast, (node) => {
        handleFunctionLikeDeclarationNode({
            node,
            scopeDescriptor,
            scopeRecord,
            fileRecord,
            identifierCollections,
            sourceContents,
            lineOffsets,
            identifierSink
        });
        const identifierHandled = handleIdentifierNode({
            node,
            builtInNames,
            fileRecord,
            scopeRecord,
            identifierCollections,
            enumLookup,
            scopeDescriptor,
            metrics,
            structVariableDeclarationScopeIds,
            identifierSink
        });
        if (identifierHandled) {
            return;
        }
        handleCallExpressionNode({
            node,
            builtInNames,
            fileRecord,
            scopeRecord,
            relationships,
            scriptNameToScopeId,
            scriptNameToResourcePath,
            metrics
        });
        handleNewExpressionScriptCall({
            node,
            builtInNames,
            fileRecord,
            scopeRecord,
            relationships,
            scriptNameToScopeId,
            scriptNameToResourcePath,
            metrics
        });
        handleConstructorParentScriptCall({
            node,
            builtInNames,
            fileRecord,
            scopeRecord,
            relationships,
            scriptNameToScopeId,
            scriptNameToResourcePath,
            metrics
        });
        handleObjectEventAssignmentNode({
            node,
            scopeDescriptor,
            identifierCollections,
            builtInNames,
            fileRecord,
            scopeRecord,
            metrics,
            identifierSink
        });
    });
}
function cloneAssetReference(reference) {
    return {
        fromResourcePath: reference.fromResourcePath,
        fromResourceName: reference.fromResourceName,
        propertyPath: reference.propertyPath,
        targetPath: reference.targetPath,
        targetName: reference.targetName ?? null,
        targetResourceType: reference.targetResourceType ?? null
    };
}
async function processWithConcurrency(items, limit, worker, options = {}) {
    if (!Core.isNonEmptyArray(items)) {
        return;
    }
    Core.assertFunction(worker, "worker");
    const { ensureNotAborted } = createProjectIndexAbortGuard(options);
    const limitValue = Number(limit);
    const effectiveLimit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : items.length;
    const workerCount = Core.clamp(Math.ceil(effectiveLimit), 1, items.length);
    let nextIndex = 0;
    const runWorker = async (): Promise<void> => {
        ensureNotAborted();
        const currentIndex = nextIndex++;
        if (currentIndex >= items.length) {
            return;
        }
        ensureNotAborted();
        await worker(items[currentIndex], currentIndex);
        await runWorker();
    };
    const workerHandles = [];
    for (let index = 0; index < workerCount; index++) {
        workerHandles.push(runWorker());
    }
    await Promise.all(workerHandles);
}
/**
 * Process a single GML source file while keeping the high-level project index
 * coordinator focused on orchestration. Handles filesystem access, metrics,
 * record preparation, and AST analysis for the provided file.
 */
async function readProjectGmlFile({ file, fsFacade, metrics }) {
    const contents = await runWithMissingPathFallback(
        () => metrics.timers.timeAsync("fs.readGml", () => fsFacade.readFile(file.absolutePath, "utf8")),
        () => {
            metrics.counters.increment("files.missingDuringRead");
            return null;
        }
    );

    if (contents === null) {
        return null;
    }

    metrics.counters.increment("io.gmlBytes", Buffer.byteLength(contents));
    return contents;
}
function registerFilePathWithScope(scopeRecord, filePath) {
    if (!scopeRecord?.filePaths) {
        return;
    }
    Core.pushUnique(scopeRecord.filePaths, filePath);
}

const MAX_IGNORED_IDENTIFIERS_PER_FILE = 256;

function recordIgnoredIdentifier(fileRecord, identifierRecord) {
    if (!fileRecord || !Array.isArray(fileRecord.ignoredIdentifiers) || !identifierRecord) {
        return;
    }

    const exists = fileRecord.ignoredIdentifiers.some((entry) => {
        if (!entry || entry.name !== identifierRecord.name) {
            return false;
        }

        return entry.start?.index === identifierRecord.start?.index;
    });

    if (exists || fileRecord.ignoredIdentifiers.length >= MAX_IGNORED_IDENTIFIERS_PER_FILE) {
        return;
    }

    fileRecord.ignoredIdentifiers.push(identifierRecord);
}

function prepareProjectIndexRecords({
    file,
    resourceAnalysis,
    scopeMap,
    filesMap,
    identifierCollections,
    identifierSink
}) {
    const scopeDescriptor =
        resourceAnalysis.gmlScopeMap.get(file.relativePath) ?? createFileScopeDescriptor(file.relativePath);
    const scopeRecord = ensureScopeRecord(scopeMap, scopeDescriptor);
    registerFilePathWithScope(scopeRecord, file.relativePath);
    ensureScriptEntry(identifierCollections, scopeDescriptor);
    const fileRecord = ensureFileRecord(filesMap, file.relativePath, scopeRecord.id);
    ensureSyntheticScriptDeclaration({
        scopeDescriptor,
        scopeRecord,
        fileRecord,
        identifierCollections,
        filePath: file.relativePath,
        identifierSink
    });
    return { scopeDescriptor, scopeRecord, fileRecord };
}
function parseProjectGmlSource({ contents, file, parseProjectSource, metrics, projectRoot }) {
    return metrics.timers.timeSync("gml.parse", () =>
        parseProjectSource(contents, {
            filePath: file.relativePath,
            projectRoot
        })
    );
}
function analyseProjectGmlAst({
    ast,
    builtInNames,
    scopeRecord,
    fileRecord,
    relationships,
    resourceAnalysis,
    identifierCollections,
    scopeDescriptor,
    metrics,
    sourceContents,
    lineOffsets,
    identifierSink
}) {
    const structVariableDeclarationScopeIds = collectConstructorVariableDeclarationScopeIds(ast);
    metrics.timers.timeSync("gml.analyse", () =>
        analyseGmlAst({
            ast,
            builtInNames,
            scopeRecord,
            fileRecord,
            relationships,
            scriptNameToScopeId: resourceAnalysis.scriptNameToScopeId,
            scriptNameToResourcePath: resourceAnalysis.scriptNameToResourcePath,
            identifierCollections,
            scopeDescriptor,
            metrics,
            sourceContents,
            lineOffsets,
            structVariableDeclarationScopeIds,
            identifierSink
        })
    );
}
async function processProjectGmlFile({
    file,
    fsFacade,
    metrics,
    ensureNotAborted,
    parseProjectSource,
    resourceAnalysis,
    scopeMap,
    filesMap,
    identifierCollections,
    relationships,
    builtInNames,
    projectRoot,
    identifierSink
}) {
    ensureNotAborted();
    metrics.counters.increment("files.gmlProcessed");
    const contents = await readProjectGmlFile({ file, fsFacade, metrics });
    if (contents === null) {
        return;
    }
    ensureNotAborted();
    const lineOffsets = computeLineOffsets(contents);
    const { scopeDescriptor, scopeRecord, fileRecord } = prepareProjectIndexRecords({
        file,
        resourceAnalysis,
        scopeMap,
        filesMap,
        identifierCollections,
        identifierSink
    });
    const ast = parseProjectGmlSource({
        contents,
        file,
        parseProjectSource,
        metrics,
        projectRoot
    });
    analyseProjectGmlAst({
        ast,
        builtInNames,
        scopeRecord,
        fileRecord,
        relationships,
        resourceAnalysis,
        identifierCollections,
        scopeDescriptor,
        metrics,
        sourceContents: contents,
        lineOffsets,
        identifierSink
    });
}
/**
 * Centralize the mutable collections used while aggregating project index
 * details. Keeping the map initialisation and relationship bookkeeping here
 * lets the main build flow focus on orchestration rather than data structure
 * wiring.
 */
function createProjectIndexAggregationState(resourceAnalysis) {
    const scopeMap = new Map();
    const filesMap = new Map();

    // Add default entries for .yy resource files so they are available in the index.
    for (const [_, resourceRecord] of resourceAnalysis.resourcesMap) {
        if (!filesMap.has(resourceRecord.path)) {
            filesMap.set(resourceRecord.path, {
                filePath: resourceRecord.path,
                scopeId: null,
                declarations: [],
                references: [],
                ignoredIdentifiers: [],
                scriptCalls: []
            });
        }
    }

    const relationships = {
        scriptCalls: [],
        assetReferences: resourceAnalysis.assetReferences.map((reference) => cloneAssetReference(reference))
    };
    const identifierCollections = createIdentifierCollections();
    return {
        scopeMap,
        filesMap,
        relationships,
        identifierCollections
    };
}

function resolveIdentifierRoleRecords({
    identifierSink,
    collection,
    key,
    role,
    fallbackRecords
}: {
    identifierSink: IdentifierSink | null;
    collection: string;
    key: string;
    role: IdentifierSinkRole;
    fallbackRecords: Array<any>;
}): Array<any> {
    if (!identifierSink) {
        return Core.cloneObjectEntries(fallbackRecords);
    }

    return Core.toMutableArray(identifierSink.readAll(collection, key, role), { clone: true });
}
/**
 * Derive the final serializable project index payload from the populated
 * aggregation state. The snapshot clones individual entry collections so the
 * returned object mirrors the shape produced by the historical inline
 * implementation without leaking mutable internals.
 */
function createProjectIndexResultSnapshot({
    projectRoot,
    resourceAnalysis,
    scopeMap,
    filesMap,
    identifierCollections,
    relationships,
    identifierSink
}) {
    const resources = mapToObject(
        resourceAnalysis.resourcesMap,
        (record) => ({
            path: record.path,
            name: record.name,
            resourceType: record.resourceType,
            scopes: [...record.scopes],
            gmlFiles: [...record.gmlFiles],
            assetReferences: record.assetReferences.map((reference) => cloneAssetReference(reference))
        }),
        { sortEntries: false }
    );
    const scopes = mapToObject(
        scopeMap,
        (record) => ({
            id: record.id,
            kind: record.kind,
            name: record.name,
            displayName: record.displayName,
            resourcePath: record.resourcePath,
            event: record.event ? { ...record.event } : null,
            filePaths: [...record.filePaths],
            ...cloneEntryCollections(record, "declarations", "references", "ignoredIdentifiers", "scriptCalls")
        }),
        { sortEntries: false }
    );
    const files = mapToObject(
        filesMap,
        (record) => ({
            filePath: record.filePath,
            scopeId: record.scopeId,
            ...cloneEntryCollections(record, "declarations", "references", "ignoredIdentifiers", "scriptCalls")
        }),
        { sortEntries: false }
    );
    const identifiers = {
        scripts: mapToObject(identifierCollections.scripts, (entry) => ({
            identifierId: entry.identifierId ?? buildIdentifierId("script", entry.id ?? entry.name ?? ""),
            id: entry.id,
            name: entry.name ?? null,
            displayName: entry.displayName ?? entry.name ?? entry.id,
            resourcePath: entry.resourcePath ?? null,
            declarationKinds: [...Core.asArray(entry.declarationKinds)],
            declarations: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.scripts,
                key: entry.id,
                role: "declarations",
                fallbackRecords: entry.declarations
            }),
            references: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.scripts,
                key: entry.id,
                role: "references",
                fallbackRecords: entry.references
            }).map((reference) => ({
                filePath: reference.filePath ?? null,
                scopeId: reference.scopeId ?? null,
                targetName: reference.targetName ?? null,
                targetResourcePath: reference.targetResourcePath ?? null,
                location: reference.location
                    ? {
                          start: Core.cloneLocation(reference.location.start),
                          end: Core.cloneLocation(reference.location.end)
                      }
                    : null,
                isResolved: reference.isResolved ?? false
            }))
        })),
        functions: mapToObject(identifierCollections.functions, (entry) => ({
            identifierId: entry.identifierId ?? buildIdentifierId("function", entry.key ?? entry.name ?? ""),
            key: entry.key,
            name: entry.name ?? null,
            displayName: entry.displayName ?? entry.name ?? entry.key,
            filePath: entry.filePath ?? null,
            scopeId: entry.scopeId ?? null,
            declarations: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.functions,
                key: entry.key,
                role: "declarations",
                fallbackRecords: entry.declarations
            }),
            references: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.functions,
                key: entry.key,
                role: "references",
                fallbackRecords: entry.references
            })
        })),
        structs: mapToObject(identifierCollections.structs, (entry) => ({
            identifierId: entry.identifierId ?? buildIdentifierId("struct", entry.key ?? entry.name ?? ""),
            key: entry.key,
            name: entry.name ?? null,
            displayName: entry.displayName ?? entry.name ?? entry.key,
            filePath: entry.filePath ?? null,
            scopeId: entry.scopeId ?? null,
            declarations: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.structs,
                key: entry.key,
                role: "declarations",
                fallbackRecords: entry.declarations
            }),
            references: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.structs,
                key: entry.key,
                role: "references",
                fallbackRecords: entry.references
            })
        })),
        macros: mapToObject(identifierCollections.macros, (entry) => ({
            identifierId: entry.identifierId ?? buildIdentifierId("macro", entry.name ?? ""),
            name: entry.name,
            declarations: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.macros,
                key: entry.name,
                role: "declarations",
                fallbackRecords: entry.declarations
            }),
            references: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.macros,
                key: entry.name,
                role: "references",
                fallbackRecords: entry.references
            })
        })),
        enums: mapToObject(identifierCollections.enums, (entry) => ({
            identifierId: entry.identifierId ?? buildIdentifierId("enum", entry.key ?? entry.name ?? ""),
            key: entry.key,
            name: entry.name ?? null,
            filePath: entry.filePath ?? null,
            declarations: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.enums,
                key: entry.key,
                role: "declarations",
                fallbackRecords: entry.declarations
            }),
            references: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.enums,
                key: entry.key,
                role: "references",
                fallbackRecords: entry.references
            })
        })),
        enumMembers: mapToObject(identifierCollections.enumMembers, (entry) => ({
            identifierId: entry.identifierId ?? buildIdentifierId("enum-member", entry.key ?? ""),
            key: entry.key,
            name: entry.name ?? null,
            enumKey: entry.enumKey ?? null,
            enumName: entry.enumName ?? null,
            filePath: entry.filePath ?? null,
            declarations: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.enumMembers,
                key: entry.key,
                role: "declarations",
                fallbackRecords: entry.declarations
            }),
            references: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.enumMembers,
                key: entry.key,
                role: "references",
                fallbackRecords: entry.references
            })
        })),
        globalVariables: mapToObject(identifierCollections.globalVariables, (entry) => ({
            identifierId: entry.identifierId ?? buildIdentifierId("global", entry.name ?? ""),
            name: entry.name,
            declarations: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.globalVariables,
                key: entry.name,
                role: "declarations",
                fallbackRecords: entry.declarations
            }),
            references: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.globalVariables,
                key: entry.name,
                role: "references",
                fallbackRecords: entry.references
            })
        })),
        instanceVariables: mapToObject(identifierCollections.instanceVariables, (entry) => ({
            identifierId: entry.identifierId ?? buildIdentifierId("instance", entry.key ?? ""),
            key: entry.key,
            name: entry.name ?? null,
            scopeId: entry.scopeId ?? null,
            scopeKind: entry.scopeKind ?? null,
            declarations: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.instanceVariables,
                key: entry.key,
                role: "declarations",
                fallbackRecords: entry.declarations
            }),
            references: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.instanceVariables,
                key: entry.key,
                role: "references",
                fallbackRecords: entry.references
            })
        })),
        localVariables: mapToObject(identifierCollections.localVariables, (entry) => ({
            identifierId: entry.identifierId ?? buildIdentifierId("local", entry.key ?? ""),
            key: entry.key,
            name: entry.name ?? null,
            scopeId: entry.scopeId ?? null,
            scopeKind: entry.scopeKind ?? null,
            declarations: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.localVariables,
                key: entry.key,
                role: "declarations",
                fallbackRecords: entry.declarations
            }),
            references: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.localVariables,
                key: entry.key,
                role: "references",
                fallbackRecords: entry.references
            })
        })),
        structVariables: mapToObject(identifierCollections.structVariables, (entry) => ({
            identifierId: entry.identifierId ?? buildIdentifierId("struct-variable", entry.key ?? ""),
            key: entry.key,
            name: entry.name ?? null,
            scopeId: entry.scopeId ?? null,
            scopeKind: entry.scopeKind ?? null,
            declarations: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.structVariables,
                key: entry.key,
                role: "declarations",
                fallbackRecords: entry.declarations
            }),
            references: resolveIdentifierRoleRecords({
                identifierSink,
                collection: IDENTIFIER_COLLECTION_NAMES.structVariables,
                key: entry.key,
                role: "references",
                fallbackRecords: entry.references
            })
        }))
    };
    return {
        projectRoot,
        resources,
        scopes,
        files,
        relationships,
        identifiers
    };
}
async function loadBuiltInNamesForProjectIndex({ fsFacade, metrics, signal, ensureNotAborted }) {
    const builtInIdentifiers = await metrics.timers.timeAsync("loadBuiltIns", () =>
        loadBuiltInIdentifiers(fsFacade, metrics, {
            signal,
            fallbackMessage: PROJECT_INDEX_BUILD_ABORT_MESSAGE
        })
    );
    ensureNotAborted();
    return builtInIdentifiers.names ?? new Set();
}
async function discoverProjectFilesForIndex({
    projectRoot,
    fsFacade,
    metrics,
    signal,
    ensureNotAborted,
    logger = null
}: {
    projectRoot: string;
    fsFacade: any;
    metrics: any;
    signal: any;
    ensureNotAborted: () => void;
    logger?: ProjectIndexLogger;
}) {
    const projectFiles = await metrics.timers.timeAsync("scanProjectTree", () =>
        scanProjectTree(projectRoot, fsFacade, metrics, { signal })
    );
    ensureNotAborted();
    metrics.metadata.setMetadata("yyFileCount", projectFiles.yyFiles.length);
    metrics.metadata.setMetadata("gmlFileCount", projectFiles.gmlFiles.length);

    if (logger) {
        logProjectIndexDebug(
            logger,
            `DEBUG: Discovered ${projectFiles.yyFiles.length} yyFiles and ${projectFiles.gmlFiles.length} gmlFiles`
        );
        if (projectFiles.yyFiles.length > 0) {
            logProjectIndexDebug(logger, `DEBUG: Sample yyFile: ${projectFiles.yyFiles[0].relativePath}`);
        }
    }
    return projectFiles;
}
async function analyseProjectResourcesForIndex({
    projectRoot,
    yyFiles,
    fsFacade,
    metrics,
    signal,
    ensureNotAborted,
    logger = null
}: {
    projectRoot: string;
    yyFiles: any[];
    fsFacade: any;
    metrics: any;
    signal: any;
    ensureNotAborted: () => void;
    logger?: ProjectIndexLogger;
}) {
    if (logger) {
        logProjectIndexDebug(logger, `DEBUG: analyseProjectResourcesForIndex called with ${yyFiles.length} yyFiles`);
    }
    const resourceAnalysis = await metrics.timers.timeAsync("analyseResourceFiles", () =>
        analyseResourceFiles({
            projectRoot,
            yyFiles,
            fsFacade,
            signal,
            logger
        })
    );
    if (logger) {
        logProjectIndexDebug(
            logger,
            `DEBUG: analyseResourceFiles returned resourcesMap of size: ${resourceAnalysis.resourcesMap.size}`
        );
    }
    ensureNotAborted();
    metrics.counters.increment("resources.total", resourceAnalysis.resourcesMap.size);
    return resourceAnalysis;
}
function configureGmlProcessing({ options, metrics }) {
    const concurrencySettings = options?.concurrency ?? {};
    const gmlConcurrency = clampConcurrency(concurrencySettings.gml ?? concurrencySettings.gmlParsing);
    metrics.metadata.setMetadata("gmlParseConcurrency", gmlConcurrency);
    const parseProjectSource = resolveProjectIndexParser(options);
    return { gmlConcurrency, parseProjectSource };
}
async function processProjectGmlFilesForIndex({
    gmlFiles,
    gmlConcurrency,
    parseProjectSource,
    fsFacade,
    metrics,
    ensureNotAborted,
    resourceAnalysis,
    scopeMap,
    filesMap,
    identifierCollections,
    relationships,
    builtInNames,
    projectRoot,
    signal,
    identifierSink
}) {
    await processWithConcurrency(
        gmlFiles,
        gmlConcurrency,
        async (file) => {
            await processProjectGmlFile({
                file,
                fsFacade,
                metrics,
                ensureNotAborted,
                parseProjectSource,
                resourceAnalysis,
                scopeMap,
                filesMap,
                identifierCollections,
                relationships,
                builtInNames,
                projectRoot,
                identifierSink
            });
        },
        { signal }
    );
    ensureNotAborted();
}
function finalizeProjectIndexResult({ metricsReporting, options, projectIndex }) {
    const metricsReport = finalizeProjectIndexMetrics(metricsReporting);
    if (metricsReport) {
        projectIndex.metrics = metricsReport;
        options?.onMetrics?.(metricsReport, projectIndex);
    }
    return projectIndex;
}
export async function buildProjectIndex(projectRoot, fsFacade = defaultFsFacade, options = {} as any) {
    if (!projectRoot) {
        throw new Error("projectRoot must be provided to buildProjectIndex");
    }
    const resolvedRoot = path.resolve(projectRoot);
    const logger = options?.logger ?? null;
    const metricsContracts = createProjectIndexMetrics({
        metrics: options?.metrics,
        logger,
        logMetrics: options?.logMetrics
    });
    const metrics = metricsContracts.recording;
    const metricsReporting = metricsContracts.reporting;
    const stopTotal = metrics.timers.startTimer("total");
    const { signal, ensureNotAborted } = createProjectIndexAbortGuard(options);
    const identifierSink =
        options?.identifierSink?.enabled === true ? createIdentifierSink(options.identifierSink) : null;
    let maxRss = 0;
    let maxHeapUsed = 0;
    const recordMemoryHighWater = (): void => {
        const snapshot = process.memoryUsage();
        maxRss = Math.max(maxRss, snapshot.rss);
        maxHeapUsed = Math.max(maxHeapUsed, snapshot.heapUsed);
    };

    recordMemoryHighWater();

    if (logger) {
        logProjectIndexDebug(logger, `DEBUG: Starting buildProjectIndex for project: ${resolvedRoot}`);
    }

    const builtInNames = await loadBuiltInNamesForProjectIndex({
        fsFacade,
        metrics,
        signal,
        ensureNotAborted
    });
    recordMemoryHighWater();

    const { yyFiles, gmlFiles } = await discoverProjectFilesForIndex({
        projectRoot: resolvedRoot,
        fsFacade,
        metrics,
        signal,
        ensureNotAborted,
        logger
    });
    recordMemoryHighWater();

    const resourceAnalysis = await analyseProjectResourcesForIndex({
        projectRoot: resolvedRoot,
        yyFiles,
        fsFacade,
        metrics,
        signal,
        ensureNotAborted,
        logger
    });
    recordMemoryHighWater();

    const { scopeMap, filesMap, relationships, identifierCollections } =
        createProjectIndexAggregationState(resourceAnalysis);

    const { gmlConcurrency, parseProjectSource } = configureGmlProcessing({
        options,
        metrics
    });

    try {
        await processProjectGmlFilesForIndex({
            gmlFiles,
            gmlConcurrency,
            parseProjectSource,
            fsFacade,
            metrics,
            ensureNotAborted,
            resourceAnalysis,
            scopeMap,
            filesMap,
            identifierCollections,
            relationships,
            builtInNames,
            projectRoot: resolvedRoot,
            signal,
            identifierSink
        });
        recordMemoryHighWater();

        recordScriptCallMetricsAndReferences({
            relationships,
            metrics,
            identifierCollections,
            identifierSink
        });

        const projectIndexPayload = createProjectIndexResultSnapshot({
            projectRoot: resolvedRoot,
            resourceAnalysis,
            scopeMap,
            filesMap,
            identifierCollections,
            relationships,
            identifierSink
        });
        recordMemoryHighWater();

        if (identifierSink) {
            const sinkStats = identifierSink.getStats();
            metrics.counters.increment("identifiers.appended", sinkStats.recordsAppended);
            metrics.counters.increment("identifiers.spilled", sinkStats.recordsSpilled);
            metrics.counters.increment("identifiers.spillFiles", sinkStats.spillFiles);
            metrics.caches.recordMetric("identifierSink", "hits", sinkStats.cacheHits);
            metrics.caches.recordMetric("identifierSink", "misses", sinkStats.cacheMisses);
        }

        metrics.metadata.setMetadata("memory.maxRssBytes", maxRss);
        metrics.metadata.setMetadata("memory.maxHeapUsedBytes", maxHeapUsed);

        if (logger) {
            logProjectIndexDebug(logger, "DEBUG: identifierCollections keys:", Object.keys(identifierCollections));
            logProjectIndexDebug(logger, "DEBUG: resourceAnalysis keys:", Object.keys(resourceAnalysis));
            if (resourceAnalysis.resourcesMap) {
                logProjectIndexDebug(
                    logger,
                    "DEBUG: resourceAnalysis.resourcesMap size:",
                    resourceAnalysis.resourcesMap.size
                );
            }
        }

        stopTotal();
        const projectIndex = projectIndexPayload;
        return finalizeProjectIndexResult({
            metricsReporting,
            options,
            projectIndex
        });
    } finally {
        identifierSink?.dispose();
    }
}
