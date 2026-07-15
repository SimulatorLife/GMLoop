import path from "node:path";

import { Core } from "@gmloop/core";

import { buildProjectIndex, type ProjectIndexFsFacade } from "../project-index/index.js";
import type { SemanticSnapshot } from "../project-index/semantic-snapshot.js";
import {
    createEmptyGmlSymbolDocumentation,
    type GmlSymbolDocumentation
} from "../project-index/symbol-documentation.js";
import {
    getGmlSymbolKindForIdentifierCollection,
    getGmlSymbolKindSpecificity,
    type GmlSemanticSymbolKind,
    normalizeGmlSemanticSymbolKind
} from "../symbols/taxonomy.js";

/**
 * Role assigned to an indexed symbol occurrence.
 */
export type GmlNavigationOccurrenceRole = "definition" | "reference";

/**
 * Source range in UTF-16 offsets with an exclusive end boundary.
 */
export type GmlNavigationRange = Readonly<{
    end: number;
    start: number;
}>;

/**
 * File-scoped source location for semantic navigation.
 */
export type GmlNavigationLocation = Readonly<{
    filePath: string;
    range: GmlNavigationRange;
}>;

/**
 * Normalized symbol occurrence produced from the project index.
 */
export type GmlNavigationOccurrence = Readonly<{
    displayName: string;
    kind: GmlSemanticSymbolKind;
    location: GmlNavigationLocation;
    name: string;
    role: GmlNavigationOccurrenceRole;
    scopeId: string | null;
    symbolId: string;
}>;

/**
 * Symbol entry with declarations and references separated for editor-style queries.
 */
export type GmlNavigationSymbol = Readonly<{
    documentation: GmlSymbolDocumentation;
    definitions: ReadonlyArray<GmlNavigationOccurrence>;
    displayName: string;
    kind: GmlSemanticSymbolKind;
    name: string;
    references: ReadonlyArray<GmlNavigationOccurrence>;
    symbolId: string;
}>;

/**
 * Typed semantic navigation view over a GameMaker project index.
 */
export type GmlProjectNavigationIndex = Readonly<{
    definitionsByFilePath: ReadonlyMap<string, ReadonlyArray<GmlNavigationOccurrence>>;
    occurrencesByFilePath: ReadonlyMap<string, ReadonlyArray<GmlNavigationOccurrence>>;
    projectRoot: string;
    resourceKindsByName: ReadonlyMap<string, GmlSemanticSymbolKind>;
    symbolIdsByName: ReadonlyMap<string, ReadonlyArray<string>>;
    symbolsById: ReadonlyMap<string, GmlNavigationSymbol>;
    symbols: ReadonlyArray<GmlNavigationSymbol>;
    rawIndex?: unknown;
}>;

/**
 * Hover facts owned by semantic analysis.
 */
export type GmlHoverFacts = Readonly<{
    displayName: string;
    kind: GmlSemanticSymbolKind;
    symbolId: string;
}>;

/** One enum member rendered in editor hover information. */
export type GmlEnumHoverMember = Readonly<{ name: string; value: string | null }>;

type ProjectIndexSource = Readonly<{
    identifiers: Record<string, unknown>;
    projectRoot: string;
    relationships: Record<string, unknown>;
    resources: Record<string, unknown>;
}>;

type LocationRecord = Readonly<{
    index?: unknown;
}>;

