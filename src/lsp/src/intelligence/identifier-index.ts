import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { Core, type FsFacade } from "@gmloop/core";
import { Parser } from "@gmloop/parser";
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
import {
    hasExactResolution,
    readOccurrenceEndFromMatch,
    readOccurrenceRoleFromMatch,
    readOccurrenceStartFromMatch,
    readSymbolDisplayNameFromMatch,
    readSymbolIdFromMatch,
    readSymbolKindFromMatch,
    readSymbolNameFromMatch
} from "./symbol-occurrence-match.js";
import { createWorkerOverlayBoundary, isWorkerOverlayBoundaryCurrent } from "./worker-overlay-boundary.js";

type GmlSymbolDocumentation = ReturnType<typeof Semantic.createEmptyGmlSymbolDocumentation>;
type SemanticFileManifest = Awaited<ReturnType<typeof Semantic.buildSemanticFileManifest>>;
type SemanticSnapshot = ReturnType<typeof Semantic.createSemanticSnapshotFromProjectIndex>;
type SemanticIndexStore = ReturnType<typeof Semantic.openSemanticIndexStore>;
type SemanticSnapshotAcquireResult = Awaited<ReturnType<SemanticIndexStore["acquireSemanticSnapshot"]>>;
type SemanticSnapshotLease = Extract<SemanticSnapshotAcquireResult, Readonly<{ kind: "lease" }>>["lease"];
type SemanticSnapshotQueries = SemanticSnapshotLease["queries"];
type SemanticOccurrenceMatch = ReturnType<SemanticSnapshotQueries["findDefinitions"]>[number];
type SemanticQuerySymbol = NonNullable<ReturnType<SemanticSnapshotQueries["findSymbol"]>>;
type NavigationState = Readonly<{
    checkpoint: Record<string, unknown> | null;
    manifest: SemanticFileManifest | null;
    projectRoot: string;
    lightweight: boolean;
    sourceRevision: SemanticSnapshotLease["identity"]["projectRevision"];
    tier: SemanticSnapshotLease["identity"]["tier"];
}>;
type BuiltNavigationState = NavigationState &
    Readonly<{
        snapshot: SemanticSnapshot;
    }>;
type SemanticSnapshotRequirement = Parameters<SemanticIndexStore["acquireSemanticSnapshot"]>[0];
type RequiredSemanticCapability =
    SemanticSnapshotRequirement["capabilities"] extends ReadonlySet<infer Capability> ? Capability : never;
type WorkerBuildBoundary = Readonly<{
    baseGeneration: number | null;
    definitionsGeneration: number | null;
    definitionsSourceRevision: string | null;
    projectHeadGeneration: number;
    projectVersion: number;
    tier: "definitions" | "full";
}>;

/**
 * Retained in-memory bookkeeping counts for the semantic index.
 *
 * These counters are intentionally compact so tests and diagnostics can verify
 * that per-document caches are released without exposing cache contents.
 */
export type GmlSemanticIndexMemoryDiagnostics = Readonly<{
    documentVersionEntries: number;
    ignoredLexicalRangeEntries: number;
}>;

function createBuiltNavigationState(
    projectRoot: string,
    checkpoint: Record<string, unknown> | null,
    lightweight: boolean,
    manifest: SemanticFileManifest | null,
    snapshot: SemanticSnapshot
): BuiltNavigationState {
    return Object.freeze({
        checkpoint,
        lightweight,
        manifest,
        projectRoot,
        snapshot,
        sourceRevision: snapshot.sourceRevision,
        tier: snapshot.tier
    });
}

function releaseBuiltNavigationState(state: BuiltNavigationState): NavigationState {
    return Object.freeze({
        checkpoint: state.checkpoint,
        lightweight: state.lightweight,
        manifest: state.manifest,
        projectRoot: state.projectRoot,
        sourceRevision: state.sourceRevision,
        tier: state.tier
    });
}

function createRestoredNavigationState(
    projectRoot: string,
    checkpoint: Record<string, unknown> | null,
    manifest: SemanticFileManifest | null,
    lease: SemanticSnapshotLease
): NavigationState {
    return Object.freeze({
        checkpoint,
        lightweight: lease.identity.tier === "definitions",
        manifest,
        projectRoot,
        sourceRevision: lease.identity.projectRevision,
        tier: lease.identity.tier
    });
}

function createNavigationSnapshotRequirements(
    state: NavigationState,
    document: GmlTextDocument,
    capability: RequiredSemanticCapability,
    requireCompleteProjectRelationships: boolean
): SemanticSnapshotRequirement {
    const overlayVersions = new Map<string, number>();
    for (const entry of state.manifest?.entries.values() ?? []) {
        if (entry.sourceOrigin === "openBuffer" && entry.sourceVersion !== null) {
            overlayVersions.set(entry.relativePath, entry.sourceVersion);
        }
    }
    return Object.freeze({
        capabilities: new Set<RequiredSemanticCapability>([capability]),
        overlayVersions,
        projectRevision: state.sourceRevision,
        requireCompleteProjectRelationships,
        requiredFiles: new Set([document.filePath]),
        requiredResources: new Set<string>(),
        tier: state.tier
    });
}

async function withPinnedSemanticQueries<Result>(
    store: SemanticIndexStore,
    state: NavigationState,
    document: GmlTextDocument,
    capability: RequiredSemanticCapability,
    requireCompleteProjectRelationships: boolean,
    signal: AbortSignal,
    read: (queries: SemanticSnapshotQueries) => Promise<Result> | Result
): Promise<Result | null> {
    return await withSemanticLeaseQueries(
        store,
        createNavigationSnapshotRequirements(state, document, capability, requireCompleteProjectRelationships),
        signal,
        (lease) => read(lease.queries)
    );
}

/**
 * Acquire a semantic snapshot, hand the lease to a callback, and release
 * the lease afterwards — returning the callback's result, or `null` when
 * the acquisition does not yield a lease.
 *
 * Exists to break the Law-of-Demeter chain that callers otherwise walk
 * by hand at every snapshot site:
 *
 * ```ts
 * const acquisition = await store.acquireSemanticSnapshot(requirements, signal);
 * if (acquisition.kind !== "lease") {
 *     return null;
 * }
 * try {
 *     return await use(acquisition.lease);
 * } finally {
 *     acquisition.lease.release();
 * }
 * ```
 *
 * Centralising the acquisition, the `kind === "lease"` narrowing, and the
 * `try/finally release` in a single helper gives every call site a single
 * immediate neighbour (`lease`) to talk to and prevents leaks from a
 * forgotten `release()` after a thrown error. Callers that need custom
 * requirements (a different `tier`, an empty `requiredFiles`, etc.) can
 * adopt the helper without having to rebuild the navigation-state-driven
 * shape of {@link withPinnedSemanticQueries}.
 *
 * The callback receives the full {@link SemanticSnapshotLease} (covering
 * `queries` and `identity`); query-only callers can simply project the
 * `lease.queries` field inside the callback. The callback may return any
 * value, including a falsy one — the helper only substitutes `null` when
 * the acquisition itself fails, never for the callback's own result.
 *
 * @param store - Semantic index store that owns the snapshot.
 * @param requirements - Snapshot requirements to satisfy.
 * @param signal - Abort signal forwarded to `acquireSemanticSnapshot`.
 * @param use - Callback invoked with the lease.
 * @returns The callback's result, or `null` when no lease is available.
 */
async function withSemanticLeaseQueries<Result>(
    store: SemanticIndexStore,
    requirements: SemanticSnapshotRequirement,
    signal: AbortSignal,
    use: (lease: SemanticSnapshotLease) => Result | Promise<Result>
): Promise<Result | null> {
    const acquisition = await store.acquireSemanticSnapshot(requirements, signal);
    if (acquisition.kind !== "lease") {
        return null;
    }
    try {
        return await use(acquisition.lease);
    } finally {
        acquisition.lease.release();
    }
}

function awaitRequestSemanticState(
    statePromise: Promise<NavigationState | null>,
    signal: AbortSignal
): Promise<NavigationState | null> {
    if (signal.aborted) {
        return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (result: NavigationState | null, error: unknown): void => {
            if (settled) {
                return;
            }
            settled = true;
            signal.removeEventListener("abort", abort);
            if (error === null) {
                resolve(result);
            } else {
                reject(coerceToError(error));
            }
        };
        const abort = (): void => finish(null, null);
        signal.addEventListener("abort", abort, { once: true });
        void statePromise.then(
            (state) => finish(state, null),
            (error: unknown) => finish(null, error)
        );
    });
}

function areWorkerBuildBoundariesEqual(left: WorkerBuildBoundary | undefined, right: WorkerBuildBoundary): boolean {
    return (
        left?.baseGeneration === right.baseGeneration &&
        left.definitionsGeneration === right.definitionsGeneration &&
        left.definitionsSourceRevision === right.definitionsSourceRevision &&
        left.projectHeadGeneration === right.projectHeadGeneration &&
        left.projectVersion === right.projectVersion &&
        left.tier === right.tier
    );
}

/** Physical or metadata inventory change applied to one semantic project. */
export type GmlSemanticFileChange = Readonly<{
    filePath: string;
    kind: "added" | "deleted" | "metadataChanged" | "modified";
}>;

/** A semantic-analysis build started by the LSP navigation facade. */
export type GmlSemanticAnalysisStart = Readonly<{
    affectedFileCount: number;
    projectRoot: string;
    reason: "cacheRecovery" | "coldStart" | "documentChange" | "fileChanges" | "references" | "rename";
    scope: "incremental" | "project";
    tier: "definitions" | "full";
}>;

/** A semantic-analysis build finished/completed by the LSP navigation facade. */
export type GmlSemanticAnalysisFinish = Readonly<{
    affectedFileCount: number;
    projectRoot: string;
    reason: GmlSemanticAnalysisStart["reason"];
    scope: GmlSemanticAnalysisStart["scope"];
    tier: GmlSemanticAnalysisStart["tier"];
    durationMs: number;
    status: "success" | "aborted" | "failed";
    errorMessage?: string;
}>;

/**
 * Lifecycle and diagnostics surface for the semantic index.
 *
 * Consumers that only need to (re)build the index, tear it down, prewarm it,
 * or read compact in-memory counters can depend on this role alone, keeping
 * unrelated LSP handlers free of the navigation, symbol, rename, and search
 * capabilities the rest of the index exposes.
 */
export interface GmlSemanticIndexLifecycle {
    buildForDocument(document: GmlTextDocument): Promise<NavigationState | null>;
    indexProjectRoot(projectRoot: string): Promise<void>;
    dispose(): Promise<void>;
    preload(): void;
    /**
     * Return compact counters for semantic-index memory diagnostics.
     */
    readMemoryDiagnostics(): GmlSemanticIndexMemoryDiagnostics;
}

/**
 * Definition/references/hover navigation surface for the semantic index.
 *
 * LSP handlers that resolve go-to-definition, references, document-local
 * references, or hover information should depend on this role alone and not
 * drag in the symbol-listing, rename, cache-management, or search
 * capabilities the index also provides.
 */
export interface GmlSemanticNavigator {
    findDefinition(
        document: GmlTextDocument,
        offset: number,
        identifierName: string,
        signal: AbortSignal
    ): Promise<Location | null>;
    findReferences(
        document: GmlTextDocument,
        offset: number,
        identifierName: string,
        includeDefinitions: boolean,
        signal: AbortSignal
    ): Promise<Location[]>;
    findDocumentReferences(
        document: GmlTextDocument,
        offset: number,
        identifierName: string,
        signal: AbortSignal
    ): Promise<Location[]>;
    hover(
        document: GmlTextDocument,
        offset: number,
        identifierName: string,
        signal: AbortSignal
    ): Promise<Hover | null>;
}

/**
 * Document-symbol and semantic-highlight listing surface for the semantic
 * index.
 *
 * Handlers that only project the AST into outline-style or token-level views
 * can depend on this role alone without coupling to navigation, rename,
 * cache, or search machinery.
 */
export interface GmlSemanticDocumentSymbolProvider {
    listDocumentSymbols(document: GmlTextDocument, signal: AbortSignal): Promise<DocumentSymbol[]>;
    listSemanticHighlights(
        document: GmlTextDocument,
        signal: AbortSignal
    ): Promise<ReturnType<typeof Semantic.collectGmlSemanticHighlights>>;
}

