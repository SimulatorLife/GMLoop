import assert from "node:assert/strict";
import { test } from "node:test";

import {
    getLspConnectionLogger,
    type GmlLanguageServerConnectionContract,
    hasLspConnectionShutdownHandler,
    isGmlLanguageServerConnectionContract,
    type LspConnectionInitialization,
    type LspConnectionLifecycle,
    type LspConnectionOutbound,
    type LspDocumentSyncConnection,
    type LspEditingConnection,
    type LspNavigationConnection,
    trySendSemanticTokenRefreshRequest
} from "@gmloop/lsp";

/**
 * Polymorphism guardrails for the GML language server's connection contract.
 *
 * The GML language server accepts any collaborator that satisfies
 * {@link GmlLanguageServerConnectionContract}. The probes below verify the
 * server's discrimination against polymorphic collaborators — e.g. real
 * `Connection` instances, in-process mocks, or cross-realm facades — is
 * structural rather than `instanceof`-based. Tests use the same probe
 * surface the server itself depends on, so they exercise the contract
 * exactly as production code does.
 */

function createContractFixture(): GmlLanguageServerConnectionContract {
    return {
        client: { register: async () => undefined },
        console: { error: () => undefined, info: () => undefined, warn: () => undefined },
        languages: { semanticTokens: { on: () => undefined } },
        listen: () => undefined,
        onCodeAction: () => undefined,
        onCompletion: () => undefined,
        onDefinition: () => undefined,
        onDidChangeTextDocument: () => undefined,
        onDidChangeWatchedFiles: () => undefined,
        onDidCloseTextDocument: () => undefined,
        onDidOpenTextDocument: () => undefined,
        onDidSaveTextDocument: () => undefined,
        onDocumentFormatting: () => undefined,
        onDocumentHighlight: () => undefined,
        onDocumentSymbol: () => undefined,
        onFoldingRanges: () => undefined,
        onHover: () => undefined,
        onInitialize: () => undefined,
        onInitialized: () => undefined,
        onPrepareRename: () => undefined,
        onReferences: () => undefined,
        onRenameRequest: () => undefined,
        onSelectionRanges: () => undefined,
        onShutdown: () => undefined,
        onWorkspaceSymbol: () => undefined,
        sendDiagnostics: () => undefined,
        sendRequest: () => undefined,
        workspace: { getWorkspaceFolders: async () => null }
    };
}

void test("contract type guard accepts a fully populated fixture", () => {
    const fixture = createContractFixture();
    assert.equal(
        isGmlLanguageServerConnectionContract(fixture),
        true,
        "Fully populated fixture must satisfy the contract"
    );
});

void test("contract type guard rejects arbitrary values", () => {
    assert.equal(isGmlLanguageServerConnectionContract(null), false, "Null must fail");
    assert.equal(isGmlLanguageServerConnectionContract(undefined), false, "Undefined must fail");
    assert.equal(isGmlLanguageServerConnectionContract(42), false, "Numbers must fail");
    assert.equal(isGmlLanguageServerConnectionContract("connection"), false, "Strings must fail");
    assert.equal(isGmlLanguageServerConnectionContract({}), false, "Empty objects must fail");
});

void test("contract type guard surfaces missing surfaces explicitly", () => {
    const fixture = createContractFixture();
    const broken = { ...fixture, listen: undefined };
    assert.equal(
        isGmlLanguageServerConnectionContract(broken),
        false,
        "Removing listen() must fail the guard so the contract stays honest"
    );

    const missingDiagnostics = { ...fixture, sendDiagnostics: undefined };
    assert.equal(
        isGmlLanguageServerConnectionContract(missingDiagnostics),
        false,
        "Removing sendDiagnostics must fail the guard"
    );
});

