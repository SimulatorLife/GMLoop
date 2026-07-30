/**
 * Semantic-index progress concern for the project operation lease.
 *
 * This module owns the domain types, persisted-shape normalization, lease-side
 * update/clear controllers, and the persist-interval constant for the
 * semantic-index progress channel that the project-operation lease exposes.
 * Extracting these concerns from `project-operation-state.ts` keeps the lease
 * focused on cross-process state persistence and locking while letting the
 * semantic-index domain evolve independently.
 *
 * The module is intentionally structural: it only depends on a tiny binding
 * contract that the lease adapts to its mutable record, so this file does
 * not need to know anything about `ProjectOperationRecord` or the rest of the
 * operation-state shape. That avoids a circular import and keeps the
 * boundary clean.
 */

const SEMANTIC_INDEX_PROGRESS_PERSIST_INTERVAL_MS = 100;

/** Summary reported once a semantic index build finishes. */
export type ProjectSemanticIndexBuildSummary = Readonly<{
    cacheHitCount: number;
    cacheMissCount: number;
    slowestFiles: ReadonlyArray<Readonly<{ relativePath: string; durationMs: number }>>;
    totalDurationMs: number;
}>;

/** Progress emitted while the semantic project index parses project sources, or the final summary once it completes. */
export type ProjectSemanticIndexProgress =
    | Readonly<{ current: number; stage: "gml-parse"; total: number }>
    | Readonly<{ stage: "complete"; summary: ProjectSemanticIndexBuildSummary }>;

/**
 * Persist cadence for the semantic-index progress channel.
 *
 * Exposed so the lease implementation (and any tests) can reason about how
 * often the underlying project-operation state file is rewritten during a
 * long-running semantic index build.
 */
export const SEMANTIC_INDEX_PROGRESS_PERSIST_INTERVAL_MS_EXPORT = SEMANTIC_INDEX_PROGRESS_PERSIST_INTERVAL_MS;

/**
 * Minimal structural view of the project-operation lease record that the
 * semantic-index progress controller needs to read and mutate.
 *
 * The lease adapts its full record to this shape, so this module never has
 * to import `ProjectOperationRecord`. Keeping the contract structural lets
 * the two concerns stay decoupled and makes the controller trivially
 * testable in isolation.
 */
export interface SemanticIndexMutableRecord {
    phase: string;
    semanticIndex: ProjectSemanticIndexProgress | null;
    updatedAt: number;
}

/**
 * Binding contract the lease exposes to the semantic-index progress
 * controller.
 *
 * Each member corresponds to one of the cross-cutting primitives the lease
 * already maintains (the in-flight record, the `completed` flag, the
 * cross-process refresh, and the persistence call). The controller never
 * touches the lease directly, which keeps the semantic-index concern
 * removable in isolation.
 */
export interface SemanticIndexLeaseBinding {
    /** Returns the current in-flight record (frozen but re-readable). */
    getCurrentRecord(): SemanticIndexMutableRecord;
    /** Returns true once the lease has been completed and is read-only. */
    isCompleted(): boolean;
    /** Persist the latest in-flight record to the shared state file. */
    persist(): void;
    /** Re-read the latest shared record so local mutations are not clobbered. */
    refreshCurrentRecord(): void;
    /** Replace the in-flight record with a new frozen value. */
    setCurrentRecord(record: SemanticIndexMutableRecord): void;
}

/**
 * Lease-side facade for the semantic-index progress channel.
 *
 * Each method mirrors a method the lease used to expose directly; the lease
 * still owns those method slots but delegates the body to this controller so
 * the lease itself only needs to wire the binding.
 */
export interface SemanticIndexProgressController {
    clear(): void;
    update(progress: ProjectSemanticIndexProgress): void;
}

/**
 * Build a new lease-side semantic-index progress controller bound to a
 * single lease. The returned controller is single-use; creating it once per
 * lease keeps the throttle bookkeeping local to that lease.
 */
