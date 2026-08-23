import type {
    CancellationToken,
    CodeAction,
    CodeActionParams,
    CompletionItem,
    CompletionParams,
    DidChangeTextDocumentParams,
    DidChangeWatchedFilesParams,
    DidCloseTextDocumentParams,
    DidOpenTextDocumentParams,
    DidSaveTextDocumentParams,
    DocumentFormattingParams,
    DocumentHighlight,
    DocumentHighlightParams,
    DocumentSymbol,
    DocumentSymbolParams,
    FoldingRange,
    FoldingRangeParams,
    Hover,
    InitializeParams,
    InitializeResult,
    Location,
    LocationLink,
    PrepareRenameParams,
    PublishDiagnosticsParams,
    Range,
    RenameParams,
    SelectionRange,
    SelectionRangeParams,
    SemanticTokens,
    SemanticTokensParams,
    TextEdit,
    WorkspaceEdit,
    WorkspaceSymbol,
    WorkspaceSymbolParams
} from "vscode-languageserver/node.js";

/**
 * Logger surface used by the GML language server.
 *
 * Mirrors the subset of the `vscode-languageserver` `Console` interface that
 * the server actually calls (`info`, `warn`, `error`). Exposing it as a
 * named role keeps the connection contract composable: a real connection
 * satisfies it via structural typing, and lightweight mocks can implement
 * only the methods they need without resorting to `any`.
 */
export interface LspConnectionLogger {
    error(message: string): void;
    info(message: string): void;
    warn(message: string): void;
}

/**
 * Optional capabilities exposed by some LSP transports.
 *
 * Real `Connection` objects include these methods, but in-process mocks and
 * alternative transports may omit them. The probes below centralise the
 * capability detection so the server never branches on `typeof x === "function"`
 * at the call site.
 */
export type LspConnectionOptionalCapability = "onShutdown" | "console.error" | "console.info" | "console.warn";

/**
 * Disposable handle returned by connection-level event registrations.
 *
 * Used for cancellation tokens and client capability registration. Mirrors
 * the shape vscode-languageserver attaches to handler subscriptions so
 * consumers that only need to dispose a subscription can rely on the
 * narrower contract without depending on the full `Connection` class.
 */
export interface LspConnectionDisposable {
    dispose(): void;
}

/**
 * LSP `Workspace` operations used by the GML language server.
 *
 * Exposing the role as its own interface lets the server depend on a
 * minimal workspace surface — sufficient for indexing and configuration
 * registration — without forcing mocks to fabricate the full
 * `Workspace` API.
 */
export interface LspConnectionWorkspace {
    getWorkspaceFolders(): Promise<Array<{ uri: string; name: string }> | null>;
}

/**
 * Client-side notification registration surface.
 *
 * The GML language server registers only the configuration-change
 * notification today, but typing the receiver as `LspConnectionClient` keeps
 * future registrations consistent with the contract instead of branching
 * on optional properties.
 */
export interface LspConnectionClient {
    register(method: string | { method: string }): Promise<unknown>;
}

/**
 * Semantic-tokens language surface.
 *
 * The server registers exactly one handler (`semanticTokens.on`), but the
 * `vscode-languageserver` connection exposes this under
 * `connection.languages.semanticTokens` rather than as a top-level method,
 * so the contract mirrors that shape.
 */
export interface LspConnectionLanguages {
    semanticTokens: {
        on(
            handler: (
                params: SemanticTokensParams,
                cancellationToken: CancellationToken
            ) => Promise<SemanticTokens> | SemanticTokens
        ): void;
    };
}

/**
 * Signature for the connection method that publishes diagnostics.
 *
 * The real `Connection` returns `Promise<void>` here; mocks may return a
 * resolved promise or `undefined`. The contract accepts both shapes.
 */
export type LspPublishDiagnostics = (params: PublishDiagnosticsParams) => Promise<void> | void;

