import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";

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
    isGmlDocumentPath,
    offsetsToRange
} from "../documents/index.js";
import { gmlSymbolKindToCompletionItemKind, gmlSymbolKindToLspSymbolKind } from "../protocol/index.js";
import { coerceToError } from "./error-normalization.js";

type NavigationIndex = Awaited<ReturnType<typeof Semantic.buildProjectNavigationIndex>>;
type NavigationOccurrence = NonNullable<ReturnType<typeof Semantic.findNavigationSymbolAtPosition>>;
type NavigationSymbol = ReturnType<typeof Semantic.searchNavigationWorkspaceSymbols>[number];
type NavigationState = {
    index: NavigationIndex;
    projectRoot: string;
    lightweight?: boolean;
};
type SemanticIndexStore = ReturnType<typeof Semantic.openSemanticIndexStore>;

/**
 * Query facade used by the LSP layer to consume semantic navigation facts.
 */
export type GmlSemanticIndex = Readonly<{
    buildForDocument(document: GmlTextDocument): Promise<NavigationState | null>;
    dispose(): Promise<void>;
    findDefinition(document: GmlTextDocument, offset: number, identifierName: string): Promise<Location | null>;
    findReferences(
        document: GmlTextDocument,
        offset: number,
        identifierName: string,
        includeDefinitions: boolean
    ): Promise<Location[]>;
    hover(document: GmlTextDocument, offset: number, identifierName: string): Promise<Hover | null>;
    invalidateForDocument(document: GmlTextDocument): void;
    invalidateForFilePath(filePath: string): Promise<void>;
    listDocumentSymbols(document: GmlTextDocument): Promise<DocumentSymbol[]>;
    listSemanticHighlights(
        document: GmlTextDocument
    ): Promise<ReturnType<typeof Semantic.collectGmlSemanticHighlights>>;
    planRename(
        document: GmlTextDocument,
        offset: number,
        identifierName: string,
        newName: string
    ): Promise<WorkspaceEdit | null>;
    preload(): void;
    refreshForDocument(document: GmlTextDocument): Promise<NavigationState | null>;
    refreshForFilePath(filePath: string): Promise<NavigationState | null>;
    searchCompletions(document: GmlTextDocument, query: string): Promise<CompletionItem[]>;
    searchWorkspaceSymbols(document: GmlTextDocument, query: string): Promise<WorkspaceSymbol[]>;
}>;

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

type LexicalRange = Readonly<{ end: number; start: number }>;

function isEscaped(sourceText: string, offset: number): boolean {
    let slashCount = 0;
    for (let index = offset - 1; index >= 0 && sourceText[index] === "\\"; index -= 1) {
        slashCount += 1;
    }
    return slashCount % 2 === 1;
}

function collectIgnoredLexicalRanges(sourceText: string): ReadonlyArray<LexicalRange> {
    const ranges: LexicalRange[] = [];
    let index = 0;
    while (index < sourceText.length) {
        const current = sourceText[index];
        const next = sourceText[index + 1];
        const start = index;
        if (current === "/" && next === "/") {
            index += 2;
            while (index < sourceText.length && sourceText[index] !== "\n" && sourceText[index] !== "\r") {
                index += 1;
            }
            ranges.push(Object.freeze({ end: index, start }));
            continue;
        }
        if (current === "/" && next === "*") {
            index += 2;
            while (index < sourceText.length && (sourceText[index] !== "*" || sourceText[index + 1] !== "/")) {
                index += 1;
            }
            index = Math.min(sourceText.length, index + 2);
            ranges.push(Object.freeze({ end: index, start }));
            continue;
        }
        if (current === '"' || current === "'") {
            const quote = current;
            index += 1;
            while (index < sourceText.length && (sourceText[index] !== quote || isEscaped(sourceText, index))) {
                index += 1;
            }
            index = Math.min(sourceText.length, index + 1);
            ranges.push(Object.freeze({ end: index, start }));
            continue;
        }
        index += 1;
    }
    return ranges;
}

