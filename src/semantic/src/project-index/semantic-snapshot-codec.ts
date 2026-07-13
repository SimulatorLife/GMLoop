import { Core } from "@gmloop/core";

import type {
    SemanticOccurrence,
    SemanticRelationship,
    SemanticSnapshot,
    SemanticSourceRevision,
    SemanticSymbol,
    SemanticTier
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
            const definingFilePath = readString(entry.filePath);
            symbols.push(
                Object.freeze({
                    definingFilePath,
                    displayName: readString(entry.displayName) ?? name,
                    documentation: readDocumentation(entry.documentation),
                    kind: collectionName,
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
    const relationships = collectScriptCallRelationships(index, tier);
    return Object.freeze({
        dependencies: Object.freeze([]),
        occurrences: Object.freeze(occurrences),
        relationships: Object.freeze(relationships),
        resources: Object.freeze(resources),
        scopes: Object.freeze(scopes),
        sourceRevision,
        symbols: Object.freeze(symbols),
        tier,
        unresolvedReferences: Object.freeze([])
    });
}