/**
 * Signature for the connection method that sends a generic server-to-client
 * request. Used for the `workspace/semanticTokens/refresh` notification
 * which the GML server sends on demand.
 */
export type LspSendRequest = <Result = unknown>(method: string | { method: string }) => Promise<Result> | undefined;

/**
 * Server lifecycle operations on the LSP connection.
 *
 * Provides the listen surface that boots the transports and the optional
 * shutdown hook used by the language server to release caches. Splitting
 * lifecycle out keeps the contract honest: handlers that only run
 * request/notification routing never need to depend on a `listen` or a
 * shutdown registrar, so they cannot accidentally bring the server up or
 * down.
 */
export interface LspConnectionLifecycle {
    listen(): void;
    onShutdown?(handler: () => Promise<void> | void): void;
}

/**
 * LSP initialization handshake surface.
 *
 * Models the `initialize`/`initialized` round trip verbatim. Capabilities
 * negotiators and server-bootstrap helpers should depend on this role
 * alone instead of the full connection contract, since they do not need
 * document sync, navigation, or editing handlers.
 */
export interface LspConnectionInitialization {
    onInitialize(handler: (params: InitializeParams) => InitializeResult): void;
    onInitialized(handler: () => void): void;
}

/**
 * Text document synchronization surface.
 *
 * Groups the `onDid*TextDocument` and `onDidChangeWatchedFiles`
 * registrars. The GML language server funnels both edit events and
 * workspace watcher events through the same invalidation pipeline, so the
 * role bundling reflects the real call wiring rather than an arbitrary
 * structural split.
 */
export interface LspDocumentSyncConnection {
    onDidChangeTextDocument(handler: (params: DidChangeTextDocumentParams) => void): void;
    onDidChangeWatchedFiles(handler: (params: DidChangeWatchedFilesParams) => void): void;
    onDidCloseTextDocument(handler: (params: DidCloseTextDocumentParams) => void): void;
    onDidOpenTextDocument(handler: (params: DidOpenTextDocumentParams) => void): void;
    onDidSaveTextDocument(handler: (params: DidSaveTextDocumentParams) => void): void;
}

/**
 * Read-only language navigation surface.
 *
 * Bundles the LSP request handlers that resolve GML identifiers and
 * project symbols without mutating the workspace. Handlers that drive
 * hover, definitions, references, symbol search, and rename preparation
 * depend on this role alone, so they remain independent of editing,
 * formatting, or display concerns.
 */
export interface LspNavigationConnection {
    onCompletion(
        handler: (params: CompletionParams, cancellationToken: CancellationToken) => Promise<CompletionItem[]>
    ): void;
    onDefinition(
        handler: (
            params: { textDocument: { uri: string }; position: { line: number; character: number } },
            cancellationToken: CancellationToken
        ) => Location[] | LocationLink[] | null | Promise<Location[] | LocationLink[] | null>
    ): void;
    onDocumentHighlight(
        handler: (
            params: DocumentHighlightParams,
            cancellationToken: CancellationToken
        ) => Promise<DocumentHighlight[] | null>
    ): void;
    onDocumentSymbol(
        handler: (params: DocumentSymbolParams, cancellationToken: CancellationToken) => Promise<DocumentSymbol[]>
    ): void;
    onHover(
        handler: (
            params: { textDocument: { uri: string }; position: { line: number; character: number } },
            cancellationToken: CancellationToken
        ) => Hover | null | Promise<Hover | null>
    ): void;
    onPrepareRename(
        handler: (
            params: PrepareRenameParams,
            cancellationToken: CancellationToken
        ) => Promise<Range | { range: Range; placeholder: string } | null>
    ): void;
    onReferences(
        handler: (
            params: {
                textDocument: { uri: string };
                position: { line: number; character: number };
                context: { includeDeclaration: boolean };
            },
            cancellationToken: CancellationToken
        ) => Location[] | null | Promise<Location[] | null>
    ): void;
    onRenameRequest(
        handler: (
            params: RenameParams,
            cancellationToken: CancellationToken
        ) => WorkspaceEdit | null | Promise<WorkspaceEdit | null>
    ): void;
    onWorkspaceSymbol(
        handler: (params: WorkspaceSymbolParams, cancellationToken: CancellationToken) => Promise<WorkspaceSymbol[]>
    ): void;
}

