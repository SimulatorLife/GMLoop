import fs from "node:fs/promises";
import path from "node:path";

import { Core, type FsFacade } from "@gmloop/core";
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

import {
    createGmlTextDocument,
    filePathToUri,
    type GmlDocumentStore,
    type GmlTextDocument,
    offsetsToRange
} from "../documents/index.js";
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
    invalidateForDocument(document: GmlTextDocument): void;
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

    const groupedTextEdits = await Promise.all(
        [...workspace.groupByFile()].map(async ([filePath, edits]) => {
            const sourceText = await fs.readFile(filePath, "utf8");
            const document = createGmlTextDocument(filePathToUri(filePath), "gml", 0, sourceText);
            return {
                uri: document.uri,
                edits: edits.map((edit) => ({
                    range: offsetsToRange(document, edit.start, edit.end),
                    newText: edit.newText
                }))
            };
        })
    );
    for (const groupedTextEdit of groupedTextEdits) {
        changes[groupedTextEdit.uri] = groupedTextEdit.edits;
    }

    const metadataTextEdits = await Promise.all(
        workspace.metadataEdits.map(async (metadataEdit) => {
            const sourceText = await fs.readFile(metadataEdit.path, "utf8");
            const document = createGmlTextDocument(filePathToUri(metadataEdit.path), "json", 0, sourceText);
            return {
                uri: document.uri,
                edit: {
                    range: offsetsToRange(document, 0, document.sourceText.length),
                    newText: metadataEdit.content
                }
            };
        })
    );
    for (const metadataTextEdit of metadataTextEdits) {
        const edits = changes[metadataTextEdit.uri] ?? [];
        edits.push(metadataTextEdit.edit);
        changes[metadataTextEdit.uri] = edits;
    }

    return Object.keys(changes).length > 0 ? { changes } : null;
}

function createLspFsFacade(documents: GmlDocumentStore, baseFs: FsFacade = Core.defaultFsFacade): FsFacade {
    return {
        ...baseFs,
        async readFile(filePath, encoding) {
            const resolvedPath = path.resolve(filePath);
            const openDoc = documents.list().find((doc) => path.resolve(doc.filePath) === resolvedPath);
            if (openDoc) {
                return openDoc.sourceText;
            }
            return await baseFs.readFile(filePath, encoding);
        },
        async stat(filePath) {
            const resolvedPath = path.resolve(filePath);
            const openDoc = documents.list().find((doc) => path.resolve(doc.filePath) === resolvedPath);
            if (openDoc) {
                let baseStats: { mtimeMs?: number } = { mtimeMs: Date.now() };
                try {
                    baseStats = await baseFs.stat(filePath);
                } catch {
                    // Ignore missing files since the document exists in memory
                }
                return {
                    ...baseStats,
                    mtimeMs: Date.now() // Treat open documents as dirty to ensure re-indexing uses the new in-memory text
                };
            }
            return baseFs.stat(filePath);
        }
    };
}

let builtInsMetadata: Record<string, unknown> | null = null;

function getBuiltInsMetadata(): Record<string, unknown> {
    if (builtInsMetadata === null) {
        try {
            const payload = Core.loadBundledIdentifierMetadata();
            builtInsMetadata =
                Core.isObjectLike(payload) && Core.isObjectLike(payload.identifiers)
                    ? (payload.identifiers as Record<string, unknown>)
                    : {};
        } catch {
            builtInsMetadata = {};
        }
    }
    return builtInsMetadata;
}

async function buildSemanticIndexForDocument(
    document: GmlTextDocument,
    fsFacade: FsFacade = Core.defaultFsFacade
): Promise<NavigationState | null> {
    const projectRoot = await Semantic.findProjectRoot({ filepath: document.filePath });
    if (!projectRoot) {
        return null;
    }

    const index = await Semantic.buildProjectNavigationIndex(projectRoot, fsFacade, {
        concurrency: { gml: 1, gmlParsing: 1 }
    });

    return {
        projectRoot,
        index
    };
}

