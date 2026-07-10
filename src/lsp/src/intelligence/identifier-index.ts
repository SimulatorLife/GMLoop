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
type NavigationState = {
    index: NavigationIndex;
    projectRoot: string;
    lightweight?: boolean;
};

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

function extractGmlDocComment(sourceText: string, startIndex: number): string {
    const beforeDeclaration = sourceText.slice(0, startIndex);
    const lines = beforeDeclaration.split(/\r?\n/u);
    const commentLines: string[] = [];

    const startIdx = lines.length - 2;
    for (let index = startIdx; index >= 0; index -= 1) {
        const line = lines[index]?.trim() ?? "";
        if (line.length === 0) {
            if (commentLines.length === 0) {
                continue;
            }
            break;
        }

        if (!line.startsWith("///")) {
            break;
        }

        const cleanLine = line.slice(3).replace(/^\s/u, "");
        commentLines.unshift(cleanLine);
    }

    return commentLines.join("\n").trim();
}

function formatGmlDocComment(rawComment: string): string {
    if (!rawComment) {
        return "";
    }

    const lines = rawComment.split("\n");
    const descriptions: string[] = [];
    const parameters: string[] = [];
    let returnsInfo = "";

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            continue;
        }

        if (trimmed.startsWith("@desc") || trimmed.startsWith("@description")) {
            const desc = trimmed.replace(/^@(desc|description)\s+/u, "");
            descriptions.push(desc);
        } else if (trimmed.startsWith("@param")) {
            const paramMatch = /@param(?:\s+\{([^}]+)\})?\s+(\w+)(?:\s+(.*))?/u.exec(trimmed);
            if (paramMatch) {
                const [, type, name, desc] = paramMatch;
                parameters.push(`* \`${name}\`${type ? ` (\`${type}\`)` : ""}${desc ? ` — ${desc}` : ""}`);
            } else {
                const cleanParam = trimmed.replace(/^@param\s+/u, "");
                parameters.push(`* ${cleanParam}`);
            }
        } else if (trimmed.startsWith("@return")) {
            const returnMatch = /@returns?(?:\s+\{([^}]+)\})?(?:\s+(.*))?/u.exec(trimmed);
            if (returnMatch) {
                const [, type, desc] = returnMatch;
                returnsInfo = `*Returns*${type ? ` \`${type}\`` : ""}${desc ? ` — ${desc}` : ""}`;
            } else {
                const cleanReturn = trimmed.replace(/^@returns?\s+/u, "");
                returnsInfo = `*Returns* — ${cleanReturn}`;
            }
        } else if (trimmed.startsWith("@")) {
            descriptions.push(`*${trimmed}*`);
        } else {
            descriptions.push(trimmed);
        }
    }

    const sections: string[] = [];

    if (descriptions.length > 0) {
        sections.push(descriptions.join("\n\n"));
    }

    if (parameters.length > 0) {
        sections.push(`**Parameters:**\n${parameters.join("\n")}`);
    }

    if (returnsInfo) {
        sections.push(returnsInfo);
    }

    return sections.join("\n\n");
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

function isOffsetInCommentOrString(sourceText: string, offset: number): boolean {
    let inStringDouble = false;
    let inStringSingle = false;
    let inCommentSingle = false;
    let inCommentBlock = false;

    for (let i = 0; i < offset; i++) {
        const char = sourceText[i];
        const nextChar = sourceText[i + 1];

        if (inCommentSingle) {
            if (char === "\n" || char === "\r") {
                inCommentSingle = false;
            }
            continue;
        }

        if (inCommentBlock) {
            if (char === "*" && nextChar === "/") {
                inCommentBlock = false;
                i++; // Skip the slash
            }
            continue;
        }

        if (inStringDouble) {
            if (char === '"' && sourceText[i - 1] !== "\\") {
                inStringDouble = false;
            }
            continue;
        }

        if (inStringSingle) {
            if (char === "'" && sourceText[i - 1] !== "\\") {
                inStringSingle = false;
            }
            continue;
        }

        if (char === "/" && nextChar === "/") {
            inCommentSingle = true;
            i++; // Skip the second slash
        } else if (char === "/" && nextChar === "*") {
            inCommentBlock = true;
            i++; // Skip the asterisk
        } else if (char === '"') {
            inStringDouble = true;
        } else if (char === "'") {
            inStringSingle = true;
        }
    }

    return inCommentSingle || inCommentBlock || inStringDouble || inStringSingle;
}

function findSymbolId(
    index: NavigationIndex,
    document: GmlTextDocument,
    offset: number,
    identifierName: string
): string | null {
    if (isOffsetInCommentOrString(document.sourceText, offset)) {
        return null;
    }

    const exactSymbolId = Semantic.findNavigationSymbolAtPosition(index, document.filePath, offset)?.symbolId;
    if (exactSymbolId) {
        return exactSymbolId;
    }

    const resolvedSymbolId = Semantic.resolveNavigationSymbolId(index, identifierName);
    if (resolvedSymbolId) {
        const symbol = index.symbolsById.get(resolvedSymbolId);
        if (
            symbol &&
            (symbol.kind === "localVariable" || symbol.kind === "instanceVariable" || symbol.kind === "structVariable")
        ) {
            return null;
        }
        return resolvedSymbolId;
    }

    return null;
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
    fsFacade: FsFacade = Core.defaultFsFacade,
    priorityFiles?: ReadonlyArray<string>,
    definitionsOnly?: boolean
): Promise<NavigationState | null> {
    const projectRoot = await Semantic.findProjectRoot({ filepath: document.filePath });
    if (!projectRoot) {
        return null;
    }

    const index = await Semantic.buildProjectNavigationIndex(projectRoot, fsFacade, {
        priorityFiles,
        definitionsOnly
    });

    return {
        projectRoot,
        index,
        lightweight: definitionsOnly
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
    const backgroundFullBuilds = new Set<string>();
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
        backgroundFullBuilds.delete(resolvedRoot);
    }

    function invalidateKnownDocumentRoots(document: GmlTextDocument): void {
        const knownRoots = new Set([...cachedStates.keys(), ...inFlightBuilds.keys()]);
        for (const projectRoot of knownRoots) {
            if (isDocumentWithinProjectRoot(document, projectRoot)) {
                invalidateRoot(projectRoot);
            }
        }
    }

    function triggerBackgroundFullBuild(document: GmlTextDocument, resolvedRoot: string) {
        if (backgroundFullBuilds.has(resolvedRoot)) {
            return;
        }
        backgroundFullBuilds.add(resolvedRoot);

        const buildVersion = readRootVersion(resolvedRoot);
        const priorityFiles = documents.list().map((doc) => doc.filePath);

        buildSemanticIndexForDocument(document, fsFacade, priorityFiles, false)
            .then((fullState) => {
                if (fullState && readRootVersion(resolvedRoot) === buildVersion) {
                    const currentState = cachedStates.get(resolvedRoot);
                    if (currentState && currentState.lightweight) {
                        currentState.index = fullState.index;
                        currentState.lightweight = false;
                    } else {
                        cachedStates.set(resolvedRoot, fullState);
                    }
                }
            })
            .catch(() => {})
            .finally(() => {
                backgroundFullBuilds.delete(resolvedRoot);
            });
    }

    async function ensureIndex(document: GmlTextDocument): Promise<NavigationState | null> {
        const projectRoot = await Semantic.findProjectRoot({ filepath: document.filePath });
        if (!projectRoot) {
            return null;
        }

        const resolvedRoot = path.resolve(projectRoot);
        const currentState = cachedStates.get(resolvedRoot);
        if (currentState && !currentState.lightweight) {
            return currentState;
        }

        if (currentState && currentState.lightweight) {
            triggerBackgroundFullBuild(document, resolvedRoot);
            return currentState;
        }

        let inFlight = inFlightBuilds.get(resolvedRoot);
        if (inFlight === undefined) {
            const buildVersion = readRootVersion(resolvedRoot);
            const buildPromise = (async () => {
                const priorityFiles = documents.list().map((doc) => doc.filePath);
                const state = await buildSemanticIndexForDocument(document, fsFacade, priorityFiles, true);
                if (state && readRootVersion(resolvedRoot) === buildVersion) {
                    cachedStates.set(resolvedRoot, state);
                    triggerBackgroundFullBuild(document, resolvedRoot);
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
        const priorityFiles = documents.list().map((doc) => doc.filePath);
        const inFlight = buildSemanticIndexForDocument(document, fsFacade, priorityFiles, false)
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
                const symbol = state.index.symbolsById.get(symbolId);
                let definitionInfo = "";
                let docComment = "";

                if (symbol && symbol.definitions.length > 0) {
                    const def = symbol.definitions[0];
                    if (def && def.location.filePath) {
                        const relativePath = path.relative(state.projectRoot, def.location.filePath);
                        definitionInfo = `*defined in [${relativePath}](file://${def.location.filePath})*`;

                        try {
                            const sourceText = await fsFacade.readFile(def.location.filePath, "utf8");
                            const rawComment = extractGmlDocComment(sourceText, def.location.range.start);
                            docComment = formatGmlDocComment(rawComment);
                        } catch {
                            // Ignore read errors
                        }
                    }
                }

                let markdownValue = `\`${facts.displayName}\`\n\n${facts.kind} - ${facts.symbolId}`;
                if (definitionInfo) {
                    markdownValue += `\n\n${definitionInfo}`;
                }
                if (docComment) {
                    markdownValue += `\n\n---\n\n${docComment}`;
                }

                return {
                    contents: {
                        kind: "markdown",
                        value: markdownValue
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
                    const manualUrl = `https://manual.gamemaker.io/monthly/en-US/index.htm#t=${encodeURIComponent(info.manualPath)}`;
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
