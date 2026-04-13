import { Core } from "@gmloop/core";

import { getHighResolutionTime } from "../timing/index.js";
import {
    applyPatchInternal,
    calculateTimingMetrics,
    captureSnapshot,
    createRegistry,
    restoreSnapshot,
    testPatchInShadow,
    validateBatchPatchDependencies,
    validatePatch,
    validatePatchDependencies
} from "./patch-utils.js";
import type {
    ApplyPatchResult,
    BatchApplyResult,
    Patch,
    PatchDiagnostics,
    PatchErrorAnalytics,
    PatchErrorCategory,
    PatchErrorSummary,
    PatchHistoryEntry,
    PatchKind,
    PatchMetadata,
    PatchStats,
    RegistryHealthCheck,
    RegistryHealthIssue,
    RuntimeFunction,
    RuntimeRegistrySnapshot,
    RuntimeWrapper,
    RuntimeWrapperOptions,
    RuntimeWrapperState,
    TrySafeApplyResult
} from "./types.js";
import { trimArrayToMaxSize } from "./undo-stack-policy.js";

const UNKNOWN_ERROR_MESSAGE = "Unknown error";
const DEFAULT_MAX_UNDO_STACK_SIZE = 50;
const DEFAULT_MAX_ERROR_HISTORY_SIZE = 100;
const PATCH_KINDS: ReadonlyArray<PatchKind> = ["script", "event", "closure"];

function getRegistryCollectionForPatchKind(
    registry: RuntimeWrapperState["registry"],
    kind: PatchKind
): Record<string, RuntimeFunction> {
    switch (kind) {
        case "script": {
            return registry.scripts;
        }
        case "event": {
            return registry.events;
        }
        case "closure": {
            return registry.closures;
        }
        default: {
            throw new TypeError("Unsupported patch kind");
        }
    }
}

function getPatchKindDisplayName(kind: PatchKind): string {
    switch (kind) {
        case "script": {
            return "Script";
        }
        case "event": {
            return "Event";
        }
        case "closure": {
            return "Closure";
        }
        default: {
            throw new TypeError("Unsupported patch kind");
        }
    }
}

function hasRegistryEntry(registry: RuntimeWrapperState["registry"], kind: PatchKind, id: string): boolean {
    const collection = getRegistryCollectionForPatchKind(registry, kind);
    return id in collection;
}

function getRegistryEntry(
    registry: RuntimeWrapperState["registry"],
    kind: PatchKind,
    id: string
): RuntimeFunction | undefined {
    const collection = getRegistryCollectionForPatchKind(registry, kind);
    return collection[id];
}

function getRuntimeFallbackErrorMessage(error: unknown): string {
    if (error === null || error === undefined) {
        return UNKNOWN_ERROR_MESSAGE;
    }

    if (typeof error === "number" || typeof error === "boolean") {
        return String(error);
    }

    return "Non-Error object thrown";
}

function getRuntimeErrorMessage(error: unknown): string {
    return Core.getErrorMessageOrFallback(error, { fallback: UNKNOWN_ERROR_MESSAGE });
}

