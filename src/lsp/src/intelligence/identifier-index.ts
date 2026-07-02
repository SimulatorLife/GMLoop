import fs from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Refactor } from "@gmloop/refactor";
import { Semantic } from "@gmloop/semantic";
import type {
    CompletionItem,
    DocumentSymbol,
    Hover,
    Location,
    TextEdit,
    WorkspaceEdit,
    WorkspaceSymbol
} from "vscode-languageserver/node.js";

import { createGmlTextDocument, filePathToUri, type GmlTextDocument, offsetsToRange } from "../documents/index.js";
import { gmlSymbolKindToCompletionItemKind, gmlSymbolKindToLspSymbolKind } from "../protocol/index.js";

type NavigationIndex = Awaited<ReturnType<typeof Semantic.buildProjectNavigationIndex>>;
type NavigationOccurrence = NonNullable<ReturnType<typeof Semantic.findNavigationSymbolAtPosition>>;
type NavigationSymbol = ReturnType<typeof Semantic.searchNavigationWorkspaceSymbols>[number];
type NavigationState = Readonly<{
    index: NavigationIndex;
    projectRoot: string;
}>;

/**
 * Query facade used by the LSP layer to consume semantic navigation facts.
 */
export type GmlSemanticIndex = Readonly<{
    buildForDocument(document: GmlTextDocument): Promise<NavigationState | null>;
    findDefinition(document: GmlTextDocument, offset: number, identifierName: string): Promise<Location | null>;
    findReferences(
        document: GmlTextDocument,
        offset: number,
        identifierName: string,
        includeDefinitions: boolean
    ): Promise<Location[]>;
    hover(document: GmlTextDocument, offset: number, identifierName: string): Promise<Hover | null>;
    listDocumentSymbols(document: GmlTextDocument): Promise<DocumentSymbol[]>;
    planRename(
        document: GmlTextDocument,
        offset: number,
        identifierName: string,
        newName: string
    ): Promise<WorkspaceEdit | null>;
    refreshForDocument(document: GmlTextDocument): Promise<NavigationState | null>;
    searchCompletions(document: GmlTextDocument, query: string): Promise<CompletionItem[]>;
    searchWorkspaceSymbols(document: GmlTextDocument, query: string): Promise<WorkspaceSymbol[]>;
}>;