function isOffsetInLexicalRanges(ranges: ReadonlyArray<LexicalRange>, offset: number): boolean {
    let lower = 0;
    let upper = ranges.length - 1;
    while (lower <= upper) {
        const middle = lower + Math.floor((upper - lower) / 2);
        const range = ranges[middle];
        if (!range) {
            return false;
        }
        if (offset < range.start) {
            upper = middle - 1;
        } else if (offset >= range.end) {
            lower = middle + 1;
        } else {
            return true;
        }
    }
    return false;
}

function findSymbolId(
    index: NavigationIndex,
    document: GmlTextDocument,
    offset: number,
    identifierName: string,
    isIgnoredOffset: (document: GmlTextDocument, offset: number) => boolean
): string | null {
    if (isIgnoredOffset(document, offset)) {
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
                let baseStats: { mtimeMs?: number } = { mtimeMs: 0 };
                try {
                    baseStats = await baseFs.stat(filePath);
                } catch {
                    // Ignore missing files since the document exists in memory
                }
                return {
                    ...baseStats,
                    // The in-memory document text is selected by readFile above. Keep
                    // the physical mtime stable so opening a buffer does not make the
                    // entire project appear dirty on every restart.
                    mtimeMs: baseStats.mtimeMs ?? 0
                };
            }
            return baseFs.stat(filePath);
        }
    };
}

let builtInsMetadata: Record<string, unknown> | null = null;
let builtInsMetadataByLowerName: Map<string, unknown> | null = null;

function getBuiltInsMetadata(): Record<string, unknown> {
    if (builtInsMetadata === null) {
        try {
            const payload = Core.loadBundledIdentifierMetadata();
            builtInsMetadata =
                Core.isObjectLike(payload) && Core.isObjectLike(payload.identifiers)
                    ? (payload.identifiers as Record<string, unknown>)
                    : {};
            builtInsMetadataByLowerName = new Map(
                Object.entries(builtInsMetadata).map(([name, descriptor]) => [name.toLowerCase(), descriptor])
            );
        } catch {
            builtInsMetadata = {};
        }
    }
    return builtInsMetadata;
}

const projectRootCache = new Map<string, string | null>();

async function getProjectRoot(filepath: string): Promise<string | null> {
    const resolvedPath = path.resolve(filepath);
    let root = projectRootCache.get(resolvedPath);
    if (root === undefined) {
        root = await Semantic.findProjectRoot({ filepath: resolvedPath });
        projectRootCache.set(resolvedPath, root);
    }
    return root;
}

async function buildSemanticIndexForDocument(
    document: GmlTextDocument,
    fsFacade: FsFacade = Core.defaultFsFacade,
    priorityFiles?: ReadonlyArray<string>,
    definitionsOnly?: boolean,
    signal?: AbortSignal,
    existingIndex?: any,
    changedFiles: ReadonlyArray<string> = [document.filePath]
): Promise<NavigationState | null> {
    const projectRoot = await getProjectRoot(document.filePath);
    if (!projectRoot) {
        return null;
    }

    const index = await Semantic.buildProjectNavigationIndex(projectRoot, fsFacade, {
        priorityFiles,
        definitionsOnly,
        signal,
        incremental: existingIndex
            ? {
                  existingIndex,
                  changedFiles
              }
            : undefined
    });

    return {
        projectRoot,
        index,
        lightweight: definitionsOnly
    };
}

