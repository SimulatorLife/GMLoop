export { applyHtml5AudioEmitterSafetyPatch } from "./audio-emitter.js";
export { resolveBuiltinConstants } from "./builtin-constants.js";
export {
    computeErrorAnalytics,
    computeErrorsForPatch,
    computePatchDiagnostics,
    computePatchStats,
    computeRegistryHealthCheck,
    computeRegistrySnapshot
} from "./diagnostics.js";
export { applyHtml5FilenameChangeExtSafetyPatch } from "./filename-change-ext.js";
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
export {
    DEFAULT_MAX_ERROR_HISTORY_SIZE,
    DEFAULT_MAX_PATCH_HISTORY_SIZE,
    DEFAULT_MAX_UNDO_STACK_SIZE
} from "./runtime-defaults.js";
export { createRuntimeWrapper } from "./runtime-wrapper.js";
export { installScriptCallAdapter } from "./script-call-adapter.js";
export { applyHtml5TexturePointerSafetyPatch } from "./texture-pointer.js";
export type {
    ApplyPatchResult,
    BatchApplyResult,
    ClosureCollection,
    ErrorAnalytics,
    EventCollection,
    Patch,
    PatchApplicator,
    PatchDependencyRegistry,
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
    ResourceCollection,
    ResourceLayerUpdate,
    ResourcePatch,
    RuntimeFunction,
    RuntimeMetrics,
    RuntimePatchError,
    RuntimeRegistry,
    RuntimeRegistryOverrides,
    RuntimeRegistrySnapshot,
    RuntimeWrapper,
    RuntimeWrapperOptions,
    RuntimeWrapperState,
    ScriptCollection,
    TrySafeApplyResult,
    VersionedRegistry
} from "./types.js";
