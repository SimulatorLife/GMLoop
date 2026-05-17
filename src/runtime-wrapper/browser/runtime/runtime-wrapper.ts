import { Core } from "@gmloop/core";

import { getHighResolutionTime } from "../timing/index.js";
import {
    computeErrorAnalytics,
    computeErrorsForPatch,
    computePatchDiagnostics,
    computePatchStats,
    computeRegistryHealthCheck,
    computeRegistrySnapshot,
    getRegistryEntry,
    hasRegistryEntry
} from "./diagnostics.js";
import { resolveRuntimeErrorMessage } from "./error-normalization.js";
import {
    applyPatchInternal,
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
    PatchErrorCategory,
    PatchHistoryEntry,
    PatchKind,
    RuntimeFunction,
    RuntimeWrapper,
    RuntimeWrapperOptions,
    RuntimeWrapperState,
    TrySafeApplyResult
} from "./types.js";
import { trimArrayToMaxSize } from "./undo-stack-policy.js";

const DEFAULT_MAX_UNDO_STACK_SIZE = 50;
const DEFAULT_MAX_ERROR_HISTORY_SIZE = 100;

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
        const errorMessage = resolveRuntimeErrorMessage(error);
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
            const message = resolveRuntimeErrorMessage(error);
            throw new Error(`Failed to apply patch ${patch.id}: ${message}`, { cause: error });
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

            const message = resolveRuntimeErrorMessage(error);
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
                const message = resolveRuntimeErrorMessage(error);
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

            const message = resolveRuntimeErrorMessage(error);

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

    function getRegistrySnapshot() {
        return computeRegistrySnapshot(state.registry);
    }

    function getPatchStats() {
        return computePatchStats(state.patchHistory);
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

    function checkRegistryHealth() {
        return computeRegistryHealthCheck(state.registry);
    }

    function getPatchDiagnostics(id: string) {
        return computePatchDiagnostics(id, state.patchHistory, state.registry);
    }

    function getErrorAnalytics() {
        return computeErrorAnalytics(state.errorHistory, state.patchHistory);
    }

    function getErrorsForPatch(patchId: string) {
        return computeErrorsForPatch(patchId, state.errorHistory);
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
