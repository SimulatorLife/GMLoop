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
 * Server lifecycle contract.
 *
 * Owns the LSP protocol's bootstrap and shutdown methods (`listen`,
 * `onInitialize`, `onInitialized`, `onShutdown`). Splitting the lifecycle out
 * of the broader connection contract keeps collaborators that only run the
 * bootstrap (for example start-up probes or tests that simulate the initial
 * handshake) from being coupled to every handler registration the server
 * later performs.
 *
 * `onShutdown` is optional because some in-process transports and slim
 * test doubles intentionally omit it. The capability probe below
 * ({@link hasLspConnectionShutdownHandler}) centralises that detection
 * so call sites never branch on `typeof connection.onShutdown === "function"`.
 */
export interface LspLifecycleContract {
    listen(): void;
    onInitialize(handler: (params: InitializeParams) => InitializeResult): void;
    onInitialized(handler: () => void): void;
    onShutdown?(handler: () => Promise<void> | void): void;
}

/**
 * Document synchronization contract.
 *
 * Owns the `textDocument/did*` and `workspace/didChangeWatchedFiles`
 * registrations. Pulling these into a dedicated role keeps document-sync
 * handlers (open, change, save, close, watched-file change) free of the
 * hover, completion, rename, and formatting concerns that share the same
 * physical connection object.
 */
export interface LspDocumentSyncContract {
    onDidChangeTextDocument(handler: (params: DidChangeTextDocumentParams) => void): void;
    onDidChangeWatchedFiles(handler: (params: DidChangeWatchedFilesParams) => void): void;
    onDidCloseTextDocument(handler: (params: DidCloseTextDocumentParams) => void): void;
    onDidOpenTextDocument(handler: (params: DidOpenTextDocumentParams) => void): void;
    onDidSaveTextDocument(handler: (params: DidSaveTextDocumentParams) => void): void;
}

/**
 * Document-feature contract.
 *
 * Owns the handlers that operate on a single document at a time and do not
 * need cross-file context: formatting, document highlights, document
 * symbols, folding ranges, and selection ranges. Splitting these out lets
 * a formatter-only mock satisfy this interface without having to fabricate
 * the rename, completion, or hover handlers it will never invoke.
 */