/**
 * Write/language-editing surface.
 *
 * Bundles the LSP request handlers that apply edits to the user's
 * workspace (code actions and document formatting). Callers that only
 * need read-only navigation should depend on
 * {@link LspNavigationConnection} instead so they do not pull in
 * formatter or autofix machinery.
 */
export interface LspEditingConnection {
    onCodeAction(
        handler: (
            params: CodeActionParams,
            cancellationToken: CancellationToken
        ) => CodeAction[] | null | Promise<CodeAction[] | null>
    ): void;
    onDocumentFormatting(
        handler: (params: DocumentFormattingParams) => TextEdit[] | null | Promise<TextEdit[] | null>
    ): void;
}

/**
 * Presentation/display surface.
 *
 * Bundles the LSP request handlers that produce outline-friendly
 * presentation artefacts (folding ranges, selection ranges, semantic
 * tokens). The semantic-tokens handler hangs off the `languages` property
 * to mirror the `vscode-languageserver` connection shape without forcing
 * the rest of the contract to know about it.
 */
export interface LspDisplayConnection {
    onFoldingRanges(
        handler: (params: FoldingRangeParams) => FoldingRange[] | null | Promise<FoldingRange[] | null>
    ): void;
    onSelectionRanges(
        handler: (params: SelectionRangeParams) => SelectionRange[] | null | Promise<SelectionRange[] | null>
    ): void;
    languages: LspConnectionLanguages;
}

/**
 * Server-to-client outbound surface.
 *
 * Wraps the two outbound calls the GML language server makes: publishing
 * diagnostics and dispatching generic server-to-client requests (e.g. the
 * `workspace/semanticTokens/refresh` capability probe). Helpers that only
 * need to talk to the client can depend on this role without dragging in
 * the full request-handler registrar surface.
 */
export interface LspConnectionOutbound {
    sendDiagnostics: LspPublishDiagnostics;
    sendRequest: LspSendRequest;
}

/**
 * Typed contract the GML language server depends on.
 *
 * The real `Connection` returned by `vscode-languageserver`'s
 * `createConnection` factory satisfies this contract via structural typing,
 * so production wiring requires no change. Tests, in-process transports, and
 * any future embedder (CLI integrations, LSP-MCP bridges, harnesses) can
 * substitute a slim mock that implements only the methods they exercise —
 * without resorting to `any` or relying on `typeof x === "function"` runtime
 * checks that vary across realms.
 *
 * The contract composes role interfaces that mirror the LSP functional
 * groups (lifecycle, initialization, document sync, navigation, editing,
 * display, outbound, plus the existing client/workspace/console facets).
 * Helpers that only need a subset of capabilities should depend on the
 * matching role interface directly instead of importing this composite,
 * which is the Interface Segregation Principle in practice.
 *
 * Optional capabilities (`onShutdown`) are typed as `?` and resolved via
 * the capability probes below — keeping the contract honest about which
 * surfaces are required versus tolerated.
 */
export interface GmlLanguageServerConnectionContract
    extends
        LspConnectionLifecycle,
        LspConnectionInitialization,
        LspDocumentSyncConnection,
        LspNavigationConnection,
        LspEditingConnection,
        LspDisplayConnection,
        LspConnectionOutbound {
    client: LspConnectionClient;
    console: Partial<LspConnectionLogger>;
    workspace: LspConnectionWorkspace;
}

