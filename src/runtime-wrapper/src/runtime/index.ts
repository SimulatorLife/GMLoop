export { resolveBuiltinConstants } from "./builtin-constants.js";
export {
    computeErrorAnalytics,
    computeErrorsForPatch,
    computePatchDiagnostics,
    computePatchStats,
    computeRegistryHealthCheck,
    computeRegistrySnapshot
} from "./diagnostics.js";
export type {
    ConsoleOutput,
    GeneralLogger,
    Logger,
    LoggerConfiguration,
    LoggerOptions,
    LogLevel,
    PatchLifecycleLogger,
    RegistryLifecycleLogger,
    WebSocketLogger
} from "./logger.js";
export { createChangeEventLogger, createLogger, LogLevels, parseLogLevel } from "./logger.js";
export { testPatchInShadow } from "./patch-utils.js";
export { createRuntimeWrapper } from "./runtime-wrapper.js";
export { installScriptCallAdapter } from "./script-call-adapter.js";
export type {
    ApplyPatchResult,
    BatchApplyResult,
    ErrorAnalytics,
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
    PatchMetadata,
    PatchStats,
    PatchUndoController,
    RegistryChangeEvent,
    RegistryChangeListener,
    RegistryDiagnostics,
    RegistryHealthCheck,
    RegistryHealthIssue,
    RegistryMutator,
    RegistryReader,
    RuntimeFunction,
    RuntimeMetrics,
    RuntimePatchError,
    RuntimeRegistry,
    RuntimeRegistryOverrides,
    RuntimeRegistrySnapshot,
    RuntimeWrapper,
    RuntimeWrapperOptions,
    RuntimeWrapperState,
    TrySafeApplyResult
} from "./types.js";
