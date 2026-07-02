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
    FoldingRange,
    FoldingRangeKind,
    InitializeResult,
    Location,
    ProposedFeatures,
    Range,
    SelectionRange,
    TextDocumentSyncKind,
    TextEdit,
    WorkspaceEdit,
    WorkspaceSymbol
} from "vscode-languageserver/node.js";

import {
    createGmlDocumentStore,
    type GmlTextDocument,
    isGmlDocumentPath,
    offsetToPosition,
    positionToOffset
} from "../documents/index.js";
import { createGmlSemanticIndex } from "../intelligence/index.js";
import { eslintMessageToDiagnostic, parserErrorToDiagnostic } from "../protocol/diagnostics.js";
import { createSingleDocumentWorkspaceEdit, createWholeDocumentTextEdit } from "../protocol/edits.js";

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

/**
 * Create the GML language server and attach all protocol handlers to the connection.
 */
export function createGmlLanguageServer(connection = createConnection(ProposedFeatures.all)) {
    const documents = createGmlDocumentStore();
    const semanticIndex = createGmlSemanticIndex(documents);
    const lintRunner = createLintRunner(false);
    const lintFixRunner = createLintRunner(true);
    const pendingDiagnostics = new Map<string, NodeJS.Timeout>();

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
                selectionRangeProvider: true
            }
        })
    );

    connection.onInitialized(() => {
        void connection.client.register(DidChangeConfigurationNotification.type).catch((error: unknown) => {
            connection.console.warn(
                `Unable to register configuration change notifications: ${Core.getErrorMessageOrFallback(error)}`
            );
        });
    });

    connection.onDidOpenTextDocument(({ textDocument }) => {
        runNotificationTask(connection, async () => {
            const document = documents.open(textDocument);
            await publishDiagnostics(document);
            await semanticIndex.buildForDocument(document);
        });
    });

    connection.onDidChangeTextDocument(({ textDocument, contentChanges }) => {
        const document = documents.update(textDocument.uri, textDocument.version, contentChanges);
        if (!document) {
            return;
        }

        const existingTimer = pendingDiagnostics.get(textDocument.uri);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

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
        const existingTimer = pendingDiagnostics.get(textDocument.uri);
        if (existingTimer) {
            clearTimeout(existingTimer);
            pendingDiagnostics.delete(textDocument.uri);
        }

        runNotificationTask(connection, async () => {
            const document = documents.get(textDocument.uri);
            if (document) {
                await semanticIndex.refreshForDocument(document);
                await publishDiagnostics(document);
            }
        });
    });

    connection.onDidCloseTextDocument(({ textDocument }) => {
        const existingTimer = pendingDiagnostics.get(textDocument.uri);
        if (existingTimer) {
            clearTimeout(existingTimer);
            pendingDiagnostics.delete(textDocument.uri);
        }

        documents.close(textDocument.uri);
        void connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
    });

    connection.onDocumentFormatting(async ({ textDocument, options }): Promise<TextEdit[]> => {
        const document = documents.get(textDocument.uri);
        if (!document) {
            return [];
        }

        const formatted = await Format.format(document.sourceText, {
            tabWidth: options?.tabSize,
            useTabs: options?.insertSpaces === false
        });
        return [createWholeDocumentTextEdit(document, formatted)];
    });

    connection.onDefinition(async ({ textDocument, position }): Promise<Location[]> => {
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
    });

    connection.onReferences(async ({ textDocument, position, context }): Promise<Location[]> => {
        const document = documents.get(textDocument.uri);
        if (!document) {
            return [];
        }

        const offset = positionToOffset(document, position);
        const word = readWordAtPosition(document, offset);
        return word ? await semanticIndex.findReferences(document, offset, word.name, context.includeDeclaration) : [];
    });

    connection.onDocumentSymbol(async ({ textDocument }) => {
        const document = documents.get(textDocument.uri);
        return document ? await semanticIndex.listDocumentSymbols(document) : [];
    });

    connection.onWorkspaceSymbol(async ({ query }): Promise<WorkspaceSymbol[]> => {
        const document = documents.list().find((candidate) => isGmlDocumentPath(candidate.filePath));
        return document ? await semanticIndex.searchWorkspaceSymbols(document, query) : [];
    });

    connection.onHover(async ({ textDocument, position }) => {
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
    });

    connection.onPrepareRename(({ textDocument, position }) => {
        const document = documents.get(textDocument.uri);
        if (!document) {
            return null;
        }

        return readWordAtPosition(document, positionToOffset(document, position))?.range ?? null;
    });

    connection.onRenameRequest(async ({ textDocument, position, newName }) => {
        const document = documents.get(textDocument.uri);
        if (!document) {
            return null;
        }

        const word = readWordAtPosition(document, positionToOffset(document, position));
        if (!word) {
            return null;
        }

        return await semanticIndex.planRename(document, positionToOffset(document, position), word.name, newName);
    });

    connection.onCompletion(async ({ textDocument, position }) => {
        const document = documents.get(textDocument.uri);
        if (!document) {
            return [];
        }

        const prefix = readWordAtPosition(document, positionToOffset(document, position))?.name ?? "";
        return await semanticIndex.searchCompletions(document, prefix);
    });

    connection.onCodeAction(async ({ textDocument, context }) => {
        const document = documents.get(textDocument.uri);
        if (!document || context.diagnostics.length === 0) {
            return [];
        }

        const edit = await createLintFixWorkspaceEdit(document, lintFixRunner);
        if (!edit) {
            return [];
        }

        return [
            {
                title: "Apply GMLoop lint fixes",
                kind: CodeActionKind.QuickFix,
                diagnostics: context.diagnostics,
                edit,
                isPreferred: true
            }
        ];
    });

    connection.onDocumentHighlight(async ({ textDocument, position }): Promise<DocumentHighlight[]> => {
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

    connection.onFoldingRanges(({ textDocument }): FoldingRange[] => {
        const document = documents.get(textDocument.uri);
        if (!document) {
            return [];
        }

        const lines = document.sourceText.split(/\r?\n/u);
        const foldingRanges: FoldingRange[] = [];
        const regionStack: number[] = [];
        const braceStack: number[] = [];

        for (const [i, lineText] of lines.entries()) {
            const line = lineText.trim();

            if (line.startsWith("#region")) {
                regionStack.push(i);
            } else if (line.startsWith("#endregion")) {
                const startLine = regionStack.pop();
                if (startLine !== undefined && startLine < i) {
                    foldingRanges.push({
                        startLine,
                        endLine: i,
                        kind: FoldingRangeKind.Region
                    });
                }
            }

            if (line.includes("{")) {
                braceStack.push(i);
            }
            if (line.includes("}")) {
                const startLine = braceStack.pop();
                if (startLine !== undefined && startLine < i - 1) {
                    foldingRanges.push({
                        startLine,
                        endLine: i
                    });
                }
            }
        }
        return foldingRanges;
    });

    connection.onSelectionRanges(({ textDocument, positions }): SelectionRange[] => {
        const document = documents.get(textDocument.uri);
        if (!document) {
            return [];
        }

        let ast: any;
        try {
            ast = Parser.GMLParser.parse(document.sourceText);
        } catch {
            return [];
        }

        return positions.map((pos) => {
            const offset = positionToOffset(document, pos);
            const nodePath: any[] = [];

            const visit = (node: any) => {
                if (!node || typeof node !== "object") {
                    return;
                }
                const start = getOffset(node.start);
                const end = getOffset(node.end);
                if (typeof start === "number" && typeof end === "number" && offset >= start && offset <= end) {
                    nodePath.push(node);
                    for (const key of Object.keys(node)) {
                        if (
                            key === "parent" ||
                            key === "enclosingNode" ||
                            key === "precedingNode" ||
                            key === "followingNode"
                        ) {
                            continue;
                        }
                        const child = node[key];
                        if (Array.isArray(child)) {
                            for (const item of child) {
                                visit(item);
                            }
                        } else if (child && typeof child === "object") {
                            visit(child);
                        }
                    }
                }
            };
            visit(ast);

            let currentRange: SelectionRange | undefined;
            for (const node of nodePath) {
                const start = getOffset(node.start);
                const end = getOffset(node.end);
                if (typeof start === "number" && typeof end === "number") {
                    const startPos = offsetToPosition(document, start);
                    const endPos = offsetToPosition(document, end);
                    currentRange = {
                        range: { start: startPos, end: endPos },
                        parent: currentRange
                    };
                }
            }
            return currentRange ?? { range: { start: pos, end: pos } };
        });
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

function getOffset(nodePos: any): number | undefined {
    if (typeof nodePos === "number") {
        return nodePos;
    }
    if (nodePos && typeof nodePos === "object" && typeof nodePos.index === "number") {
        return nodePos.index;
    }
    return undefined;
}
