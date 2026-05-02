import * as Runtime from "./runtime/index.js";
import * as Timing from "./timing/index.js";
import * as Clients from "./websocket/index.js";

// Export the RuntimeWrapper namespace as the primary public API
export const RuntimeWrapper = Object.freeze({
    ...Runtime,
    ...Clients,
    Timing
});

export type {
    ApplyPatchResult,
    BatchApplyResult,
    ConsoleOutput,
    ErrorAnalytics,
    GeneralLogger,
    Logger,
    LoggerConfiguration,
    LoggerOptions,
    LogLevel,
    Patch,
    PatchApplicator,
    PatchDiagnostics,
    PatchErrorAnalytics,
    PatchErrorCategory,
    PatchErrorOccurrence,
    PatchErrorSummary,
    PatchHistoryEntry,
    PatchHistoryReader,
    PatchKind,
    PatchLifecycleLogger,
    PatchMetadata,
    PatchStats,
    PatchUndoController,
    RegistryChangeEvent,
    RegistryChangeListener,
    RegistryDiagnostics,
    RegistryHealthCheck,
    RegistryHealthIssue,
    RegistryLifecycleLogger,
    RegistryMutator,
    RegistryReader,
    RuntimeFunction,
    RuntimeMetrics,
    RuntimePatchError,
    RuntimeRegistry,
    RuntimeRegistryOverrides,
    RuntimeRegistrySnapshot,
    RuntimeWrapperOptions,
    RuntimeWrapperState,
    RuntimeWrapper as RuntimeWrapperType,
    TrySafeApplyResult,
    WebSocketLogger
} from "./runtime/index.js";
// Export sub-namespaces for internal use and testing
export * as Runtime from "./runtime/index.js";
export type {
    MessageEventLike,
    PatchQueueMetrics,
    PatchQueueOptions,
    PatchQueueState,
    RuntimeWebSocketClient,
    RuntimeWebSocketConstructor,
    RuntimeWebSocketInstance,
    WebSocketClientOptions,
    WebSocketClientState,
    WebSocketConnectionLifecycle,
    WebSocketConnectionMetrics,
    WebSocketEvent,
    WebSocketInstanceProvider,
    WebSocketMessageSender,
    WebSocketMetricsCollector,
    WebSocketPatchQueueManager
} from "./websocket/index.js";
export * as Clients from "./websocket/index.js";
// The Timing namespace is the canonical public surface for timing utilities.
export * as Timing from "./timing/index.js";