function buildSemanticIndexInWorker(
    projectRoot: string,
    priorityFiles: ReadonlyArray<string>,
    openDocuments: ReadonlyArray<GmlTextDocument>,
    signal?: AbortSignal
): Promise<NavigationState | null> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("project-index-worker.js", import.meta.url));
        let settled = false;
        const abort = (): void => finish(() => resolve(null));
        const finish = (callback: () => void): void => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", abort);
            void worker.terminate();
            callback();
        };
        worker.on("message", (message: { error?: unknown; rawIndex?: unknown }) => {
            if (message.error !== undefined) {
                finish(() => reject(new Error(Core.getErrorMessageOrFallback(message.error))));
                return;
            }
            if (!Core.isObjectLike(message.rawIndex)) {
                finish(() => resolve(null));
                return;
            }
            const index = Semantic.createProjectNavigationIndex(message.rawIndex);
            (index as { rawIndex?: unknown }).rawIndex = message.rawIndex;
            finish(() => resolve({ projectRoot, index, lightweight: false }));
        });
        worker.on("error", (error) => finish(() => reject(coerceToError(error))));
        worker.on("exit", (code) => {
            if (code !== 0) finish(() => reject(new Error(`Project index worker exited with code ${String(code)}.`)));
        });
        signal?.addEventListener("abort", abort, { once: true });
        worker.postMessage({
            definitionsOnly: false,
            openDocuments: openDocuments.map((document) => ({
                filePath: path.resolve(document.filePath),
                sourceText: document.sourceText
            })),
            priorityFiles,
            projectRoot
        });
    });
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
    const staleStates = new Map<string, NavigationState>();
    const inFlightBuilds = new Map<string, Promise<NavigationState | null>>();
    const backgroundFullBuilds = new Map<string, Promise<NavigationState | null>>();
    const rootVersions = new Map<string, number>();
    const abortControllers = new Map<string, AbortController>();
    const semanticStores = new Map<string, SemanticIndexStore>();
    const documentVersions = new Map<string, number>();
    const pendingCacheWrites = new Map<string, Promise<void>>();
    const lexicalRangesByDocument = new Map<
        string,
        Readonly<{ ranges: ReadonlyArray<LexicalRange>; version: number }>
    >();
    const manifestReconciliations = new Map<string, Promise<void>>();
    const fsFacade = createLspFsFacade(documents);

    function isIgnoredOffset(document: GmlTextDocument, offset: number): boolean {
        const cached = lexicalRangesByDocument.get(document.uri);
        if (cached && cached.version === document.version) {
            return isOffsetInLexicalRanges(cached.ranges, offset);
        }
        const ranges = collectIgnoredLexicalRanges(document.sourceText);
        lexicalRangesByDocument.set(document.uri, Object.freeze({ ranges, version: document.version }));
        return isOffsetInLexicalRanges(ranges, offset);
    }

    function readRootVersion(projectRoot: string): number {
        return rootVersions.get(projectRoot) ?? 0;
    }

    function readDocumentVersion(uri: string): number {
        return documentVersions.get(uri) ?? 0;
    }

    function abortActiveBuild(projectRoot: string): void {
        const controller = abortControllers.get(projectRoot);
        if (controller) {
            controller.abort();
            abortControllers.delete(projectRoot);
        }
    }

    function invalidateRoot(projectRoot: string): void {
        const resolvedRoot = path.resolve(projectRoot);
        rootVersions.set(resolvedRoot, readRootVersion(resolvedRoot) + 1);
        const current = cachedStates.get(resolvedRoot);
        if (current) {
            staleStates.set(resolvedRoot, current);
        }
        // Keep the last complete snapshot available to hover, completion, and
        // semantic-token requests while the scoped refresh runs. Deleting it
        // here made every edit turn otherwise-fast requests into "Loading...".
        inFlightBuilds.delete(resolvedRoot);
    }

    function getSemanticStore(resolvedRoot: string): SemanticIndexStore {
        const existing = semanticStores.get(resolvedRoot);
        if (existing) {
            return existing;
        }
        const store = Semantic.openSemanticIndexStore(resolvedRoot);
        semanticStores.set(resolvedRoot, store);
        return store;
    }

    function reconcileRestoredManifest(
        document: GmlTextDocument,
        resolvedRoot: string,
        tier: "definitions" | "full"
    ): void {
        if (manifestReconciliations.has(resolvedRoot)) {
            return;
        }
        const reconciliation = (async () => {
            const previousManifest = getSemanticStore(resolvedRoot).readManifestForTier(tier);
            if (previousManifest === null) {
                return;
            }
            const overlays = documents.list().map((openDocument) => ({
                absolutePath: openDocument.filePath,
                contentHash: Semantic.createSemanticContentHash(openDocument.sourceText),
                documentVersion: openDocument.version,
                sourceText: openDocument.sourceText
            }));
            const currentManifest = await Semantic.buildSemanticFileManifest(resolvedRoot, fsFacade, overlays);
            if (Semantic.reconcileSemanticManifests(previousManifest, currentManifest).requiresBuild) {
                invalidateRoot(resolvedRoot);
                triggerBuildInBackground(document, resolvedRoot);
            }
        })()
            .catch((error: unknown) => {
                console.error(`Failed to reconcile semantic manifest for ${resolvedRoot}:`, error);
            })
            .finally(() => {
                manifestReconciliations.delete(resolvedRoot);
            });
        manifestReconciliations.set(resolvedRoot, reconciliation);
    }

    function saveIndexCacheToDisk(resolvedRoot: string, index: NavigationIndex, lightweight: boolean): void {
        const tier = lightweight ? "definitions" : "full";

        const previousWrite = pendingCacheWrites.get(resolvedRoot) ?? Promise.resolve();
        const write = previousWrite
            .catch(() => {
                // A failed earlier write must not permanently block later snapshots.
                return undefined;
            })
            .then(async () => {
                const overlays = documents.list().map((document) => ({
                    absolutePath: document.filePath,
                    contentHash: Semantic.createSemanticContentHash(document.sourceText),
                    documentVersion: document.version,
                    sourceText: document.sourceText
                }));
                const manifest = await Semantic.buildSemanticFileManifest(resolvedRoot, fsFacade, overlays);
                const store = getSemanticStore(resolvedRoot);
                const publication = store.publishIndex({
                    expectedHeadGeneration: store.readProjectHead().generation,
                    index: index.rawIndex as Record<string, unknown>,
                    manifest,
                    sourceRevision: manifest.sourceRevision,
                    tier
                });
                if (publication.status === "superseded") {
                    throw new Error(`Semantic cache publication was superseded for ${resolvedRoot}.`);
                }
                return undefined;
            })
            .catch((error: unknown) => {
                console.error(`Failed to persist semantic index for ${resolvedRoot}:`, error);
                return undefined;
            });
        pendingCacheWrites.set(resolvedRoot, write);
        void write.finally(() => {
            if (pendingCacheWrites.get(resolvedRoot) === write) {
                pendingCacheWrites.delete(resolvedRoot);
            }
        });
    }

    function invalidateKnownDocumentRoots(document: GmlTextDocument): void {
        const resolvedUri = document.uri;
        documentVersions.set(resolvedUri, readDocumentVersion(resolvedUri) + 1);
        lexicalRangesByDocument.delete(resolvedUri);
        const knownRoots = new Set([...cachedStates.keys(), ...inFlightBuilds.keys()]);
        for (const projectRoot of knownRoots) {
            if (isDocumentWithinProjectRoot(document, projectRoot)) {
                invalidateRoot(projectRoot);
            }
        }
    }

    async function invalidateKnownFileRoots(filePath: string): Promise<void> {
        const projectRoot = await getProjectRoot(filePath);
        if (projectRoot) {
            invalidateRoot(projectRoot);
        }
    }

    function findCachedStateForDocument(document: GmlTextDocument): NavigationState | null {
        for (const [projectRoot, state] of cachedStates) {
            if (isDocumentWithinProjectRoot(document, projectRoot)) {
                return state;
            }
        }
        return null;
    }

    function triggerBackgroundFullBuild(
        document: GmlTextDocument,
        resolvedRoot: string
    ): Promise<NavigationState | null> {
        const existingBuild = backgroundFullBuilds.get(resolvedRoot);
        if (existingBuild !== undefined) {
            return existingBuild;
        }

        const resolvedUri = document.uri;
        const startDocVersion = readDocumentVersion(resolvedUri);
        const buildVersion = readRootVersion(resolvedRoot);
        const priorityFiles = documents.list().map((doc) => doc.filePath);

        abortActiveBuild(resolvedRoot);
        const controller = new AbortController();
        abortControllers.set(resolvedRoot, controller);

        const fullBuild = (async () => {
            try {
                const currentDoc = documents.get(document.uri);
                if (currentDoc && currentDoc.version !== document.version) {
                    return null;
                }
                if (readDocumentVersion(resolvedUri) !== startDocVersion) {
                    return null;
                }
                const fullState = await buildSemanticIndexInWorker(
                    resolvedRoot,
                    priorityFiles,
                    documents.list(),
                    controller.signal
                );
                if (
                    fullState &&
                    readRootVersion(resolvedRoot) === buildVersion &&
                    readDocumentVersion(resolvedUri) === startDocVersion
                ) {
                    const currentState = cachedStates.get(resolvedRoot);
                    if (currentState && currentState.lightweight) {
                        currentState.index = fullState.index;
                        currentState.lightweight = false;
                    } else {
                        cachedStates.set(resolvedRoot, fullState);
                    }
                    staleStates.delete(resolvedRoot);

                    saveIndexCacheToDisk(resolvedRoot, fullState.index, false);

                    return cachedStates.get(resolvedRoot) ?? fullState;
                }
                return null;
            } catch (error) {
                if (Core.isAbortError(error)) {
                    return null;
                }
                console.error(
                    `Error in GMLoop background project index build: ${Core.getErrorMessageOrFallback(error)}`
                );
                return null;
            }
        })();

        const finalBuild = fullBuild.finally(() => {
            if (abortControllers.get(resolvedRoot) === controller) {
                abortControllers.delete(resolvedRoot);
            }
            if (backgroundFullBuilds.get(resolvedRoot) === finalBuild) {
                backgroundFullBuilds.delete(resolvedRoot);
            }
        });
        backgroundFullBuilds.set(resolvedRoot, finalBuild);
        return finalBuild;
    }

    function triggerBuildInBackground(document: GmlTextDocument, resolvedRoot: string): void {
        let inFlight = inFlightBuilds.get(resolvedRoot);
        if (inFlight === undefined) {
            const resolvedUri = document.uri;
            const startDocVersion = readDocumentVersion(resolvedUri);
            const buildVersion = readRootVersion(resolvedRoot);
            abortActiveBuild(resolvedRoot);
            const controller = new AbortController();
            abortControllers.set(resolvedRoot, controller);

            const buildPromise = (async () => {
                const priorityFiles = documents.list().map((doc) => doc.filePath);
                try {
                    const currentDoc = documents.get(document.uri);
                    if (currentDoc && currentDoc.version !== document.version) {
                        return null;
                    }
                    if (readDocumentVersion(resolvedUri) !== startDocVersion) {
                        return null;
                    }
                    const existingState = cachedStates.get(resolvedRoot) ?? staleStates.get(resolvedRoot);
                    const state = await buildSemanticIndexForDocument(
                        document,
                        fsFacade,
                        priorityFiles,
                        true,
                        controller.signal,
                        existingState?.index?.rawIndex
                    );
                    if (
                        state &&
                        readRootVersion(resolvedRoot) === buildVersion &&
                        readDocumentVersion(resolvedUri) === startDocVersion
                    ) {
                        cachedStates.set(resolvedRoot, state);
                        staleStates.delete(resolvedRoot);
                        saveIndexCacheToDisk(resolvedRoot, state.index, true);
                        void triggerBackgroundFullBuild(document, resolvedRoot);
                        return state;
                    }
                    return null;
                } catch (error) {
                    if (Core.isAbortError(error)) {
                        return null;
                    }
                    throw error;
                }
            })();

            inFlight = buildPromise.finally(() => {
                if (abortControllers.get(resolvedRoot) === controller) {
                    abortControllers.delete(resolvedRoot);
                }
                inFlightBuilds.delete(resolvedRoot);
            });
            inFlightBuilds.set(resolvedRoot, inFlight);
        }
    }

    async function ensureIndex(
        document: GmlTextDocument,
        options?: { allowStale?: boolean }
    ): Promise<NavigationState | null> {
        const resolvedUri = document.uri;
        const startDocVersion = readDocumentVersion(resolvedUri);
        const projectRoot = await getProjectRoot(document.filePath);
        if (!projectRoot) {
            return null;
        }

        const currentDoc = documents.get(document.uri);
        if (currentDoc && currentDoc.version !== document.version) {
            return null;
        }

        if (readDocumentVersion(resolvedUri) !== startDocVersion) {
            return null;
        }

        const resolvedRoot = path.resolve(projectRoot);
        let currentState = cachedStates.get(resolvedRoot);
        const staleState = staleStates.get(resolvedRoot);

        if (!currentState && !staleState) {
            try {
                const store = getSemanticStore(resolvedRoot);
                const definitionsState = store.readStateForTier("definitions");
                const fullState = store.readStateForTier("full");
                const useDefinitions =
                    definitionsState !== null &&
                    (fullState === null || definitionsState.generation > fullState.generation);
                const cachedState = useDefinitions ? definitionsState : fullState;
                const cachedProjectIndex = cachedState ? store.readIndexForTier(cachedState.tier) : null;
                if (cachedProjectIndex && cachedState) {
                    const navIndex = Semantic.createProjectNavigationIndex(cachedProjectIndex);
                    (navIndex as any).rawIndex = cachedProjectIndex;
                    const loadedState = {
                        projectRoot: resolvedRoot,
                        index: navIndex,
                        lightweight: cachedState.tier === "definitions"
                    };
                    cachedStates.set(resolvedRoot, loadedState);
                    currentState = loadedState;
                    reconcileRestoredManifest(document, resolvedRoot, cachedState.tier);
                }
            } catch (error) {
                console.error(`Failed to restore semantic index for ${resolvedRoot}:`, error);
            }
        }

        if (currentState && !currentState.lightweight) {
            return currentState;
        }

        if (currentState && currentState.lightweight) {
            void triggerBackgroundFullBuild(document, resolvedRoot);
            return currentState;
        }
        if (staleState && options?.allowStale) {
            triggerBuildInBackground(document, resolvedRoot);
            return staleState;
        }

        let inFlight = inFlightBuilds.get(resolvedRoot);
        if (inFlight === undefined) {
            const buildVersion = readRootVersion(resolvedRoot);
            abortActiveBuild(resolvedRoot);
            const controller = new AbortController();
            abortControllers.set(resolvedRoot, controller);

            const buildPromise = (async () => {
                const priorityFiles = documents.list().map((doc) => doc.filePath);
                try {
                    const innerCurrentDoc = documents.get(document.uri);
                    if (innerCurrentDoc && innerCurrentDoc.version !== document.version) {
                        return null;
                    }
                    if (readDocumentVersion(resolvedUri) !== startDocVersion) {
                        return null;
                    }
                    const existingState = cachedStates.get(resolvedRoot) ?? staleStates.get(resolvedRoot);
                    const state = await buildSemanticIndexForDocument(
                        document,
                        fsFacade,
                        priorityFiles,
                        true,
                        controller.signal,
                        existingState?.index?.rawIndex
                    );
                    if (
                        state &&
                        readRootVersion(resolvedRoot) === buildVersion &&
                        readDocumentVersion(resolvedUri) === startDocVersion
                    ) {
                        cachedStates.set(resolvedRoot, state);
                        staleStates.delete(resolvedRoot);
                        saveIndexCacheToDisk(resolvedRoot, state.index, true);
                        void triggerBackgroundFullBuild(document, resolvedRoot);
                        return state;
                    }
                    return null;
                } catch (error) {
                    if (Core.isAbortError(error)) {
                        return null;
                    }
                    throw error;
                }
            })();

            inFlight = buildPromise.finally(() => {
                if (abortControllers.get(resolvedRoot) === controller) {
                    abortControllers.delete(resolvedRoot);
                }
                inFlightBuilds.delete(resolvedRoot);
            });
            inFlightBuilds.set(resolvedRoot, inFlight);
        }

        return await inFlight;
    }

    async function refreshIndex(
        document: GmlTextDocument,
        changedFiles: ReadonlyArray<string> = [document.filePath]
    ): Promise<NavigationState | null> {
        const resolvedUri = document.uri;
        const startDocVersion = readDocumentVersion(resolvedUri);
        const projectRoot = await getProjectRoot(document.filePath);
        if (!projectRoot) {
            return null;
        }

        const currentDoc = documents.get(document.uri);
        if (currentDoc && currentDoc.version !== document.version) {
            return null;
        }

        if (readDocumentVersion(resolvedUri) !== startDocVersion) {
            return null;
        }

        const resolvedRoot = path.resolve(projectRoot);
        const buildVersion = readRootVersion(resolvedRoot);
        const priorityFiles = documents.list().map((doc) => doc.filePath);

        abortActiveBuild(resolvedRoot);
        const controller = new AbortController();
        abortControllers.set(resolvedRoot, controller);

        const inFlight = (async () => {
            try {
                const innerCurrentDoc = documents.get(document.uri);
                if (innerCurrentDoc && innerCurrentDoc.version !== document.version) {
                    return null;
                }
                if (readDocumentVersion(resolvedUri) !== startDocVersion) {
                    return null;
                }
                const existingState = cachedStates.get(resolvedRoot) ?? staleStates.get(resolvedRoot);
                const canIncremental = existingState && !existingState.lightweight;
                const state = await buildSemanticIndexForDocument(
                    document,
                    fsFacade,
                    priorityFiles,
                    false,
                    controller.signal,
                    canIncremental ? existingState.index.rawIndex : undefined,
                    changedFiles
                );
                if (
                    state &&
                    readRootVersion(resolvedRoot) === buildVersion &&
                    readDocumentVersion(resolvedUri) === startDocVersion
                ) {
                    const currentState = cachedStates.get(resolvedRoot);
                    if (currentState) {
                        currentState.index = state.index;
                        currentState.lightweight = false;
                    } else {
                        cachedStates.set(resolvedRoot, state);
                    }
                    staleStates.delete(resolvedRoot);

                    saveIndexCacheToDisk(resolvedRoot, state.index, false);

                    return state;
                }
                return null;
            } catch (error) {
                if (Core.isAbortError(error)) {
                    return null;
                }
                throw error;
            }
        })();

        const finalInFlight = inFlight.finally(() => {
            if (abortControllers.get(resolvedRoot) === controller) {
                abortControllers.delete(resolvedRoot);
            }
            inFlightBuilds.delete(resolvedRoot);
        });
        inFlightBuilds.set(resolvedRoot, finalInFlight);
        return await finalInFlight;
    }

    async function ensureFullIndex(document: GmlTextDocument): Promise<NavigationState | null> {
        const state = await ensureIndex(document);
        if (!state) {
            return null;
        }
        if (!state.lightweight) {
            return state;
        }

        const projectRoot = await getProjectRoot(document.filePath);
        if (!projectRoot) {
            return state;
        }
        const resolvedRoot = path.resolve(projectRoot);

        const fullState = await triggerBackgroundFullBuild(document, resolvedRoot);
        return fullState && !fullState.lightweight ? fullState : null;
    }

    return {
        async dispose() {
            for (const controller of abortControllers.values()) {
                controller.abort();
            }
            abortControllers.clear();
            await Promise.all(pendingCacheWrites.values());
            await Promise.all(manifestReconciliations.values());
            for (const store of semanticStores.values()) {
                store.close();
            }
            semanticStores.clear();
            pendingCacheWrites.clear();
            lexicalRangesByDocument.clear();
            manifestReconciliations.clear();
        },
        buildForDocument: ensureIndex,
        refreshForDocument: refreshIndex,
        invalidateForDocument: invalidateKnownDocumentRoots,
        invalidateForFilePath: invalidateKnownFileRoots,
        async refreshForFilePath(filePath) {
            if (!isGmlDocumentPath(filePath)) {
                await invalidateKnownFileRoots(filePath);
                return null;
            }

            const resolvedPath = path.resolve(filePath);
            const projectRoot = await getProjectRoot(resolvedPath);
            const resolvedRoot = projectRoot ? path.resolve(projectRoot) : null;
            const changedFiles = resolvedRoot
                ? [
                      resolvedPath,
                      ...getSemanticStore(resolvedRoot)
                          .findImmediateDownstreamFiles(path.relative(resolvedRoot, resolvedPath))
                          .map((relativePath) => path.join(resolvedRoot, relativePath))
                  ]
                : [resolvedPath];
            const openedDocument = documents
                .list()
                .find((document) => path.resolve(document.filePath) === resolvedPath);
            if (openedDocument) {
                invalidateKnownDocumentRoots(openedDocument);
                return await refreshIndex(openedDocument, changedFiles);
            }

            let sourceText = "";
            try {
                sourceText = await fs.readFile(resolvedPath, "utf8");
            } catch (error) {
                if (!Core.isErrorWithCode(error, "ENOENT")) {
                    throw error;
                }
            }
            const document = createGmlTextDocument(filePathToUri(resolvedPath), "gml", 0, sourceText);
            await invalidateKnownFileRoots(resolvedPath);
            return await refreshIndex(document, changedFiles);
        },
        preload() {
            try {
                getBuiltInsMetadata();
            } catch {
                // Ignore pre-load errors
            }
        },
        async findDefinition(document, offset, identifierName) {
            const state = await ensureIndex(document);
            if (!state) {
                return null;
            }

            const symbolId = findSymbolId(state.index, document, offset, identifierName, isIgnoredOffset);
            const definition = symbolId ? (Semantic.findNavigationDefinitions(state.index, symbolId)[0] ?? null) : null;
            return definition ? await occurrenceToLspLocation(document, definition) : null;
        },
        async findReferences(document, offset, identifierName, includeDefinitions) {
            const state = await ensureFullIndex(document);
            if (!state) {
                return [];
            }

            const symbolId = findSymbolId(state.index, document, offset, identifierName, isIgnoredOffset);
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
            if (isIgnoredOffset(document, offset)) {
                return null;
            }

            // First check if it is a built-in identifier. Since built-in metadata is bundled,
            // we can return hover info for built-ins instantly without waiting for the full or
            // lightweight project semantic index to compile/build, avoiding the "Loading..." lag.
            const builtIns = getBuiltInsMetadata();
            let builtIn = builtIns[identifierName];
            if (!builtIn) {
                builtIn = builtInsMetadataByLowerName?.get(identifierName.toLowerCase());
            }

            if (Core.isObjectLike(builtIn)) {
                const info = builtIn as Record<string, unknown>;
                const type = typeof info.type === "string" ? info.type : "unknown";
                let markdown = `\`${identifierName}\`\n\nBuilt-in ${type}`;
                if (typeof info.manualUrl === "string" && info.manualUrl.length > 0) {
                    markdown += `\n\n[Open GameMaker Manual Page](${info.manualUrl})`;
                }
                return {
                    contents: {
                        kind: "markdown",
                        value: markdown
                    },
                    range: offsetsToRange(document, offset, offset + identifierName.length)
                };
            }

            const state = await ensureIndex(document, { allowStale: true });
            if (!state) {
                return null;
            }

            const symbolId = findSymbolId(state.index, document, offset, identifierName, isIgnoredOffset);
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
                    }
                    docComment = formatGmlDocComment(symbol.documentation);
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
        async listSemanticHighlights(document) {
            const cachedState = findCachedStateForDocument(document);
            if (!cachedState) {
                // Baseline lexical/built-in highlighting must not wait for a
                // project parse. The semantic refresh will replace it later.
                void ensureIndex(document, { allowStale: true });
                return Semantic.collectGmlSemanticHighlights({
                    sourceText: document.sourceText,
                    builtIns: Object.entries(getBuiltInsMetadata()).flatMap(([name, descriptor]) => {
                        if (!Core.isObjectLike(descriptor)) return [];
                        const entry = descriptor as Record<string, unknown>;
                        return typeof entry.type === "string"
                            ? [{ name, type: entry.type, deprecated: entry.deprecated === true }]
                            : [];
                    }),
                    projectIdentifiers: [],
                    occurrences: []
                });
            }
            const state = await ensureIndex(document, { allowStale: true });
            const occurrences = state?.index.occurrencesByFilePath.get(path.resolve(document.filePath)) ?? [];
            const builtIns = Object.entries(getBuiltInsMetadata()).flatMap(([name, descriptor]) => {
                if (!Core.isObjectLike(descriptor)) return [];
                const entry = descriptor as Record<string, unknown>;
                if (typeof entry.type !== "string") return [];
                return [{ name, type: entry.type, deprecated: entry.deprecated === true }];
            });
            return Semantic.collectGmlSemanticHighlights({
                sourceText: document.sourceText,
                builtIns,
                projectIdentifiers: state
                    ? [...state.index.resourceKindsByName].map(([name, kind]) => ({ name, kind }))
                    : [],
                occurrences: occurrences.map((occurrence) => ({
                    start: occurrence.location.range.start,
                    end: occurrence.location.range.end,
                    kind: occurrence.kind,
                    role: occurrence.role
                }))
            });
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
            const state = await ensureFullIndex(document);
            if (!state) {
                return null;
            }

            const symbolId = findSymbolId(state.index, document, offset, identifierName, isIgnoredOffset);
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
