import assert from "node:assert/strict";
import { test } from "node:test";

import {
    getLspConnectionLogger,
    type GmlLanguageServerConnectionContract,
    hasLspConnectionShutdownHandler,
    isGmlLanguageServerConnectionContract,
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
