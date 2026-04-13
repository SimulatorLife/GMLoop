import type { Logger } from "../runtime/logger.js";
import type { PatchApplicator } from "../runtime/types.js";
import { getHighResolutionTime } from "../timing/index.js";
import type { PatchQueueMetrics, PatchQueueState, WebSocketClientState, WebSocketConnectionMetrics } from "./types.js";

const QUEUE_COMPACTION_THRESHOLD_MULTIPLIER = 2;

/**
 * Create a fresh connection-metrics snapshot for a websocket client.
 *
 * @returns The zeroed connection metrics.
 */
export function createInitialConnectionMetrics(): WebSocketConnectionMetrics {
    return {
        totalConnections: 0,
        totalDisconnections: 0,
        totalReconnectAttempts: 0,
        patchesReceived: 0,
        patchesApplied: 0,
        patchesFailed: 0,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastPatchReceivedAt: null,
        lastPatchAppliedAt: null,
        connectionErrors: 0,
        patchErrors: 0
    };
}

function createInitialPatchQueueMetrics(): PatchQueueMetrics {
    return {
        totalQueued: 0,
        totalFlushed: 0,
        totalDropped: 0,
        totalDeduplicated: 0,
        maxQueueDepth: 0,
        flushCount: 0,
        lastFlushSize: 0,
        lastFlushedAt: null
    };
}

/**
 * Create the mutable queue state used to batch websocket patches.
 *
 * @returns The initialized patch queue state.
 */
export function createPatchQueueState(): PatchQueueState {
    return {
        queue: [],
        flushTimer: null,
        queueMetrics: createInitialPatchQueueMetrics(),
        queueHead: 0
    };
}

/**
 * Record the arrival of an incoming patch payload on the websocket client.
 *
 * @param state The mutable client state to update.
 * @returns The wall-clock timestamp used for the received patch.
 */
export function recordPatchReceived(state: WebSocketClientState): number {
    const receivedAt = Date.now();
    state.connectionMetrics.patchesReceived += 1;
    state.connectionMetrics.lastPatchReceivedAt = receivedAt;
    return receivedAt;
}

/**
 * Queue a pending patch until the runtime becomes ready to apply it.
 *
 * @param state The mutable client state.
 * @param patch The patch payload to enqueue.
 * @param maxPendingPatches The maximum pending patch window.
 */
export function enqueuePendingPatchUntilRuntimeReady(
    state: WebSocketClientState,
    patch: unknown,
    maxPendingPatches: number
): void {
    const effectivePendingCount = state.pendingPatches.length - state.pendingPatchHead;
    if (effectivePendingCount >= maxPendingPatches) {
        state.pendingPatchHead += 1;

        const compactionThreshold = maxPendingPatches * QUEUE_COMPACTION_THRESHOLD_MULTIPLIER;
        if (state.pendingPatchHead >= compactionThreshold) {
            state.pendingPatches = state.pendingPatches.slice(state.pendingPatchHead);
            state.pendingPatchHead = 0;
        }
    }

    state.pendingPatches.push(patch);
}

/**
 * Enqueue a patch into the active flush queue, dropping the oldest entry when the queue is full.
 *
 * @param state The mutable client state.
 * @param patch The patch payload to enqueue.
 * @param maxQueueSize The maximum queue size before older patches are dropped or the queue flushes.
 * @param flushQueuedPatchBatch Callback that flushes the queue immediately.
 * @param scheduleFlush Callback that schedules a deferred flush.
 * @param logger Optional logger for queue diagnostics.
 */
export function enqueuePatchForDeferredFlush(
    state: WebSocketClientState,
    patch: unknown,
    maxQueueSize: number,
    flushQueuedPatchBatch: () => number,
    scheduleFlush: () => void,
    logger?: Logger
): void {
    if (!state.patchQueue) {
        return;
    }

    const queueState = state.patchQueue;
    const queueMetrics = queueState.queueMetrics;
    const effectiveQueueSize = queueState.queue.length - queueState.queueHead;

    if (effectiveQueueSize >= maxQueueSize) {
        queueState.queueHead += 1;
        queueMetrics.totalDropped += 1;

        const compactionThreshold = maxQueueSize * QUEUE_COMPACTION_THRESHOLD_MULTIPLIER;
        if (queueState.queueHead >= compactionThreshold) {
            queueState.queue = queueState.queue.slice(queueState.queueHead);
            queueState.queueHead = 0;
        }
    }

    queueState.queue.push(patch);
    queueMetrics.totalQueued += 1;

    const currentDepth = queueState.queue.length - queueState.queueHead;
    if (currentDepth > queueMetrics.maxQueueDepth) {
        queueMetrics.maxQueueDepth = currentDepth;
    }

    if (logger && typeof patch === "object" && patch !== null && "id" in patch && typeof patch.id === "string") {
        logger.patchQueued(patch.id, currentDepth);
    }

    if (currentDepth >= maxQueueSize) {
        flushQueuedPatchBatch();
    } else {
        scheduleFlush();
    }
}

