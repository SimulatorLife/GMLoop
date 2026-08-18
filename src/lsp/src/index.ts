import * as Documents from "./documents/index.js";
import * as Intelligence from "./intelligence/index.js";
import * as Protocol from "./protocol/index.js";
import * as Server from "./server/index.js";

/**
 * Public LSP workspace namespace for the GML language server protocol surface.
 */
export const Lsp = Object.freeze({
    ...Documents,
    ...Intelligence,
    ...Protocol,
    ...Server,
    Documents,
    Intelligence,
    Protocol,
    Server
});

export type {
    GmlLanguageServerConnectionContract,
    LspConnectionClient,
    LspConnectionDisposable,
    LspConnectionInitialization,
    LspConnectionLanguages,
    LspConnectionLifecycle,
    LspConnectionLogger,
    LspConnectionOptionalCapability,
    LspConnectionOutbound,
    LspConnectionWorkspace,
    LspDisplayConnection,
    LspDocumentSyncConnection,
    LspEditingConnection,
    LspNavigationConnection,
    LspPublishDiagnostics,
    LspSendRequest
} from "./server/lsp-connection-contract.js";
export {
    getLspConnectionLogger,
    hasLspConnectionShutdownHandler,
    isGmlLanguageServerConnectionContract,
    trySendSemanticTokenRefreshRequest
} from "./server/lsp-connection-contract.js";
