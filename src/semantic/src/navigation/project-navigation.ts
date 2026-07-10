import path from "node:path";

import { Core } from "@gmloop/core";

import { buildProjectIndex, type ProjectIndexFsFacade } from "../project-index/index.js";

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
    kind: string;
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
    definitions: ReadonlyArray<GmlNavigationOccurrence>;
    displayName: string;
    kind: string;
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
    resourceKindsByName: ReadonlyMap<string, string>;
    symbolIdsByName: ReadonlyMap<string, ReadonlyArray<string>>;
    symbolsById: ReadonlyMap<string, GmlNavigationSymbol>;
    symbols: ReadonlyArray<GmlNavigationSymbol>;
}>;

/**
 * Hover facts owned by semantic analysis.
 */
export type GmlHoverFacts = Readonly<{
    displayName: string;
    kind: string;
    symbolId: string;
}>;

type ProjectIndexSource = Readonly<{
    identifiers: Record<string, unknown>;
    projectRoot: string;
    relationships: Record<string, unknown>;
    resources: Record<string, unknown>;
}>;

type LocationRecord = Readonly<{
    index?: unknown;
}>;

const IDENTIFIER_COLLECTION_KINDS: Readonly<Record<string, string>> = Object.freeze({
    constructorStaticMembers: "constructorStaticMember",
    enumMembers: "enumMember",
    enums: "enum",
    functions: "function",
    globalVariables: "globalVariable",
    instanceVariables: "instanceVariable",
    localVariables: "localVariable",
    macros: "macro",
    scripts: "script",
    structVariables: "structVariable",
    structs: "struct"
});

function asRecord(value: unknown): Record<string, unknown> {
    return Core.isObjectLike(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
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
    kind: string;
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
    const kind = IDENTIFIER_COLLECTION_KINDS[collectionName] ?? "variable";
    const symbolId = readString(entry.identifierId) ?? `${kind}:${entryKey}`;
    const entryFilePath = readString(entry.filePath) ?? readString(entry.resourcePath);
    const scopeId = readString(entry.scopeId);
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
    for (const rawScriptCall of scriptCalls) {
        const target = asRecord(asRecord(rawScriptCall).target);
        const targetScopeId = readString(target.scopeId);
        const targetName = readString(target.name);
        const symbol = symbols.find(
            (candidate) =>
                (targetScopeId !== null && candidate.symbolId === `script:${targetScopeId}`) ||
                (targetName !== null && candidate.kind === "script" && candidate.name === targetName)
        );
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
        symbolIdsByName: new Map([...symbolIdsByName.entries()].map(([name, ids]) => [name, ids.toSorted()])),
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
    const resourceKindsByName = new Map<string, string>();
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
 * Build a project index and immediately normalize it for semantic navigation.
 */
export async function buildProjectNavigationIndex(
    projectRoot: string,
    fsFacade?: ProjectIndexFsFacade,
    options?: Record<string, unknown>
): Promise<GmlProjectNavigationIndex> {
    const projectIndex = await buildProjectIndex(projectRoot, fsFacade, options);
    return createProjectNavigationIndex(projectIndex);
}

/**
 * Find the symbol occurrence covering a file offset.
 */
export function findNavigationSymbolAtPosition(
    index: GmlProjectNavigationIndex,
    filePath: string,
    offset: number
): GmlNavigationOccurrence | null {
    const matches = (index.occurrencesByFilePath.get(normalizeFilePathKey(filePath)) ?? []).filter((occurrence) =>
        isOffsetInRange(offset, occurrence.location.range)
    );

    return (
        matches.toSorted(
            (left, right) =>
                left.location.range.end -
                left.location.range.start -
                (right.location.range.end - right.location.range.start)
        )[0] ?? null
    );
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