void test("logger probe returns callable methods when connection exposes them", () => {
    const messages: Array<{ channel: "error" | "info" | "warn"; message: string }> = [];
    const fixture = createContractFixture();
    const decorated = {
        ...fixture,
        console: {
            error: (message: string) => messages.push({ channel: "error", message }),
            info: (message: string) => messages.push({ channel: "info", message }),
            warn: (message: string) => messages.push({ channel: "warn", message })
        }
    };

    const logger = getLspConnectionLogger(decorated);
    logger.info("hello");
    logger.warn("careful");
    logger.error("oops");

    assert.deepEqual(messages, [
        { channel: "info", message: "hello" },
        { channel: "warn", message: "careful" },
        { channel: "error", message: "oops" }
    ]);
});

void test("logger probe substitutes no-op methods when console is absent", () => {
    const fixture = createContractFixture();
    const partial = { ...fixture, console: {} };
    const logger = getLspConnectionLogger(partial);

    assert.doesNotThrow(() => logger.info("missing"));
    assert.doesNotThrow(() => logger.warn("missing"));
    assert.doesNotThrow(() => logger.error("missing"));
});

void test("logger probe degrades gracefully for non-object connections", () => {
    const logger = getLspConnectionLogger(undefined);
    assert.doesNotThrow(() => logger.info("noop"));
    assert.doesNotThrow(() => logger.warn("noop"));
    assert.doesNotThrow(() => logger.error("noop"));
});

void test("shutdown capability probe reports presence without `instanceof`", () => {
    const fixture = createContractFixture();
    assert.equal(hasLspConnectionShutdownHandler(fixture), true);

    const partial: Partial<GmlLanguageServerConnectionContract> = { ...fixture, onShutdown: undefined };
    assert.equal(hasLspConnectionShutdownHandler(partial), false);

    assert.equal(hasLspConnectionShutdownHandler(null), false);
    assert.equal(hasLspConnectionShutdownHandler({}), false);
});

void test("semantic token refresh probe routes through sendRequest and returns true", () => {
    let calledWith: unknown = null;
    const fixture = createContractFixture();
    const decorated = {
        ...fixture,
        sendRequest: (method: unknown) => {
            calledWith = method;
            return undefined;
        }
    };

    assert.equal(trySendSemanticTokenRefreshRequest(decorated), true);
    assert.equal(calledWith, "workspace/semanticTokens/refresh");
});

void test("semantic token refresh probe returns false when sendRequest is missing", () => {
    const fixture = createContractFixture();
    const partial = { ...fixture, sendRequest: undefined };
    assert.equal(trySendSemanticTokenRefreshRequest(partial), false);
    assert.equal(trySendSemanticTokenRefreshRequest(null), false);
});

/**
 * Role-interface coverage tests.
 *
 * The composite contract is decomposed into role interfaces so consumers
 * can depend on only the members they actually exercise. These tests
 * verify that:
 *
 * 1. The composite contract still satisfies every role interface
 *    (so existing call sites keep compiling).
 * 2. A slim implementation that only exposes one role's members
 *    satisfies that role — the structural-type contract does not force
 *    mocks to fabricate the full surface.
 * 3. The type guard's role-keyed handler registry agrees with the role
 *    interfaces, so dropping a method from any role role makes the
 *    guard reject the fixture.
 */

void test("composite contract satisfies every role interface", () => {
    const fixture = createContractFixture();
    const lifecycle: LspConnectionLifecycle = fixture;
    const initialization: LspConnectionInitialization = fixture;
    const documentSync: LspDocumentSyncConnection = fixture;
    const navigation: LspNavigationConnection = fixture;
    const editing: LspEditingConnection = fixture;
    const outbound: LspConnectionOutbound = fixture;

    assert.equal(typeof lifecycle.listen, "function", "Lifecycle role must expose listen");
    assert.equal(typeof initialization.onInitialize, "function", "Initialization role must expose onInitialize");
    assert.equal(
        typeof documentSync.onDidChangeTextDocument,
        "function",
        "Document sync role must expose onDidChangeTextDocument"
    );
    assert.equal(typeof navigation.onCompletion, "function", "Navigation role must expose onCompletion");
    assert.equal(typeof editing.onCodeAction, "function", "Editing role must expose onCodeAction");
    assert.equal(typeof outbound.sendDiagnostics, "function", "Outbound role must expose sendDiagnostics");
});

