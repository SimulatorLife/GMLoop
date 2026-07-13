import { Core } from "@gmloop/core";

import { getGmlSymbolKindForIdentifierCollection } from "../symbols/taxonomy.js";
import type {
    SemanticDependency,
    SemanticOccurrence,
    SemanticRelationship,
    SemanticSnapshot,
    SemanticSourceRevision,
    SemanticSymbol,
    SemanticTier,
    SemanticUnresolvedReference
} from "./semantic-snapshot.js";
import { createEmptyGmlSymbolDocumentation, type GmlSymbolDocumentation } from "./symbol-documentation.js";

type RawRecord = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): RawRecord {
    return Core.isObjectLike(value) ? Object.freeze(Object.fromEntries(Object.entries(value))) : {};
}

function readString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function readOffset(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    const record = asRecord(value);
    return typeof record.index === "number" && Number.isFinite(record.index) ? record.index : null;
}

function readDocumentation(value: unknown): GmlSymbolDocumentation {
    const record = asRecord(value);
    if (typeof record.normalizedText !== "string") {
        return createEmptyGmlSymbolDocumentation();
    }
    const parameters = Array.isArray(record.parameters)
        ? record.parameters.flatMap((parameter) => {
              const parameterRecord = asRecord(parameter);
              const name = readString(parameterRecord.name);
              return name === null
                  ? []
                  : [
                        Object.freeze({
                            description:
                                typeof parameterRecord.description === "string" ? parameterRecord.description : null,
                            name,
                            type: typeof parameterRecord.type === "string" ? parameterRecord.type : null
                        })
                    ];
          })
        : [];
    const returnsRecord = asRecord(record.returns);
    const returns = Core.isObjectLike(record.returns)
        ? Object.freeze({
              description: typeof returnsRecord.description === "string" ? returnsRecord.description : null,
              type: typeof returnsRecord.type === "string" ? returnsRecord.type : null
          })
        : null;
    const additionalTags = Array.isArray(record.additionalTags)
        ? record.additionalTags.flatMap((tag) => {
              const tagRecord = asRecord(tag);
              const name = readString(tagRecord.name);
              return name === null
                  ? []
                  : [Object.freeze({ name, value: typeof tagRecord.value === "string" ? tagRecord.value : "" })];
          })
        : [];
    return Object.freeze({
        additionalTags: Object.freeze(additionalTags),
        description: typeof record.description === "string" ? record.description : "",
        normalizedText: record.normalizedText,
        parameters: Object.freeze(parameters),
        returns
    });
}

function collectOccurrences(
    entry: RawRecord,
    symbolId: string,
    defaultFilePath: string | null,
    tier: SemanticTier
): ReadonlyArray<SemanticOccurrence> {
    const collect = (records: unknown, role: SemanticOccurrence["role"]): ReadonlyArray<SemanticOccurrence> => {
        if (role === "reference" && tier === "definitions") {
            return [];
        }
        return Array.isArray(records)
            ? records.flatMap((value) => {
                  const record = asRecord(value);
                  const location = asRecord(record.location);
                  const start = readOffset(location.start ?? record.start);
                  const endInclusive = readOffset(location.end ?? record.end);
                  const filePath = readString(record.filePath) ?? defaultFilePath;
                  if (start === null || endInclusive === null || filePath === null) {
                      return [];
                  }
                  return [
                      Object.freeze({
                          end: Math.max(start, endInclusive + 1),
                          filePath,
                          role,
                          scopeId: readString(record.scopeId) ?? readString(entry.scopeId),
                          start,
                          symbolId
                      })
                  ];
              })
            : [];
    };
    return Object.freeze([...collect(entry.declarations, "definition"), ...collect(entry.references, "reference")]);
}

function readFirstOccurrenceFilePath(records: unknown): string | null {
    if (!Array.isArray(records)) {
        return null;
    }
    for (const value of records) {
        const filePath = readString(asRecord(value).filePath);
        if (filePath !== null) {
            return filePath;
        }
    }
    return null;
}