/**
 * Rename preparation and planning surface for the semantic index.
 *
 * LSP handlers that drive `textDocument/prepareRename` and
 * `textDocument/rename` should depend on this role alone instead of the full
 * index, so unrelated navigation or search code is not in their contract.
 */
export interface GmlSemanticRenameSupport {
    planRename(
        document: GmlTextDocument,
        offset: number,
        identifierName: string,
        newName: string,
        signal: AbortSignal
    ): Promise<WorkspaceEdit | null>;
    prepareRename(
        document: GmlTextDocument,
        offset: number,
        identifierName: string,
        signal: AbortSignal
    ): Promise<ReturnType<typeof offsetsToRange> | null>;
}

/**
 * Cache invalidation surface for the semantic index.
 *
 * Document-sync handlers that only need to drop stale cached navigation
 * state for a freshly edited document can depend on this role alone,
 * leaving refresh, navigation, symbol, rename, and search concerns to
 * their own dedicated roles. Keeping invalidation separate from refresh
 * matches the call-site reality: an LSP `onDidChangeTextDocument` handler
 * invalidates and lets the next query trigger a refresh, while file-watcher
 * and save handlers refresh directly from disk.
 */
export interface GmlSemanticCacheInvalidator {
    invalidateForDocument(document: GmlTextDocument): void;
    invalidateForFilePath(filePath: string): Promise<void>;
}

/**
 * Cache refresh surface for the semantic index.
 *
 * File-watcher and save handlers that need to rebuild cached navigation
 * state from disk can depend on this role alone, leaving invalidation,
 * navigation, symbol, rename, and search concerns to their own dedicated
 * roles. Refreshing without invalidating first is the intended pattern
 * here: callers that need both should depend on the composite
 * {@link GmlSemanticCacheManager} instead.
 */
export interface GmlSemanticCacheRefresher {
    refreshForDocument(document: GmlTextDocument): Promise<NavigationState | null>;
    refreshForFilePath(filePath: string): Promise<NavigationState | null>;
    refreshForFileChanges(changes: ReadonlyArray<GmlSemanticFileChange>): Promise<void>;
}

/**
 * Composite cache-management surface for the semantic index.
 *
 * Combines the invalidation and refresh roles so callers that genuinely
 * need both capabilities — for example integration tests that exercise
 * the full cache lifecycle end-to-end — can declare a single dependency.
 * Handlers that only need to invalidate (document-sync) or only need to
 * refresh (file-watcher, save, close) should depend on the narrower role
 * interface directly to keep their contract honest.
 *
 * This split mirrors the Interface Segregation Principle: each role models
 * a single cohesive cache responsibility and exposes only the members its
 * consumers require, preventing accidental coupling between the
 * "drop stale state" and "rebuild state from disk" subsystems of the
 * semantic index.
 */
export interface GmlSemanticCacheManager extends GmlSemanticCacheInvalidator, GmlSemanticCacheRefresher {}

/**
 * Completion and workspace-symbol search surface for the semantic index.
 *
 * Handlers that resolve completions or `workspace/symbol` queries should
 * depend on this role alone instead of the full index, so unrelated
 * navigation or rename code is not in their contract.
 */
export interface GmlSemanticSearchProvider {
    searchCompletions(document: GmlTextDocument, query: string, signal: AbortSignal): Promise<CompletionItem[]>;
    searchWorkspaceSymbols(document: GmlTextDocument, query: string, signal: AbortSignal): Promise<WorkspaceSymbol[]>;
}

/**
 * Composite query facade used by the LSP layer to consume semantic navigation
 * facts.
 *
 * The composite intentionally extends the role interfaces above so callers
 * that genuinely need every capability (the canonical `createGmlSemanticIndex`
 * factory, the existing LSP handler wiring) can resolve a single object, while
 * new call sites are encouraged to depend on the narrower role they actually
 * use. Each role models one cohesive responsibility and exposes only the
 * members its consumers require, which is the Interface Segregation Principle
 * in practice.
 */
export type GmlSemanticIndex = GmlSemanticIndexLifecycle &
    GmlSemanticNavigator &
    GmlSemanticDocumentSymbolProvider &
    GmlSemanticRenameSupport &
    GmlSemanticCacheInvalidator &
    GmlSemanticCacheRefresher &
    GmlSemanticSearchProvider;