void test("navigation role accepts a navigation-only mock", () => {
    const navigationOnly: LspNavigationConnection = {
        onCompletion: () => undefined,
        onDefinition: () => undefined,
        onDocumentHighlight: () => undefined,
        onDocumentSymbol: () => undefined,
        onHover: () => undefined,
        onPrepareRename: () => undefined,
        onReferences: () => undefined,
        onRenameRequest: () => undefined,
        onWorkspaceSymbol: () => undefined
    };

    assert.equal(typeof navigationOnly.onCompletion, "function");
    assert.equal(typeof navigationOnly.onHover, "function");
});

void test("outbound role accepts an outbound-only mock", () => {
    const outboundOnly: LspConnectionOutbound = {
        sendDiagnostics: () => undefined,
        sendRequest: () => undefined
    };

    assert.equal(typeof outboundOnly.sendDiagnostics, "function");
    assert.equal(typeof outboundOnly.sendRequest, "function");
});

void test("lifecycle role accepts a lifecycle-only mock", () => {
    const lifecycleOnly: LspConnectionLifecycle = {
        listen: () => undefined
    };

    assert.equal(typeof lifecycleOnly.listen, "function");
});

void test("document sync role accepts a document-sync-only mock", () => {
    const documentSyncOnly: LspDocumentSyncConnection = {
        onDidChangeTextDocument: () => undefined,
        onDidChangeWatchedFiles: () => undefined,
        onDidCloseTextDocument: () => undefined,
        onDidOpenTextDocument: () => undefined,
        onDidSaveTextDocument: () => undefined
    };

    assert.equal(typeof documentSyncOnly.onDidOpenTextDocument, "function");
    assert.equal(typeof documentSyncOnly.onDidSaveTextDocument, "function");
});

void test("initialization role accepts an initialization-only mock", () => {
    const initializationOnly: LspConnectionInitialization = {
        onInitialize: () => undefined,
        onInitialized: () => undefined
    };

    assert.equal(typeof initializationOnly.onInitialize, "function");
    assert.equal(typeof initializationOnly.onInitialized, "function");
});

void test("editing role accepts an editing-only mock", () => {
    const editingOnly: LspEditingConnection = {
        onCodeAction: () => undefined,
        onDocumentFormatting: () => undefined
    };

    assert.equal(typeof editingOnly.onCodeAction, "function");
    assert.equal(typeof editingOnly.onDocumentFormatting, "function");
});

void test("type guard rejects fixtures missing a role's handler", () => {
    const base = createContractFixture();
    const missingFromNavigation = { ...base, onHover: undefined };
    assert.equal(
        isGmlLanguageServerConnectionContract(missingFromNavigation),
        false,
        "Removing a navigation role handler must fail the guard"
    );

    const missingFromDocumentSync = { ...base, onDidSaveTextDocument: undefined };
    assert.equal(
        isGmlLanguageServerConnectionContract(missingFromDocumentSync),
        false,
        "Removing a document sync role handler must fail the guard"
    );

    const missingFromEditing = { ...base, onCodeAction: undefined };
    assert.equal(
        isGmlLanguageServerConnectionContract(missingFromEditing),
        false,
        "Removing an editing role handler must fail the guard"
    );

    const missingFromInitialization = { ...base, onInitialize: undefined };
    assert.equal(
        isGmlLanguageServerConnectionContract(missingFromInitialization),
        false,
        "Removing an initialization role handler must fail the guard"
    );

    const missingFromLifecycle = { ...base, listen: undefined };
    assert.equal(
        isGmlLanguageServerConnectionContract(missingFromLifecycle),
        false,
        "Removing a lifecycle role handler must fail the guard"
    );
});