export function createSemanticIndexProgressController(
    binding: SemanticIndexLeaseBinding
): SemanticIndexProgressController {
    let lastPersistAt = 0;

    function applySemanticIndexUpdate(progress: ProjectSemanticIndexProgress): void {
        if (binding.isCompleted()) {
            return;
        }
        binding.refreshCurrentRecord();
        const nextRecord: SemanticIndexMutableRecord = {
            ...binding.getCurrentRecord(),
            phase: "semantic-index",
            semanticIndex: { ...progress },
            updatedAt: Date.now()
        };
        binding.setCurrentRecord(Object.freeze(nextRecord));
        const now = Date.now();
        if (
            progress.stage === "complete" ||
            progress.current === progress.total ||
            now - lastPersistAt >= SEMANTIC_INDEX_PROGRESS_PERSIST_INTERVAL_MS
        ) {
            lastPersistAt = now;
            binding.persist();
        }
    }

    function clearSemanticIndexProgress(): void {
        if (binding.isCompleted()) {
            return;
        }
        binding.refreshCurrentRecord();
        const nextRecord: SemanticIndexMutableRecord = {
            ...binding.getCurrentRecord(),
            semanticIndex: null,
            updatedAt: Date.now()
        };
        binding.setCurrentRecord(Object.freeze(nextRecord));
        binding.persist();
    }

    return Object.freeze({
        clear: (): void => clearSemanticIndexProgress(),
        update: (progress: ProjectSemanticIndexProgress): void => applySemanticIndexUpdate(progress)
    });
}

/**
 * Coerce an unknown value (typically a parsed JSON node) into a
 * {@link ProjectSemanticIndexBuildSummary} or `null` when the shape does not
 * match. `null` is intentionally returned — never thrown — so the surrounding
 * record normalizer can drop the progress field without aborting the whole
 * state load.
 */
export function normalizeProjectSemanticIndexBuildSummary(value: unknown): ProjectSemanticIndexBuildSummary | null {
    if (value === null || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (
        typeof record.cacheHitCount !== "number" ||
        typeof record.cacheMissCount !== "number" ||
        typeof record.totalDurationMs !== "number" ||
        !Array.isArray(record.slowestFiles)
    ) {
        return null;
    }
    const slowestFiles = record.slowestFiles.flatMap((entry) => {
        if (entry === null || typeof entry !== "object") {
            return [];
        }
        const fileRecord = entry as Record<string, unknown>;
        if (typeof fileRecord.relativePath !== "string" || typeof fileRecord.durationMs !== "number") {
            return [];
        }
        return [Object.freeze({ relativePath: fileRecord.relativePath, durationMs: fileRecord.durationMs })];
    });
    return Object.freeze({
        cacheHitCount: record.cacheHitCount,
        cacheMissCount: record.cacheMissCount,
        slowestFiles,
        totalDurationMs: record.totalDurationMs
    });
}

/**
 * Coerce an unknown value into a {@link ProjectSemanticIndexProgress} or
 * `null`. Mirrors {@link normalizeProjectSemanticIndexBuildSummary} for the
 * wrapper progress shape.
 */
export function normalizeProjectSemanticIndexProgress(value: unknown): ProjectSemanticIndexProgress | null {
    if (value === null || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (record.stage === "complete") {
        const summary = normalizeProjectSemanticIndexBuildSummary(record.summary);
        return summary === null ? null : Object.freeze({ stage: "complete" as const, summary });
    }
    if (
        typeof record.current !== "number" ||
        !Number.isInteger(record.current) ||
        record.current < 0 ||
        typeof record.total !== "number" ||
        !Number.isInteger(record.total) ||
        record.total < 0 ||
        record.stage !== "gml-parse"
    ) {
        return null;
    }
    return Object.freeze({ current: record.current, stage: "gml-parse" as const, total: record.total });
}