function collectScriptCallRelationships(
    index: Readonly<Record<string, unknown>>,
    tier: SemanticTier
): ReadonlyArray<SemanticRelationship> {
    if (tier === "definitions") {
        return [];
    }
    const relationships = asRecord(index.relationships);
    return Array.isArray(relationships.scriptCalls)
        ? relationships.scriptCalls.flatMap((rawCall, ordinal) => {
              const call = asRecord(rawCall);
              const from = asRecord(call.from);
              const target = asRecord(call.target);
              const ownerFilePath = readString(from.filePath);
              if (ownerFilePath === null) {
                  return [];
              }
              const location = asRecord(call.location);
              const start = readOffset(location.start ?? call.start);
              const endInclusive = readOffset(location.end ?? call.end);
              return [
                  Object.freeze({
                      kind: "scriptCall",
                      ownerFilePath,
                      payload: Object.freeze({
                          end: endInclusive === null ? null : endInclusive + 1,
                          fromScopeId: readString(from.scopeId),
                          isResolved: call.isResolved === true,
                          start,
                          targetName: readString(target.name),
                          targetScopeId: readString(target.scopeId)
                      }),
                      relationshipId: `script-call:${ownerFilePath}:${String(ordinal)}`
                  })
              ];
          })
        : [];
}

function collectUnresolvedReferences(
    index: Readonly<Record<string, unknown>>,
    tier: SemanticTier
): ReadonlyArray<SemanticUnresolvedReference> {
    if (tier === "definitions") {
        return [];
    }
    const references = new Map<string, SemanticUnresolvedReference>();
    const register = (reference: SemanticUnresolvedReference): void => {
        references.set(
            `${reference.filePath}\u0000${reference.start}\u0000${reference.end}\u0000${reference.name}`,
            reference
        );
    };
    for (const [filePath, rawFile] of Object.entries(asRecord(index.files))) {
        const ignoredIdentifiers = asRecord(rawFile).ignoredIdentifiers;
        if (!Array.isArray(ignoredIdentifiers)) {
            continue;
        }
        for (const rawIdentifier of ignoredIdentifiers) {
            const identifier = asRecord(rawIdentifier);
            const name = readString(identifier.name);
            const start = readOffset(identifier.start);
            const endInclusive = readOffset(identifier.end);
            if (name === null || start === null || endInclusive === null || identifier.reason === "built-in") {
                continue;
            }
            register(Object.freeze({ end: Math.max(start, endInclusive + 1), filePath, name, start }));
        }
    }
    const scriptCalls = asRecord(index.relationships).scriptCalls;
    if (Array.isArray(scriptCalls)) {
        for (const rawCall of scriptCalls) {
            const call = asRecord(rawCall);
            if (call.isResolved === true) {
                continue;
            }
            const from = asRecord(call.from);
            const target = asRecord(call.target);
            const location = asRecord(call.location);
            const filePath = readString(from.filePath);
            const name = readString(target.name);
            const start = readOffset(location.start);
            const endInclusive = readOffset(location.end);
            if (filePath === null || name === null || start === null || endInclusive === null) {
                continue;
            }
            register(Object.freeze({ end: Math.max(start, endInclusive + 1), filePath, name, start }));
        }
    }
    return [...references.values()].toSorted((left, right) =>
        left.filePath === right.filePath ? left.start - right.start : left.filePath.localeCompare(right.filePath)
    );
}

function createReferenceKey(filePath: string, start: number, end: number, name: string): string {
    return `${filePath}\u0000${start}\u0000${end}\u0000${name}`;
}

