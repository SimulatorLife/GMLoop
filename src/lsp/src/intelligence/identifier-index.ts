import path from "node:path";

import { Core } from "@gmloop/core";
import { Semantic } from "@gmloop/semantic";
import type { DocumentSymbol, Location, WorkspaceSymbol } from "vscode-languageserver/node.js";

import { filePathToUri, type GmlTextDocument, offsetsToRange } from "../documents/index.js";
import { gmlSymbolKindToLspSymbolKind } from "../protocol/index.js";

type IdentifierLocation = Readonly<{
    end: number;
    filePath: string;
    start: number;
}>;

type IdentifierRecord = Readonly<{
    displayName: string;
    kind: string;
    locations: ReadonlyArray<IdentifierLocation>;
    name: string;
}>;

type ProjectIndexLike = Readonly<{
    identifiers?: unknown;
}>;

type SemanticIndexState = Readonly<{
    projectIndex: ProjectIndexLike;
    projectRoot: string;
}>;

/**
 * Query facade used by the LSP layer to consume semantic project-index facts.
 */
export type GmlSemanticIndex = Readonly<{
    buildForDocument(document: GmlTextDocument): Promise<SemanticIndexState | null>;
    findDefinition(document: GmlTextDocument, identifierName: string): Promise<Location | null>;
    findReferences(document: GmlTextDocument, identifierName: string): Promise<Location[]>;
    listDocumentSymbols(document: GmlTextDocument): Promise<DocumentSymbol[]>;
    searchWorkspaceSymbols(document: GmlTextDocument, query: string): Promise<WorkspaceSymbol[]>;
}>;

