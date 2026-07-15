import { Core } from "@gmloop/core";
import { Format } from "@gmloop/format";
import { Lint } from "@gmloop/lint";
import { Parser } from "@gmloop/parser";
import { ESLint, type Linter } from "eslint";
import {
    CodeActionKind,
    createConnection,
    Diagnostic,
    DidChangeConfigurationNotification,
    DocumentHighlight,
    DocumentHighlightKind,
    FileChangeType,
    InitializeResult,
    Location,
    ProposedFeatures,
    Range,
    SemanticTokensRefreshRequest,
    TextDocumentSyncKind,
    TextEdit,
    WorkspaceEdit,
    WorkspaceSymbol
} from "vscode-languageserver/node.js";

import {
    createGmlDocumentStore,
    type GmlTextDocument,
    isGmlDocumentPath,
    offsetsToRange,
    offsetToPosition,
    positionToOffset,
    uriToFilePath
} from "../documents/index.js";
import {
    createGmlSemanticIndex,
    type GmlSemanticAnalysisFinish,
    type GmlSemanticAnalysisStart,
    type GmlSemanticFileChange
} from "../intelligence/index.js";
import { eslintMessageToDiagnostic, parserErrorToDiagnostic } from "../protocol/diagnostics.js";
import { createSingleDocumentWorkspaceEdit, createWholeDocumentTextEdit } from "../protocol/edits.js";
import {
    createGmlFoldingRanges,
    createGmlSelectionRanges,
    encodeGmlSemanticTokens,
    GML_SEMANTIC_TOKEN_LEGEND
} from "../protocol/index.js";
import { resolveDocumentFormatOptions } from "./document-format-options.js";

/**
 * Stable identity used by LSP clients when they connect to GMLoop's GML server.
 */
export type GmlLanguageServerMetadata = Readonly<{
    name: string;
    version: string;
}>;

export const GML_LANGUAGE_SERVER_METADATA: GmlLanguageServerMetadata = Object.freeze({
    name: "gmloop-lsp",
    version: "0.0.1"
});

type WordRange = Readonly<{
    name: string;
    range: Range;
}>;

type GmlLanguageServerConnection = ReturnType<typeof createConnection>;

function cloneLintConfigForEslint() {
    return Lint.configs.recommended.map((config) => ({
        ...config,
        files: [...config.files],
        plugins: config.plugins ? { ...config.plugins } : undefined,
        rules: { ...config.rules }
    }));
}

function createLintRunner(fix: boolean): ESLint {
    const overrideConfig = cloneLintConfigForEslint() as Linter.Config[];
    return new ESLint({
        overrideConfigFile: true,
        fix,
        overrideConfig
    });
}

function isIdentifierCharacter(character: string): boolean {
    return /[$A-Z_a-z0-9]/u.test(character);
}

function isIdentifierStart(character: string): boolean {
    return /[$A-Z_a-z]/u.test(character);
}

function readWordAtPosition(document: GmlTextDocument, offset: number): WordRange | null {
    const sourceText = document.sourceText;

    let start = offset;
    while (start > 0 && isIdentifierCharacter(sourceText[start - 1] ?? "")) {
        start -= 1;
    }

    let end = offset;
    while (end < sourceText.length && isIdentifierCharacter(sourceText[end] ?? "")) {
        end += 1;
    }

    const name = sourceText.slice(start, end);
    if (name.length === 0 || !isIdentifierStart(name[0] ?? "")) {
        return null;
    }

    return {
        name,
        range: {
            start: offsetToPosition(document, start),
            end: offsetToPosition(document, end)
        }
    };
}

async function collectDiagnostics(document: GmlTextDocument, lintRunner: ESLint): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];

    try {
        Parser.GMLParser.parse(document.sourceText);
    } catch (error) {
        diagnostics.push(parserErrorToDiagnostic(document, error));
    }

    if (!isGmlDocumentPath(document.filePath)) {
        return diagnostics;
    }

    try {
        const [result] = await lintRunner.lintText(document.sourceText, {
            filePath: document.filePath
        });
        diagnostics.push(...result.messages.map((message) => eslintMessageToDiagnostic(message)));
    } catch (error) {
        diagnostics.push(parserErrorToDiagnostic(document, error));
    }

    return diagnostics;
}