function resolveUniqueCallTargets(
    parameters: Readonly<{
        occurrences: ReadonlyArray<SemanticOccurrence>;
        relationships: ReadonlyArray<SemanticRelationship>;
        symbols: ReadonlyArray<SemanticSymbol>;
    }>
): Readonly<{
    occurrences: ReadonlyArray<SemanticOccurrence>;
    relationships: ReadonlyArray<SemanticRelationship>;
    resolvedReferenceKeys: ReadonlySet<string>;
}> {
    const callableSymbolsByName = new Map<string, SemanticSymbol[]>();
    for (const symbol of parameters.symbols) {
        if (symbol.definingFilePath === null || (symbol.kind !== "function" && symbol.kind !== "script")) {
            continue;
        }
        Core.getOrCreateMapEntry(callableSymbolsByName, symbol.name, () => []).push(symbol);
    }
    const existingOccurrenceKeys = new Set(
        parameters.occurrences.map(
            (occurrence) =>
                `${occurrence.symbolId}\u0000${occurrence.filePath}\u0000${occurrence.start}\u0000${occurrence.end}`
        )
    );
    const occurrences: SemanticOccurrence[] = [];
    const resolvedReferenceKeys = new Set<string>();
    const relationships = parameters.relationships.map((relationship) => {
        if (relationship.kind !== "scriptCall") {
            return relationship;
        }
        const targetName = relationship.payload.targetName;
        const start = relationship.payload.start;
        const end = relationship.payload.end;
        if (typeof targetName !== "string" || typeof start !== "number" || typeof end !== "number") {
            return relationship;
        }
        const candidates = callableSymbolsByName.get(targetName) ?? [];
        if (candidates.length !== 1) {
            return relationship;
        }
        const target = candidates[0];
        const occurrenceKey = `${target.symbolId}\u0000${relationship.ownerFilePath}\u0000${start}\u0000${end}`;
        if (!existingOccurrenceKeys.has(occurrenceKey)) {
            occurrences.push(
                Object.freeze({
                    end,
                    filePath: relationship.ownerFilePath,
                    role: "reference",
                    scopeId:
                        typeof relationship.payload.fromScopeId === "string" ? relationship.payload.fromScopeId : null,
                    start,
                    symbolId: target.symbolId
                })
            );
            existingOccurrenceKeys.add(occurrenceKey);
        }
        resolvedReferenceKeys.add(createReferenceKey(relationship.ownerFilePath, start, end, targetName));
        return Object.freeze({
            ...relationship,
            payload: Object.freeze({ ...relationship.payload, isResolved: true, targetSymbolId: target.symbolId })
        });
    });
    return Object.freeze({
        occurrences: Object.freeze(occurrences),
        relationships: Object.freeze(relationships),
        resolvedReferenceKeys
    });
}

function collectDependencies(
    parameters: Readonly<{
        occurrences: ReadonlyArray<SemanticOccurrence>;
        relationships: ReadonlyArray<SemanticRelationship>;
        scopes: ReadonlyArray<SemanticSnapshot["scopes"][number]>;
        symbols: ReadonlyArray<SemanticSymbol>;
        tier: SemanticTier;
    }>
): ReadonlyArray<SemanticDependency> {
    if (parameters.tier === "definitions") {
        return [];
    }
    const dependencies = new Map<string, SemanticDependency>();
    const register = (dependency: SemanticDependency): void => {
        if (dependency.ownerFilePath === dependency.dependentFilePath) {
            return;
        }
        dependencies.set(
            `${dependency.kind}\u0000${dependency.ownerFilePath}\u0000${dependency.dependentFilePath}\u0000${dependency.symbolId ?? ""}`,
            Object.freeze(dependency)
        );
    };
    const definitionsBySymbolId = new Map<string, string[]>();
    for (const occurrence of parameters.occurrences) {
        if (occurrence.role !== "definition") {
            continue;
        }
        const filePaths = Core.getOrCreateMapEntry(definitionsBySymbolId, occurrence.symbolId, () => []);
        if (!filePaths.includes(occurrence.filePath)) {
            filePaths.push(occurrence.filePath);
        }
    }
    for (const occurrence of parameters.occurrences) {
        if (occurrence.role !== "reference") {
            continue;
        }
        for (const ownerFilePath of definitionsBySymbolId.get(occurrence.symbolId) ?? []) {
            register({
                dependentFilePath: occurrence.filePath,
                kind: "resolvedSymbolReference",
                ownerFilePath,
                symbolId: occurrence.symbolId
            });
        }
    }
    const filesByScopeId = new Map(parameters.scopes.map((scope) => [scope.scopeId, scope.filePaths]));
    const symbolsByName = new Map(parameters.symbols.map((symbol) => [symbol.name, symbol]));
    for (const relationship of parameters.relationships) {
        if (relationship.kind !== "scriptCall") {
            continue;
        }
        const targetScopeId = relationship.payload.targetScopeId;
        const targetName = relationship.payload.targetName;
        const targetSymbol = typeof targetName === "string" ? symbolsByName.get(targetName) : undefined;
        const ownerFilePaths =
            typeof targetScopeId === "string"
                ? (filesByScopeId.get(targetScopeId) ?? [])
                : targetSymbol?.definingFilePath
                  ? [targetSymbol.definingFilePath]
                  : [];
        for (const ownerFilePath of ownerFilePaths) {
            register({
                dependentFilePath: relationship.ownerFilePath,
                kind: "scriptCall",
                ownerFilePath,
                symbolId: targetSymbol?.symbolId ?? null
            });
        }
    }
    return [...dependencies.values()].toSorted((left, right) =>
        left.ownerFilePath === right.ownerFilePath
            ? left.dependentFilePath === right.dependentFilePath
                ? left.kind.localeCompare(right.kind)
                : left.dependentFilePath.localeCompare(right.dependentFilePath)
            : left.ownerFilePath.localeCompare(right.ownerFilePath)
    );
}

