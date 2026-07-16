import path from "node:path";

import { Core } from "@gmloop/core";

import { getGmlSymbolKindSpecificity, normalizeGmlSemanticSymbolKind } from "../symbols/taxonomy.js";
import { compareSemanticQueryText, normalizeSemanticSearchText } from "./semantic-query-order.js";
import type {
    SemanticEnumMember,
    SemanticResourceQueryResult,
    SemanticSnapshotQueries,
    SemanticSymbolOccurrenceMatch
} from "./semantic-query-types.js";
import type { SemanticOccurrence, SemanticSnapshot, SemanticSymbol } from "./semantic-snapshot.js";
import { createSemanticSnapshotRefactorQueries } from "./snapshot-refactor-queries.js";
import { createEmptyGmlSymbolDocumentation, type GmlSymbolDocumentation } from "./symbol-documentation.js";

function resolveSemanticQueryFilePath(projectRoot: string, filePath: string): string {
    return path.resolve(projectRoot, filePath);
}

function compareOccurrences(left: SemanticOccurrence, right: SemanticOccurrence): number {
    const pathComparison = compareSemanticQueryText(left.filePath, right.filePath);
    if (pathComparison !== 0) {
        return pathComparison;
    }
    if (left.start !== right.start) {
        return left.start - right.start;
    }
    if (left.end !== right.end) {
        return left.end - right.end;
    }
    return compareSemanticQueryText(left.symbolId, right.symbolId);
}

function compareSymbols(left: SemanticSymbol, right: SemanticSymbol): number {
    const nameComparison = compareSemanticQueryText(
        normalizeSemanticSearchText(left.displayName),
        normalizeSemanticSearchText(right.displayName)
    );
    return nameComparison === 0 ? compareSemanticQueryText(left.symbolId, right.symbolId) : nameComparison;
}

function comparePreferredSymbolIds(
    leftId: string,
    rightId: string,
    symbolsById: ReadonlyMap<string, SemanticSymbol>
): number {
    const left = symbolsById.get(leftId);
    const right = symbolsById.get(rightId);
    const leftSpecificity =
        left === undefined ? 0 : getGmlSymbolKindSpecificity(normalizeGmlSemanticSymbolKind(left.kind));
    const rightSpecificity =
        right === undefined ? 0 : getGmlSymbolKindSpecificity(normalizeGmlSemanticSymbolKind(right.kind));
    return leftSpecificity === rightSpecificity
        ? compareSemanticQueryText(leftId, rightId)
        : rightSpecificity - leftSpecificity;
}

function createParameterDocumentation(
    parameter: SemanticSymbol,
    definition: SemanticOccurrence,
    symbols: ReadonlyArray<SemanticSymbol>,
    occurrencesBySymbolId: ReadonlyMap<string, ReadonlyArray<SemanticOccurrence>>
): GmlSymbolDocumentation {
    let closestDeclarationStart = -1;
    let matchingParameter: GmlSymbolDocumentation["parameters"][number] | null = null;
    for (const owner of symbols) {
        const documentedParameter = owner.documentation.parameters.find((entry) => entry.name === parameter.name);
        if (documentedParameter === undefined) {
            continue;
        }
        for (const ownerDefinition of occurrencesBySymbolId.get(owner.symbolId) ?? []) {
            if (
                ownerDefinition.role !== "definition" ||
                ownerDefinition.filePath !== definition.filePath ||
                ownerDefinition.start > definition.start ||
                ownerDefinition.start < closestDeclarationStart
            ) {
                continue;
            }
            closestDeclarationStart = ownerDefinition.start;
            matchingParameter = documentedParameter;
        }
    }
    if (matchingParameter === null) {
        return parameter.documentation;
    }
    const empty = createEmptyGmlSymbolDocumentation();
    return Object.freeze({
        additionalTags: empty.additionalTags,
        description: empty.description,
        normalizedText: "",
        parameters: Object.freeze([matchingParameter]),
        returns: empty.returns
    });
}