async function createLintFixWorkspaceEdit(
    document: GmlTextDocument,
    lintFixRunner: ESLint
): Promise<WorkspaceEdit | null> {
    const [result] = await lintFixRunner.lintText(document.sourceText, {
        filePath: document.filePath
    });
    const fixedText = result.output ?? document.sourceText;

    if (fixedText === document.sourceText) {
        return null;
    }

    return createSingleDocumentWorkspaceEdit(document, [createWholeDocumentTextEdit(document, fixedText)]);
}

function reportAsyncNotificationError(connection: GmlLanguageServerConnection, error: unknown): void {
    connection.console.warn(Core.getErrorMessageOrFallback(error));
}

function runNotificationTask(connection: GmlLanguageServerConnection, task: () => Promise<void>): void {
    void task().catch((error: unknown) => {
        reportAsyncNotificationError(connection, error);
    });
}

function requestSemanticTokenRefresh(connection: GmlLanguageServerConnection): void {
    void connection.sendRequest(SemanticTokensRefreshRequest.type).catch(() => {
        // Clients may not advertise semantic-token refresh support.
    });
}

const isLocalDebug =
    process.env.GMLOOP_LSP_DEBUG === "true" ||
    process.env.GMLOOP_DEBUG === "true" ||
    process.env.NODE_ENV !== "production" ||
    !import.meta.url.includes("node_modules");

function formatSemanticAnalysisStart(event: GmlSemanticAnalysisStart): string {
    const scopeDescription =
        event.scope === "project"
            ? "all project files"
            : `${event.affectedFileCount} affected file${event.affectedFileCount === 1 ? "" : "s"}`;
    return `Semantic analysis started: ${event.tier} tier, ${event.scope} scope (${scopeDescription}), reason ${event.reason}.`;
}

function formatSemanticAnalysisFinish(event: GmlSemanticAnalysisFinish): string {
    const scopeDescription =
        event.scope === "project"
            ? "all project files"
            : `${event.affectedFileCount} affected file${event.affectedFileCount === 1 ? "" : "s"}`;
    const duration = `${event.durationMs}ms`;
    if (event.status === "success") {
        return `Semantic analysis completed: ${event.tier} tier, ${event.scope} scope (${scopeDescription}), took ${duration}.`;
    } else if (event.status === "aborted") {
        return `Semantic analysis aborted: ${event.tier} tier, ${event.scope} scope (${scopeDescription}), took ${duration}.`;
    } else {
        return `Semantic analysis failed: ${event.tier} tier, ${event.scope} scope (${scopeDescription}), took ${duration}. Error: ${event.errorMessage ?? "Unknown error"}`;
    }
}

/**
 * Create the GML language server and attach all protocol handlers to the connection.
 */