/** Convert the current analysis result into deterministic normalized semantic facts. */
export function createSemanticSnapshotFromProjectIndex(
    index: Readonly<Record<string, unknown>>,
    tier: SemanticTier,
    sourceRevision: SemanticSourceRevision
): SemanticSnapshot {
    const symbols: SemanticSymbol[] = [];
    const occurrences: SemanticOccurrence[] = [];
    const identifierCollections = asRecord(index.identifiers);
    for (const [collectionName, collection] of Object.entries(identifierCollections).toSorted(([left], [right]) =>
        left.localeCompare(right)
    )) {
        for (const [entryKey, rawEntry] of Object.entries(asRecord(collection)).toSorted(([left], [right]) =>
            left.localeCompare(right)
        )) {
            const entry = asRecord(rawEntry);
            const symbolId = readString(entry.identifierId) ?? `gml/${collectionName}/${entryKey}`;
            const name = readString(entry.name) ?? readString(entry.key) ?? entryKey;
            const definingFilePath = readString(entry.filePath) ?? readFirstOccurrenceFilePath(entry.declarations);
            symbols.push(
                Object.freeze({
                    definingFilePath,
                    displayName: readString(entry.displayName) ?? name,
                    documentation: readDocumentation(entry.documentation),
                    kind: readString(entry.semanticKind) ?? getGmlSymbolKindForIdentifierCollection(collectionName),
                    name,
                    scopeId: readString(entry.scopeId),
                    symbolId
                })
            );
            occurrences.push(...collectOccurrences(entry, symbolId, definingFilePath, tier));
        }
    }
    const scopes = Object.entries(asRecord(index.scopes)).map(([scopeId, rawScope]) => {
        const scope = asRecord(rawScope);
        return Object.freeze({
            displayName: readString(scope.displayName) ?? scopeId,
            filePaths: Array.isArray(scope.filePaths)
                ? Object.freeze(scope.filePaths.flatMap((filePath) => (typeof filePath === "string" ? [filePath] : [])))
                : Object.freeze([]),
            kind: readString(scope.kind) ?? "unknown",
            name: readString(scope.name) ?? scopeId,
            resourcePath: readString(scope.resourcePath),
            scopeId
        });
    });
    const resources = Object.entries(asRecord(index.resources)).map(([resourcePath, rawResource]) => {
        const resource = asRecord(rawResource);
        return Object.freeze({
            name: readString(resource.name) ?? resourcePath,
            resourcePath,
            resourceType: readString(resource.resourceType) ?? "unknown"
        });
    });
    const rawRelationships = collectScriptCallRelationships(index, tier);
    const resolvedCalls = resolveUniqueCallTargets({ occurrences, relationships: rawRelationships, symbols });
    occurrences.push(...resolvedCalls.occurrences);
    const relationships = resolvedCalls.relationships;
    const unresolvedReferences = collectUnresolvedReferences(index, tier).filter(
        (reference) =>
            !resolvedCalls.resolvedReferenceKeys.has(
                createReferenceKey(reference.filePath, reference.start, reference.end, reference.name)
            )
    );
    const dependencies = collectDependencies({ occurrences, relationships, scopes, symbols, tier });
    return Object.freeze({
        dependencies: Object.freeze(dependencies),
        occurrences: Object.freeze(occurrences),
        relationships: Object.freeze(relationships),
        resources: Object.freeze(resources),
        scopes: Object.freeze(scopes),
        sourceRevision,
        symbols: Object.freeze(symbols),
        tier,
        unresolvedReferences: Object.freeze(unresolvedReferences)
    });
}