export function createRuntimeWrapper(options: RuntimeWrapperOptions = {}): RuntimeWrapper {
    const baseRegistry = createRegistry(options.registry);

    const state: RuntimeWrapperState = {
        registry: baseRegistry,
        undoStack: [],
        patchHistory: [],
        errorHistory: [],
        options: {
            validateBeforeApply: options.validateBeforeApply ?? false,
            maxUndoStackSize: options.maxUndoStackSize ?? DEFAULT_MAX_UNDO_STACK_SIZE,
            maxErrorHistorySize: options.maxErrorHistorySize ?? DEFAULT_MAX_ERROR_HISTORY_SIZE
        }
    };

    const onPatchApplied = options.onPatchApplied;
    const onChange = options.onChange;

    function recordError(patch: Patch, category: PatchErrorCategory, error: unknown): void {
        const errorMessage = Core.getErrorMessage(error, { fallback: getRuntimeFallbackErrorMessage });
        const stackTrace =
            Core.isErrorLike(error) && typeof (error as { stack?: unknown }).stack === "string"
                ? (error as { stack: string }).stack
                : undefined;

        state.errorHistory.push({
            patchId: patch.id,
            patchKind: patch.kind,
            category,
            error: errorMessage,
            timestamp: Date.now(),
            stackTrace
        });

        trimErrorHistory();
    }

    function trimUndoStack(): void {
        trimArrayToMaxSize(state.undoStack, state.options.maxUndoStackSize);
    }

    function trimErrorHistory(): void {
        trimArrayToMaxSize(state.errorHistory, state.options.maxErrorHistorySize);
    }

    /**
     * A point-in-time snapshot of the mutable batch-relevant state that is used
     * to atomically roll back all side-effects of a failed batch application.
     */
    interface BatchCheckpoint {
        /** Full registry state captured before the batch started. */
        readonly registry: RuntimeWrapperState["registry"];
        /** `undoStack.length` at checkpoint time — used to truncate the stack on rollback. */
        readonly undoStackSize: number;
        /** `patchHistory.length` at checkpoint time — used to truncate history on rollback. */
        readonly historySize: number;
    }

    /**
     * Snapshots the mutable collections that must be restored if a batch fails.
     * Callers pair this with {@link rollbackToBatchCheckpoint} to implement atomic semantics.
     */
    function captureBatchCheckpoint(): BatchCheckpoint {
        return {
            registry: { ...state.registry },
            undoStackSize: state.undoStack.length,
            historySize: state.patchHistory.length
        };
    }

    /**
     * Restores the registry, undo stack, and patch history to the state captured
     * by {@link captureBatchCheckpoint}, effectively discarding every change made
     * during the failed batch.
     */
    function rollbackToBatchCheckpoint(checkpoint: BatchCheckpoint): void {
        state.registry = checkpoint.registry;
        state.undoStack.length = checkpoint.undoStackSize;
        state.patchHistory.length = checkpoint.historySize;
    }

    /**
     * Appends a top-level "batch applied" entry to the patch history.
     * Individual per-patch entries are already written by {@link recordAppliedPatch};
     * this single summary entry lets callers query the batch as a unit.
     */
    function recordBatchAppliedHistoryEntry(
        appliedCount: number,
        wallClockStartTime: number,
        durationMs: number
    ): void {
        state.patchHistory.push({
            patch: { kind: "script", id: `batch:${appliedCount}_patches` },
            version: state.registry.version,
            timestamp: wallClockStartTime,
            action: "apply",
            durationMs
        });
    }

    /**
     * Appends a "batch rolled back" entry to the patch history, recording which
     * patch index failed and why.
     */
    function recordBatchRollbackHistoryEntry(appliedCount: number, totalCount: number, errorMessage: string): void {
        state.patchHistory.push({
            patch: { kind: "script", id: `batch:${appliedCount}_of_${totalCount}` },
            version: state.registry.version,
            timestamp: Date.now(),
            action: "rollback",
            error: errorMessage
        });
    }

    /**
     * Records a successfully applied patch in the undo stack and history,
     * then notifies observers about the registry update.
     */
    function recordAppliedPatch(
        patch: Patch,
        snapshot: ReturnType<typeof captureSnapshot>,
        appliedAt: number,
        durationMs: number
    ): void {
        state.undoStack.push(snapshot);
        trimUndoStack();
        state.patchHistory.push({
            patch: { kind: patch.kind, id: patch.id, metadata: patch.metadata },
            version: state.registry.version,
            timestamp: appliedAt,
            action: "apply",
            durationMs
        });

        if (onPatchApplied) {
            onPatchApplied(patch, state.registry.version);
        }

        if (onChange) {
            onChange({
                type: "patch-applied",
                patch,
                version: state.registry.version
            });
        }
    }

    function applyPatchWithValidation(
        patch: Patch,
        snapshot: ReturnType<typeof captureSnapshot> | null,
        skipShadowValidation: boolean
    ): ApplyPatchResult {
        const depValidation = validatePatchDependencies(patch, state.registry);
        if (!depValidation.satisfied) {
            const missingDeps = depValidation.missingDependencies.join(", ");
            const errorMessage = `Patch ${patch.id} has unsatisfied dependencies: ${missingDeps}`;
            recordError(patch, "validation", errorMessage);
            throw new Error(errorMessage);
        }

        if (state.options.validateBeforeApply && !skipShadowValidation) {
            const testResult = testPatchInShadow(patch);
            if (!testResult.valid) {
                recordError(patch, "shadow", testResult.error ?? "Unknown shadow validation error");
                throw new Error(`Patch validation failed for ${patch.id}: ${testResult.error}`);
            }
        }

        const resolvedSnapshot = snapshot ?? captureSnapshot(state.registry, patch);
        const startTime = getHighResolutionTime();

        try {
            const { registry: nextRegistry, result } = applyPatchInternal(state.registry, patch);
            const durationMs = getHighResolutionTime() - startTime;

            state.registry = nextRegistry;
            recordAppliedPatch(patch, resolvedSnapshot, Date.now(), durationMs);

            return result;
        } catch (error) {
            recordError(patch, "application", error);
            const message = getRuntimeErrorMessage(error);
            throw new Error(`Failed to apply patch ${patch.id}: ${message}`);
        }
    }

    function applyPatch(patchCandidate: unknown): ApplyPatchResult {
        validatePatch(patchCandidate);
        const patch = patchCandidate;

        return applyPatchWithValidation(patch, null, false);
    }

    function validateBatchPatches(patchCandidates: Array<unknown>): Array<Patch> | BatchApplyResult {
        const validatedPatches: Array<Patch> = [];
        for (const candidate of patchCandidates) {
            validatePatch(candidate);
            validatedPatches.push(candidate);
        }

        const batchDependencyValidation = validateBatchPatchDependencies(validatedPatches, state.registry);
        if (batchDependencyValidation.satisfied === false) {
            const failedPatch = validatedPatches[batchDependencyValidation.failedIndex];
            if (failedPatch) {
                const missingDeps = batchDependencyValidation.missingDependencies.join(", ");
                const errorMessage = `Patch ${failedPatch.id} has unsatisfied dependencies: ${missingDeps}`;
                recordError(failedPatch, "validation", errorMessage);
                return {
                    success: false,
                    appliedCount: 0,
                    failedIndex: batchDependencyValidation.failedIndex,
                    error: "dependency_validation_failed",
                    message: `Batch dependency validation failed at patch ${batchDependencyValidation.failedIndex} (${failedPatch.id}): ${errorMessage}`,
                    rolledBack: false
                };
            }
        }

        if (state.options.validateBeforeApply) {
            for (const [index, patch] of validatedPatches.entries()) {
                const testResult = testPatchInShadow(patch);
                if (!testResult.valid) {
                    recordError(patch, "shadow", testResult.error ?? "Unknown shadow validation error");
                    return {
                        success: false,
                        appliedCount: 0,
                        failedIndex: index,
                        error: testResult.error,
                        message: `Batch validation failed at patch ${index} (${patch.id}): ${testResult.error}`,
                        rolledBack: false
                    };
                }
            }
        }

        return validatedPatches;
    }

    function applyPatchBatch(patchCandidates: Array<unknown>): BatchApplyResult {
        if (!Array.isArray(patchCandidates)) {
            throw new TypeError("applyPatchBatch expects an array of patches");
        }

        if (patchCandidates.length === 0) {
            return {
                success: true,
                version: state.registry.version,
                appliedCount: 0,
                rolledBack: false
            };
        }

        const validationResult = validateBatchPatches(patchCandidates);
        if (!Array.isArray(validationResult)) {
            return validationResult;
        }
        const validatedPatches = validationResult;

        const batchCheckpoint = captureBatchCheckpoint();
        const startTime = getHighResolutionTime();
        const wallClockStartTime = Date.now();
        let appliedCount = 0;

        try {
            for (const patch of validatedPatches) {
                const snapshot = captureSnapshot(state.registry, patch);
                const patchStartTime = getHighResolutionTime();

                const { registry: nextRegistry } = applyPatchInternal(state.registry, patch);
                const durationMs = getHighResolutionTime() - patchStartTime;

                state.registry = nextRegistry;
                recordAppliedPatch(patch, snapshot, Date.now(), durationMs);
                appliedCount++;
            }

            const totalDuration = getHighResolutionTime() - startTime;
            recordBatchAppliedHistoryEntry(appliedCount, wallClockStartTime, totalDuration);

            return {
                success: true,
                version: state.registry.version,
                appliedCount,
                rolledBack: false
            };
        } catch (error) {
            const failedPatch = validatedPatches[appliedCount];
            if (failedPatch) {
                recordError(failedPatch, "application", error);
            }

            rollbackToBatchCheckpoint(batchCheckpoint);

            const message = getRuntimeErrorMessage(error);
            recordBatchRollbackHistoryEntry(appliedCount, validatedPatches.length, message);

            return {
                success: false,
                version: state.registry.version,
                appliedCount,
                failedIndex: appliedCount,
                error: message,
                message: `Batch apply failed at patch ${appliedCount}: ${message}`,
                rolledBack: true
            };
        }
    }

    function undo(): { success: boolean; version?: number; message?: string } {
        if (state.undoStack.length === 0) {
            return { success: false, message: "Nothing to undo" };
        }

        const snapshot = state.undoStack.pop();
        const restoredRegistry = restoreSnapshot(state.registry, snapshot);

        state.registry = {
            ...restoredRegistry,
            version: state.registry.version + 1
        };

        state.patchHistory.push({
            patch: { kind: snapshot.kind, id: snapshot.id },
            version: state.registry.version,
            timestamp: Date.now(),
            action: "undo"
        });

        if (onChange) {
            onChange({
                type: "patch-undone",
                patch: { kind: snapshot.kind, id: snapshot.id },
                version: state.registry.version
            });
        }

        return { success: true, version: state.registry.version };
    }

    function trySafeApply(patchCandidate: unknown, onValidate?: (patch: Patch) => boolean | void): TrySafeApplyResult {
        validatePatch(patchCandidate);
        const patch = patchCandidate;

        const testResult = testPatchInShadow(patch);
        if (!testResult.valid) {
            recordError(patch, "shadow", testResult.error ?? "Unknown shadow validation error");
            return {
                success: false,
                error: testResult.error,
                message: `Shadow validation failed: ${testResult.error}`
            };
        }

        if (onValidate) {
            try {
                const validationResult = onValidate(patch);
                if (validationResult === false) {
                    recordError(patch, "validation", "Custom validation rejected patch");
                    return {
                        success: false,
                        error: "Custom validation rejected patch",
                        message: "Custom validation callback returned false"
                    };
                }
            } catch (error) {
                recordError(patch, "validation", error);
                const message = getRuntimeErrorMessage(error);
                return {
                    success: false,
                    error: message,
                    message: `Custom validation failed: ${message}`
                };
            }
        }

        const snapshot = captureSnapshot(state.registry, patch);
        const previousVersion = state.registry.version;

        try {
            const result = applyPatchWithValidation(patch, snapshot, true);
            return {
                success: true,
                version: result.version,
                rolledBack: false
            };
        } catch (error) {
            recordError(patch, "rollback", error);

            const restoredRegistry = restoreSnapshot(state.registry, snapshot);
            state.registry = {
                ...restoredRegistry,
                version: previousVersion
            };

            const lastSnapshot = state.undoStack.at(-1);
            if (
                lastSnapshot &&
                lastSnapshot.id === patch.id &&
                lastSnapshot.kind === patch.kind &&
                lastSnapshot.version === previousVersion
            ) {
                state.undoStack.pop();
            }

            const message = getRuntimeErrorMessage(error);

            state.patchHistory.push({
                patch: { kind: patch.kind, id: patch.id, metadata: patch.metadata },
                version: state.registry.version,
                timestamp: Date.now(),
                action: "rollback",
                error: message
            });

            if (onChange) {
                onChange({
                    type: "patch-rolled-back",
                    patch,
                    version: state.registry.version,
                    error: message
                });
            }

            return {
                success: false,
                error: message,
                message: `Patch failed and was rolled back: ${message}`,
                rolledBack: true
            };
        }
    }

    function getPatchHistory(): Array<PatchHistoryEntry> {
        return [...state.patchHistory];
    }

    function getUndoStackSize(): number {
        return state.undoStack.length;
    }

    function getPatchById(id: string): Array<PatchHistoryEntry> {
        return state.patchHistory.filter((entry) => entry.patch.id === id);
    }

    function getPatchesByKind(kind: PatchKind): Array<PatchHistoryEntry> {
        return state.patchHistory.filter((entry) => entry.patch.kind === kind);
    }

    function getRegistrySnapshot(): RuntimeRegistrySnapshot {
        const scripts = Object.keys(getRegistryCollectionForPatchKind(state.registry, "script"));
        const events = Object.keys(getRegistryCollectionForPatchKind(state.registry, "event"));
        const closures = Object.keys(getRegistryCollectionForPatchKind(state.registry, "closure"));

        return {
            version: state.registry.version,
            scriptCount: scripts.length,
            eventCount: events.length,
            closureCount: closures.length,
            scripts,
            events,
            closures
        };
    }

    function getPatchStats(): PatchStats {
        const stats: Omit<PatchStats, "uniqueIds"> = {
            totalPatches: state.patchHistory.length,
            appliedPatches: 0,
            undonePatches: 0,
            rolledBackPatches: 0,
            scriptPatches: 0,
            eventPatches: 0,
            closurePatches: 0
        };

        const uniqueIds = new Set<string>();
        const durations: Array<number> = [];

        for (const entry of state.patchHistory) {
            switch (entry.action) {
                case "apply": {
                    stats.appliedPatches++;
                    if (typeof entry.durationMs === "number") {
                        durations.push(entry.durationMs);
                    }
                    break;
                }
                case "undo": {
                    stats.undonePatches++;

                    break;
                }
                case "rollback": {
                    stats.rolledBackPatches++;

                    break;
                }
                // No default
            }

            uniqueIds.add(entry.patch.id);

            switch (entry.patch.kind) {
                case "script": {
                    stats.scriptPatches++;
                    break;
                }
                case "event": {
                    stats.eventPatches++;
                    break;
                }
                case "closure": {
                    stats.closurePatches++;
                    break;
                }
                // No default
            }
        }

        const timingMetrics = calculateTimingMetrics(durations);

        if (timingMetrics) {
            return { ...stats, ...timingMetrics, uniqueIds: uniqueIds.size };
        }

        return { ...stats, uniqueIds: uniqueIds.size };
    }

    function getVersion(): number {
        return state.registry.version;
    }

    function getScript(id: string): RuntimeFunction | undefined {
        return getRegistryEntry(state.registry, "script", id);
    }

    function getEvent(id: string): RuntimeFunction | undefined {
        return getRegistryEntry(state.registry, "event", id);
    }

    function hasScript(id: string): boolean {
        return hasRegistryEntry(state.registry, "script", id);
    }

    function hasEvent(id: string): boolean {
        return hasRegistryEntry(state.registry, "event", id);
    }

    function getClosure(id: string): RuntimeFunction | undefined {
        return getRegistryEntry(state.registry, "closure", id);
    }

    function hasClosure(id: string): boolean {
        return hasRegistryEntry(state.registry, "closure", id);
    }

    function clearRegistry(): void {
        state.registry = createRegistry({
            version: state.registry.version + 1
        });
        state.undoStack = [];

        if (onChange) {
            onChange({
                type: "registry-cleared",
                version: state.registry.version
            });
        }
    }

    function checkRegistryHealth(): RegistryHealthCheck {
        const issues: Array<RegistryHealthIssue> = [];
        for (const kind of PATCH_KINDS) {
            const displayName = getPatchKindDisplayName(kind);
            const collection = getRegistryCollectionForPatchKind(state.registry, kind);
            for (const [id, fn] of Object.entries(collection)) {
                if (typeof fn !== "function") {
                    issues.push({
                        severity: "error",
                        category: "function-type",
                        message: `${displayName} registry entry is not a function (type: ${typeof fn})`,
                        affectedId: id
                    });
                }
            }
        }

        return {
            healthy: issues.length === 0,
            version: state.registry.version,
            issues
        };
    }

    function getPatchDiagnostics(id: string): PatchDiagnostics | null {
        const historyEntries: Array<PatchHistoryEntry> = [];
        let kind: PatchKind | null = null;
        let metadata: PatchMetadata | undefined;
        let applicationCount = 0;
        let undoCount = 0;
        let rollbackCount = 0;
        let firstAppliedAt: number | null = null;
        let lastAppliedAt: number | null = null;
        let durationSum = 0;
        let durationCount = 0;

        for (const entry of state.patchHistory) {
            if (entry.patch.id !== id) {
                continue;
            }

            historyEntries.push(entry);

            if (!kind) {
                kind = entry.patch.kind;
            }

            if (!metadata && entry.patch.metadata) {
                metadata = entry.patch.metadata;
            }

            switch (entry.action) {
                case "apply": {
                    applicationCount++;
                    if (firstAppliedAt === null) {
                        firstAppliedAt = entry.timestamp;
                    }
                    lastAppliedAt = entry.timestamp;
                    if (typeof entry.durationMs === "number") {
                        durationSum += entry.durationMs;
                        durationCount++;
                    }
                    break;
                }
                case "undo": {
                    undoCount++;
                    break;
                }
                case "rollback": {
                    rollbackCount++;
                    break;
                }
                // No default
            }
        }

        if (historyEntries.length === 0 || !kind) {
            return null;
        }

        const averageDurationMs = durationCount > 0 ? durationSum / durationCount : null;

        const currentlyApplied = hasRegistryEntry(state.registry, kind, id);

        return {
            id,
            kind,
            applicationCount,
            firstAppliedAt,
            lastAppliedAt,
            currentlyApplied,
            undoCount,
            rollbackCount,
            averageDurationMs,
            sourcePath: metadata?.sourcePath ?? null,
            sourceHash: metadata?.sourceHash ?? null,
            dependencies: metadata?.dependencies ?? [],
            historyEntries: [...historyEntries]
        };
    }

    function getErrorAnalytics(): PatchErrorAnalytics {
        const totalErrors = state.errorHistory.length;

        const errorsByCategory: Record<PatchErrorCategory, number> = {
            validation: 0,
            shadow: 0,
            application: 0,
            rollback: 0
        };

        const errorsByKind: Record<PatchKind, number> = {
            script: 0,
            event: 0,
            closure: 0
        };

        const patchErrorCounts = new Map<string, number>();

        for (const errorEntry of state.errorHistory) {
            errorsByCategory[errorEntry.category] = (errorsByCategory[errorEntry.category] ?? 0) + 1;
            errorsByKind[errorEntry.patchKind] = (errorsByKind[errorEntry.patchKind] ?? 0) + 1;

            const currentCount = patchErrorCounts.get(errorEntry.patchId) ?? 0;
            patchErrorCounts.set(errorEntry.patchId, currentCount + 1);
        }

        const uniquePatchesWithErrors = patchErrorCounts.size;

        const sortedEntries = Array.from(patchErrorCounts.entries())
            .map(([patchId, errorCount]) => ({ patchId, errorCount }))
            .toSorted((a, b) => b.errorCount - a.errorCount);

        const mostProblematicPatches = sortedEntries.slice(0, 10);

        const recentErrors = Core.cloneObjectEntries(state.errorHistory.slice(-20));

        const totalPatches = state.patchHistory.filter((entry) => entry.action === "apply").length;
        const errorRate = totalPatches > 0 ? totalErrors / totalPatches : 0;

        return {
            totalErrors,
            errorsByCategory,
            errorsByKind,
            uniquePatchesWithErrors,
            mostProblematicPatches,
            recentErrors,
            errorRate
        };
    }

    function getErrorsForPatch(patchId: string): PatchErrorSummary | null {
        const errorsForPatch = state.errorHistory.filter((entry) => entry.patchId === patchId);

        if (errorsForPatch.length === 0) {
            return null;
        }

        const errorsByCategory: Record<PatchErrorCategory, number> = {
            validation: 0,
            shadow: 0,
            application: 0,
            rollback: 0
        };

        const uniqueErrors = new Set<string>();

        for (const errorEntry of errorsForPatch) {
            errorsByCategory[errorEntry.category] = (errorsByCategory[errorEntry.category] ?? 0) + 1;
            uniqueErrors.add(errorEntry.error);
        }

        const firstError = errorsForPatch[0];
        const lastError = errorsForPatch.at(-1);

        return {
            patchId,
            totalErrors: errorsForPatch.length,
            errorsByCategory,
            firstErrorAt: firstError.timestamp,
            lastErrorAt: lastError.timestamp,
            mostRecentError: lastError.error,
            uniqueErrorMessages: uniqueErrors.size
        };
    }

    function clearErrorHistory(): void {
        state.errorHistory = [];
    }

    return {
        state,
        applyPatch,
        applyPatchBatch,
        trySafeApply,
        undo,
        getPatchHistory,
        getUndoStackSize,
        getPatchById,
        getPatchesByKind,
        getRegistrySnapshot,
        getPatchStats,
        getVersion,
        getScript,
        getEvent,
        hasScript,
        hasEvent,
        getClosure,
        hasClosure,
        clearRegistry,
        checkRegistryHealth,
        getPatchDiagnostics,
        getErrorAnalytics,
        getErrorsForPatch,
        clearErrorHistory
    };
}