function asRecord(value: unknown): Record<string, unknown> {
    return Core.isObjectLike(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readDocumentation(value: unknown): GmlSymbolDocumentation {
    if (!Core.isObjectLike(value)) {
        return createEmptyGmlSymbolDocumentation();
    }
    const documentation = asRecord(value);
    const normalizedText = readString(documentation.normalizedText);
    if (normalizedText === null) {
        return createEmptyGmlSymbolDocumentation();
    }
    const description = readString(documentation.description) ?? "";
    const parameters = Array.isArray(documentation.parameters)
        ? documentation.parameters.flatMap((parameter) => {
              if (!Core.isObjectLike(parameter) || readString(parameter.name) === null) {
                  return [];
              }
              return [
                  Object.freeze({
                      name: readString(parameter.name) ?? "",
                      type: readString(parameter.type),
                      description: readString(parameter.description)
                  })
              ];
          })
        : [];
    const returnsValue = asRecord(documentation.returns);
    const returns = Core.isObjectLike(documentation.returns)
        ? Object.freeze({ type: readString(returnsValue.type), description: readString(returnsValue.description) })
        : null;
    const additionalTags = Array.isArray(documentation.additionalTags)
        ? documentation.additionalTags.flatMap((tag) =>
              Core.isObjectLike(tag) && readString(tag.name) !== null
                  ? [Object.freeze({ name: readString(tag.name) ?? "", value: readString(tag.value) ?? "" })]
                  : []
          )
        : [];
    return Object.freeze({
        normalizedText,
        description,
        parameters: Object.freeze(parameters),
        returns,
        additionalTags: Object.freeze(additionalTags)
    });
}

function readLocationIndex(value: unknown): number | null {
    if (typeof value === "number") {
        return readFiniteNumber(value);
    }

    if (!Core.isObjectLike(value)) {
        return null;
    }

    const record = value as LocationRecord;
    return readFiniteNumber(record.index);
}

function resolveProjectFilePath(projectRoot: string, filePath: string): string {
    return path.isAbsolute(filePath)
        ? path.normalize(filePath)
        : path.normalize(path.join(projectRoot, Core.fromPosixPath(filePath)));
}

function readOccurrenceLocation(
    projectRoot: string,
    entryFilePath: string | null,
    rawOccurrence: unknown
): GmlNavigationLocation | null {
    const occurrence = asRecord(rawOccurrence);
    const location = asRecord(occurrence.location);
    const startContainer = Core.isObjectLike(location.start) ? location.start : occurrence.start;
    const endContainer = Core.isObjectLike(location.end) ? location.end : occurrence.end;
    const start = readLocationIndex(startContainer);
    const endInclusive = readLocationIndex(endContainer);
    const filePath = readString(occurrence.filePath) ?? readString(occurrence.path) ?? entryFilePath;

    if (start === null || endInclusive === null || filePath === null) {
        return null;
    }

    return {
        filePath: resolveProjectFilePath(projectRoot, filePath),
        range: {
            start,
            end: Math.max(start, endInclusive + 1)
        }
    };
}

function readOccurrences(parameters: {
    displayName: string;
    entryFilePath: string | null;
    kind: GmlSemanticSymbolKind;
    name: string;
    projectRoot: string;
    rawOccurrences: unknown;
    role: GmlNavigationOccurrenceRole;
    scopeId: string | null;
    symbolId: string;
}): GmlNavigationOccurrence[] {
    if (!Array.isArray(parameters.rawOccurrences)) {
        return [];
    }

    return parameters.rawOccurrences.flatMap((rawOccurrence) => {
        const location = readOccurrenceLocation(parameters.projectRoot, parameters.entryFilePath, rawOccurrence);
        if (!location) {
            return [];
        }

        const occurrence = asRecord(rawOccurrence);
        return [
            {
                displayName: parameters.displayName,
                kind: parameters.kind,
                location,
                name: readString(occurrence.name) ?? parameters.name,
                role: parameters.role,
                scopeId: readString(occurrence.scopeId) ?? parameters.scopeId,
                symbolId: parameters.symbolId
            }
        ];
    });
}

function normalizeIdentifierEntry(
    projectRoot: string,
    collectionName: string,
    entryKey: string,
    rawEntry: unknown
): GmlNavigationSymbol | null {
    const entry = asRecord(rawEntry);
    const name = readString(entry.name) ?? readString(entry.displayName) ?? entryKey;
    const displayName = readString(entry.displayName) ?? name;
    const declarations = Array.isArray(entry.declarations) ? entry.declarations : [];
    const isParameter = declarations.some((declaration) => {
        const classifications = asRecord(declaration).classifications;
        return Array.isArray(classifications) && classifications.includes("parameter");
    });
    const kind = normalizeGmlSemanticSymbolKind(
        readString(entry.semanticKind) ??
            (collectionName === "localVariables" && isParameter
                ? "parameter"
                : getGmlSymbolKindForIdentifierCollection(collectionName))
    );
    const symbolId = readString(entry.identifierId) ?? `${kind}:${entryKey}`;
    const entryFilePath = readString(entry.filePath) ?? readString(entry.resourcePath);
    const scopeId = readString(entry.scopeId);
    const documentation = readDocumentation(entry.documentation);
    const common = { projectRoot, entryFilePath, symbolId, name, displayName, kind, scopeId };
    const definitions = readOccurrences({
        ...common,
        role: "definition",
        rawOccurrences: entry.declarations
    });
    const references = readOccurrences({
        ...common,
        role: "reference",
        rawOccurrences: entry.references
    });

    if (definitions.length === 0 && references.length === 0) {
        return null;
    }

    return {
        symbolId,
        name,
        displayName,
        kind,
        documentation,
        definitions,
        references
    };
}

function normalizeProjectIndexSource(projectIndex: unknown): ProjectIndexSource | null {
    const source = asRecord(projectIndex);
    const projectRoot = readString(source.projectRoot);
    const identifiers = asRecord(source.identifiers);
    const relationships = asRecord(source.relationships);
    const resources = asRecord(source.resources);

    if (projectRoot === null) {
        return null;
    }

    return {
        projectRoot,
        identifiers,
        relationships,
        resources
    };
}

function compareOccurrencesByLocation(left: GmlNavigationOccurrence, right: GmlNavigationOccurrence): number {
    const pathComparison = left.location.filePath.localeCompare(right.location.filePath);
    return pathComparison === 0 ? left.location.range.start - right.location.range.start : pathComparison;
}

function compareSymbols(left: GmlNavigationSymbol, right: GmlNavigationSymbol): number {
    const nameComparison = left.displayName.localeCompare(right.displayName);
    return nameComparison === 0 ? left.symbolId.localeCompare(right.symbolId) : nameComparison;
}

function listAllOccurrences(symbol: GmlNavigationSymbol): GmlNavigationOccurrence[] {
    return [...symbol.definitions, ...symbol.references].toSorted(compareOccurrencesByLocation);
}

function createScriptCallReference(
    projectRoot: string,
    symbol: GmlNavigationSymbol,
    rawScriptCall: unknown
): GmlNavigationOccurrence | null {
    const scriptCall = asRecord(rawScriptCall);
    const from = asRecord(scriptCall.from);
    const location = readOccurrenceLocation(projectRoot, readString(from.filePath), scriptCall);
    if (!location) {
        return null;
    }

    return {
        displayName: symbol.displayName,
        kind: symbol.kind,
        location,
        name: symbol.name,
        role: "reference",
        scopeId: readString(from.scopeId),
        symbolId: symbol.symbolId
    };
}

function mergeScriptCallReferences(
    projectRoot: string,
    symbols: ReadonlyArray<GmlNavigationSymbol>,
    relationships: Record<string, unknown>
): GmlNavigationSymbol[] {
    const scriptCalls = relationships.scriptCalls;
    if (!Array.isArray(scriptCalls)) {
        return [...symbols];
    }

    const referencesBySymbolId = new Map<string, GmlNavigationOccurrence[]>();
    const scriptsByScopeId = new Map<string, GmlNavigationSymbol>();
    const scriptsByName = new Map<string, GmlNavigationSymbol>();
    for (const symbol of symbols) {
        if (symbol.kind !== "script") {
            continue;
        }
        scriptsByName.set(symbol.name, symbol);
        for (const definition of symbol.definitions) {
            const scopeId = definition.scopeId;
            if (scopeId) {
                scriptsByScopeId.set(scopeId, symbol);
            }
        }
    }
    for (const rawScriptCall of scriptCalls) {
        const target = asRecord(asRecord(rawScriptCall).target);
        const targetScopeId = readString(target.scopeId);
        const targetName = readString(target.name);
        let symbol: GmlNavigationSymbol | undefined;
        if (targetScopeId === null) {
            symbol = targetName === null ? undefined : scriptsByName.get(targetName);
        } else {
            symbol = scriptsByScopeId.get(targetScopeId);
            if (symbol === undefined && targetName !== null) {
                symbol = scriptsByName.get(targetName);
            }
        }
        if (!symbol) {
            continue;
        }

        const reference = createScriptCallReference(projectRoot, symbol, rawScriptCall);
        if (!reference) {
            continue;
        }

        const references = Core.getOrCreateMapEntry(referencesBySymbolId, symbol.symbolId, () => []);
        references.push(reference);
    }

    return symbols.map((symbol) => {
        const additionalReferences = referencesBySymbolId.get(symbol.symbolId) ?? [];
        return additionalReferences.length === 0
            ? symbol
            : {
                  ...symbol,
                  references: [...symbol.references, ...additionalReferences].toSorted(compareOccurrencesByLocation)
              };
    });
}

function isOffsetInRange(offset: number, range: GmlNavigationRange): boolean {
    return offset >= range.start && offset < range.end;
}

function normalizeFilePathKey(filePath: string): string {
    return path.resolve(filePath);
}

function sortOccurrencesByLocation(
    occurrences: ReadonlyArray<GmlNavigationOccurrence>
): ReadonlyArray<GmlNavigationOccurrence> {
    return [...occurrences].toSorted(compareOccurrencesByLocation);
}

function createNavigationIndexMaps(
    symbols: ReadonlyArray<GmlNavigationSymbol>
): Pick<
    GmlProjectNavigationIndex,
    "definitionsByFilePath" | "occurrencesByFilePath" | "symbolIdsByName" | "symbolsById"
> {
    const symbolsById = new Map<string, GmlNavigationSymbol>();
    const symbolIdsByName = new Map<string, string[]>();
    const definitionsByFilePath = new Map<string, GmlNavigationOccurrence[]>();
    const occurrencesByFilePath = new Map<string, GmlNavigationOccurrence[]>();

    for (const symbol of symbols) {
        symbolsById.set(symbol.symbolId, symbol);

        for (const name of [symbol.name, symbol.displayName]) {
            const ids = Core.getOrCreateMapEntry(symbolIdsByName, name, () => []);
            if (!ids.includes(symbol.symbolId)) {
                ids.push(symbol.symbolId);
            }
        }

        for (const definition of symbol.definitions) {
            const definitions = Core.getOrCreateMapEntry(
                definitionsByFilePath,
                normalizeFilePathKey(definition.location.filePath),
                () => []
            );
            definitions.push(definition);
        }

        for (const occurrence of listAllOccurrences(symbol)) {
            const occurrences = Core.getOrCreateMapEntry(
                occurrencesByFilePath,
                normalizeFilePathKey(occurrence.location.filePath),
                () => []
            );
            occurrences.push(occurrence);
        }
    }

    return {
        symbolsById,
        symbolIdsByName: new Map(
            [...symbolIdsByName.entries()].map(([name, ids]) => [
                name,
                ids.toSorted((a, b) => {
                    const symbolA = symbolsById.get(a);
                    const symbolB = symbolsById.get(b);
                    const specA = symbolA ? getGmlSymbolKindSpecificity(symbolA.kind) : 0;
                    const specB = symbolB ? getGmlSymbolKindSpecificity(symbolB.kind) : 0;
                    if (specA !== specB) {
                        return specB - specA;
                    }
                    return a.localeCompare(b);
                })
            ])
        ),
        definitionsByFilePath: new Map(
            [...definitionsByFilePath.entries()].map(([filePath, occurrences]) => [
                filePath,
                sortOccurrencesByLocation(occurrences)
            ])
        ),
        occurrencesByFilePath: new Map(
            [...occurrencesByFilePath.entries()].map(([filePath, occurrences]) => [
                filePath,
                sortOccurrencesByLocation(occurrences)
            ])
        )
    };
}

/**
 * Build a typed semantic navigation view from a project index snapshot.
 */
export function createProjectNavigationIndex(projectIndex: unknown): GmlProjectNavigationIndex {
    const source = normalizeProjectIndexSource(projectIndex);
    if (!source) {
        return {
            projectRoot: "",
            resourceKindsByName: new Map(),
            symbols: [],
            symbolsById: new Map(),
            symbolIdsByName: new Map(),
            definitionsByFilePath: new Map(),
            occurrencesByFilePath: new Map()
        };
    }

    const symbols: GmlNavigationSymbol[] = [];
    const resourceKindsByName = new Map<string, GmlSemanticSymbolKind>();
    for (const [resourceKey, rawResource] of Object.entries(source.resources)) {
        const resource = asRecord(rawResource);
        const name = readString(resource.name) ?? resourceKey;
        const resourceType = readString(resource.resourceType);
        resourceKindsByName.set(
            name,
            resourceType === "GMObject" ? "object" : resourceType === "GMRoom" ? "room" : "resource"
        );
    }
    for (const [collectionName, rawCollection] of Object.entries(source.identifiers)) {
        const collection = asRecord(rawCollection);
        for (const [entryKey, rawEntry] of Object.entries(collection)) {
            const symbol = normalizeIdentifierEntry(source.projectRoot, collectionName, entryKey, rawEntry);
            if (symbol) {
                symbols.push(symbol);
            }
        }
    }

    const mergedSymbols = mergeScriptCallReferences(source.projectRoot, symbols, source.relationships);

    const sortedSymbols = mergedSymbols.toSorted(compareSymbols);

    return {
        projectRoot: source.projectRoot,
        resourceKindsByName,
        symbols: sortedSymbols,
        ...createNavigationIndexMaps(sortedSymbols)
    };
}

/**
 * Build navigation maps from normalized semantic facts restored from SQLite.
 * This path intentionally does not depend on the optional JSON projection.
 */
export function createProjectNavigationIndexFromSemanticSnapshot(
    projectRoot: string,
    snapshot: SemanticSnapshot
): GmlProjectNavigationIndex {
    const occurrencesBySymbolId = new Map<string, GmlNavigationOccurrence[]>();
    for (const occurrence of snapshot.occurrences) {
        const occurrences = Core.getOrCreateMapEntry(occurrencesBySymbolId, occurrence.symbolId, () => []);
        occurrences.push({
            displayName: "",
            kind: "variable",
            location: {
                filePath: resolveProjectFilePath(projectRoot, occurrence.filePath),
                range: { end: occurrence.end, start: occurrence.start }
            },
            name: "",
            role: occurrence.role,
            scopeId: occurrence.scopeId,
            symbolId: occurrence.symbolId
        });
    }
    const symbols = snapshot.symbols
        .map((symbol): GmlNavigationSymbol => {
            const kind = normalizeGmlSemanticSymbolKind(symbol.kind);
            const occurrences = (occurrencesBySymbolId.get(symbol.symbolId) ?? []).map((occurrence) => ({
                ...occurrence,
                displayName: symbol.displayName,
                kind,
                name: symbol.name
            }));
            return {
                definitions: occurrences.filter((occurrence) => occurrence.role === "definition"),
                displayName: symbol.displayName,
                documentation: symbol.documentation,
                kind,
                name: symbol.name,
                references: occurrences.filter((occurrence) => occurrence.role === "reference"),
                symbolId: symbol.symbolId
            };
        })
        .toSorted(compareSymbols);
    const resourceKindsByName = new Map(
        snapshot.resources.map(
            (resource) =>
                [
                    resource.name,
                    resource.resourceType === "GMObject"
                        ? "object"
                        : resource.resourceType === "GMRoom"
                          ? "room"
                          : "resource"
                ] as const
        )
    );
    return {
        projectRoot,
        resourceKindsByName,
        symbols,
        ...createNavigationIndexMaps(symbols)
    };
}

/**
 * Build a project index and immediately normalize it for semantic navigation.
 */
export async function buildProjectNavigationIndex(
    projectRoot: string,
    fsFacade?: ProjectIndexFsFacade,
    options?: Record<string, unknown>
): Promise<GmlProjectNavigationIndex> {
    const projectIndex = await buildProjectIndex(projectRoot, fsFacade, options);
    const navIndex = createProjectNavigationIndex(projectIndex);
    (navIndex as any).rawIndex = projectIndex;
    return navIndex;
}

/**
 * Find the symbol occurrence covering a file offset.
 */
export function findNavigationSymbolAtPosition(
    index: GmlProjectNavigationIndex,
    filePath: string,
    offset: number
): GmlNavigationOccurrence | null {
    const occurrences = index.occurrencesByFilePath.get(normalizeFilePathKey(filePath)) ?? [];
    let low = 0;
    let high = occurrences.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (occurrences[middle].location.range.start <= offset) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    let best: GmlNavigationOccurrence | null = null;
    for (let indexAt = low - 1; indexAt >= 0; indexAt -= 1) {
        const occurrence = occurrences[indexAt];
        if (occurrence.location.range.start > offset) {
            continue;
        }
        if (occurrence.location.range.end <= offset) {
            break;
        }
        if (!isOffsetInRange(offset, occurrence.location.range)) {
            continue;
        }
        const currentLength = occurrence.location.range.end - occurrence.location.range.start;
        const bestLength = best ? best.location.range.end - best.location.range.start : 0;
        if (
            best === null ||
            currentLength < bestLength ||
            (currentLength === bestLength &&
                getGmlSymbolKindSpecificity(occurrence.kind) > getGmlSymbolKindSpecificity(best.kind))
        ) {
            best = occurrence;
        }
    }
    return best;
}

/**
 * Resolve a project symbol ID by display/name text.
 */
export function resolveNavigationSymbolId(index: GmlProjectNavigationIndex, name: string): string | null {
    return index.symbolIdsByName.get(name)?.[0] ?? null;
}

/**
 * Return true when a project navigation index contains a symbol.
 */
export function hasNavigationSymbol(index: GmlProjectNavigationIndex, symbolId: string): boolean {
    return index.symbolsById.has(symbolId);
}

/**
 * Return symbol definitions for a symbol ID.
 */
export function findNavigationDefinitions(
    index: GmlProjectNavigationIndex,
    symbolId: string
): ReadonlyArray<GmlNavigationOccurrence> {
    return index.symbolsById.get(symbolId)?.definitions ?? [];
}

/**
 * Return symbol occurrences for a symbol ID.
 */
export function findNavigationReferences(
    index: GmlProjectNavigationIndex,
    symbolId: string,
    includeDefinitions: boolean
): ReadonlyArray<GmlNavigationOccurrence> {
    const symbol = index.symbolsById.get(symbolId);
    if (!symbol) {
        return [];
    }

    return (includeDefinitions ? listAllOccurrences(symbol) : [...symbol.references]).toSorted(
        compareOccurrencesByLocation
    );
}

/**
 * List definitions belonging to a file for document-symbol responses.
 */
export function listNavigationDocumentSymbols(
    index: GmlProjectNavigationIndex,
    filePath: string
): ReadonlyArray<GmlNavigationOccurrence> {
    return index.definitionsByFilePath.get(normalizeFilePathKey(filePath)) ?? [];
}

/**
 * Search project symbols by display name.
 */
export function searchNavigationWorkspaceSymbols(
    index: GmlProjectNavigationIndex,
    query: string,
    limit = 100
): ReadonlyArray<GmlNavigationSymbol> {
    const normalizedQuery = query.toLowerCase();
    return index.symbols.filter((symbol) => symbol.displayName.toLowerCase().includes(normalizedQuery)).slice(0, limit);
}

/**
 * Return semantic hover facts for a symbol ID.
 */
export function getNavigationHoverFacts(index: GmlProjectNavigationIndex, symbolId: string): GmlHoverFacts | null {
    const symbol = index.symbolsById.get(symbolId);
    return symbol
        ? {
              displayName: symbol.displayName,
              kind: symbol.kind,
              symbolId: symbol.symbolId
          }
        : null;
}

/**
 * Return hover facts for the enum that owns an enum symbol or enum member.
 *
 * This lets editor consumers render the complete enum consistently when a
 * user hovers either its declaration or one of its members.
 */
export function getNavigationEnumHoverFacts(index: GmlProjectNavigationIndex, symbolId: string): GmlHoverFacts | null {
    const facts = getNavigationHoverFacts(index, symbolId);
    if (facts?.kind === "enum") {
        return facts;
    }
    if (facts?.kind !== "enumMember") {
        return null;
    }

    const identifiers = asRecord(asRecord(index.rawIndex).identifiers);
    const enumMembers = asRecord(identifiers.enumMembers);
    const member = Object.values(enumMembers)
        .map(asRecord)
        .find((entry) => readString(entry.identifierId) === symbolId);
    const enumKey = member ? readString(member.enumKey) : null;
    if (enumKey === null) {
        return null;
    }

    const enumEntry = asRecord(asRecord(identifiers.enums)[enumKey]);
    const enumSymbolId = readString(enumEntry.identifierId);
    return enumSymbolId === null ? null : getNavigationHoverFacts(index, enumSymbolId);
}

/** Return the complete ordered member list for an indexed enum symbol. */
export function listNavigationEnumHoverMembers(
    index: GmlProjectNavigationIndex,
    symbolId: string
): ReadonlyArray<GmlEnumHoverMember> {
    if (index.symbolsById.get(symbolId)?.kind !== "enum") {
        return [];
    }
    const identifiers = asRecord(asRecord(index.rawIndex).identifiers);
    const enums = asRecord(identifiers.enums);
    const enumEntry = Object.entries(enums).find(([, value]) => readString(asRecord(value).identifierId) === symbolId);
    if (enumEntry === undefined) {
        return [];
    }
    const enumKey = enumEntry[0];
    return Object.values(asRecord(identifiers.enumMembers))
        .flatMap((value) => {
            const member = asRecord(value);
            const name = readString(member.name);
            if (readString(member.enumKey) !== enumKey || name === null) {
                return [];
            }
            return [
                {
                    member: Object.freeze({ name, value: readString(member.value) }),
                    order: readFiniteNumber(member.order) ?? 0
                }
            ];
        })
        .toSorted((left, right) => left.order - right.order || left.member.name.localeCompare(right.member.name))
        .map(({ member }) => member);
}