function enrichParameterDocumentation(
    symbols: ReadonlyArray<SemanticSymbol>,
    occurrencesBySymbolId: ReadonlyMap<string, ReadonlyArray<SemanticOccurrence>>
): ReadonlyArray<SemanticSymbol> {
    return symbols.map((symbol) => {
        if (symbol.kind !== "parameter" || symbol.documentation.parameters.length > 0) {
            return symbol;
        }
        const definition = (occurrencesBySymbolId.get(symbol.symbolId) ?? []).find(
            (occurrence) => occurrence.role === "definition"
        );
        if (definition === undefined) {
            return symbol;
        }
        const documentation = createParameterDocumentation(symbol, definition, symbols, occurrencesBySymbolId);
        return documentation === symbol.documentation ? symbol : Object.freeze({ ...symbol, documentation });
    });
}

function createSymbolOccurrenceMatch(
    occurrence: SemanticOccurrence,
    symbolsById: ReadonlyMap<string, SemanticSymbol>
): SemanticSymbolOccurrenceMatch | null {
    const symbol = symbolsById.get(occurrence.symbolId);
    return symbol === undefined ? null : Object.freeze({ occurrence, symbol });
}

/** Build an immutable query backend once for one session-local semantic snapshot. */
export function createSemanticMemorySnapshotQueries(
    projectRoot: string,
    snapshot: SemanticSnapshot
): SemanticSnapshotQueries {
    const occurrencesBySymbolId = new Map<string, SemanticOccurrence[]>();
    const occurrencesByFilePath = new Map<string, SemanticOccurrence[]>();
    for (const occurrence of snapshot.occurrences) {
        Core.getOrCreateMapEntry(occurrencesBySymbolId, occurrence.symbolId, () => []).push(occurrence);
        Core.getOrCreateMapEntry(
            occurrencesByFilePath,
            resolveSemanticQueryFilePath(projectRoot, occurrence.filePath),
            () => []
        ).push(occurrence);
    }
    for (const occurrences of occurrencesBySymbolId.values()) {
        occurrences.sort(compareOccurrences);
    }
    for (const occurrences of occurrencesByFilePath.values()) {
        occurrences.sort(compareOccurrences);
    }

    const symbols = enrichParameterDocumentation(snapshot.symbols, occurrencesBySymbolId).toSorted(compareSymbols);
    const symbolsById = new Map(symbols.map((symbol) => [symbol.symbolId, symbol]));
    const symbolIdsByName = new Map<string, string[]>();
    for (const symbol of symbols) {
        for (const name of new Set([symbol.name, symbol.displayName])) {
            Core.getOrCreateMapEntry(symbolIdsByName, name, () => []).push(symbol.symbolId);
        }
    }
    for (const symbolIds of symbolIdsByName.values()) {
        symbolIds.sort((left, right) => comparePreferredSymbolIds(left, right, symbolsById));
    }
    const filePathsByResourcePath = new Map<string, Set<string>>();
    for (const scope of snapshot.scopes) {
        if (scope.resourcePath === null) {
            continue;
        }
        const filePaths = Core.getOrCreateMapEntry(filePathsByResourcePath, scope.resourcePath, () => new Set());
        for (const filePath of scope.filePaths) {
            filePaths.add(filePath);
        }
    }
    const resources: ReadonlyArray<SemanticResourceQueryResult> = Object.freeze(
        snapshot.resources
            .map((resource) =>
                Object.freeze({
                    filePaths: Object.freeze(
                        [...(filePathsByResourcePath.get(resource.resourcePath) ?? [])].toSorted(
                            compareSemanticQueryText
                        )
                    ),
                    name: resource.name,
                    resourcePath: resource.resourcePath,
                    resourceType: resource.resourceType
                })
            )
            .toSorted((left, right) => compareSemanticQueryText(left.resourcePath, right.resourcePath))
    );

    const matchesForOccurrences = (
        occurrences: ReadonlyArray<SemanticOccurrence>
    ): ReadonlyArray<SemanticSymbolOccurrenceMatch> =>
        Object.freeze(
            occurrences.flatMap((occurrence) => {
                const match = createSymbolOccurrenceMatch(occurrence, symbolsById);
                return match === null ? [] : [match];
            })
        );

    return Object.freeze({
        findSymbolAtPosition(filePath, offset) {
            const candidates = (occurrencesByFilePath.get(resolveSemanticQueryFilePath(projectRoot, filePath)) ?? [])
                .filter((occurrence) => occurrence.start <= offset && occurrence.end > offset)
                .toSorted((left, right) => {
                    const lengthComparison = left.end - left.start - (right.end - right.start);
                    if (lengthComparison !== 0) {
                        return lengthComparison;
                    }
                    return comparePreferredSymbolIds(left.symbolId, right.symbolId, symbolsById);
                });
            return candidates.length === 0 ? null : createSymbolOccurrenceMatch(candidates[0], symbolsById);
        },
        findSymbol(symbolId) {
            return symbolsById.get(symbolId) ?? null;
        },
        resolveSymbolId(name) {
            return symbolIdsByName.get(name)?.[0] ?? null;
        },
        hasSymbol(symbolId) {
            return symbolsById.has(symbolId);
        },
        findDefinitions(symbolId) {
            return matchesForOccurrences(
                (occurrencesBySymbolId.get(symbolId) ?? []).filter((occurrence) => occurrence.role === "definition")
            );
        },
        findReferences(symbolId, includeDefinitions) {
            return matchesForOccurrences(
                (occurrencesBySymbolId.get(symbolId) ?? []).filter(
                    (occurrence) => includeDefinitions || occurrence.role === "reference"
                )
            );
        },
        listDocumentSymbols(filePath) {
            return matchesForOccurrences(
                (occurrencesByFilePath.get(resolveSemanticQueryFilePath(projectRoot, filePath)) ?? []).filter(
                    (occurrence) => occurrence.role === "definition"
                )
            );
        },
        searchWorkspaceSymbols(query, limit) {
            const boundedLimit = Math.max(0, Math.floor(limit));
            if (boundedLimit === 0) {
                return Object.freeze([]);
            }
            const normalizedQuery = normalizeSemanticSearchText(query);
            return Object.freeze(
                symbols
                    .filter((symbol) => normalizeSemanticSearchText(symbol.displayName).includes(normalizedQuery))
                    .slice(0, boundedLimit)
            );
        },
        listFileOccurrences(filePath) {
            return matchesForOccurrences(
                occurrencesByFilePath.get(resolveSemanticQueryFilePath(projectRoot, filePath)) ?? []
            );
        },
        listResources() {
            return resources;
        },
        findResourcesByNames(names) {
            const requestedNames = new Set(names);
            return Object.freeze(resources.filter((resource) => requestedNames.has(resource.name)));
        },
        findEnumOwner(symbolId) {
            const symbol = symbolsById.get(symbolId);
            if (symbol?.kind === "enum") {
                return symbol;
            }
            if (symbol?.kind !== "enumMember") {
                return null;
            }
            const relationship = snapshot.relationships
                .filter((candidate) => candidate.kind === "enumMember" && candidate.payload.memberSymbolId === symbolId)
                .toSorted((left, right) => compareSemanticQueryText(left.relationshipId, right.relationshipId))[0];
            const ownerId = relationship?.payload.enumSymbolId;
            return typeof ownerId === "string" ? (symbolsById.get(ownerId) ?? null) : null;
        },
        listEnumMembers(symbolId) {
            if (symbolsById.get(symbolId)?.kind !== "enum") {
                return Object.freeze([]);
            }
            return Object.freeze(
                snapshot.relationships
                    .flatMap((relationship): ReadonlyArray<SemanticEnumMember> => {
                        if (relationship.kind !== "enumMember" || relationship.payload.enumSymbolId !== symbolId) {
                            return [];
                        }
                        const memberSymbolId = relationship.payload.memberSymbolId;
                        const name = relationship.payload.memberName;
                        const order = relationship.payload.order;
                        const value = relationship.payload.value;
                        return typeof memberSymbolId === "string" &&
                            typeof name === "string" &&
                            typeof order === "number"
                            ? [
                                  Object.freeze({
                                      name,
                                      order,
                                      symbolId: memberSymbolId,
                                      value: typeof value === "string" ? value : null
                                  })
                              ]
                            : [];
                    })
                    .toSorted(
                        (left, right) =>
                            left.order - right.order ||
                            compareSemanticQueryText(left.name, right.name) ||
                            compareSemanticQueryText(left.symbolId, right.symbolId)
                    )
            );
        },
        refactor: createSemanticSnapshotRefactorQueries(projectRoot, snapshot)
    });
}
