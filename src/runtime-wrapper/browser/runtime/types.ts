export type RuntimeFunction = (...args: Array<unknown>) => unknown;

export type PatchKind = "script" | "event" | "closure";

export interface PatchMetadata {
    sourcePath?: string;
    sourceHash?: string;
    timestamp?: number;
    dependencies?: Array<string>;
}

export interface BasePatch {
    kind: PatchKind;
    id: string;
    metadata?: PatchMetadata;
}

export interface ScriptPatch extends BasePatch {
    kind: "script";
    js_body: string;
    /**
     * Optional override for the name used to look up and update this script
     * in the GameMaker HTML5 runtime's internal tables (e.g. `JSON_game.Scripts`
     * and the `gml_Script_*` / `gml_GlobalScript_*` globals). When absent, the
     * patch `id` is used as-is. The transpiler sets this when the canonical GML
     * script URI (`gml/script/<name>`) differs from the GameMaker-generated
     * function name.
     */
    runtimeId?: string;
}

export interface EventPatch extends BasePatch {
    kind: "event";
    js_body: string;
    this_name?: string;
    js_args?: string;
}

export interface ClosurePatch extends BasePatch {
    kind: "closure";
    js_body: string;
}

export type Patch = ScriptPatch | EventPatch | ClosurePatch;

export interface RuntimeRegistry {
    version: number;
    scripts: Record<string, RuntimeFunction>;
    events: Record<string, RuntimeFunction>;
    closures: Record<string, RuntimeFunction>;
}

export interface RuntimeRegistryOverrides {
    version?: number;
    scripts?: Record<string, RuntimeFunction>;
    events?: Record<string, RuntimeFunction>;
    closures?: Record<string, RuntimeFunction>;
}

export interface PatchSnapshot {
    kind: PatchKind;
    id: string;
    version: number;
    previous: RuntimeFunction | null;
}

export type PatchAction = "apply" | "undo" | "rollback";

export interface PatchHistoryEntry {
    patch: Pick<BasePatch, "kind" | "id"> & { metadata?: PatchMetadata };
    version: number;
    timestamp: number;
    action: PatchAction;
    error?: string;
    rolledBack?: boolean;
    durationMs?: number;
}

export type RegistryChangeEvent =
    | { type: "patch-applied"; patch: Patch; version: number }
    | {
          type: "patch-rolled-back";
          patch: Patch;
          version: number;
          error: string;
      }
    | {
          type: "patch-undone";
          patch: Pick<BasePatch, "kind" | "id">;
          version: number;
      }
    | { type: "registry-cleared"; version: number };

export type RegistryChangeListener = (event: RegistryChangeEvent) => void;

export interface RuntimeWrapperOptions {
    registry?: RuntimeRegistryOverrides;
    onPatchApplied?: (patch: Patch, version: number) => void;
    validateBeforeApply?: boolean;
    onChange?: RegistryChangeListener;
    maxUndoStackSize?: number;
    maxErrorHistorySize?: number;
}

export interface RuntimeWrapperState {
    registry: RuntimeRegistry;
    undoStack: Array<PatchSnapshot>;
    patchHistory: Array<PatchHistoryEntry>;
    errorHistory: Array<PatchErrorOccurrence>;
    options: {
        validateBeforeApply: boolean;
        maxUndoStackSize: number;
        maxErrorHistorySize: number;
    };
}

export interface PatchStats {
    totalPatches: number;
    appliedPatches: number;
    undonePatches: number;
    rolledBackPatches: number;
    scriptPatches: number;
    eventPatches: number;
    closurePatches: number;
    uniqueIds: number;
    averagePatchDurationMs?: number;
    totalDurationMs?: number;
    fastestPatchMs?: number;
    slowestPatchMs?: number;
    p50DurationMs?: number;
    p90DurationMs?: number;
    p99DurationMs?: number;
}

export interface PatchDiagnostics {
    id: string;
    kind: PatchKind;
    applicationCount: number;
    firstAppliedAt: number | null;
    lastAppliedAt: number | null;
    currentlyApplied: boolean;
    undoCount: number;
    rollbackCount: number;
    averageDurationMs: number | null;
    sourcePath: string | null;
    sourceHash: string | null;
    dependencies: Array<string>;
    historyEntries: Array<PatchHistoryEntry>;
}

export interface RuntimeRegistrySnapshot {
    version: number;
    scriptCount: number;
    eventCount: number;
    closureCount: number;
    scripts: Array<string>;
    events: Array<string>;
    closures: Array<string>;
}

export interface TrySafeApplyResult {
    success: boolean;
    version?: number;
    error?: string;
    message?: string;
    rolledBack?: boolean;
}

export interface BatchApplyResult {
    success: boolean;
    version?: number;
    appliedCount: number;
    failedIndex?: number;
    error?: string;
    message?: string;
    rolledBack: boolean;
}

export type ApplyPatchResult = { success: true; version: number };

export type RuntimePatchError = Error & { patch?: Patch; rolledBack?: boolean };

export interface ShadowTestResult {
    valid: boolean;
    error?: string;
}

/**
 * Patch application operations.
 *
 * Provides the core capability to apply runtime patches without coupling
 * to history tracking, registry queries, or statistics gathering.
 * Consumers that only need to apply patches (e.g., WebSocket clients)
 * should depend on this interface rather than the full RuntimeWrapper.
 */