const NOOP_LOGGER: LspConnectionLogger = Object.freeze({
    error: () => {
        /* intentional no-op logger when the connection has no console */
    },
    info: () => {
        /* intentional no-op logger when the connection has no console */
    },
    warn: () => {
        /* intentional no-op logger when the connection has no console */
    }
});

/**
 * Resolve the logger surface the GML language server should use for a given
 * connection.
 *
 * Uses a structural capability probe (looking up each method on the
 * connection's `console` field) instead of `typeof x === "function"`
 * discrimination. Every member that is missing falls back to a no-op so
 * call sites never need to gate log output on the runtime type.
 *
 * The probe is intentionally structural rather than based on `instanceof`
 * so any substitute — real `Connection`, in-memory mock, or cross-realm
 * facade — supplies its own implementation while sharing the same call
 * shape. Returning a frozen object means the no-op fallback cannot be
 * mutated by a downstream collaborator.
 *
 * @param connection Candidate LSP connection to introspect.
 * @returns Logger that always implements the three call sites the server
 *   uses; missing methods degrade to no-ops rather than throwing.
 */
export function getLspConnectionLogger(connection: unknown): LspConnectionLogger {
    if (!connection || typeof connection !== "object") {
        return NOOP_LOGGER;
    }

    const candidate = (connection as { console?: unknown }).console;
    if (!candidate || typeof candidate !== "object") {
        return NOOP_LOGGER;
    }

    const consoleRecord = candidate as Record<string, unknown>;
    const info =
        typeof consoleRecord.info === "function"
            ? (consoleRecord.info as (message: string) => void).bind(candidate)
            : undefined;
    const warn =
        typeof consoleRecord.warn === "function"
            ? (consoleRecord.warn as (message: string) => void).bind(candidate)
            : undefined;
    const error =
        typeof consoleRecord.error === "function"
            ? (consoleRecord.error as (message: string) => void).bind(candidate)
            : undefined;

    return Object.freeze({
        error: error ?? ((_message: string) => {}),
        info: info ?? ((_message: string) => {}),
        warn: warn ?? ((_message: string) => {})
    });
}

/**
 * Determine whether the candidate connection exposes an `onShutdown`
 * handler registrar.
 *
 * Replaces the previous `typeof connection.onShutdown === "function"`
 * runtime check with a structural capability probe so the result is
 * computed once at startup and reused across all call sites. The real
 * `vscode-languageserver` `Connection` advertises `onShutdown`, while
 * in-memory mocks and lightweight test transports can omit it without
 * breaking server bootstrap.
 *
 * @param connection Candidate LSP connection to introspect.
 * @returns `true` when the connection implements `onShutdown`.
 */
export function hasLspConnectionShutdownHandler(connection: unknown): boolean {
    if (!connection || typeof connection !== "object") {
        return false;
    }
    return typeof (connection as { onShutdown?: unknown }).onShutdown === "function";
}

/**
 * Send a `workspace/semanticTokens/refresh` request to the client.
 *
 * Encapsulates the previous `connection.sendRequest(SemanticTokensRefreshRequest.type)`
 * call site. The probe ensures the connection exposes a `sendRequest`
 * method before invoking it; clients that do not advertise the semantic
 * tokens refresh capability simply have their request dropped silently,
 * matching the previous behaviour while removing the runtime feature
 * check from each call site.
 *
 * @param connection Candidate LSP connection to dispatch through.
 * @returns `true` when the request was issued; `false` when the connection
 *   does not implement `sendRequest`.
 */
export function trySendSemanticTokenRefreshRequest(connection: unknown): boolean {
    if (!connection || typeof connection !== "object") {
        return false;
    }
    const sendRequest = (connection as { sendRequest?: unknown }).sendRequest;
    if (typeof sendRequest !== "function") {
        return false;
    }

    try {
        void (sendRequest as LspSendRequest).call(connection, "workspace/semanticTokens/refresh");
        return true;
    } catch {
        return false;
    }
}