function asRecord(value: unknown): Record<string, unknown> {
    return Core.isObjectLike(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readLocation(entry: Record<string, unknown>, fallbackPath: string | null): IdentifierLocation | null {
    const startRecord = asRecord(entry.start);
    const endRecord = asRecord(entry.end);
    const start = readNumber(entry.start) ?? readNumber(startRecord.index);
    const end = readNumber(entry.end) ?? readNumber(endRecord.index);
    const filePath = readString(entry.filePath) ?? readString(entry.path) ?? fallbackPath;

    if (start === null || end === null || filePath === null) {
        return null;
    }

    return {
        filePath,
        start,
        end
    };
}

function readIdentifierLocations(entry: Record<string, unknown>, fallbackPath: string | null): IdentifierLocation[] {
    const locations: IdentifierLocation[] = [];
    const directLocation = readLocation(entry, fallbackPath);
    if (directLocation) {
        locations.push(directLocation);
    }

    for (const key of ["declarations", "references"]) {
        const value = entry[key];
        if (!Array.isArray(value)) {
            continue;
        }

        for (const rawLocation of value) {
            const location = readLocation(asRecord(rawLocation), fallbackPath);
            if (location) {
                locations.push(location);
            }
        }
    }

    return locations;
}

function readIdentifierRecord(entry: Record<string, unknown>, nameFromKey: string): IdentifierRecord | null {
    const name = readString(entry.name) ?? readString(entry.displayName) ?? readString(entry.key) ?? nameFromKey;
    const fallbackPath = readString(entry.filePath) ?? readString(entry.resourcePath);
    const locations = readIdentifierLocations(entry, fallbackPath);

    if (locations.length === 0) {
        return null;
    }

    return {
        name,
        displayName: readString(entry.displayName) ?? name,
        kind: readString(entry.kind) ?? readString(entry.category) ?? "variable",
        locations
    };
}

function listIdentifierRecords(projectIndex: ProjectIndexLike): IdentifierRecord[] {
    const identifiers = asRecord(projectIndex.identifiers);
    const records: IdentifierRecord[] = [];

    for (const [nameFromKey, rawEntryOrGroup] of Object.entries(identifiers)) {
        const entryOrGroup = asRecord(rawEntryOrGroup);
        const directRecord = readIdentifierRecord(entryOrGroup, nameFromKey);
        if (directRecord) {
            records.push(directRecord);
            continue;
        }

        for (const nestedEntry of Object.values(entryOrGroup)) {
            const nestedRecord = readIdentifierRecord(asRecord(nestedEntry), nameFromKey);
            if (nestedRecord) {
                records.push(nestedRecord);
            }
        }
    }

    return records;
}

function resolveIndexedFilePath(projectRoot: string, filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.join(projectRoot, Core.fromPosixPath(filePath));
}

function locationToLspLocation(projectRoot: string, location: IdentifierLocation, document: GmlTextDocument): Location {
    const absolutePath = resolveIndexedFilePath(projectRoot, location.filePath);
    const targetUri = filePathToUri(absolutePath);
    const targetDocument =
        targetUri === document.uri
            ? document
            : {
                  ...document,
                  uri: targetUri,
                  filePath: absolutePath,
                  sourceText: "",
                  lineStarts: [0]
              };

    return {
        uri: targetUri,
        range: offsetsToRange(targetDocument, location.start, location.end)
    };
}

async function buildSemanticIndexForDocument(document: GmlTextDocument): Promise<SemanticIndexState | null> {
    const projectRoot = await Semantic.findProjectRoot({ filepath: document.filePath });
    if (!projectRoot) {
        return null;
    }

    const projectIndex = await Semantic.buildProjectIndex(projectRoot, Core.defaultFsFacade, {
        concurrency: { gml: 1, gmlParsing: 1 }
    });

    return {
        projectRoot,
        projectIndex: projectIndex as ProjectIndexLike
    };
}

function matchesIdentifier(record: IdentifierRecord, identifierName: string): boolean {
    return record.name === identifierName || record.displayName === identifierName;
}

function isDocumentLocation(projectRoot: string, document: GmlTextDocument, location: IdentifierLocation): boolean {
    return path.resolve(resolveIndexedFilePath(projectRoot, location.filePath)) === path.resolve(document.filePath);
}

/**
 * Create the semantic project-index query facade used by the LSP server.
 */
export function createGmlSemanticIndex(): GmlSemanticIndex {
    let cachedState: SemanticIndexState | null = null;
    let inFlightBuild: Promise<SemanticIndexState | null> | null = null;

    async function ensureIndex(document: GmlTextDocument): Promise<SemanticIndexState | null> {
        const currentState = cachedState;
        if (currentState && document.filePath.startsWith(currentState.projectRoot)) {
            return currentState;
        }

        if (inFlightBuild === null) {
            inFlightBuild = buildSemanticIndexForDocument(document)
                .then((state) => {
                    cachedState = state;
                    return state;
                })
                .finally(() => {
                    inFlightBuild = null;
                });
        }

        return await inFlightBuild;
    }

    return {
        buildForDocument: ensureIndex,
        async findDefinition(document, identifierName) {
            const state = await ensureIndex(document);
            if (!state) {
                return null;
            }

            const record = listIdentifierRecords(state.projectIndex).find((candidate) =>
                matchesIdentifier(candidate, identifierName)
            );
            const location = record?.locations[0] ?? null;
            return location ? locationToLspLocation(state.projectRoot, location, document) : null;
        },
        async findReferences(document, identifierName) {
            const state = await ensureIndex(document);
            if (!state) {
                return [];
            }

            return listIdentifierRecords(state.projectIndex)
                .filter((candidate) => matchesIdentifier(candidate, identifierName))
                .flatMap((record) =>
                    record.locations.map((location) => locationToLspLocation(state.projectRoot, location, document))
                );
        },
        async listDocumentSymbols(document) {
            const state = await ensureIndex(document);
            if (!state) {
                return [];
            }

            return listIdentifierRecords(state.projectIndex)
                .flatMap((record) =>
                    record.locations
                        .filter((location) => isDocumentLocation(state.projectRoot, document, location))
                        .map((location) => ({
                            name: record.displayName,
                            kind: gmlSymbolKindToLspSymbolKind(record.kind),
                            range: offsetsToRange(document, location.start, location.end),
                            selectionRange: offsetsToRange(document, location.start, location.end)
                        }))
                )
                .toSorted((left, right) => left.range.start.line - right.range.start.line);
        },
        async searchWorkspaceSymbols(document, query) {
            const state = await ensureIndex(document);
            if (!state) {
                return [];
            }

            const normalizedQuery = query.toLowerCase();
            return listIdentifierRecords(state.projectIndex)
                .filter((record) => record.displayName.toLowerCase().includes(normalizedQuery))
                .slice(0, 100)
                .map((record) => {
                    const location = record.locations[0];
                    return {
                        name: record.displayName,
                        kind: gmlSymbolKindToLspSymbolKind(record.kind),
                        location: locationToLspLocation(state.projectRoot, location, document)
                    } satisfies WorkspaceSymbol;
                });
        }
    };
}