/**
 * Flush queued patches through the runtime wrapper, including queue deduplication and metrics updates.
 *
 * @param state The mutable client state.
 * @param wrapper The patch applicator that will consume queued patches.
 * @param applyQueuedPatch Callback used when batch application is unavailable.
 * @param logger Optional logger for queue diagnostics.
 * @returns The number of queued patches removed from the queue before deduplication.
 */
export function flushQueuedPatches(
    state: WebSocketClientState,
    wrapper: PatchApplicator | null,
    applyQueuedPatch: (incoming: unknown) => boolean,
    logger?: Logger
): number {
    if (!state.patchQueue || !wrapper) {
        return 0;
    }

    const queueState = state.patchQueue;
    const effectiveQueueSize = queueState.queue.length - queueState.queueHead;
    if (effectiveQueueSize === 0) {
        return 0;
    }

    if (queueState.flushTimer !== null) {
        clearTimeout(queueState.flushTimer);
        queueState.flushTimer = null;
    }

    const patchesToFlush = queueState.queueHead === 0 ? queueState.queue : queueState.queue.slice(queueState.queueHead);
    const flushSize = patchesToFlush.length;

    queueState.queue = [];
    queueState.queueHead = 0;

    const queueMetrics = queueState.queueMetrics;
    const connectionMetrics = state.connectionMetrics;

    queueMetrics.flushCount += 1;
    queueMetrics.lastFlushSize = flushSize;
    queueMetrics.lastFlushedAt = Date.now();

    const { patches: deduplicatedPatches, duplicateCount } = deduplicatePatchesById(patchesToFlush);
    const patchesToApply = orderPatchesForDependencyBatching(deduplicatedPatches);
    queueMetrics.totalDeduplicated += duplicateCount;

    const flushStartTime = getHighResolutionTime();

    if (wrapper.applyPatchBatch) {
        const result = wrapper.applyPatchBatch(patchesToApply);
        const applied = result.success && !result.rolledBack ? result.appliedCount : 0;
        const failed = result.success ? 0 : patchesToApply.length;

        connectionMetrics.patchesApplied += applied;
        connectionMetrics.patchesFailed += failed;
        if (failed > 0) {
            connectionMetrics.patchErrors += failed;
        }
        queueMetrics.totalFlushed += flushSize;

        if (result.success && applied > 0) {
            connectionMetrics.lastPatchAppliedAt = Date.now();
        }
    } else {
        for (const patch of patchesToApply) {
            applyQueuedPatch(patch);
        }
        queueMetrics.totalFlushed += flushSize;
    }

    const flushDuration = getHighResolutionTime() - flushStartTime;
    if (logger) {
        logger.patchQueueFlushed(flushSize, flushDuration);
    }

    return flushSize;
}

/**
 * Deduplicate patch candidates by ID, keeping only the latest occurrence of each string ID.
 *
 * @param patches The patch candidates to deduplicate.
 * @returns The deduplicated patches and the number of removed duplicates.
 */
export function deduplicatePatchesById(patches: Array<unknown>): {
    patches: Array<unknown>;
    duplicateCount: number;
} {
    if (patches.length < 2) {
        return { patches, duplicateCount: 0 };
    }

    const seenIds = new Set<string>();
    const deduplicatedReversed: Array<unknown> = [];
    let duplicateCount = 0;

    for (let index = patches.length - 1; index >= 0; index -= 1) {
        const patch = patches[index];
        const patchId = extractPatchId(patch);
        if (patchId === null) {
            deduplicatedReversed.push(patch);
            continue;
        }

        if (seenIds.has(patchId)) {
            duplicateCount += 1;
            continue;
        }

        seenIds.add(patchId);
        deduplicatedReversed.push(patch);
    }

    if (duplicateCount === 0) {
        return { patches, duplicateCount: 0 };
    }

    deduplicatedReversed.reverse();
    return { patches: deduplicatedReversed, duplicateCount };
}

function extractPatchId(patch: unknown): string | null {
    if (patch === null || typeof patch !== "object" || !("id" in patch)) {
        return null;
    }

    const patchId = (patch as Record<string, unknown>).id;
    return typeof patchId === "string" ? patchId : null;
}