/**
 * Registry of handler-registrar method names keyed by the role interface
 * they contribute to.
 *
 * Grouping the keys per role (rather than flattening them into a single
 * list) keeps the type guard in lockstep with the
 * {@link GmlLanguageServerConnectionContract} decomposition: each role
 * interface declares exactly the handlers the guard expects, and any new
 * member added to a role must be mirrored here so the guard stays honest.
 *
 * The keys deliberately match the LSP method names on the
 * `vscode-languageserver` `Connection` so real transports satisfy the
 * guard without any structural coercion.
 */
const LSP_CONNECTION_ROLE_HANDLER_KEYS: Readonly<Record<string, ReadonlyArray<string>>> = Object.freeze({
    LspConnectionLifecycle: ["listen"],
    LspConnectionInitialization: ["onInitialize", "onInitialized"],
    LspDocumentSyncConnection: [
        "onDidChangeTextDocument",
        "onDidChangeWatchedFiles",
        "onDidCloseTextDocument",
        "onDidOpenTextDocument",
        "onDidSaveTextDocument"
    ],
    LspNavigationConnection: [
        "onCompletion",
        "onDefinition",
        "onDocumentHighlight",
        "onDocumentSymbol",
        "onHover",
        "onPrepareRename",
        "onReferences",
        "onRenameRequest",
        "onWorkspaceSymbol"
    ],
    LspEditingConnection: ["onCodeAction", "onDocumentFormatting"],
    LspDisplayConnection: ["onFoldingRanges", "onSelectionRanges"]
});

/**
 * Type guard that narrows an arbitrary value to the
 * {@link GmlLanguageServerConnectionContract} the GML language server
 * depends on.
 *
 * Performs a structural check on every member the server actually invokes.
 * Real `vscode-languageserver` `Connection` instances satisfy it via
 * structural typing; tests can implement a slim mock by handing the probe
 * a typed object that exposes the same surface — without resorting to
 * `any` or runtime feature probes scattered across the server module.
 *
 * The probe iterates over
 * {@link LSP_CONNECTION_ROLE_HANDLER_KEYS}, so each role interface
 * contributes its own set of expected method names. Optional capabilities
 * are validated separately (see {@link hasLspConnectionShutdownHandler})
 * when their presence matters.
 *
 * @param value Candidate value to introspect.
 * @returns `true` when {@link value} carries every required surface.
 */
export function isGmlLanguageServerConnectionContract(value: unknown): value is GmlLanguageServerConnectionContract {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (!candidate.console || typeof candidate.console !== "object") {
        return false;
    }
    if (!candidate.client || typeof candidate.client !== "object") {
        return false;
    }
    if (!candidate.workspace || typeof candidate.workspace !== "object") {
        return false;
    }
    if (!candidate.languages || typeof candidate.languages !== "object") {
        return false;
    }
    const languages = candidate.languages as Record<string, unknown>;
    const semanticTokens = languages.semanticTokens as Record<string, unknown> | undefined;
    if (!semanticTokens || typeof semanticTokens.on !== "function") {
        return false;
    }
    if (typeof candidate.sendDiagnostics !== "function") {
        return false;
    }
    if (typeof candidate.sendRequest !== "function") {
        return false;
    }
    for (const handlerKeys of Object.values(LSP_CONNECTION_ROLE_HANDLER_KEYS)) {
        for (const handler of handlerKeys) {
            if (typeof candidate[handler] !== "function") {
                return false;
            }
        }
    }
    return true;
}

/**
 * Stable no-op logger used by the capability probes above.
 *
 * Exposed so embedders that build mock connections can reuse the same
 * default rather than redeclaring the same three no-op methods. The
 * object is frozen to prevent downstream collaborators from mutating the
 * shared fallback, which would silently change log behaviour across
 * every connection in the process.
 */
export const LSP_NOOP_CONNECTION_LOGGER: LspConnectionLogger = NOOP_LOGGER;