export function createGmlLanguageServer(
    connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout)
) {
    const debugLog = (message: string): void => {
        if (isLocalDebug && typeof connection.console?.info === "function") {
            connection.console.info(`[Debug] ${message}`);
        }
    };

    if (isLocalDebug && typeof connection.console?.info === "function") {
        connection.console.info("[Debug] GMLoop LSP server started in local debug mode.");
    }

    const documents = createGmlDocumentStore();
    const semanticIndex = createGmlSemanticIndex(
        documents,
        () => {
            requestSemanticTokenRefresh(connection);
        },
        (event) => {
            if (typeof connection.console?.info === "function") {
                connection.console.info(formatSemanticAnalysisStart(event));
            }
        },
        (event) => {
            if (typeof connection.console?.info === "function") {
                connection.console.info(formatSemanticAnalysisFinish(event));
            }
        }
    );
    const lintRunner = createLintRunner(false);
    const lintFixRunner = createLintRunner(true);
    const pendingDiagnostics = new Map<string, NodeJS.Timeout>();
    const pendingSemanticRefreshes = new Map<string, NodeJS.Timeout>();
    const pendingWatchedFileChanges = new Map<string, GmlSemanticFileChange["kind"]>();
    let watchedFileRefreshTimer: NodeJS.Timeout | null = null;

    if (typeof connection.onShutdown === "function") {
        connection.onShutdown(async () => {
            for (const timeout of pendingDiagnostics.values()) {
                clearTimeout(timeout);
            }
            pendingDiagnostics.clear();
            for (const timeout of pendingSemanticRefreshes.values()) {
                clearTimeout(timeout);
            }
            pendingSemanticRefreshes.clear();
            if (watchedFileRefreshTimer !== null) {
                clearTimeout(watchedFileRefreshTimer);
                watchedFileRefreshTimer = null;
            }
            pendingWatchedFileChanges.clear();
            await semanticIndex.dispose();
        });
    }

    function cancelPendingSemanticRefresh(uri: string): void {
        const timer = pendingSemanticRefreshes.get(uri);
        if (timer) {
            clearTimeout(timer);
            pendingSemanticRefreshes.delete(uri);
        }
    }

    async function publishDiagnostics(document: GmlTextDocument): Promise<void> {
        const diagnostics = await collectDiagnostics(document, lintRunner);
        await connection.sendDiagnostics({ uri: document.uri, diagnostics });
    }

    connection.onInitialize(
        (): InitializeResult => ({
            serverInfo: GML_LANGUAGE_SERVER_METADATA,
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                documentFormattingProvider: true,
                definitionProvider: true,
                referencesProvider: true,
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
                hoverProvider: true,
                renameProvider: {
                    prepareProvider: true
                },
                codeActionProvider: {
                    codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorRewrite]
                },
                completionProvider: {
                    triggerCharacters: [".", "_"]
                },
                documentHighlightProvider: true,
                foldingRangeProvider: true,
                selectionRangeProvider: true,
                semanticTokensProvider: {
                    legend: GML_SEMANTIC_TOKEN_LEGEND,
                    full: true
                }
            }
        })
    );

    connection.onInitialized(() => {
        // Pre-load/warm the cached built-in metadata asynchronously so first hover/completion is instant
        setTimeout(() => {
            try {
                semanticIndex.preload();
            } catch (error) {
                connection.console.warn(
                    `Unable to pre-load bundled identifier metadata: ${Core.getErrorMessageOrFallback(error)}`
                );
            }
        }, 0);

        void connection.client.register(DidChangeConfigurationNotification.type).catch((error: unknown) => {
            connection.console.warn(
                `Unable to register configuration change notifications: ${Core.getErrorMessageOrFallback(error)}`
            );
        });
    });

    connection.onDidOpenTextDocument(({ textDocument }) => {
        debugLog(`Opened document: ${textDocument.uri}`);
        const document = documents.open(textDocument);
        // Start semantic readiness first. Diagnostics are intentionally
        // independent so parser/lint work cannot delay the first hover.
        runNotificationTask(connection, async () => {
            await semanticIndex.buildForDocument(document);
            requestSemanticTokenRefresh(connection);
        });
        runNotificationTask(connection, async () => {
            await publishDiagnostics(document);
        });
    });

    connection.onDidChangeTextDocument(({ textDocument, contentChanges }) => {
        debugLog(`Changed document: ${textDocument.uri} (version ${textDocument.version})`);
        const document = documents.update(textDocument.uri, textDocument.version, contentChanges);
        if (!document) {
            return;
        }

        const existingTimer = pendingDiagnostics.get(textDocument.uri);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        semanticIndex.invalidateForDocument(document);
        const existingSemanticTimer = pendingSemanticRefreshes.get(textDocument.uri);
        if (existingSemanticTimer) {
            clearTimeout(existingSemanticTimer);
        }
        const semanticTimer = setTimeout(() => {
            pendingSemanticRefreshes.delete(textDocument.uri);
            runNotificationTask(connection, async () => {
                const currentDocument = documents.get(textDocument.uri);
                if (currentDocument && currentDocument.version === textDocument.version) {
                    await semanticIndex.refreshForFilePath(currentDocument.filePath);
                    requestSemanticTokenRefresh(connection);
                }
            });
        }, 50);
        pendingSemanticRefreshes.set(textDocument.uri, semanticTimer);

        const timer = setTimeout(() => {
            pendingDiagnostics.delete(textDocument.uri);
            runNotificationTask(connection, async () => {
                const doc = documents.get(textDocument.uri);
                if (doc && doc.version === textDocument.version) {
                    await publishDiagnostics(doc);
                }
            });
        }, 300);
        pendingDiagnostics.set(textDocument.uri, timer);
    });

    connection.onDidSaveTextDocument(({ textDocument }) => {
        debugLog(`Saved document: ${textDocument.uri}`);
        const existingTimer = pendingDiagnostics.get(textDocument.uri);
        if (existingTimer) {
            clearTimeout(existingTimer);
            pendingDiagnostics.delete(textDocument.uri);
        }
        const semanticTimer = pendingSemanticRefreshes.get(textDocument.uri);
        if (semanticTimer) {
            clearTimeout(semanticTimer);
            pendingSemanticRefreshes.delete(textDocument.uri);
        }

        runNotificationTask(connection, async () => {
            const document = documents.get(textDocument.uri);
            if (document) {
                await semanticIndex.refreshForFilePath(document.filePath);
                await publishDiagnostics(document);
                requestSemanticTokenRefresh(connection);
            }
        });
    });

    connection.onDidCloseTextDocument(({ textDocument }) => {
        debugLog(`Closed document: ${textDocument.uri}`);
        const existingTimer = pendingDiagnostics.get(textDocument.uri);
        if (existingTimer) {
            clearTimeout(existingTimer);
            pendingDiagnostics.delete(textDocument.uri);
        }
        const semanticTimer = pendingSemanticRefreshes.get(textDocument.uri);
        if (semanticTimer) {
            clearTimeout(semanticTimer);
            pendingSemanticRefreshes.delete(textDocument.uri);
        }

        const closingDocument = documents.get(textDocument.uri);
        documents.close(textDocument.uri);
        void connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
        if (closingDocument) {
            runNotificationTask(connection, async () => {
                await semanticIndex.refreshForFilePath(closingDocument.filePath);
                requestSemanticTokenRefresh(connection);
            });
        }
    });

    if ("onDidChangeWatchedFiles" in connection) {
        connection.onDidChangeWatchedFiles(({ changes }) => {
            for (const change of changes) {
                const filePath = uriToFilePath(change.uri);
                const kind =
                    change.type === FileChangeType.Created
                        ? "added"
                        : change.type === FileChangeType.Deleted
                          ? "deleted"
                          : isGmlDocumentPath(filePath)
                            ? "modified"
                            : "metadataChanged";
                pendingWatchedFileChanges.set(filePath, kind);
            }
            if (watchedFileRefreshTimer !== null) {
                clearTimeout(watchedFileRefreshTimer);
            }
            watchedFileRefreshTimer = setTimeout(() => {
                watchedFileRefreshTimer = null;
                const changedFiles = [...pendingWatchedFileChanges].map(([filePath, kind]) => ({ filePath, kind }));
                pendingWatchedFileChanges.clear();
                runNotificationTask(connection, async () => {
                    await semanticIndex.refreshForFileChanges(changedFiles);
                    requestSemanticTokenRefresh(connection);
                });
            }, 50);
        });
    }

    connection.onDocumentFormatting(async ({ textDocument, options }): Promise<TextEdit[]> => {
        const document = documents.get(textDocument.uri);
        if (!document) {
            return [];
        }

        const formatOptions = await resolveDocumentFormatOptions(document.filePath, {
            insertSpaces: options.insertSpaces,
            tabSize: options.tabSize
        });
        const formatted = await Format.format(document.sourceText, formatOptions);
        return [createWholeDocumentTextEdit(document, formatted)];
    });

    connection.onDefinition(async ({ textDocument, position }): Promise<Location[]> => {
        cancelPendingSemanticRefresh(textDocument.uri);
        try {
            const document = documents.get(textDocument.uri);
            if (!document) {
                return [];
            }

            const offset = positionToOffset(document, position);
            const word = readWordAtPosition(document, offset);
            if (!word) {
                return [];
            }

            const definition = await semanticIndex.findDefinition(document, offset, word.name);
            return definition ? [definition] : [];
        } catch (error) {
            connection.console.error(`Error in onDefinition: ${Core.getErrorMessageOrFallback(error)}`);
            return [];
        }
    });

    connection.onReferences(async ({ textDocument, position, context }): Promise<Location[]> => {
        cancelPendingSemanticRefresh(textDocument.uri);
        try {
            const document = documents.get(textDocument.uri);
            if (!document) {
                return [];
            }

            const offset = positionToOffset(document, position);
            const word = readWordAtPosition(document, offset);
            return word
                ? await semanticIndex.findReferences(document, offset, word.name, context.includeDeclaration)
                : [];
        } catch (error) {
            connection.console.error(`Error in onReferences: ${Core.getErrorMessageOrFallback(error)}`);
            return [];
        }
    });

    connection.onDocumentSymbol(async ({ textDocument }) => {
        try {
            const document = documents.get(textDocument.uri);
            return document ? await semanticIndex.listDocumentSymbols(document) : [];
        } catch (error) {
            connection.console.error(`Error in onDocumentSymbol: ${Core.getErrorMessageOrFallback(error)}`);
            return [];
        }
    });

    connection.languages.semanticTokens.on(async ({ textDocument }) => {
        cancelPendingSemanticRefresh(textDocument.uri);
        try {
            const document = documents.get(textDocument.uri);
            return document
                ? encodeGmlSemanticTokens(document, await semanticIndex.listSemanticHighlights(document))
                : { data: [] };
        } catch (error) {
            connection.console.error(`Error in semanticTokens.on: ${Core.getErrorMessageOrFallback(error)}`);
            return { data: [] };
        }
    });

    connection.onWorkspaceSymbol(async ({ query }): Promise<WorkspaceSymbol[]> => {
        try {
            const document = documents.list().find((candidate) => isGmlDocumentPath(candidate.filePath));
            return document ? await semanticIndex.searchWorkspaceSymbols(document, query) : [];
        } catch (error) {
            connection.console.error(`Error in onWorkspaceSymbol: ${Core.getErrorMessageOrFallback(error)}`);
            return [];
        }
    });

    connection.onHover(async ({ textDocument, position }) => {
        cancelPendingSemanticRefresh(textDocument.uri);
        try {
            const document = documents.get(textDocument.uri);
            if (!document) {
                return null;
            }

            const offset = positionToOffset(document, position);
            const word = readWordAtPosition(document, offset);
            if (!word) {
                return null;
            }

            return await semanticIndex.hover(document, offset, word.name);
        } catch (error) {
            connection.console.error(`Error in onHover: ${Core.getErrorMessageOrFallback(error)}`);
            return null;
        }
    });

    connection.onPrepareRename(({ textDocument, position }) => {
        cancelPendingSemanticRefresh(textDocument.uri);
        try {
            const document = documents.get(textDocument.uri);
            if (!document) {
                return null;
            }

            return readWordAtPosition(document, positionToOffset(document, position))?.range ?? null;
        } catch (error) {
            connection.console.error(`Error in onPrepareRename: ${Core.getErrorMessageOrFallback(error)}`);
            return null;
        }
    });

    connection.onRenameRequest(async ({ textDocument, position, newName }) => {
        cancelPendingSemanticRefresh(textDocument.uri);
        try {
            const document = documents.get(textDocument.uri);
            if (!document) {
                return null;
            }

            const word = readWordAtPosition(document, positionToOffset(document, position));
            if (!word) {
                return null;
            }

            return await semanticIndex.planRename(document, positionToOffset(document, position), word.name, newName);
        } catch (error) {
            connection.console.error(`Error in onRenameRequest: ${Core.getErrorMessageOrFallback(error)}`);
            return null;
        }
    });

    connection.onCompletion(async ({ textDocument, position }) => {
        cancelPendingSemanticRefresh(textDocument.uri);
        try {
            const document = documents.get(textDocument.uri);
            if (!document) {
                return [];
            }

            const prefix = readWordAtPosition(document, positionToOffset(document, position))?.name ?? "";
            return await semanticIndex.searchCompletions(document, prefix);
        } catch (error) {
            connection.console.error(`Error in onCompletion: ${Core.getErrorMessageOrFallback(error)}`);
            return [];
        }
    });

    connection.onCodeAction(async ({ textDocument, context }) => {
        const document = documents.get(textDocument.uri);
        if (!document || context.diagnostics.length === 0) {
            return [];
        }

        const actions: any[] = [];

        // 1. Generate individual quick fixes for diagnostics that have fix metadata attached
        for (const diagnostic of context.diagnostics) {
            const data = diagnostic.data;
            if (data && data.fix) {
                const range = offsetsToRange(document, data.fix.range[0], data.fix.range[1]);
                const edit = createSingleDocumentWorkspaceEdit(document, [TextEdit.replace(range, data.fix.text)]);

                actions.push({
                    title: `Fix this: ${diagnostic.message}`,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    edit,
                    isPreferred: true
                });
            }
        }

        // 2. Generate global quick fix to apply all fixable rule violations in the document
        const globalEdit = await createLintFixWorkspaceEdit(document, lintFixRunner);
        if (globalEdit) {
            actions.push({
                title: "Apply all GMLoop lint fixes",
                kind: CodeActionKind.QuickFix,
                diagnostics: context.diagnostics,
                edit: globalEdit
            });
        }

        return actions;
    });

    connection.onDocumentHighlight(async ({ textDocument, position }): Promise<DocumentHighlight[]> => {
        cancelPendingSemanticRefresh(textDocument.uri);
        const document = documents.get(textDocument.uri);
        if (!document) {
            return [];
        }

        const offset = positionToOffset(document, position);
        const word = readWordAtPosition(document, offset);
        if (!word) {
            return [];
        }

        const references = await semanticIndex.findReferences(document, offset, word.name, true);
        const localReferences = references.filter((loc) => loc.uri === textDocument.uri);

        return localReferences.map((ref) => ({
            range: ref.range,
            kind: DocumentHighlightKind.Text
        }));
    });

    connection.onFoldingRanges(({ textDocument }) => {
        const document = documents.get(textDocument.uri);
        if (!document) {
            return [];
        }

        return createGmlFoldingRanges(document.sourceText);
    });

    connection.onSelectionRanges(({ textDocument, positions }) => {
        const document = documents.get(textDocument.uri);
        if (!document) {
            return [];
        }

        return createGmlSelectionRanges(document, positions);
    });

    connection.onRequest("gmloop/applyLintFixes", async (params: { uri: string }): Promise<WorkspaceEdit | null> => {
        const document = documents.get(params.uri);
        if (!document) {
            return null;
        }
        return await createLintFixWorkspaceEdit(document, lintFixRunner);
    });

    return Object.freeze({
        connection,
        documents,
        listen() {
            connection.listen();
        }
    });
}

/**
 * Start the GML language server over stdio for editor and LSP-MCP integrations.
 */
export function runGmlLanguageServerStdio(): void {
    const server = createGmlLanguageServer();
    server.listen();
}