function formatGmlDocComment(documentation: GmlSymbolDocumentation): string {
    if (documentation.normalizedText.length === 0) {
        return "";
    }
    const sections: string[] = [];
    if (documentation.description.length > 0) {
        sections.push(documentation.description);
    }
    if (documentation.parameters.length > 0) {
        sections.push(
            `**Parameters:**\n${documentation.parameters
                .map(
                    (parameter) =>
                        `* \`${parameter.name}\`${parameter.type ? ` (\`${parameter.type}\`)` : ""}${
                            parameter.description ? ` — ${parameter.description}` : ""
                        }`
                )
                .join("\n")}`
        );
    }
    if (documentation.returns !== null) {
        sections.push(
            `*Returns*${documentation.returns.type ? ` \`${documentation.returns.type}\`` : ""}${
                documentation.returns.description ? ` — ${documentation.returns.description}` : ""
            }`
        );
    }
    for (const tag of documentation.additionalTags) {
        sections.push(`*@${tag.name}${tag.value ? ` ${tag.value}` : ""}*`);
    }
    return sections.join("\n\n");
}

function resolveOccurrenceFilePath(projectRoot: string, occurrence: SemanticOccurrenceMatch["occurrence"]): string {
    return path.isAbsolute(occurrence.filePath)
        ? path.resolve(occurrence.filePath)
        : path.resolve(projectRoot, occurrence.filePath);
}

async function readDocumentForLocation(
    openedDocument: GmlTextDocument,
    projectRoot: string,
    occurrence: SemanticOccurrenceMatch["occurrence"]
): Promise<GmlTextDocument> {
    const filePath = resolveOccurrenceFilePath(projectRoot, occurrence);
    if (filePath === path.resolve(openedDocument.filePath)) {
        return openedDocument;
    }

    const sourceText = await fs.readFile(filePath, "utf8");
    return createGmlTextDocument(filePathToUri(filePath), "gml", 0, sourceText);
}

async function occurrenceToLspLocation(
    projectRoot: string,
    document: GmlTextDocument,
    match: SemanticOccurrenceMatch
): Promise<Location> {
    const targetDocument = await readDocumentForLocation(document, projectRoot, match.occurrence);
    return {
        uri: targetDocument.uri,
        range: offsetsToRange(targetDocument, readOccurrenceStartFromMatch(match), readOccurrenceEndFromMatch(match))
    };
}

async function symbolToWorkspaceSymbol(
    projectRoot: string,
    document: GmlTextDocument,
    queries: SemanticSnapshotQueries,
    symbol: SemanticQuerySymbol
): Promise<WorkspaceSymbol | null> {
    const definition = queries.findDefinitions(symbol.symbolId)[0] ?? null;
    if (!definition) {
        return null;
    }

    return {
        name: symbol.displayName,
        kind: gmlSymbolKindToLspSymbolKind(symbol.kind),
        location: await occurrenceToLspLocation(projectRoot, document, definition)
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
    queries: SemanticSnapshotQueries,
    document: GmlTextDocument,
    offset: number,
    identifierName: string,
    isIgnoredOffset: (document: GmlTextDocument, offset: number) => boolean,
    allowPositionOccurrence = true
): string | null {
    if (isIgnoredOffset(document, offset)) {
        return null;
    }

    const exactMatch = allowPositionOccurrence ? queries.findSymbolAtPosition(document.filePath, offset) : null;
    const exactSymbolId = exactMatch === null ? null : readSymbolIdFromMatch(exactMatch);
    if (exactSymbolId !== null) {
        return exactSymbolId;
    }
    const resolvedSymbolId = queries.hasSymbol(identifierName)
        ? identifierName
        : queries.resolveSymbolId(identifierName);
    if (resolvedSymbolId === null) {
        return null;
    }
    const symbol = queries.findSymbol(resolvedSymbolId);
    return symbol?.kind === "localVariable" || symbol?.kind === "instanceVariable" || symbol?.kind === "structVariable"
        ? null
        : resolvedSymbolId;
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

/**
 * Ceiling on distinct file paths tracked by {@link projectRootCache}.
 *
 * This cache is process-wide (not scoped to a single semantic index
 * instance) and every navigation, diagnostic, and file-watcher callback that
 * resolves a project root feeds it. Left unbounded, a long-running LSP
 * session accumulates one entry per unique file path ever queried for the
 * lifetime of the process, even after the owning document closes — on a
 * large project this becomes a steady memory leak that never shrinks.
 */
const PROJECT_ROOT_CACHE_MAX_ENTRIES = 2000;
const projectRootCache = new Map<string, string | null>();

async function getProjectRoot(filepath: string): Promise<string | null> {
    const resolvedPath = path.resolve(filepath);
    const cached = projectRootCache.get(resolvedPath);
    if (cached !== undefined) {
        // Reinsert to mark as most-recently-used so eviction below drops the
        // least-recently-used entry first (Map iterates in insertion order).
        projectRootCache.delete(resolvedPath);
        projectRootCache.set(resolvedPath, cached);
        return cached;
    }

    const root = await Semantic.findProjectRoot({ filepath: resolvedPath });
    projectRootCache.set(resolvedPath, root);
    if (projectRootCache.size > PROJECT_ROOT_CACHE_MAX_ENTRIES) {
        const oldestEntry: IteratorResult<string> = projectRootCache.keys().next();
        const oldestKey: unknown = oldestEntry.value;
        if (!oldestEntry.done && typeof oldestKey === "string") {
            projectRootCache.delete(oldestKey);
        }
    }
    return root;
}

/** @internal Test-only accessor for the module-wide project root cache. */
export const getProjectRootForTests = getProjectRoot;

/** @internal Test-only diagnostics for the module-wide project root cache. */
export function getProjectRootCacheSizeForTests(): number {
    return projectRootCache.size;
}

/** @internal Test-only reset for the module-wide project root cache. */
export function resetProjectRootCacheForTests(): void {
    projectRootCache.clear();
}

/** @internal Test-only membership check for the module-wide project root cache. */
export function hasProjectRootCacheEntryForTests(filepath: string): boolean {
    return projectRootCache.has(path.resolve(filepath));
}

interface SemanticIndexWorkerBuildOptions {
    projectRoot: string;
    priorityFiles: ReadonlyArray<string>;
    openDocuments: ReadonlyArray<GmlTextDocument>;
    definitionsOnly: boolean;
    readCurrentOpenDocuments: () => ReadonlyArray<GmlTextDocument>;
    buildIdentity: Readonly<{
        boundary: WorkerBuildBoundary;
        isCurrent: (boundary: WorkerBuildBoundary) => boolean;
    }>;
    signal?: AbortSignal;
    incremental?: Readonly<{
        changes: ReadonlyArray<GmlSemanticFileChange>;
        existingIndex: Record<string, unknown>;
    }> | null;
    previousManifest?: SemanticFileManifest | null;
}

function buildSemanticIndexInWorker({
    projectRoot,
    priorityFiles,
    openDocuments,
    definitionsOnly,
    readCurrentOpenDocuments,
    buildIdentity,
    signal,
    incremental = null,
    previousManifest = null
}: SemanticIndexWorkerBuildOptions): Promise<BuiltNavigationState | null> {
    const { boundary: buildBoundary, isCurrent: isBuildBoundaryCurrent } = buildIdentity;
    const overlayBoundary = createWorkerOverlayBoundary(openDocuments);
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
        worker.on(
            "message",
            (message: {
                buildBoundary?: WorkerBuildBoundary;
                error?: unknown;
                openDocumentBoundary?: ReadonlyArray<{
                    contentHash: string;
                    documentVersion: number;
                    filePath: string;
                }>;
                manifest?: SemanticFileManifest;
                rawIndex?: unknown;
                semanticSnapshot?: ReturnType<typeof Semantic.createSemanticSnapshotFromProjectIndex>;
            }) => {
                if (message.error !== undefined) {
                    finish(() => reject(new Error(Core.getErrorMessageOrFallback(message.error))));
                    return;
                }
                if (
                    !Core.isObjectLike(message.rawIndex) ||
                    message.manifest === undefined ||
                    message.semanticSnapshot === undefined
                ) {
                    finish(() => resolve(null));
                    return;
                }
                if (
                    !areWorkerBuildBoundariesEqual(message.buildBoundary, buildBoundary) ||
                    !isBuildBoundaryCurrent(buildBoundary)
                ) {
                    finish(() => resolve(null));
                    return;
                }
                if (
                    message.openDocumentBoundary?.length !== overlayBoundary.size ||
                    !message.openDocumentBoundary.every((entry) => {
                        const boundary = overlayBoundary.get(path.resolve(entry.filePath));
                        return (
                            boundary?.contentHash === entry.contentHash && boundary.version === entry.documentVersion
                        );
                    })
                ) {
                    finish(() => resolve(null));
                    return;
                }
                if (!isWorkerOverlayBoundaryCurrent(overlayBoundary, readCurrentOpenDocuments())) {
                    finish(() => resolve(null));
                    return;
                }
                finish(() =>
                    resolve(
                        createBuiltNavigationState(
                            projectRoot,
                            Object.freeze(Object.fromEntries(Object.entries(message.rawIndex))),
                            definitionsOnly,
                            message.manifest,
                            message.semanticSnapshot
                        )
                    )
                );
            }
        );
        worker.on("error", (error) => finish(() => reject(coerceToError(error))));
        worker.on("exit", (code) => {
            if (code !== 0) finish(() => reject(new Error(`Project index worker exited with code ${String(code)}.`)));
        });
        signal?.addEventListener("abort", abort, { once: true });
        worker.postMessage({
            buildBoundary,
            definitionsOnly,
            incremental,
            openDocuments: openDocuments.map((document) => ({
                contentHash: Semantic.createSemanticContentHash(document.sourceText),
                documentVersion: document.version,
                filePath: path.resolve(document.filePath),
                sourceText: document.sourceText
            })),
            priorityFiles,
            projectRoot,
            previousManifest
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
export function createGmlSemanticIndex(
    documents: GmlDocumentStore,
    onSemanticGenerationPublished: (() => void) | null = null,
    onSemanticAnalysisStarted: ((event: GmlSemanticAnalysisStart) => void) | null = null,
    onSemanticAnalysisFinished: ((event: GmlSemanticAnalysisFinish) => void) | null = null
): GmlSemanticIndex {
    const cachedStates = new Map<string, NavigationState>();
    const staleStates = new Map<string, NavigationState>();
    const inFlightBuilds = new Map<string, Promise<NavigationState | null>>();
    const fullProjectBuilds = new Map<string, Promise<NavigationState | null>>();
    const rootVersions = new Map<string, number>();
    const abortControllers = new Map<string, AbortController>();
    const semanticStores = new Map<string, SemanticIndexStore>();
    const listProjectDocuments = (projectRoot: string): ReadonlyArray<GmlTextDocument> =>
        documents.list().filter((document) => isDocumentWithinProjectRoot(document, projectRoot));
    const documentVersions = new Map<string, number>();
    const pendingCacheWrites = new Map<string, Promise<void>>();
    const lexicalRangesByDocument = new Map<
        string,
        Readonly<{ ranges: ReadonlyArray<LexicalRange>; version: number }>
    >();
    const manifestReconciliations = new Map<string, Promise<void>>();
    const staleSemanticDocumentUris = new Set<string>();

    function reportSemanticAnalysisStart(event: GmlSemanticAnalysisStart): void {
        if (onSemanticAnalysisStarted !== null) {
            onSemanticAnalysisStarted(event);
        }
    }

    function reportSemanticAnalysisFinish(event: GmlSemanticAnalysisFinish): void {
        if (onSemanticAnalysisFinished !== null) {
            onSemanticAnalysisFinished(event);
        }
    }
    const fsFacade = createLspFsFacade(documents);
    let disposed = false;

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
            cachedStates.delete(resolvedRoot);
        }
        // A stale snapshot can be retained for lifecycle bookkeeping but is
        // never eligible to satisfy a semantic request for the new revision.
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

    function createWorkerBuildBoundary(
        resolvedRoot: string,
        tier: "definitions" | "full",
        projectVersion: number
    ): WorkerBuildBoundary {
        const activeSlots = getSemanticStore(resolvedRoot).readActiveSemanticSlots();
        return Object.freeze({
            baseGeneration: activeSlots[tier]?.generation ?? null,
            definitionsGeneration: activeSlots.definitions?.generation ?? null,
            definitionsSourceRevision: activeSlots.definitions?.sourceSignature ?? null,
            projectHeadGeneration: getSemanticStore(resolvedRoot).readSemanticProjectHead().generation,
            projectVersion,
            tier
        });
    }

    function isWorkerBuildBoundaryCurrent(resolvedRoot: string, boundary: WorkerBuildBoundary): boolean {
        const activeSlots = getSemanticStore(resolvedRoot).readActiveSemanticSlots();
        return (
            readRootVersion(resolvedRoot) === boundary.projectVersion &&
            getSemanticStore(resolvedRoot).readSemanticProjectHead().generation === boundary.projectHeadGeneration &&
            (activeSlots[boundary.tier]?.generation ?? null) === boundary.baseGeneration &&
            (activeSlots.definitions?.generation ?? null) === boundary.definitionsGeneration &&
            (activeSlots.definitions?.sourceSignature ?? null) === boundary.definitionsSourceRevision
        );
    }

    async function findMetadataAffectedFiles(
        resolvedRoot: string,
        metadataChange: GmlSemanticFileChange
    ): Promise<GmlSemanticFileChange[]> {
        const metadataFilePath = metadataChange.filePath;
        // Metadata impact is calculated from the last committed resource
        // inventory. A preceding refresh may have returned after publishing its
        // in-memory state but while its serialized publication is still queued.
        // Waiting for that project-local queue prevents a rapid add/remove pair
        // from diffing against an older manifest and retaining orphaned facts.
        await (pendingCacheWrites.get(resolvedRoot) ?? Promise.resolve());
        const requirements: SemanticSnapshotRequirement = Object.freeze({
            capabilities: new Set<RequiredSemanticCapability>(),
            overlayVersions: new Map<string, number>(),
            projectRevision: "current",
            requireCompleteProjectRelationships: false,
            requiredFiles: new Set<string>(),
            requiredResources: new Set<string>(),
            tier: "full"
        });
        // Hand the acquire-check-release ceremony to `withSemanticLeaseQueries`
        // so the call site only talks to its immediate neighbour (`lease` or
        // `null`); the `null` branch reuses the same change-set computation
        // with an empty resource inventory and a disk-only manifest rebuild.
        const result = await withSemanticLeaseQueries(
            getSemanticStore(resolvedRoot),
            requirements,
            new AbortController().signal,
            (lease) => computeMetadataAffectedChanges(resolvedRoot, metadataFilePath, metadataChange, lease.queries)
        );
        return result ?? (await computeMetadataAffectedChanges(resolvedRoot, metadataFilePath, metadataChange, null));
    }

    async function computeMetadataAffectedChanges(
        resolvedRoot: string,
        metadataFilePath: string,
        metadataChange: GmlSemanticFileChange,
        queries: SemanticSnapshotQueries | null
    ): Promise<GmlSemanticFileChange[]> {
        const resources = queries?.listResources() ?? [];
        const changesByPath = new Map<string, GmlSemanticFileChange["kind"]>([
            [path.resolve(metadataFilePath), metadataChange.kind]
        ]);
        if (metadataFilePath.toLowerCase().endsWith(".yyp")) {
            const currentResourcePaths = await fs
                .readFile(metadataFilePath, "utf8")
                .then((sourceText) => JSON.parse(sourceText) as unknown)
                .then((manifest) => {
                    if (!Core.isObjectLike(manifest)) {
                        return [];
                    }
                    const manifestRecord = Object.fromEntries(Object.entries(manifest));
                    if (!Array.isArray(manifestRecord.resources)) {
                        return [];
                    }
                    return manifestRecord.resources.flatMap((resource) => {
                        if (!Core.isObjectLike(resource)) {
                            return [];
                        }
                        const resourceRecord = Object.fromEntries(Object.entries(resource));
                        if (!Core.isObjectLike(resourceRecord.id)) {
                            return [];
                        }
                        const idRecord = Object.fromEntries(Object.entries(resourceRecord.id));
                        return typeof idRecord.path === "string" ? [idRecord.path] : [];
                    });
                })
                .catch((error: unknown) => {
                    if (Core.isErrorWithCode(error, "ENOENT")) {
                        return [];
                    }
                    throw error;
                });
            const previousResourcePaths = Core.uniqueArray(resources.map((resource) => resource.resourcePath));
            const currentPathSet = new Set(currentResourcePaths);
            const previousPathSet = new Set(previousResourcePaths);
            if (queries === null) {
                // A session-local overlay intentionally has no persistent
                // full snapshot. Reuse semantic project discovery to find
                // resource metadata still on disk but no longer listed by
                // the manifest, then invalidate their sibling source files
                // as deleted. This is conservative without relying on the
                // LSP's mutable raw-index projection.
                const currentManifest = await Semantic.buildSemanticFileManifest(resolvedRoot, fsFacade, []);
                for (const entry of currentManifest.entries.values()) {
                    if (entry.fileKind === "resourceMetadata" && !currentPathSet.has(entry.relativePath)) {
                        changesByPath.set(path.resolve(resolvedRoot, entry.relativePath), "deleted");
                    }
                }
            }
            for (const resourcePath of [...currentPathSet, ...previousPathSet]) {
                if (currentPathSet.has(resourcePath) !== previousPathSet.has(resourcePath)) {
                    changesByPath.set(
                        path.resolve(resolvedRoot, resourcePath),
                        currentPathSet.has(resourcePath) ? "added" : "deleted"
                    );
                }
            }
        }
        const resourcesByMetadataPath = new Map(
            resources.map((resource) => [path.resolve(resolvedRoot, resource.resourcePath), resource] as const)
        );
        for (const [affectedMetadataPath, affectedKind] of changesByPath) {
            const resource = resourcesByMetadataPath.get(path.resolve(affectedMetadataPath));
            if (resource === undefined) {
                continue;
            }
            for (const filePath of resource.filePaths) {
                if (isGmlDocumentPath(filePath)) {
                    changesByPath.set(
                        path.resolve(resolvedRoot, filePath),
                        affectedKind === "deleted" ? "deleted" : "modified"
                    );
                }
            }
        }
        const metadataChanges = [...changesByPath].filter(([filePath]) => !isGmlDocumentPath(filePath));
        const directoryFileGroups = await Promise.all(
            metadataChanges.map(([affectedMetadataPath, affectedKind]) =>
                fs
                    .readdir(path.dirname(affectedMetadataPath), { withFileTypes: true })
                    .then((entries) =>
                        entries.flatMap((entry) =>
                            entry.isFile() && entry.name.toLowerCase().endsWith(".gml")
                                ? [
                                      {
                                          filePath: path.resolve(path.dirname(affectedMetadataPath), entry.name),
                                          kind:
                                              affectedKind === "deleted" ? ("deleted" as const) : ("modified" as const)
                                      }
                                  ]
                                : []
                        )
                    )
                    .catch((error: unknown) => {
                        if (Core.isErrorWithCode(error, "ENOENT")) {
                            return [];
                        }
                        throw error;
                    })
            )
        );
        for (const directoryChanges of directoryFileGroups) {
            for (const directoryChange of directoryChanges) {
                changesByPath.set(directoryChange.filePath, directoryChange.kind);
            }
        }
        return [...changesByPath]
            .map(([filePath, kind]) => ({ filePath, kind }))
            .toSorted((left, right) => left.filePath.localeCompare(right.filePath));
    }

    function reconcileRestoredManifest(
        document: GmlTextDocument,
        resolvedRoot: string,
        tier: "definitions" | "full"
    ): void {
        if (disposed) {
            return;
        }
        if (manifestReconciliations.has(resolvedRoot)) {
            return;
        }
        const reconciliation = (async () => {
            const previousManifest = getSemanticStore(resolvedRoot).readSemanticManifest(tier);
            if (previousManifest === null) {
                return;
            }
            const overlays = listProjectDocuments(resolvedRoot).map((openDocument) => ({
                absolutePath: openDocument.filePath,
                contentHash: Semantic.createSemanticContentHash(openDocument.sourceText),
                documentVersion: openDocument.version,
                sourceText: openDocument.sourceText
            }));
            const currentManifest = await Semantic.buildSemanticFileManifest(
                resolvedRoot,
                fsFacade,
                overlays,
                previousManifest
            );
            const reconciliationResult = Semantic.reconcileSemanticManifests(previousManifest, currentManifest);
            if (!disposed && reconciliationResult.requiresBuild) {
                // Reuse the watched-file batch path so a restarted session applies
                // every detected disk and overlay change as one impacted set. The
                // previous implementation refreshed only the opening document and
                // forced a project rebuild, leaving closed-session edits stale.
                await refreshForFileChanges(
                    reconciliationResult.changedFiles.map((change) => ({
                        filePath: path.resolve(resolvedRoot, change.relativePath),
                        kind: change.kind
                    }))
                );
            }
        })()
            .catch((error: unknown) => {
                console.error(
                    `Failed to reconcile semantic manifest for ${resolvedRoot}: ${Core.getErrorMessageOrFallback(error)}`
                );
            })
            .finally(() => {
                manifestReconciliations.delete(resolvedRoot);
            });
        manifestReconciliations.set(resolvedRoot, reconciliation);
    }

    async function publishNavigationState(
        resolvedRoot: string,
        state: BuiltNavigationState,
        expectedRootVersion: number,
        changedFiles: ReadonlyArray<string> | null = null
    ): Promise<boolean> {
        if (disposed) {
            return false;
        }
        if (state.manifest === null) {
            throw new Error("Cannot publish a semantic build without its source manifest.");
        }
        const snapshot = state.snapshot;
        const tier = state.lightweight ? "definitions" : "full";
        if (snapshot.tier !== tier || snapshot.sourceRevision !== state.manifest.sourceRevision) {
            throw new Error("Cannot publish a semantic build with mismatched tier or source revision identity.");
        }

        const previousWrite = pendingCacheWrites.get(resolvedRoot) ?? Promise.resolve();
        const publication = previousWrite.then(() => {
            if (disposed) {
                return false;
            }
            if (readRootVersion(resolvedRoot) !== expectedRootVersion) {
                return false;
            }
            const store = getSemanticStore(resolvedRoot);
            const hasSessionOverlay = [...state.manifest.entries.values()].some(
                (entry) => entry.sourceOrigin === "openBuffer"
            );
            if (hasSessionOverlay) {
                const sessionPublication = store.publishSessionSemanticSnapshot({
                    manifest: state.manifest,
                    snapshot
                });
                if (sessionPublication.kind !== "published") {
                    throw new Error(`Failed to publish the session semantic snapshot: ${sessionPublication.kind}.`);
                }
                return true;
            }
            const rawNavigationProjection = state.checkpoint;
            if (!Core.isObjectLike(rawNavigationProjection)) {
                throw new TypeError("Cannot persist a semantic build without its incremental checkpoint.");
            }
            const publicationRequest = {
                authoritative: false,
                baseGeneration: store.readActiveSemanticSlots()[tier]?.generation ?? null,
                expectedHeadGeneration: store.readSemanticProjectHead().generation,
                manifest: state.manifest,
                navigationProjection: rawNavigationProjection,
                snapshot,
                sourceRevision: state.manifest.sourceRevision,
                tier
            } as const;
            const pubResult =
                changedFiles === null || publicationRequest.baseGeneration === null
                    ? store.publishSemanticSnapshot(publicationRequest)
                    : store.applySemanticIncrement({ ...publicationRequest, affectedFiles: changedFiles });
            if (pubResult.status === "superseded") {
                return false;
            }
            return true;
        });
        const queuedWrite = publication
            .then(() => undefined)
            .catch((error: unknown) => {
                console.error(
                    `Failed to persist semantic index for ${resolvedRoot}: ${Core.getErrorMessageOrFallback(error)}`
                );
                return undefined;
            });
        pendingCacheWrites.set(resolvedRoot, queuedWrite);
        void queuedWrite.finally(() => {
            if (pendingCacheWrites.get(resolvedRoot) === queuedWrite) {
                pendingCacheWrites.delete(resolvedRoot);
            }
        });
        return await publication;
    }

    function invalidateKnownDocumentRoots(document: GmlTextDocument): void {
        const resolvedUri = document.uri;
        documentVersions.set(resolvedUri, readDocumentVersion(resolvedUri) + 1);
        lexicalRangesByDocument.delete(resolvedUri);
        staleSemanticDocumentUris.add(resolvedUri);
        const knownRoots = new Set([...cachedStates.keys(), ...inFlightBuilds.keys()]);
        for (const projectRoot of knownRoots) {
            if (isDocumentWithinProjectRoot(document, projectRoot)) {
                invalidateRoot(projectRoot);
            }
        }
    }

    function releaseClosedDocumentCaches(filePath: string): void {
        const uri = filePathToUri(path.resolve(filePath));
        if (documents.get(uri) !== null) {
            return;
        }
        // These caches describe open-buffer text. Once the buffer is closed,
        // disk-backed refreshes must not keep lexical ranges or edit-version
        // counters for documents that no longer have session-local contents.
        documentVersions.delete(uri);
        lexicalRangesByDocument.delete(uri);
        staleSemanticDocumentUris.delete(uri);
    }

    async function invalidateKnownFileRoots(filePath: string): Promise<void> {
        releaseClosedDocumentCaches(filePath);
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

    function markProjectDocumentFactsCurrent(projectRoot: string): void {
        for (const document of documents.list()) {
            if (isDocumentWithinProjectRoot(document, projectRoot)) {
                staleSemanticDocumentUris.delete(document.uri);
            }
        }
    }

    function buildFullProjectIndex(
        document: GmlTextDocument,
        resolvedRoot: string,
        reason: GmlSemanticAnalysisStart["reason"]
    ): Promise<NavigationState | null> {
        const existingBuild = fullProjectBuilds.get(resolvedRoot);
        if (existingBuild !== undefined) {
            return existingBuild;
        }

        const resolvedUri = document.uri;
        const startDocVersion = readDocumentVersion(resolvedUri);
        const buildVersion = readRootVersion(resolvedRoot);
        const priorityFiles = listProjectDocuments(resolvedRoot).map((doc) => doc.filePath);

        abortActiveBuild(resolvedRoot);
        const controller = new AbortController();
        abortControllers.set(resolvedRoot, controller);

        const fullBuild = (async () => {
            const startTime = performance.now();
            const scope = "project";
            const tier = "full";
            try {
                await (pendingCacheWrites.get(resolvedRoot) ?? Promise.resolve());
                const currentDoc = documents.get(document.uri);
                if (currentDoc && currentDoc.version !== document.version) {
                    return null;
                }
                if (readDocumentVersion(resolvedUri) !== startDocVersion) {
                    return null;
                }
                reportSemanticAnalysisStart({
                    affectedFileCount: priorityFiles.length,
                    projectRoot: resolvedRoot,
                    reason,
                    scope,
                    tier
                });
                const workerBoundary = createWorkerBuildBoundary(resolvedRoot, "full", buildVersion);
                const store = getSemanticStore(resolvedRoot);
                const previousManifest =
                    store.readSemanticManifest("full") ?? store.readSemanticManifest("definitions");
                const fullState = await buildSemanticIndexInWorker({
                    projectRoot: resolvedRoot,
                    priorityFiles,
                    openDocuments: listProjectDocuments(resolvedRoot),
                    definitionsOnly: false,
                    readCurrentOpenDocuments: () => listProjectDocuments(resolvedRoot),
                    buildIdentity: {
                        boundary: workerBoundary,
                        isCurrent: (boundary) => isWorkerBuildBoundaryCurrent(resolvedRoot, boundary)
                    },
                    signal: controller.signal,
                    previousManifest
                });
                if (
                    fullState &&
                    !disposed &&
                    readRootVersion(resolvedRoot) === buildVersion &&
                    readDocumentVersion(resolvedUri) === startDocVersion
                ) {
                    const published = await publishNavigationState(resolvedRoot, fullState, buildVersion);
                    if (!published) {
                        reportSemanticAnalysisFinish({
                            affectedFileCount: priorityFiles.length,
                            projectRoot: resolvedRoot,
                            reason,
                            scope,
                            tier,
                            durationMs: Math.round(performance.now() - startTime),
                            status: "aborted"
                        });
                        return null;
                    }
                    const retainedState = releaseBuiltNavigationState(fullState);
                    cachedStates.set(resolvedRoot, retainedState);
                    staleStates.delete(resolvedRoot);
                    markProjectDocumentFactsCurrent(resolvedRoot);
                    onSemanticGenerationPublished?.();

                    reportSemanticAnalysisFinish({
                        affectedFileCount: priorityFiles.length,
                        projectRoot: resolvedRoot,
                        reason,
                        scope,
                        tier,
                        durationMs: Math.round(performance.now() - startTime),
                        status: "success"
                    });
                    return retainedState;
                }
                reportSemanticAnalysisFinish({
                    affectedFileCount: priorityFiles.length,
                    projectRoot: resolvedRoot,
                    reason,
                    scope,
                    tier,
                    durationMs: Math.round(performance.now() - startTime),
                    status: "aborted"
                });
                return null;
            } catch (error) {
                if (Core.isAbortError(error)) {
                    reportSemanticAnalysisFinish({
                        affectedFileCount: priorityFiles.length,
                        projectRoot: resolvedRoot,
                        reason,
                        scope,
                        tier,
                        durationMs: Math.round(performance.now() - startTime),
                        status: "aborted"
                    });
                    return null;
                }
                reportSemanticAnalysisFinish({
                    affectedFileCount: priorityFiles.length,
                    projectRoot: resolvedRoot,
                    reason,
                    scope,
                    tier,
                    durationMs: Math.round(performance.now() - startTime),
                    status: "failed",
                    errorMessage: Core.getErrorMessageOrFallback(error)
                });
                console.error(`Error in GMLoop full project semantic build: ${Core.getErrorMessageOrFallback(error)}`);
                return null;
            }
        })();

        const finalBuild = fullBuild.finally(() => {
            if (abortControllers.get(resolvedRoot) === controller) {
                abortControllers.delete(resolvedRoot);
            }
            if (fullProjectBuilds.get(resolvedRoot) === finalBuild) {
                fullProjectBuilds.delete(resolvedRoot);
            }
        });
        fullProjectBuilds.set(resolvedRoot, finalBuild);
        return finalBuild;
    }

    async function restorePersistentSemanticState(
        document: GmlTextDocument,
        resolvedRoot: string
    ): Promise<NavigationState | null> {
        const store = getSemanticStore(resolvedRoot);
        const activeSlots = store.readActiveSemanticSlots();
        const cachedState = activeSlots.hasMatchingFull
            ? activeSlots.full
            : (activeSlots.definitions ?? activeSlots.full);
        if (cachedState === null) {
            return null;
        }
        const requirements: SemanticSnapshotRequirement = Object.freeze({
            capabilities: new Set<RequiredSemanticCapability>(),
            overlayVersions: new Map<string, number>(),
            projectRevision: "current",
            requireCompleteProjectRelationships: false,
            // A restored generation is only usable for this request when it
            // actually covers the opening document. Older/partial caches can
            // contain symbols while omitting analyzed-file coverage; treating
            // those generations as usable makes every project hover/definition
            // request fail its exact coverage check and silently fall back to
            // built-ins. Force the normal Tier 1 rebuild for that case.
            requiredFiles: new Set([document.filePath]),
            requiredResources: new Set<string>(),
            tier: cachedState.tier
        });
        // Route the acquire-check-release ceremony through
        // `withSemanticLeaseQueries` so the function only talks to its
        // immediate neighbour (`lease`); the helper handles the `null`
        // acquisition result and lease release on every code path.
        return await withSemanticLeaseQueries(store, requirements, new AbortController().signal, (lease) => {
            const state = createRestoredNavigationState(
                resolvedRoot,
                store.readSemanticNavigationProjection(cachedState.tier),
                store.readSemanticManifest(cachedState.tier),
                lease
            );
            cachedStates.set(resolvedRoot, state);
            reconcileRestoredManifest(document, resolvedRoot, cachedState.tier);
            return state;
        });
    }

    async function ensureIndex(document: GmlTextDocument): Promise<NavigationState | null> {
        if (disposed) {
            return null;
        }
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
                currentState = await restorePersistentSemanticState(document, resolvedRoot);
            } catch (error) {
                console.error(`Failed to restore semantic index for ${resolvedRoot}:`, error);
            }
        }

        if (currentState && !currentState.lightweight) {
            return currentState;
        }

        if (currentState && currentState.lightweight) {
            triggerBackgroundFullIndex(
                document,
                "cacheRecovery",
                readRootVersion(resolvedRoot),
                readDocumentVersion(resolvedUri)
            );
            return currentState;
        }
        let inFlight = inFlightBuilds.get(resolvedRoot);
        if (inFlight === undefined) {
            const buildVersion = readRootVersion(resolvedRoot);
            abortActiveBuild(resolvedRoot);
            const controller = new AbortController();
            abortControllers.set(resolvedRoot, controller);

            const buildPromise = (async () => {
                const priorityFiles = listProjectDocuments(resolvedRoot).map((doc) => doc.filePath);
                const startTime = performance.now();
                const reason = "coldStart";
                const tier = "definitions";
                const existingState = cachedStates.get(resolvedRoot) ?? staleStates.get(resolvedRoot);
                const existingRawIndex = existingState?.checkpoint;
                const incrementalBuild = existingState !== undefined && Core.isObjectLike(existingRawIndex);
                const scope = incrementalBuild ? "incremental" : "project";
                try {
                    const innerCurrentDoc = documents.get(document.uri);
                    if (innerCurrentDoc && innerCurrentDoc.version !== document.version) {
                        return null;
                    }
                    if (readDocumentVersion(resolvedUri) !== startDocVersion) {
                        return null;
                    }
                    reportSemanticAnalysisStart({
                        affectedFileCount: priorityFiles.length,
                        projectRoot: resolvedRoot,
                        reason,
                        scope,
                        tier
                    });
                    const workerBoundary = createWorkerBuildBoundary(resolvedRoot, "definitions", buildVersion);
                    const store = getSemanticStore(resolvedRoot);
                    const previousManifest =
                        store.readSemanticManifest("definitions") ?? store.readSemanticManifest("full");
                    const state = await buildSemanticIndexInWorker({
                        projectRoot: resolvedRoot,
                        priorityFiles,
                        openDocuments: listProjectDocuments(resolvedRoot),
                        definitionsOnly: true,
                        readCurrentOpenDocuments: () => listProjectDocuments(resolvedRoot),
                        buildIdentity: {
                            boundary: workerBoundary,
                            isCurrent: (boundary) => isWorkerBuildBoundaryCurrent(resolvedRoot, boundary)
                        },
                        signal: controller.signal,
                        incremental: incrementalBuild
                            ? {
                                  changes: [{ filePath: document.filePath, kind: "modified" }],
                                  existingIndex: Object.fromEntries(Object.entries(existingRawIndex))
                              }
                            : null,
                        previousManifest
                    });
                    if (
                        state &&
                        !disposed &&
                        readRootVersion(resolvedRoot) === buildVersion &&
                        readDocumentVersion(resolvedUri) === startDocVersion
                    ) {
                        const published = await publishNavigationState(resolvedRoot, state, buildVersion);
                        if (!published) {
                            reportSemanticAnalysisFinish({
                                affectedFileCount: priorityFiles.length,
                                projectRoot: resolvedRoot,
                                reason,
                                scope,
                                tier,
                                durationMs: Math.round(performance.now() - startTime),
                                status: "aborted"
                            });
                            return null;
                        }
                        const retainedState = releaseBuiltNavigationState(state);
                        cachedStates.set(resolvedRoot, retainedState);
                        staleStates.delete(resolvedRoot);
                        markProjectDocumentFactsCurrent(resolvedRoot);
                        onSemanticGenerationPublished?.();

                        reportSemanticAnalysisFinish({
                            affectedFileCount: priorityFiles.length,
                            projectRoot: resolvedRoot,
                            reason,
                            scope,
                            tier,
                            durationMs: Math.round(performance.now() - startTime),
                            status: "success"
                        });

                        triggerBackgroundFullIndex(document, reason, buildVersion, startDocVersion);

                        return retainedState;
                    }
                    reportSemanticAnalysisFinish({
                        affectedFileCount: priorityFiles.length,
                        projectRoot: resolvedRoot,
                        reason,
                        scope,
                        tier,
                        durationMs: Math.round(performance.now() - startTime),
                        status: "aborted"
                    });
                    return null;
                } catch (error) {
                    if (Core.isAbortError(error)) {
                        reportSemanticAnalysisFinish({
                            affectedFileCount: priorityFiles.length,
                            projectRoot: resolvedRoot,
                            reason,
                            scope,
                            tier,
                            durationMs: Math.round(performance.now() - startTime),
                            status: "aborted"
                        });
                        return null;
                    }
                    reportSemanticAnalysisFinish({
                        affectedFileCount: priorityFiles.length,
                        projectRoot: resolvedRoot,
                        reason,
                        scope,
                        tier,
                        durationMs: Math.round(performance.now() - startTime),
                        status: "failed",
                        errorMessage: Core.getErrorMessageOrFallback(error)
                    });
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

    async function listIntroducedDefinitionNames(
        resolvedRoot: string,
        document: GmlTextDocument,
        previousState: NavigationState | undefined,
        nextSnapshot: SemanticSnapshot
    ): Promise<ReadonlyArray<string>> {
        const nextNames = Core.uniqueArray(
            nextSnapshot.symbols.filter((symbol) => symbol.definingFilePath !== null).map((symbol) => symbol.name)
        );
        if (previousState === undefined) {
            return nextNames;
        }
        // Funnel the acquire-check-release ceremony through the same
        // `withPinnedSemanticQueries` helper the rest of the index uses so
        // this branch only talks to its immediate neighbour (`queries`); the
        // helper returns `null` when the snapshot cannot be pinned, which is
        // exactly the fallback we already wanted (`nextNames` unchanged).
        const filtered = await withPinnedSemanticQueries(
            getSemanticStore(resolvedRoot),
            previousState,
            document,
            "workspaceSymbols",
            false,
            new AbortController().signal,
            (queries) => nextNames.filter((name) => queries.resolveSymbolId(name) === null)
        );
        return filtered ?? nextNames;
    }

    async function refreshIndex(
        document: GmlTextDocument,
        changes: ReadonlyArray<GmlSemanticFileChange> = [{ filePath: document.filePath, kind: "modified" }]
    ): Promise<NavigationState | null> {
        if (disposed) {
            return null;
        }
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
        await (pendingCacheWrites.get(resolvedRoot) ?? Promise.resolve());
        if (disposed) {
            return null;
        }
        const changesByPath = new Map<string, GmlSemanticFileChange["kind"]>();
        for (const change of changes) {
            changesByPath.set(path.resolve(change.filePath), change.kind);
        }
        const resolvedImpactPaths = await Semantic.resolveSemanticImpactFilePaths(
            resolvedRoot,
            changes.map((change) => change.filePath),
            []
        );
        for (const impactedPath of resolvedImpactPaths) {
            if (!changesByPath.has(impactedPath)) {
                changesByPath.set(impactedPath, "modified");
            }
        }
        const impactedChanges = [...changesByPath]
            .map(([filePath, kind]) => ({ filePath, kind }))
            .toSorted((left, right) => left.filePath.localeCompare(right.filePath));
        const buildVersion = readRootVersion(resolvedRoot);
        const priorityFiles = listProjectDocuments(resolvedRoot).map((doc) => doc.filePath);

        abortActiveBuild(resolvedRoot);
        const controller = new AbortController();
        abortControllers.set(resolvedRoot, controller);

        const inFlight = (async () => {
            let currentActiveBuild: {
                tier: "definitions" | "full";
                startTime: number;
                reason: GmlSemanticAnalysisStart["reason"];
                scope: GmlSemanticAnalysisStart["scope"];
                fileCount: number;
            } | null = null;
            try {
                const innerCurrentDoc = documents.get(document.uri);
                if (innerCurrentDoc && innerCurrentDoc.version !== document.version) {
                    return null;
                }
                if (readDocumentVersion(resolvedUri) !== startDocVersion) {
                    return null;
                }
                const existingState = cachedStates.get(resolvedRoot) ?? staleStates.get(resolvedRoot);
                let fullImpactedFiles = impactedChanges.map((change) => change.filePath);
                const hadFullState = existingState !== undefined && !existingState.lightweight;
                const fullIncrementalIndex = hadFullState
                    ? (existingState.checkpoint ??
                      getSemanticStore(resolvedRoot).readSemanticNavigationProjection("full"))
                    : null;
                const canIncrementFull = Core.isObjectLike(fullIncrementalIndex);
                const definitionsIncrementalIndex =
                    existingState?.checkpoint ??
                    getSemanticStore(resolvedRoot).readSemanticNavigationProjection("definitions");
                const canIncrementDefinitions = Core.isObjectLike(definitionsIncrementalIndex);

                const definitionsReason = "fileChanges";
                const definitionsTier = "definitions";
                const definitionsScope = canIncrementDefinitions ? "incremental" : "project";
                const definitionsStartTime = performance.now();
                currentActiveBuild = {
                    tier: definitionsTier,
                    startTime: definitionsStartTime,
                    reason: definitionsReason,
                    scope: definitionsScope,
                    fileCount: impactedChanges.length
                };
                reportSemanticAnalysisStart({
                    affectedFileCount: impactedChanges.length,
                    projectRoot: resolvedRoot,
                    reason: definitionsReason,
                    scope: definitionsScope,
                    tier: definitionsTier
                });
                const definitionsBoundary = createWorkerBuildBoundary(resolvedRoot, "definitions", buildVersion);
                const store = getSemanticStore(resolvedRoot);
                const definitionsPreviousManifest =
                    store.readSemanticManifest("definitions") ?? store.readSemanticManifest("full");
                const definitionsState = await buildSemanticIndexInWorker({
                    projectRoot: resolvedRoot,
                    priorityFiles,
                    openDocuments: listProjectDocuments(resolvedRoot),
                    definitionsOnly: true,
                    readCurrentOpenDocuments: () => listProjectDocuments(resolvedRoot),
                    buildIdentity: {
                        boundary: definitionsBoundary,
                        isCurrent: (boundary) => isWorkerBuildBoundaryCurrent(resolvedRoot, boundary)
                    },
                    signal: controller.signal,
                    incremental: canIncrementDefinitions
                        ? { changes: impactedChanges, existingIndex: definitionsIncrementalIndex }
                        : null,
                    previousManifest: definitionsPreviousManifest
                });
                if (
                    !definitionsState ||
                    disposed ||
                    readRootVersion(resolvedRoot) !== buildVersion ||
                    readDocumentVersion(resolvedUri) !== startDocVersion
                ) {
                    currentActiveBuild = null;
                    reportSemanticAnalysisFinish({
                        affectedFileCount: impactedChanges.length,
                        projectRoot: resolvedRoot,
                        reason: definitionsReason,
                        scope: definitionsScope,
                        tier: definitionsTier,
                        durationMs: Math.round(performance.now() - definitionsStartTime),
                        status: "aborted"
                    });
                    return null;
                }
                const definitionsSnapshot = definitionsState.snapshot;
                const introducedNames = await listIntroducedDefinitionNames(
                    resolvedRoot,
                    document,
                    existingState,
                    definitionsSnapshot
                );
                const definitionsPublished = await publishNavigationState(
                    resolvedRoot,
                    definitionsState,
                    buildVersion,
                    impactedChanges.map((change) => change.filePath)
                );
                if (!definitionsPublished) {
                    currentActiveBuild = null;
                    reportSemanticAnalysisFinish({
                        affectedFileCount: impactedChanges.length,
                        projectRoot: resolvedRoot,
                        reason: definitionsReason,
                        scope: definitionsScope,
                        tier: definitionsTier,
                        durationMs: Math.round(performance.now() - definitionsStartTime),
                        status: "aborted"
                    });
                    return null;
                }
                const retainedDefinitionsState = releaseBuiltNavigationState(definitionsState);
                cachedStates.set(resolvedRoot, retainedDefinitionsState);
                staleStates.delete(resolvedRoot);
                markProjectDocumentFactsCurrent(resolvedRoot);
                onSemanticGenerationPublished?.();

                currentActiveBuild = null;
                reportSemanticAnalysisFinish({
                    affectedFileCount: impactedChanges.length,
                    projectRoot: resolvedRoot,
                    reason: definitionsReason,
                    scope: definitionsScope,
                    tier: definitionsTier,
                    durationMs: Math.round(performance.now() - definitionsStartTime),
                    status: "success"
                });

                if (!hadFullState) {
                    triggerBackgroundFullIndex(document, "fileChanges", buildVersion, startDocVersion);
                    return retainedDefinitionsState;
                }
                fullImpactedFiles = [
                    ...(await Semantic.resolveSemanticImpactFilePaths(
                        resolvedRoot,
                        impactedChanges.map((change) => change.filePath),
                        introducedNames
                    ))
                ];
                await (pendingCacheWrites.get(resolvedRoot) ?? Promise.resolve());

                const fullReason = canIncrementFull ? "fileChanges" : "cacheRecovery";
                const fullTier = "full";
                const fullScope = canIncrementFull ? "incremental" : "project";
                const fullStartTime = performance.now();
                currentActiveBuild = {
                    tier: fullTier,
                    startTime: fullStartTime,
                    reason: fullReason,
                    scope: fullScope,
                    fileCount: fullImpactedFiles.length
                };
                reportSemanticAnalysisStart({
                    affectedFileCount: fullImpactedFiles.length,
                    projectRoot: resolvedRoot,
                    reason: fullReason,
                    scope: fullScope,
                    tier: fullTier
                });
                const fullBoundary = createWorkerBuildBoundary(resolvedRoot, "full", buildVersion);
                const storeForFull = getSemanticStore(resolvedRoot);
                const fullPreviousManifest =
                    storeForFull.readSemanticManifest("full") ?? storeForFull.readSemanticManifest("definitions");
                const state = await buildSemanticIndexInWorker({
                    projectRoot: resolvedRoot,
                    priorityFiles,
                    openDocuments: listProjectDocuments(resolvedRoot),
                    definitionsOnly: false,
                    readCurrentOpenDocuments: () => listProjectDocuments(resolvedRoot),
                    buildIdentity: {
                        boundary: fullBoundary,
                        isCurrent: (boundary) => isWorkerBuildBoundaryCurrent(resolvedRoot, boundary)
                    },
                    signal: controller.signal,
                    incremental: canIncrementFull
                        ? {
                              changes: fullImpactedFiles.map((filePath) => ({
                                  filePath,
                                  kind: changesByPath.get(filePath) ?? "modified"
                              })),
                              existingIndex: fullIncrementalIndex
                          }
                        : null,
                    previousManifest: fullPreviousManifest
                });
                if (
                    state &&
                    !disposed &&
                    readRootVersion(resolvedRoot) === buildVersion &&
                    readDocumentVersion(resolvedUri) === startDocVersion
                ) {
                    const published = await publishNavigationState(
                        resolvedRoot,
                        state,
                        buildVersion,
                        fullImpactedFiles
                    );
                    if (!published) {
                        currentActiveBuild = null;
                        reportSemanticAnalysisFinish({
                            affectedFileCount: fullImpactedFiles.length,
                            projectRoot: resolvedRoot,
                            reason: fullReason,
                            scope: fullScope,
                            tier: fullTier,
                            durationMs: Math.round(performance.now() - fullStartTime),
                            status: "aborted"
                        });
                        return null;
                    }
                    const retainedState = releaseBuiltNavigationState(state);
                    cachedStates.set(resolvedRoot, retainedState);
                    staleStates.delete(resolvedRoot);
                    markProjectDocumentFactsCurrent(resolvedRoot);
                    onSemanticGenerationPublished?.();

                    currentActiveBuild = null;
                    reportSemanticAnalysisFinish({
                        affectedFileCount: fullImpactedFiles.length,
                        projectRoot: resolvedRoot,
                        reason: fullReason,
                        scope: fullScope,
                        tier: fullTier,
                        durationMs: Math.round(performance.now() - fullStartTime),
                        status: "success"
                    });
                    return retainedState;
                }
                currentActiveBuild = null;
                reportSemanticAnalysisFinish({
                    affectedFileCount: fullImpactedFiles.length,
                    projectRoot: resolvedRoot,
                    reason: fullReason,
                    scope: fullScope,
                    tier: fullTier,
                    durationMs: Math.round(performance.now() - fullStartTime),
                    status: "aborted"
                });
                return null;
            } catch (error) {
                if (currentActiveBuild !== null) {
                    const status = Core.isAbortError(error) ? "aborted" : "failed";
                    reportSemanticAnalysisFinish({
                        affectedFileCount: currentActiveBuild.fileCount,
                        projectRoot: resolvedRoot,
                        reason: currentActiveBuild.reason,
                        scope: currentActiveBuild.scope,
                        tier: currentActiveBuild.tier,
                        durationMs: Math.round(performance.now() - currentActiveBuild.startTime),
                        status,
                        errorMessage: status === "failed" ? Core.getErrorMessageOrFallback(error) : undefined
                    });
                }
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

    function triggerBackgroundFullIndex(
        document: GmlTextDocument,
        reason: GmlSemanticAnalysisStart["reason"],
        scheduledRootVersion: number,
        scheduledDocVersion: number
    ): void {
        setTimeout(() => {
            if (disposed) {
                return;
            }
            const resolvedRootPromise = getProjectRoot(document.filePath);
            if (resolvedRootPromise === null) {
                return;
            }
            resolvedRootPromise
                .then((projectRoot) => {
                    if (projectRoot && !disposed) {
                        const resolvedRoot = path.resolve(projectRoot);
                        if (readRootVersion(resolvedRoot) !== scheduledRootVersion) {
                            return;
                        }
                        if (readDocumentVersion(document.uri) !== scheduledDocVersion) {
                            return;
                        }
                        const currentState = cachedStates.get(resolvedRoot);
                        if (currentState && !currentState.lightweight) {
                            return;
                        }
                        if (fullProjectBuilds.has(resolvedRoot)) {
                            return;
                        }
                        return void buildFullProjectIndex(document, resolvedRoot, reason).catch((error) => {
                            console.error("Background full index build failed:", error);
                        });
                    }
                    return null;
                })
                .catch((error: unknown) => {
                    console.error("Failed to get project root for background indexing:", error);
                    return null;
                });
        }, 1);
    }

    function triggerBackgroundFullIndexForRoot(
        resolvedRoot: string,
        reason: GmlSemanticAnalysisStart["reason"],
        scheduledRootVersion: number
    ): void {
        setTimeout(() => {
            if (disposed) {
                return;
            }
            const resolvedRootPath = path.resolve(resolvedRoot);
            if (readRootVersion(resolvedRootPath) !== scheduledRootVersion) {
                return;
            }
            const currentState = cachedStates.get(resolvedRootPath);
            if (currentState && !currentState.lightweight) {
                return;
            }
            if (fullProjectBuilds.has(resolvedRootPath)) {
                return;
            }
            return void buildFullProjectIndexForRoot(resolvedRootPath, reason).catch((error) => {
                console.error("Background full index build failed for root:", error);
            });
        }, 1);
    }

    function buildFullProjectIndexForRoot(
        resolvedRoot: string,
        reason: GmlSemanticAnalysisStart["reason"]
    ): Promise<NavigationState | null> {
        const existingBuild = fullProjectBuilds.get(resolvedRoot);
        if (existingBuild !== undefined) {
            return existingBuild;
        }

        const buildVersion = readRootVersion(resolvedRoot);

        abortActiveBuild(resolvedRoot);
        const controller = new AbortController();
        abortControllers.set(resolvedRoot, controller);

        const fullBuild = (async () => {
            const startTime = performance.now();
            const scope = "project";
            const tier = "full";
            try {
                await (pendingCacheWrites.get(resolvedRoot) ?? Promise.resolve());
                reportSemanticAnalysisStart({
                    affectedFileCount: 0,
                    projectRoot: resolvedRoot,
                    reason,
                    scope,
                    tier
                });
                const workerBoundary = createWorkerBuildBoundary(resolvedRoot, "full", buildVersion);
                const store = getSemanticStore(resolvedRoot);
                const previousManifest =
                    store.readSemanticManifest("full") ?? store.readSemanticManifest("definitions");
                const fullState = await buildSemanticIndexInWorker({
                    projectRoot: resolvedRoot,
                    priorityFiles: [],
                    openDocuments: listProjectDocuments(resolvedRoot),
                    definitionsOnly: false,
                    readCurrentOpenDocuments: () => listProjectDocuments(resolvedRoot),
                    buildIdentity: {
                        boundary: workerBoundary,
                        isCurrent: (boundary) => isWorkerBuildBoundaryCurrent(resolvedRoot, boundary)
                    },
                    signal: controller.signal,
                    previousManifest
                });
                if (fullState && !disposed && readRootVersion(resolvedRoot) === buildVersion) {
                    const published = await publishNavigationState(resolvedRoot, fullState, buildVersion);
                    if (!published) {
                        reportSemanticAnalysisFinish({
                            affectedFileCount: 0,
                            projectRoot: resolvedRoot,
                            reason,
                            scope,
                            tier,
                            durationMs: Math.round(performance.now() - startTime),
                            status: "aborted"
                        });
                        return null;
                    }
                    const retainedState = releaseBuiltNavigationState(fullState);
                    cachedStates.set(resolvedRoot, retainedState);
                    staleStates.delete(resolvedRoot);
                    markProjectDocumentFactsCurrent(resolvedRoot);
                    onSemanticGenerationPublished?.();

                    reportSemanticAnalysisFinish({
                        affectedFileCount: 0,
                        projectRoot: resolvedRoot,
                        reason,
                        scope,
                        tier,
                        durationMs: Math.round(performance.now() - startTime),
                        status: "success"
                    });
                    return retainedState;
                }
                reportSemanticAnalysisFinish({
                    affectedFileCount: 0,
                    projectRoot: resolvedRoot,
                    reason,
                    scope,
                    tier,
                    durationMs: Math.round(performance.now() - startTime),
                    status: "aborted"
                });
                return null;
            } catch (error) {
                if (Core.isAbortError(error)) {
                    reportSemanticAnalysisFinish({
                        affectedFileCount: 0,
                        projectRoot: resolvedRoot,
                        reason,
                        scope,
                        tier,
                        durationMs: Math.round(performance.now() - startTime),
                        status: "aborted"
                    });
                    return null;
                }
                reportSemanticAnalysisFinish({
                    affectedFileCount: 0,
                    projectRoot: resolvedRoot,
                    reason,
                    scope,
                    tier,
                    durationMs: Math.round(performance.now() - startTime),
                    status: "failed",
                    errorMessage: Core.getErrorMessageOrFallback(error)
                });
                return null;
            }
        })();

        const finalFullBuild = fullBuild.finally(() => {
            if (abortControllers.get(resolvedRoot) === controller) {
                abortControllers.delete(resolvedRoot);
            }
            fullProjectBuilds.delete(resolvedRoot);
        });
        fullProjectBuilds.set(resolvedRoot, finalFullBuild);
        return finalFullBuild;
    }

    async function ensureProjectRootIndex(projectRoot: string): Promise<NavigationState | null> {
        if (disposed) {
            return null;
        }
        const resolvedRoot = path.resolve(projectRoot);
        const buildVersion = readRootVersion(resolvedRoot);
        let currentState = cachedStates.get(resolvedRoot);
        const staleState = staleStates.get(resolvedRoot);

        if (!currentState && !staleState) {
            try {
                const store = getSemanticStore(resolvedRoot);
                const activeSlots = store.readActiveSemanticSlots();
                if (activeSlots.definitions) {
                    const requirements: SemanticSnapshotRequirement = {
                        capabilities: new Set(["definition"]),
                        overlayVersions: new Map(),
                        projectRevision: "current",
                        requireCompleteProjectRelationships: false,
                        requiredFiles: new Set(),
                        requiredResources: new Set(),
                        tier: "definitions"
                    };
                    // Delegate the acquire-check-release ceremony to
                    // `withSemanticLeaseQueries`; the helper's `null` return
                    // matches the original "no lease" branch's `currentState`
                    // left untouched, so no further branching is needed.
                    const restored = await withSemanticLeaseQueries(
                        store,
                        requirements,
                        new AbortController().signal,
                        (lease) => {
                            const state = createRestoredNavigationState(
                                resolvedRoot,
                                store.readSemanticNavigationProjection("definitions"),
                                store.readSemanticManifest("definitions"),
                                lease
                            );
                            cachedStates.set(resolvedRoot, state);
                            return state;
                        }
                    );
                    if (restored !== null) {
                        currentState = restored;
                    }
                }
            } catch (error) {
                console.error(`Failed to restore semantic index for ${resolvedRoot}:`, error);
            }
        }

        if (currentState && !currentState.lightweight) {
            return currentState;
        }

        if (currentState && currentState.lightweight) {
            triggerBackgroundFullIndexForRoot(resolvedRoot, "cacheRecovery", buildVersion);
            return currentState;
        }

        const inFlight = inFlightBuilds.get(resolvedRoot);
        if (inFlight === undefined) {
            const controller = new AbortController();
            abortControllers.set(resolvedRoot, controller);

            const buildPromise = (async () => {
                const startTime = performance.now();
                const reason = "coldStart";
                const tier = "definitions";
                const existingState = cachedStates.get(resolvedRoot) ?? staleStates.get(resolvedRoot);
                const existingRawIndex = existingState?.checkpoint;
                const incrementalBuild = existingState !== undefined && Core.isObjectLike(existingRawIndex);
                const scope = incrementalBuild ? "incremental" : "project";
                try {
                    reportSemanticAnalysisStart({
                        affectedFileCount: 0,
                        projectRoot: resolvedRoot,
                        reason,
                        scope,
                        tier
                    });
                    const workerBoundary = createWorkerBuildBoundary(resolvedRoot, "definitions", buildVersion);
                    const store = getSemanticStore(resolvedRoot);
                    const previousManifest =
                        store.readSemanticManifest("definitions") ?? store.readSemanticManifest("full");
                    const state = await buildSemanticIndexInWorker({
                        projectRoot: resolvedRoot,
                        priorityFiles: [],
                        openDocuments: listProjectDocuments(resolvedRoot),
                        definitionsOnly: true,
                        readCurrentOpenDocuments: () => listProjectDocuments(resolvedRoot),
                        buildIdentity: {
                            boundary: workerBoundary,
                            isCurrent: (boundary) => isWorkerBuildBoundaryCurrent(resolvedRoot, boundary)
                        },
                        signal: controller.signal,
                        previousManifest
                    });
                    if (state && !disposed && readRootVersion(resolvedRoot) === buildVersion) {
                        const published = await publishNavigationState(resolvedRoot, state, buildVersion);
                        if (!published) {
                            reportSemanticAnalysisFinish({
                                affectedFileCount: 0,
                                projectRoot: resolvedRoot,
                                reason,
                                scope,
                                tier,
                                durationMs: Math.round(performance.now() - startTime),
                                status: "aborted"
                            });
                            return null;
                        }
                        const retainedState = releaseBuiltNavigationState(state);
                        cachedStates.set(resolvedRoot, retainedState);
                        staleStates.delete(resolvedRoot);
                        markProjectDocumentFactsCurrent(resolvedRoot);
                        onSemanticGenerationPublished?.();

                        reportSemanticAnalysisFinish({
                            affectedFileCount: 0,
                            projectRoot: resolvedRoot,
                            reason,
                            scope,
                            tier,
                            durationMs: Math.round(performance.now() - startTime),
                            status: "success"
                        });

                        triggerBackgroundFullIndexForRoot(resolvedRoot, reason, buildVersion);
                        return retainedState;
                    }
                    reportSemanticAnalysisFinish({
                        affectedFileCount: 0,
                        projectRoot: resolvedRoot,
                        reason,
                        scope,
                        tier,
                        durationMs: Math.round(performance.now() - startTime),
                        status: "aborted"
                    });
                    return null;
                } catch (error) {
                    if (Core.isAbortError(error)) {
                        reportSemanticAnalysisFinish({
                            affectedFileCount: 0,
                            projectRoot: resolvedRoot,
                            reason,
                            scope,
                            tier,
                            durationMs: Math.round(performance.now() - startTime),
                            status: "aborted"
                        });
                        return null;
                    }
                    reportSemanticAnalysisFinish({
                        affectedFileCount: 0,
                        projectRoot: resolvedRoot,
                        reason,
                        scope,
                        tier,
                        durationMs: Math.round(performance.now() - startTime),
                        status: "failed",
                        errorMessage: Core.getErrorMessageOrFallback(error)
                    });
                    return null;
                }
            })();

            const finalInFlight = buildPromise.finally(() => {
                if (abortControllers.get(resolvedRoot) === controller) {
                    abortControllers.delete(resolvedRoot);
                }
                inFlightBuilds.delete(resolvedRoot);
            });
            inFlightBuilds.set(resolvedRoot, finalInFlight);
            return await finalInFlight;
        }
        return await inFlight;
    }

    async function ensureFullIndex(
        document: GmlTextDocument,
        reason: GmlSemanticAnalysisStart["reason"]
    ): Promise<NavigationState | null> {
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
        const fullState = await buildFullProjectIndex(document, resolvedRoot, reason);
        return fullState && !fullState.lightweight ? fullState : null;
    }

    async function refreshForFileChanges(changes: ReadonlyArray<GmlSemanticFileChange>): Promise<void> {
        if (disposed) {
            return;
        }
        const rootsByFilePath = await Promise.all(
            changes.map(async (change) => ({
                filePath: path.resolve(change.filePath),
                kind: change.kind,
                projectRoot: await getProjectRoot(change.filePath)
            }))
        );
        const changesByProjectRoot = new Map<string, GmlSemanticFileChange[]>();
        for (const entry of rootsByFilePath) {
            if (!entry.projectRoot) {
                continue;
            }
            const resolvedRoot = path.resolve(entry.projectRoot);
            const projectChanges = changesByProjectRoot.get(resolvedRoot) ?? [];
            projectChanges.push({ filePath: entry.filePath, kind: entry.kind });
            changesByProjectRoot.set(resolvedRoot, projectChanges);
        }

        await [...changesByProjectRoot.entries()].reduce(async (previous, [projectRoot, projectChanges]) => {
            await previous;
            const expandedChangesByPath = new Map(
                projectChanges.map((change) => [path.resolve(change.filePath), change.kind] as const)
            );
            const metadataImpactGroups = await Promise.all(
                projectChanges
                    .filter((change) => !isGmlDocumentPath(change.filePath))
                    .map(async (metadataChange) => await findMetadataAffectedFiles(projectRoot, metadataChange))
            );
            for (const metadataImpactGroup of metadataImpactGroups) {
                for (const affectedChange of metadataImpactGroup) {
                    expandedChangesByPath.set(path.resolve(affectedChange.filePath), affectedChange.kind);
                }
            }
            const expandedChanges = [...expandedChangesByPath]
                .map(([filePath, kind]) => ({ filePath, kind }))
                .toSorted((left, right) => left.filePath.localeCompare(right.filePath));
            const anchorDocument = documents
                .list()
                .find((document) => isDocumentWithinProjectRoot(document, projectRoot));
            if (!anchorDocument) {
                await Promise.all(
                    expandedChanges.map(async (change) => await invalidateKnownFileRoots(change.filePath))
                );
                void ensureProjectRootIndex(projectRoot).catch((error) => {
                    console.error("Background re-indexing failed after disk changes:", error);
                });
                return;
            }
            invalidateRoot(projectRoot);
            await refreshIndex(anchorDocument, expandedChanges);
        }, Promise.resolve());
    }

    return {
        async dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            for (const controller of abortControllers.values()) {
                controller.abort();
            }
            abortControllers.clear();
            await Promise.allSettled([...inFlightBuilds.values(), ...fullProjectBuilds.values()]);
            await Promise.allSettled(manifestReconciliations.values());
            await Promise.allSettled(pendingCacheWrites.values());
            await Promise.all([...semanticStores.values()].map(async (store) => await store.close()));
            semanticStores.clear();
            pendingCacheWrites.clear();
            lexicalRangesByDocument.clear();
            manifestReconciliations.clear();
            staleSemanticDocumentUris.clear();
        },
        buildForDocument: ensureIndex,
        readMemoryDiagnostics() {
            return Object.freeze({
                documentVersionEntries: documentVersions.size,
                ignoredLexicalRangeEntries: lexicalRangesByDocument.size
            });
        },
        async indexProjectRoot(projectRoot) {
            await ensureProjectRootIndex(projectRoot);
        },
        refreshForDocument: refreshIndex,
        refreshForFileChanges,
        invalidateForDocument: invalidateKnownDocumentRoots,
        invalidateForFilePath: invalidateKnownFileRoots,
        async refreshForFilePath(filePath) {
            if (!isGmlDocumentPath(filePath)) {
                const projectRoot = await getProjectRoot(filePath);
                if (!projectRoot) {
                    return null;
                }
                const resolvedRoot = path.resolve(projectRoot);
                const anchorDocument = documents
                    .list()
                    .find((document) => isDocumentWithinProjectRoot(document, resolvedRoot));
                if (!anchorDocument) {
                    await invalidateKnownFileRoots(filePath);
                    return null;
                }
                const metadataAffectedFiles = await findMetadataAffectedFiles(resolvedRoot, {
                    filePath,
                    kind: "metadataChanged"
                });
                invalidateRoot(resolvedRoot);
                return await refreshIndex(anchorDocument, metadataAffectedFiles);
            }

            const resolvedPath = path.resolve(filePath);
            const openedDocument = documents
                .list()
                .find((document) => path.resolve(document.filePath) === resolvedPath);
            if (openedDocument) {
                invalidateKnownDocumentRoots(openedDocument);
                return await refreshIndex(openedDocument, [{ filePath: resolvedPath, kind: "modified" }]);
            }

            let sourceText = "";
            let fileExists = true;
            try {
                sourceText = await fs.readFile(resolvedPath, "utf8");
            } catch (error) {
                if (!Core.isErrorWithCode(error, "ENOENT")) {
                    throw error;
                }
                fileExists = false;
            }
            const document = createGmlTextDocument(filePathToUri(resolvedPath), "gml", 0, sourceText);
            await invalidateKnownFileRoots(resolvedPath);
            return await refreshIndex(document, [
                {
                    filePath: resolvedPath,
                    kind: fileExists ? "modified" : "deleted"
                }
            ]);
        },
        preload() {
            try {
                getBuiltInsMetadata();
            } catch {
                // Ignore pre-load errors
            }
        },
        async findDefinition(document, offset, identifierName, signal) {
            const state = await awaitRequestSemanticState(ensureIndex(document), signal);
            if (!state) {
                return null;
            }
            return await withPinnedSemanticQueries(
                getSemanticStore(state.projectRoot),
                state,
                document,
                "definition",
                false,
                signal,
                async (queries) => {
                    const symbolId = findSymbolId(
                        queries,
                        document,
                        offset,
                        identifierName,
                        isIgnoredOffset,
                        !staleSemanticDocumentUris.has(document.uri)
                    );
                    const definition = symbolId ? (queries.findDefinitions(symbolId)[0] ?? null) : null;
                    return definition ? await occurrenceToLspLocation(state.projectRoot, document, definition) : null;
                }
            );
        },
        async findReferences(document, offset, identifierName, includeDefinitions, signal) {
            const state = await awaitRequestSemanticState(ensureFullIndex(document, "references"), signal);
            if (!state) {
                return [];
            }

            return (
                (await withPinnedSemanticQueries(
                    getSemanticStore(state.projectRoot),
                    state,
                    document,
                    "references",
                    true,
                    signal,
                    async (queries) => {
                        const symbolId = findSymbolId(
                            queries,
                            document,
                            offset,
                            identifierName,
                            isIgnoredOffset,
                            !staleSemanticDocumentUris.has(document.uri)
                        );
                        return symbolId
                            ? await Promise.all(
                                  queries
                                      .findReferences(symbolId, includeDefinitions)
                                      .map((occurrence) =>
                                          occurrenceToLspLocation(state.projectRoot, document, occurrence)
                                      )
                              )
                            : [];
                    }
                )) ?? []
            );
        },
        async findDocumentReferences(document, offset, identifierName, signal) {
            const state = await awaitRequestSemanticState(ensureIndex(document), signal);
            if (!state) {
                return [];
            }
            return (
                (await withPinnedSemanticQueries(
                    getSemanticStore(state.projectRoot),
                    state,
                    document,
                    "semanticTokens",
                    false,
                    signal,
                    (queries) => {
                        const symbolId = findSymbolId(
                            queries,
                            document,
                            offset,
                            identifierName,
                            isIgnoredOffset,
                            !staleSemanticDocumentUris.has(document.uri)
                        );
                        return symbolId === null
                            ? []
                            : queries
                                  .listFileOccurrences(document.filePath)
                                  .filter((match) => readSymbolIdFromMatch(match) === symbolId)
                                  .map((match) => ({
                                      uri: document.uri,
                                      range: offsetsToRange(
                                          document,
                                          readOccurrenceStartFromMatch(match),
                                          readOccurrenceEndFromMatch(match)
                                      )
                                  }));
                    }
                )) ?? []
            );
        },
        async hover(document, offset, identifierName, signal) {
            if (isIgnoredOffset(document, offset)) {
                return null;
            }

            const state = await awaitRequestSemanticState(ensureIndex(document), signal);
            if (!state) {
                return null;
            }

            const projectHover = await withPinnedSemanticQueries(
                getSemanticStore(state.projectRoot),
                state,
                document,
                "hover",
                false,
                signal,
                (queries): Hover | null => {
                    const symbolId = findSymbolId(
                        queries,
                        document,
                        offset,
                        identifierName,
                        isIgnoredOffset,
                        !staleSemanticDocumentUris.has(document.uri)
                    );
                    const symbol = symbolId === null ? null : queries.findSymbol(symbolId);
                    if (symbolId === null || symbol === null) {
                        return null;
                    }

                    const definition = queries.findDefinitions(symbolId)[0] ?? null;
                    let definitionInfo = "";
                    if (definition !== null) {
                        const definitionFilePath = resolveOccurrenceFilePath(state.projectRoot, definition.occurrence);
                        const relativePath = path.relative(state.projectRoot, definitionFilePath);
                        definitionInfo = `*defined in [${relativePath}](file://${definitionFilePath})*`;
                    }
                    const docComment = symbol.kind === "parameter" ? "" : formatGmlDocComment(symbol.documentation);
                    let markdownValue = `\`${symbol.displayName}\`\n\n${symbol.kind} - ${symbol.symbolId}`;
                    if (symbol.kind === "parameter") {
                        markdownValue = appendParameterDocumentationMarkdown(markdownValue, symbol);
                    }
                    if (definitionInfo.length > 0) {
                        markdownValue += `\n\n${definitionInfo}`;
                    }
                    if (docComment.length > 0) {
                        markdownValue += `\n\n---\n\n${docComment}`;
                    }
                    const enumOwner = queries.findEnumOwner(symbolId);
                    if (enumOwner !== null) {
                        const members = queries.listEnumMembers(enumOwner.symbolId);
                        if (members.length > 0) {
                            markdownValue += `\n\n\`\`\`gml\nenum ${enumOwner.displayName} {\n${members
                                .map(
                                    (member) => `    ${member.name}${member.value === null ? "" : ` = ${member.value}`}`
                                )
                                .join(",\n")}\n}\n\`\`\``;
                        }
                    }
                    return {
                        contents: { kind: "markdown", value: markdownValue },
                        range: offsetsToRange(document, offset, offset + identifierName.length)
                    };
                }
            );
            if (projectHover !== null) {
                return projectHover;
            }

            const builtIn = getBuiltInsMetadata()[identifierName];
            if (Core.isObjectLike(builtIn)) {
                const info = builtIn as Record<string, unknown>;
                if (info.type === "keyword") {
                    return null;
                }
                const hoverInfo = Core.getBuiltInHoverInfo(identifierName);
                const type = typeof info.type === "string" ? info.type : "unknown";
                const signature = hoverInfo?.signature ?? identifierName;
                let markdown = `\`${signature}\`\n\nBuilt-in ${type}`;
                if (hoverInfo && hoverInfo.description !== null) {
                    markdown += `\n\n${hoverInfo.description}`;
                }
                if (hoverInfo && hoverInfo.parameters.length > 0) {
                    const parameters = hoverInfo.parameters.flatMap((parameter) => {
                        const parameterType = parameter.type === null ? "" : ` (\`${parameter.type}\`)`;
                        const description = parameter.description === null ? "" : ` — ${parameter.description}`;
                        return [`* \`${parameter.name}\`${parameterType}${description}`];
                    });
                    if (parameters.length > 0) {
                        markdown += `\n\n**Parameters:**\n${parameters.join("\n")}`;
                    }
                }
                if (hoverInfo && hoverInfo.returnType !== null) {
                    markdown += `\n\n*Returns* \`${hoverInfo.returnType}\``;
                }
                if (typeof info.manualUrl === "string" && info.manualUrl.length > 0) {
                    markdown += `\n\n[Open GameMaker Manual Page](${info.manualUrl})`;
                }
                return {
                    contents: { kind: "markdown", value: markdown },
                    range: offsetsToRange(document, offset, offset + identifierName.length)
                };
            }

            return null;
        },
        async listDocumentSymbols(document, signal) {
            const state = await awaitRequestSemanticState(ensureIndex(document), signal);
            if (!state) {
                return [];
            }
            return (
                (await withPinnedSemanticQueries(
                    getSemanticStore(state.projectRoot),
                    state,
                    document,
                    "documentSymbols",
                    false,
                    signal,
                    (queries) =>
                        queries.listDocumentSymbols(document.filePath).map((match) => ({
                            name: readSymbolDisplayNameFromMatch(match),
                            kind: gmlSymbolKindToLspSymbolKind(readSymbolKindFromMatch(match)),
                            range: offsetsToRange(
                                document,
                                readOccurrenceStartFromMatch(match),
                                readOccurrenceEndFromMatch(match)
                            ),
                            selectionRange: offsetsToRange(
                                document,
                                readOccurrenceStartFromMatch(match),
                                readOccurrenceEndFromMatch(match)
                            )
                        }))
                )) ?? []
            );
        },
        async listSemanticHighlights(document, signal) {
            if (signal.aborted) {
                return [];
            }
            const builtIns = Object.entries(getBuiltInsMetadata()).flatMap(([name, descriptor]) => {
                if (!Core.isObjectLike(descriptor)) return [];
                const entry = descriptor as Record<string, unknown>;
                if (typeof entry.type !== "string") return [];
                return [{ name, type: entry.type, deprecated: entry.deprecated === true }];
            });
            const cachedState = findCachedStateForDocument(document);
            if (!cachedState) {
                // Baseline lexical/built-in highlighting must not wait for a
                // project parse. The semantic refresh will replace it later.
                void ensureIndex(document);
                return Semantic.collectGmlSemanticHighlights({
                    sourceText: document.sourceText,
                    builtIns,
                    projectIdentifiers: [],
                    occurrences: []
                });
            }
            const state = await awaitRequestSemanticState(ensureIndex(document), signal);
            if (state === null) {
                return Semantic.collectGmlSemanticHighlights({
                    sourceText: document.sourceText,
                    builtIns,
                    projectIdentifiers: [],
                    occurrences: []
                });
            }
            return (
                (await withPinnedSemanticQueries(
                    getSemanticStore(state.projectRoot),
                    state,
                    document,
                    "semanticTokens",
                    false,
                    signal,
                    (queries) => {
                        const identifierNames = Object.freeze(
                            Core.uniqueArray(
                                Parser.tokenizeGmlIdentifierRanges(document.sourceText).map(
                                    (identifier) => identifier.name
                                )
                            )
                        );
                        return Semantic.collectGmlSemanticHighlights({
                            sourceText: document.sourceText,
                            builtIns,
                            projectIdentifiers: queries.findResourcesByNames(identifierNames).map((resource) => ({
                                name: resource.name,
                                kind:
                                    resource.resourceType === "GMObject"
                                        ? "object"
                                        : resource.resourceType === "GMRoom"
                                          ? "room"
                                          : "resource"
                            })),
                            occurrences: staleSemanticDocumentUris.has(document.uri)
                                ? []
                                : queries.listFileOccurrences(document.filePath).map((match) => ({
                                      start: readOccurrenceStartFromMatch(match),
                                      end: readOccurrenceEndFromMatch(match),
                                      kind: Semantic.normalizeGmlSemanticSymbolKind(readSymbolKindFromMatch(match)),
                                      role: readOccurrenceRoleFromMatch(match)
                                  }))
                        });
                    }
                )) ??
                Semantic.collectGmlSemanticHighlights({
                    sourceText: document.sourceText,
                    builtIns,
                    projectIdentifiers: [],
                    occurrences: []
                })
            );
        },
        async searchWorkspaceSymbols(document, query, signal) {
            const state = await awaitRequestSemanticState(ensureIndex(document), signal);
            if (!state) {
                return [];
            }
            return (
                (await withPinnedSemanticQueries(
                    getSemanticStore(state.projectRoot),
                    state,
                    document,
                    "workspaceSymbols",
                    false,
                    signal,
                    async (queries) => {
                        const symbols = await Promise.all(
                            queries
                                .searchWorkspaceSymbols(query, 100)
                                .map((symbol) => symbolToWorkspaceSymbol(state.projectRoot, document, queries, symbol))
                        );
                        return symbols.filter((symbol): symbol is WorkspaceSymbol => symbol !== null);
                    }
                )) ?? []
            );
        },
        async searchCompletions(document, query, signal) {
            const state = await awaitRequestSemanticState(ensureIndex(document), signal);
            const projectSymbols =
                state === null
                    ? []
                    : ((await withPinnedSemanticQueries(
                          getSemanticStore(state.projectRoot),
                          state,
                          document,
                          "completion",
                          false,
                          signal,
                          (queries) =>
                              queries.searchWorkspaceSymbols(query, 50).map((symbol) => ({
                                  label: symbol.displayName,
                                  kind: gmlSymbolKindToCompletionItemKind(symbol.kind)
                              }))
                      )) ?? []);

            if (signal.aborted) {
                return [];
            }

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
        async prepareRename(document, offset, identifierName, signal) {
            const state = await awaitRequestSemanticState(ensureFullIndex(document, "rename"), signal);
            if (!state || isIgnoredOffset(document, offset)) {
                return null;
            }
            return await withPinnedSemanticQueries(
                getSemanticStore(state.projectRoot),
                state,
                document,
                "renameSafety",
                true,
                signal,
                (queries) => {
                    const match = queries.findSymbolAtPosition(document.filePath, offset);
                    if (
                        match === null ||
                        readSymbolNameFromMatch(match) !== identifierName ||
                        !hasExactResolution(match) ||
                        queries.refactor.getRenameSafetyGaps(readSymbolIdFromMatch(match)).length > 0
                    ) {
                        return null;
                    }
                    return offsetsToRange(
                        document,
                        readOccurrenceStartFromMatch(match),
                        readOccurrenceEndFromMatch(match)
                    );
                }
            );
        },
        async planRename(document, offset, identifierName, newName, signal) {
            const state = await awaitRequestSemanticState(ensureFullIndex(document, "rename"), signal);
            if (!state) {
                return null;
            }
            return await withPinnedSemanticQueries(
                getSemanticStore(state.projectRoot),
                state,
                document,
                "renameSafety",
                true,
                signal,
                async (queries) => {
                    const match = queries.findSymbolAtPosition(document.filePath, offset);
                    if (
                        match === null ||
                        readSymbolNameFromMatch(match) !== identifierName ||
                        !hasExactResolution(match)
                    ) {
                        return null;
                    }
                    const symbolId = readSymbolIdFromMatch(match);
                    const refactorEngine = Refactor.createRefactorEngine({
                        semantic: queries.refactor
                    });
                    return await refactorWorkspaceEditToLspWorkspaceEdit(
                        await refactorEngine.planRename({ symbolId, newName })
                    );
                }
            );
        }
    };
}
function appendParameterDocumentationMarkdown(markdownValue: string, parameter: SemanticQuerySymbol): string {
    const documentation = parameter.documentation.parameters.find(
        (documentationParameter) => documentationParameter.name === parameter.name
    );
    if (documentation === undefined) {
        return markdownValue;
    }
    let nextMarkdownValue = markdownValue;
    if (documentation.type !== null) {
        nextMarkdownValue += `\n\nType: \`${documentation.type}\``;
    }
    if (documentation.description !== null) {
        nextMarkdownValue += `\n\nDescription: ${documentation.description}`;
    }
    return nextMarkdownValue;
}