function isPathInside(rootPath: string, filePath: string): boolean {
    const relativePath = path.relative(path.resolve(rootPath), path.resolve(filePath));
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function readDocumentForLocation(
    openedDocument: GmlTextDocument,
    location: NavigationOccurrence["location"]
): Promise<GmlTextDocument> {
    if (path.resolve(location.filePath) === path.resolve(openedDocument.filePath)) {
        return openedDocument;
    }

    const sourceText = await fs.readFile(location.filePath, "utf8");
    return createGmlTextDocument(filePathToUri(location.filePath), "gml", 0, sourceText);
}

async function occurrenceToLspLocation(document: GmlTextDocument, occurrence: NavigationOccurrence): Promise<Location> {
    const targetDocument = await readDocumentForLocation(document, occurrence.location);
    return {
        uri: targetDocument.uri,
        range: offsetsToRange(targetDocument, occurrence.location.range.start, occurrence.location.range.end)
    };
}

async function symbolToWorkspaceSymbol(
    document: GmlTextDocument,
    symbol: NavigationSymbol
): Promise<WorkspaceSymbol | null> {
    const definition = symbol.definitions[0] ?? symbol.references[0] ?? null;
    if (!definition) {
        return null;
    }

    return {
        name: symbol.displayName,
        kind: gmlSymbolKindToLspSymbolKind(symbol.kind),
        location: await occurrenceToLspLocation(document, definition)
    };
}

function findSymbolId(
    index: NavigationIndex,
    document: GmlTextDocument,
    offset: number,
    identifierName: string
): string | null {
    return (
        Semantic.findNavigationSymbolAtPosition(index, document.filePath, offset)?.symbolId ??
        Semantic.resolveNavigationSymbolId(index, identifierName)
    );
}

function createRefactorSemanticProvider(index: NavigationIndex) {
    return {
        hasSymbol(symbolId: string) {
            return Semantic.hasNavigationSymbol(index, symbolId);
        },
        resolveSymbolId(name: string) {
            return Semantic.resolveNavigationSymbolId(index, name);
        },
        getSymbolAtPosition(filePath: string, offset: number) {
            const occurrence = Semantic.findNavigationSymbolAtPosition(index, filePath, offset);
            return occurrence
                ? {
                      symbolId: occurrence.symbolId,
                      name: occurrence.name,
                      range: {
                          start: occurrence.location.range.start,
                          end: occurrence.location.range.end
                      }
                  }
                : null;
        },
        getSymbolOccurrences(symbolName: string, symbolId: string | null = null) {
            const resolvedSymbolId = symbolId ?? Semantic.resolveNavigationSymbolId(index, symbolName);
            if (!resolvedSymbolId) {
                return [];
            }

            return Semantic.findNavigationReferences(index, resolvedSymbolId, true).map((occurrence) => ({
                path: occurrence.location.filePath,
                start: occurrence.location.range.start,
                end: occurrence.location.range.end,
                scopeId: occurrence.scopeId ?? undefined,
                kind: occurrence.role
            }));
        },
        getFileSymbols(filePath: string) {
            return Semantic.listNavigationDocumentSymbols(index, filePath).map((occurrence) => ({
                id: occurrence.symbolId
            }));
        }
    };
}

async function refactorWorkspaceEditToLspWorkspaceEdit(
    workspace: InstanceType<typeof Refactor.WorkspaceEdit>
): Promise<WorkspaceEdit | null> {
    const changes: Record<string, TextEdit[]> = {};

    for (const [filePath, edits] of workspace.groupByFile()) {
        const sourceText = await fs.readFile(filePath, "utf8");
        const document = createGmlTextDocument(filePathToUri(filePath), "gml", 0, sourceText);
        changes[document.uri] = edits.map((edit) => ({
            range: offsetsToRange(document, edit.start, edit.end),
            newText: edit.newText
        }));
    }

    for (const metadataEdit of workspace.metadataEdits) {
        const sourceText = await fs.readFile(metadataEdit.path, "utf8");
        const document = createGmlTextDocument(filePathToUri(metadataEdit.path), "json", 0, sourceText);
        const edits = changes[document.uri] ?? [];
        edits.push({
            range: offsetsToRange(document, 0, document.sourceText.length),
            newText: metadataEdit.content
        });
        changes[document.uri] = edits;
    }

    return Object.keys(changes).length > 0 ? { changes } : null;
}

async function buildSemanticIndexForDocument(document: GmlTextDocument): Promise<NavigationState | null> {
    const projectRoot = await Semantic.findProjectRoot({ filepath: document.filePath });
    if (!projectRoot) {
        return null;
    }

    const index = await Semantic.buildProjectNavigationIndex(projectRoot, Core.defaultFsFacade, {
        concurrency: { gml: 1, gmlParsing: 1 }
    });

    return {
        projectRoot,
        index
    };
}

/**
 * Create the semantic project-index query facade used by the LSP server.
 */
export function createGmlSemanticIndex(): GmlSemanticIndex {
    let cachedState: NavigationState | null = null;
    let inFlightBuild: Promise<NavigationState | null> | null = null;

    async function ensureIndex(document: GmlTextDocument): Promise<NavigationState | null> {
        const currentState = cachedState;
        if (currentState && isPathInside(currentState.projectRoot, document.filePath)) {
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

    async function refreshIndex(document: GmlTextDocument): Promise<NavigationState | null> {
        inFlightBuild = buildSemanticIndexForDocument(document)
            .then((state) => {
                cachedState = state;
                return state;
            })
            .finally(() => {
                inFlightBuild = null;
            });
        return await inFlightBuild;
    }

    return {
        buildForDocument: ensureIndex,
        refreshForDocument: refreshIndex,
        async findDefinition(document, offset, identifierName) {
            const state = await ensureIndex(document);
            if (!state) {
                return null;
            }

            const symbolId = findSymbolId(state.index, document, offset, identifierName);
            const definition = symbolId ? (Semantic.findNavigationDefinitions(state.index, symbolId)[0] ?? null) : null;
            return definition ? await occurrenceToLspLocation(document, definition) : null;
        },
        async findReferences(document, offset, identifierName, includeDefinitions) {
            const state = await ensureIndex(document);
            if (!state) {
                return [];
            }

            const symbolId = findSymbolId(state.index, document, offset, identifierName);
            if (!symbolId) {
                return [];
            }

            return await Promise.all(
                Semantic.findNavigationReferences(state.index, symbolId, includeDefinitions).map((occurrence) =>
                    occurrenceToLspLocation(document, occurrence)
                )
            );
        },
        async hover(document, offset, identifierName) {
            const state = await ensureIndex(document);
            if (!state) {
                return null;
            }

            const symbolId = findSymbolId(state.index, document, offset, identifierName);
            const facts = symbolId ? Semantic.getNavigationHoverFacts(state.index, symbolId) : null;
            return facts
                ? {
                      contents: {
                          kind: "markdown",
                          value: `\`${facts.displayName}\`\n\n${facts.kind} - ${facts.symbolId}`
                      },
                      range: offsetsToRange(document, offset, offset + identifierName.length)
                  }
                : null;
        },
        async listDocumentSymbols(document) {
            const state = await ensureIndex(document);
            if (!state) {
                return [];
            }

            return Semantic.listNavigationDocumentSymbols(state.index, document.filePath).map((occurrence) => ({
                name: occurrence.displayName,
                kind: gmlSymbolKindToLspSymbolKind(occurrence.kind),
                range: offsetsToRange(document, occurrence.location.range.start, occurrence.location.range.end),
                selectionRange: offsetsToRange(document, occurrence.location.range.start, occurrence.location.range.end)
            }));
        },
        async searchWorkspaceSymbols(document, query) {
            const state = await ensureIndex(document);
            if (!state) {
                return [];
            }

            const symbols = await Promise.all(
                Semantic.searchNavigationWorkspaceSymbols(state.index, query).map((symbol) =>
                    symbolToWorkspaceSymbol(document, symbol)
                )
            );
            return symbols.filter((symbol): symbol is WorkspaceSymbol => symbol !== null);
        },
        async searchCompletions(document, query) {
            const state = await ensureIndex(document);
            if (!state) {
                return [];
            }

            return Semantic.searchNavigationWorkspaceSymbols(state.index, query, 50).map((symbol) => ({
                label: symbol.displayName,
                kind: gmlSymbolKindToCompletionItemKind(symbol.kind)
            }));
        },
        async planRename(document, offset, identifierName, newName) {
            const state = await ensureIndex(document);
            if (!state) {
                return null;
            }

            const symbolId = findSymbolId(state.index, document, offset, identifierName);
            if (!symbolId) {
                return null;
            }

            const refactorEngine = new Refactor.RefactorEngine({
                semantic: createRefactorSemanticProvider(state.index)
            });
            const workspace = await refactorEngine.planRename({ symbolId, newName });
            return await refactorWorkspaceEditToLspWorkspaceEdit(workspace);
        }
    };
}