function extractPatchDependencies(patch: unknown): Array<string> {
    if (patch === null || typeof patch !== "object" || !("metadata" in patch)) {
        return [];
    }

    const metadata = (patch as Record<string, unknown>).metadata;
    if (metadata === null || typeof metadata !== "object" || !("dependencies" in metadata)) {
        return [];
    }

    const dependencies = (metadata as Record<string, unknown>).dependencies;
    if (!Array.isArray(dependencies) || dependencies.length === 0) {
        return [];
    }

    return dependencies.filter(
        (dependency): dependency is string => typeof dependency === "string" && dependency.length > 0
    );
}

function orderPatchesForDependencyBatching(patches: Array<unknown>): Array<unknown> {
    if (patches.length < 2) {
        return patches;
    }

    const patchIds = new Set<string>();
    const patchById = new Map<string, unknown>();
    const orderedIds: Array<string> = [];

    for (const patch of patches) {
        const patchId = extractPatchId(patch);
        if (patchId === null || patchById.has(patchId)) {
            continue;
        }

        patchIds.add(patchId);
        patchById.set(patchId, patch);
        orderedIds.push(patchId);
    }

    if (orderedIds.length < 2) {
        return patches;
    }

    const patchIndexById = new Map<string, number>();
    for (const [index, patchId] of orderedIds.entries()) {
        patchIndexById.set(patchId, index);
    }

    let requiresReorder = false;
    for (const patchId of orderedIds) {
        const patch = patchById.get(patchId);
        if (patch === undefined) {
            continue;
        }

        const dependencyIds = extractPatchDependencies(patch);
        if (dependencyIds.length === 0) {
            continue;
        }

        const currentIndex = patchIndexById.get(patchId);
        if (currentIndex === undefined) {
            continue;
        }

        const uniqueDependencies = new Set<string>();
        for (const dependencyId of dependencyIds) {
            if (uniqueDependencies.has(dependencyId)) {
                continue;
            }
            uniqueDependencies.add(dependencyId);

            const dependencyIndex = patchIndexById.get(dependencyId);
            if (dependencyIndex === undefined || dependencyId === patchId) {
                continue;
            }

            if (dependencyIndex > currentIndex) {
                requiresReorder = true;
                break;
            }
        }

        if (requiresReorder) {
            break;
        }
    }

    if (!requiresReorder) {
        return patches;
    }

    const incomingEdges = new Map<string, number>();
    const dependentsByDependency = new Map<string, Array<string>>();
    const queuedIds = new Set<string>();

    for (const patchId of orderedIds) {
        incomingEdges.set(patchId, 0);
    }

    for (const patchId of orderedIds) {
        const patch = patchById.get(patchId);
        if (patch === undefined) {
            continue;
        }

        const dependencyIds = extractPatchDependencies(patch);
        if (dependencyIds.length === 0) {
            continue;
        }

        const uniqueDependencies = new Set<string>();
        for (const dependencyId of dependencyIds) {
            if (uniqueDependencies.has(dependencyId)) {
                continue;
            }
            uniqueDependencies.add(dependencyId);

            if (!patchIds.has(dependencyId) || dependencyId === patchId) {
                continue;
            }

            incomingEdges.set(patchId, (incomingEdges.get(patchId) ?? 0) + 1);

            const dependents = dependentsByDependency.get(dependencyId);
            if (dependents) {
                dependents.push(patchId);
            } else {
                dependentsByDependency.set(dependencyId, [patchId]);
            }
        }
    }

    const readyQueue: Array<string> = [];
    for (const patchId of orderedIds) {
        if ((incomingEdges.get(patchId) ?? 0) === 0) {
            readyQueue.push(patchId);
        }
    }

    let readyQueueHead = 0;
    const reordered: Array<unknown> = [];

    while (readyQueueHead < readyQueue.length) {
        const nextPatchId = readyQueue[readyQueueHead];
        readyQueueHead += 1;

        if (nextPatchId === undefined || queuedIds.has(nextPatchId)) {
            continue;
        }

        queuedIds.add(nextPatchId);
        const patch = patchById.get(nextPatchId);
        if (patch !== undefined) {
            reordered.push(patch);
        }

        for (const dependentId of dependentsByDependency.get(nextPatchId) ?? []) {
            const remainingEdges = (incomingEdges.get(dependentId) ?? 0) - 1;
            incomingEdges.set(dependentId, remainingEdges);
            if (remainingEdges === 0) {
                readyQueue.push(dependentId);
            }
        }
    }

    return reordered.length === orderedIds.length ? reordered : patches;
}