export interface PatchApplicator {
    applyPatch(patch: unknown): ApplyPatchResult;
    applyPatchBatch(patches: Array<unknown>): BatchApplyResult;
    trySafeApply(patch: unknown, onValidate?: (patch: Patch) => boolean | void): TrySafeApplyResult;
}

/**
 * Undo stack control.
 *
 * Provides undo execution and stack sizing without coupling to
 * history query operations.
 */
export interface PatchUndoController {
    undo(): { success: boolean; version?: number; message?: string };
    getUndoStackSize(): number;
}

/**
 * Patch history inspection.
 *
 * Provides read-only access to patch history data without coupling
 * to undo execution or patch application.
 */
export interface PatchHistoryReader {
    getPatchHistory(): Array<PatchHistoryEntry>;
    getPatchById(id: string): Array<PatchHistoryEntry>;
    getPatchesByKind(kind: PatchKind): Array<PatchHistoryEntry>;
}

/**
 * Read-only registry access.
 *
 * Provides query operations for scripts, events, and closures in the
 * runtime registry without coupling to mutation or patch application.
 */
export interface RegistryReader {
    getScript(id: string): RuntimeFunction | undefined;
    getEvent(id: string): RuntimeFunction | undefined;
    getClosure(id: string): RuntimeFunction | undefined;
    hasScript(id: string): boolean;
    hasEvent(id: string): boolean;
    hasClosure(id: string): boolean;
}

/**
 * Registry mutation operations.
 *
 * Provides the ability to clear the runtime registry without coupling
 * to patch application or query operations.
 */
export interface RegistryMutator {
    clearRegistry(): void;
}

export interface RegistryHealthCheck {
    healthy: boolean;
    version: number;
    issues: Array<RegistryHealthIssue>;
}

export interface RegistryHealthIssue {
    severity: "warning" | "error";
    category: "function-type" | "id-format" | "collection-integrity";
    message: string;
    affectedId?: string;
}

/**
 * Registry health and diagnostics.
 *
 * Provides validation and health checking capabilities for the runtime
 * registry without coupling to patch application or mutation operations.
 */
export interface RegistryDiagnostics {
    checkRegistryHealth(): RegistryHealthCheck;
    getPatchDiagnostics(id: string): PatchDiagnostics | null;
}

/**
 * Runtime metrics and snapshot operations.
 *
 * Provides statistics gathering and registry snapshot capabilities
 * without coupling to patch application or registry mutations.
 */
export interface RuntimeMetrics {
    getPatchStats(): PatchStats;
    getRegistrySnapshot(): RuntimeRegistrySnapshot;
    getVersion(): number;
}

/**
 * Category of patch error.
 *
 * Categorizes errors that occur during patch validation and application:
 * - validation: Structural or semantic validation failures before application
 * - shadow: Errors detected during shadow registry testing
 * - application: Errors that occur during actual patch application
 * - rollback: Errors encountered during automatic rollback operations
 */
export type PatchErrorCategory = "validation" | "shadow" | "application" | "rollback";

/**
 * Individual error occurrence record.
 *
 * Captures detailed information about a single patch error occurrence
 * for diagnostic and debugging purposes.
 */
export interface PatchErrorOccurrence {
    patchId: string;
    patchKind: PatchKind;
    category: PatchErrorCategory;
    error: string;
    timestamp: number;
    stackTrace?: string;
}

/**
 * Aggregated error statistics for a specific patch ID.
 *
 * Provides summary statistics about error patterns for a given patch,
 * helping developers identify problematic patches during development.
 */
export interface PatchErrorSummary {
    patchId: string;
    totalErrors: number;
    errorsByCategory: Record<PatchErrorCategory, number>;
    firstErrorAt: number;
    lastErrorAt: number;
    mostRecentError: string;
    uniqueErrorMessages: number;
}

/**
 * Complete error analytics snapshot.
 *
 * Provides comprehensive error statistics and patterns across all patches,
 * enabling developers to quickly identify and diagnose hot-reload issues.
 */
export interface PatchErrorAnalytics {
    totalErrors: number;
    errorsByCategory: Record<PatchErrorCategory, number>;
    errorsByKind: Record<PatchKind, number>;
    uniquePatchesWithErrors: number;
    mostProblematicPatches: Array<{ patchId: string; errorCount: number }>;
    recentErrors: Array<PatchErrorOccurrence>;
    errorRate: number;
}

/**
 * Error analytics and tracking.
 *
 * Provides comprehensive error tracking and analysis capabilities
 * for debugging hot-reload issues during development.
 */
export interface ErrorAnalytics {
    getErrorAnalytics(): PatchErrorAnalytics;
    getErrorsForPatch(patchId: string): PatchErrorSummary | null;
    clearErrorHistory(): void;
}

/**
 * Complete runtime wrapper interface.
 *
 * Combines all role-focused interfaces for consumers that need full
 * runtime wrapper capabilities. Consumers should prefer depending on
 * the minimal interface they need (PatchApplicator, PatchUndoController, PatchHistoryReader, etc.)
 * rather than this composite interface when possible.
 */
export interface RuntimeWrapper
    extends PatchApplicator,
        PatchUndoController,
        PatchHistoryReader,
        RegistryReader,
        RegistryMutator,
        RuntimeMetrics,
        RegistryDiagnostics,
        ErrorAnalytics {
    state: RuntimeWrapperState;
}