function isDocumentWithinProjectRoot(document: GmlTextDocument, projectRoot: string): boolean {
    const relativePath = path.relative(path.resolve(projectRoot), path.resolve(document.filePath));
    return relativePath.length === 0 || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

/**
 * Create the semantic project-index query facade used by the LSP server.
 */
export function createGmlSemanticIndex(documents: GmlDocumentStore): GmlSemanticIndex {
    const cachedStates = new Map<string, NavigationState>();
    const inFlightBuilds = new Map<string, Promise<NavigationState | null>>();
    const rootVersions = new Map<string, number>();
    const fsFacade = createLspFsFacade(documents);

    function readRootVersion(projectRoot: string): number {
        return rootVersions.get(projectRoot) ?? 0;
    }

    function invalidateRoot(projectRoot: string): void {
        const resolvedRoot = path.resolve(projectRoot);
        rootVersions.set(resolvedRoot, readRootVersion(resolvedRoot) + 1);
        cachedStates.delete(resolvedRoot);
        inFlightBuilds.delete(resolvedRoot);
    }

    function invalidateKnownDocumentRoots(document: GmlTextDocument): void {
        const knownRoots = new Set([...cachedStates.keys(), ...inFlightBuilds.keys()]);
        for (const projectRoot of knownRoots) {
            if (isDocumentWithinProjectRoot(document, projectRoot)) {
                invalidateRoot(projectRoot);
            }
        }
    }

    async function ensureIndex(document: GmlTextDocument): Promise<NavigationState | null> {
        const projectRoot = await Semantic.findProjectRoot({ filepath: document.filePath });
        if (!projectRoot) {
            return null;
        }

        const resolvedRoot = path.resolve(projectRoot);
        const currentState = cachedStates.get(resolvedRoot);
        if (currentState) {
            return currentState;
        }

        let inFlight = inFlightBuilds.get(resolvedRoot);
        if (inFlight === undefined) {
            const buildVersion = readRootVersion(resolvedRoot);
            const buildPromise = (async () => {
                const state = await buildSemanticIndexForDocument(document, fsFacade);
                if (state && readRootVersion(resolvedRoot) === buildVersion) {
                    cachedStates.set(resolvedRoot, state);
                }
                return state;
            })();

            inFlight = buildPromise.finally(() => {
                inFlightBuilds.delete(resolvedRoot);
            });
            inFlightBuilds.set(resolvedRoot, inFlight);
        }

        return await inFlight;
    }

    async function refreshIndex(document: GmlTextDocument): Promise<NavigationState | null> {
        const projectRoot = await Semantic.findProjectRoot({ filepath: document.filePath });
        if (!projectRoot) {
            return null;
        }

        const resolvedRoot = path.resolve(projectRoot);
        const buildVersion = readRootVersion(resolvedRoot);
        const inFlight = buildSemanticIndexForDocument(document, fsFacade)
            .then((state) => {
                if (state && readRootVersion(resolvedRoot) === buildVersion) {
                    cachedStates.set(resolvedRoot, state);
                }
                return state;
            })
            .finally(() => {
                inFlightBuilds.delete(resolvedRoot);
            });
        inFlightBuilds.set(resolvedRoot, inFlight);
        return await inFlight;
    }

    return {
        buildForDocument: ensureIndex,
        refreshForDocument: refreshIndex,
        invalidateForDocument: invalidateKnownDocumentRoots,
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
            if (facts) {
                return {
                    contents: {
                        kind: "markdown",
                        value: `\`${facts.displayName}\`\n\n${facts.kind} - ${facts.symbolId}`
                    },
                    range: offsetsToRange(document, offset, offset + identifierName.length)
                };
            }

            // Fallback: check if built-in
            const builtIns = getBuiltInsMetadata();
            let builtIn = builtIns[identifierName];
            if (!builtIn) {
                const nameLower = identifierName.toLowerCase();
                const matchedKey = Object.keys(builtIns).find((k) => k.toLowerCase() === nameLower);
                if (matchedKey) {
                    builtIn = builtIns[matchedKey];
                }
            }

            if (Core.isObjectLike(builtIn)) {
                const info = builtIn as Record<string, unknown>;
                const type = typeof info.type === "string" ? info.type : "unknown";
                let markdown = `\`${identifierName}\`\n\nBuilt-in ${type}`;
                if (typeof info.manualPath === "string" && info.manualPath.length > 0) {
                    const manualUrl = `https://manual.gamemaker.io/monthly/en-US/#t=${encodeURIComponent(info.manualPath)}`;
                    markdown += `\n\n[Open GameMaker Manual Page](${manualUrl})`;
                }
                return {
                    contents: {
                        kind: "markdown",
                        value: markdown
                    },
                    range: offsetsToRange(document, offset, offset + identifierName.length)
                };
            }

            return null;
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

            const projectSymbols = Semantic.searchNavigationWorkspaceSymbols(state.index, query, 50).map((symbol) => ({
                label: symbol.displayName,
                kind: gmlSymbolKindToCompletionItemKind(symbol.kind)
            }));

            const queryLower = query.toLowerCase();
            const builtIns = getBuiltInsMetadata();
            const matchingBuiltIns: CompletionItem[] = [];
            for (const [name, rawInfo] of Object.entries(builtIns)) {
                if (name.toLowerCase().includes(queryLower)) {
                    const info = Core.isObjectLike(rawInfo) ? (rawInfo as Record<string, unknown>) : {};
                    const type = typeof info.type === "string" ? info.type : "unknown";
                    matchingBuiltIns.push({
                        label: name,
                        kind: gmlSymbolKindToCompletionItemKind(type),
                        detail: `Built-in ${type}`
                    });
                    if (matchingBuiltIns.length >= 50) {
                        break;
                    }
                }
            }

            return [...projectSymbols, ...matchingBuiltIns];
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