export interface LspDocumentFeatureContract {
    onDocumentFormatting(
        handler: (params: DocumentFormattingParams) => TextEdit[] | null | Promise<TextEdit[] | null>
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
    onFoldingRanges(
        handler: (params: FoldingRangeParams) => FoldingRange[] | null | Promise<FoldingRange[] | null>
    ): void;
    onSelectionRanges(
        handler: (params: SelectionRangeParams) => SelectionRange[] | null | Promise<SelectionRange[] | null>
    ): void;
}

/**
 * Language-feature contract.
 *
 * Owns the handlers that resolve an identifier at a position (definition,
 * references, hover, prepare-rename, rename-request) plus completion and
 * code-action. Splitting these out lets a hover-only or rename-only mock
 * satisfy this interface without dragging in formatting, document-symbol,
 * or workspace-symbol collaborators.
 */
export interface LspLanguageFeatureContract {
    onCodeAction(
        handler: (
            params: CodeActionParams,
            cancellationToken: CancellationToken
        ) => CodeAction[] | null | Promise<CodeAction[] | null>
    ): void;
    onCompletion(
        handler: (params: CompletionParams, cancellationToken: CancellationToken) => Promise<CompletionItem[]>
    ): void;
    onDefinition(
        handler: (
            params: { textDocument: { uri: string }; position: { line: number; character: number } },
            cancellationToken: CancellationToken
        ) => Location[] | LocationLink[] | null | Promise<Location[] | LocationLink[] | null>
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
}

/**
 * Workspace-feature contract.
 *
 * Owns the handlers that operate across the entire workspace rather than a
 * single document. Today only `onWorkspaceSymbol` belongs here, but the
 * dedicated role keeps future workspace-scoped handlers (for example
 * `workspace/executeCommand`) from re-widening the connection contract.
 */
export interface LspWorkspaceFeatureContract {
    onWorkspaceSymbol(
        handler: (params: WorkspaceSymbolParams, cancellationToken: CancellationToken) => Promise<WorkspaceSymbol[]>
    ): void;
}

/**
 * Outbound notification / request contract.
 *
 * Owns the server-to-client message channels (`sendDiagnostics` for
 * publishing diagnostics and `sendRequest` for protocol-level refresh
 * requests such as `workspace/semanticTokens/refresh`). Splitting these
 * out keeps callers that only need to publish diagnostics — for example
 * a test harness that exercises lint publishing without any
 * semantic-tokens machinery — from depending on the request surface.
 */
export interface LspOutboundNotifications {
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
 * The contract deliberately lists every method and property the server
 * currently invokes. Each member has a typed signature so substitute
 * implementations can be validated at compile time. Optional capabilities
 * (the console logger and `onShutdown`) are typed as `?` and resolved via
 * the capability probes below — keeping the contract honest about which
 * surfaces are required versus tolerated.
 *
 * Following the Interface Segregation Principle, this contract composes the
 * role-focused surfaces above so consumers that genuinely need every
 * capability (the production server, integration tests that exercise the
 * full LSP protocol) can declare a single dependency. Consumers that only
 * need one slice — for example a hover-only mock or a formatter-only
 * harness — should depend on the matching role interface directly:
 * {@link LspLifecycleContract}, {@link LspDocumentSyncContract},
 * {@link LspDocumentFeatureContract}, {@link LspLanguageFeatureContract},
 * {@link LspWorkspaceFeatureContract}, or {@link LspOutboundNotifications}.
 */
export interface GmlLanguageServerConnectionContract
    extends
        LspLifecycleContract,
        LspDocumentSyncContract,
        LspDocumentFeatureContract,
        LspLanguageFeatureContract,
        LspWorkspaceFeatureContract,
        LspOutboundNotifications {
    client: LspConnectionClient;
    console: Partial<LspConnectionLogger>;
    languages: LspConnectionLanguages;
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
 * Ordered list of handler keys that make up each role contract.
 *
 * Centralising the keys keeps the per-role type guards below in sync with
 * the role interfaces they verify. Adding a handler to a role interface
 * is a one-step change: extend the role, append the key to the matching
 * list here, and the composite guard picks the addition up automatically
 * because it walks each role.
 */
const LIFECYCLE_HANDLER_KEYS = ["listen", "onInitialize", "onInitialized"] as const;
const DOCUMENT_SYNC_HANDLER_KEYS = [
    "onDidOpenTextDocument",
    "onDidChangeTextDocument",
    "onDidSaveTextDocument",
    "onDidCloseTextDocument",
    "onDidChangeWatchedFiles"
] as const;
const DOCUMENT_FEATURE_HANDLER_KEYS = [
    "onDocumentFormatting",
    "onDocumentHighlight",
    "onDocumentSymbol",
    "onFoldingRanges",
    "onSelectionRanges"
] as const;
const LANGUAGE_FEATURE_HANDLER_KEYS = [
    "onCodeAction",
    "onCompletion",
    "onDefinition",
    "onHover",
    "onPrepareRename",
    "onReferences",
    "onRenameRequest"
] as const;
const WORKSPACE_FEATURE_HANDLER_KEYS = ["onWorkspaceSymbol"] as const;

/**
 * Return whether a candidate value implements the
 * {@link LspLifecycleContract} role.
 *
 * @param value Candidate value to introspect.
 * @returns `true` when {@link value} exposes every required handler.
 */
export function isLspLifecycleContract(value: unknown): value is LspLifecycleContract {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return LIFECYCLE_HANDLER_KEYS.every((key) => typeof candidate[key] === "function");
}

/**
 * Return whether a candidate value implements the
 * {@link LspDocumentSyncContract} role.
 *
 * @param value Candidate value to introspect.
 * @returns `true` when {@link value} exposes every required handler.
 */
export function isLspDocumentSyncContract(value: unknown): value is LspDocumentSyncContract {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return DOCUMENT_SYNC_HANDLER_KEYS.every((key) => typeof candidate[key] === "function");
}

/**
 * Return whether a candidate value implements the
 * {@link LspDocumentFeatureContract} role.
 *
 * @param value Candidate value to introspect.
 * @returns `true` when {@link value} exposes every required handler.
 */
export function isLspDocumentFeatureContract(value: unknown): value is LspDocumentFeatureContract {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return DOCUMENT_FEATURE_HANDLER_KEYS.every((key) => typeof candidate[key] === "function");
}

/**
 * Return whether a candidate value implements the
 * {@link LspLanguageFeatureContract} role.
 *
 * @param value Candidate value to introspect.
 * @returns `true` when {@link value} exposes every required handler.
 */
export function isLspLanguageFeatureContract(value: unknown): value is LspLanguageFeatureContract {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return LANGUAGE_FEATURE_HANDLER_KEYS.every((key) => typeof candidate[key] === "function");
}

/**
 * Return whether a candidate value implements the
 * {@link LspWorkspaceFeatureContract} role.
 *
 * @param value Candidate value to introspect.
 * @returns `true` when {@link value} exposes every required handler.
 */
export function isLspWorkspaceFeatureContract(value: unknown): value is LspWorkspaceFeatureContract {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return WORKSPACE_FEATURE_HANDLER_KEYS.every((key) => typeof candidate[key] === "function");
}

/**
 * Return whether a candidate value implements the
 * {@link LspOutboundNotifications} role.
 *
 * @param value Candidate value to introspect.
 * @returns `true` when {@link value} exposes `sendDiagnostics` and
 *   `sendRequest` channels.
 */
export function isLspOutboundNotifications(value: unknown): value is LspOutboundNotifications {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return typeof candidate.sendDiagnostics === "function" && typeof candidate.sendRequest === "function";
}

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
 * The composite check delegates to each per-role guard above so a single
 * missing handler fails with the same verdict as the role that owns it.
 *
 * @param value Candidate value to introspect.
 * @returns `true` when {@link value} carries every required surface.
 */
export function isGmlLanguageServerConnectionContract(value: unknown): value is GmlLanguageServerConnectionContract {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (!isLspLifecycleContract(candidate)) {
        return false;
    }
    if (!isLspDocumentSyncContract(candidate)) {
        return false;
    }
    if (!isLspDocumentFeatureContract(candidate)) {
        return false;
    }
    if (!isLspLanguageFeatureContract(candidate)) {
        return false;
    }
    if (!isLspWorkspaceFeatureContract(candidate)) {
        return false;
    }
    if (!isLspOutboundNotifications(candidate)) {
        return false;
    }
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
