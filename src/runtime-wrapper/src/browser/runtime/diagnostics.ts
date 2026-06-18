import { cloneObjectEntries } from "../support/index.js";
import { getPatchKindMetadata, getSupportedPatchKinds } from "./patch-kind.js";
import { calculateTimingMetrics } from "./patch-utils.js";
import type {
    PatchDiagnostics,
    PatchErrorAnalytics,
    PatchErrorCategory,
    PatchErrorOccurrence,
    PatchErrorSummary,
    PatchHistoryEntry,
    PatchKind,
    PatchStats,
    RegistryHealthCheck,
    RegistryHealthIssue,
    RuntimeFunction,
    RuntimeRegistrySnapshot,
    RuntimeWrapperState
} from "./types.js";

const PATCH_KINDS = getSupportedPatchKinds();

/**
 * Returns the sub-collection of the registry that stores entries for the
 * given {@link PatchKind}.
 */
export function getRegistryCollectionForPatchKind(
    registry: RuntimeWrapperState["registry"],
    kind: PatchKind
): Record<string, RuntimeFunction> {
    const metadata = getPatchKindMetadata(kind);
    return registry[metadata.registryCollectionKey];
}

/**
 * Returns a human-readable display name for a {@link PatchKind}.
 */
function getPatchKindDisplayName(kind: PatchKind): string {
    return getPatchKindMetadata(kind).displayName;
}

/**
 * Checks whether a given id is registered in the collection for the
 * specified {@link PatchKind}.
 */
export function hasRegistryEntry(registry: RuntimeWrapperState["registry"], kind: PatchKind, id: string): boolean {
    const collection = getRegistryCollectionForPatchKind(registry, kind);
    return id in collection;
}

/**
 * Retrieves the runtime function registered under the given id and kind,
 * or `undefined` if no such entry exists.
 */
export function getRegistryEntry(
    registry: RuntimeWrapperState["registry"],
    kind: PatchKind,
    id: string
): RuntimeFunction | undefined {
    const collection = getRegistryCollectionForPatchKind(registry, kind);
    return collection[id];
}

/**
 * Computes aggregate statistics over a patch history timeline.
 *
 * This is a pure function — it derives all statistics from the supplied
 * history array without reading or mutating external state.
 */
export function computePatchStats(patchHistory: ReadonlyArray<PatchHistoryEntry>): PatchStats {
    const stats: Omit<PatchStats, "uniqueIds"> = {
        totalPatches: patchHistory.length,
        appliedPatches: 0,
        undonePatches: 0,
        rolledBackPatches: 0,
        scriptPatches: 0,
        eventPatches: 0,
        closurePatches: 0
    };

    const uniqueIds = new Set<string>();
    const durations: Array<number> = [];

    for (const entry of patchHistory) {
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

/**
 * Builds a read-only snapshot of the current registry contents,
 * listing registered entry ids per patch kind.
 */
export function computeRegistrySnapshot(registry: RuntimeWrapperState["registry"]): RuntimeRegistrySnapshot {
    const scripts = Object.keys(getRegistryCollectionForPatchKind(registry, "script"));
    const events = Object.keys(getRegistryCollectionForPatchKind(registry, "event"));
    const closures = Object.keys(getRegistryCollectionForPatchKind(registry, "closure"));

    return {
        version: registry.version,
        scriptCount: scripts.length,
        eventCount: events.length,
        closureCount: closures.length,
        scripts,
        events,
        closures
    };
}

/**
 * Inspects every entry in the registry and reports structural issues
 * (e.g. non-function values stored in a function slot).
 */
export function computeRegistryHealthCheck(registry: RuntimeWrapperState["registry"]): RegistryHealthCheck {
    const issues: Array<RegistryHealthIssue> = [];
    for (const kind of PATCH_KINDS) {
        const displayName = getPatchKindDisplayName(kind);
        const collection = getRegistryCollectionForPatchKind(registry, kind);
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
        version: registry.version,
        issues
    };
}

/**
 * Aggregates diagnostic information for a single patch id by scanning
 * the full patch history.
 *
 * Returns `null` when no history entries exist for the given id.
 */
export function computePatchDiagnostics(
    id: string,
    patchHistory: ReadonlyArray<PatchHistoryEntry>,
    registry: RuntimeWrapperState["registry"]
): PatchDiagnostics | null {
    const historyEntries: Array<PatchHistoryEntry> = [];
    let kind: PatchKind | null = null;
    let metadata: PatchHistoryEntry["patch"]["metadata"] | undefined;
    let applicationCount = 0;
    let undoCount = 0;
    let rollbackCount = 0;
    let firstAppliedAt: number | null = null;
    let lastAppliedAt: number | null = null;
    let durationSum = 0;
    let durationCount = 0;

    for (const entry of patchHistory) {
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

    const currentlyApplied = hasRegistryEntry(registry, kind, id);

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

/**
 * Computes comprehensive error analytics across all patches.
 *
 * This is a pure function — it derives all analytics from the supplied
 * error and patch history arrays without reading or mutating external state.
 */
export function computeErrorAnalytics(
    errorHistory: ReadonlyArray<PatchErrorOccurrence>,
    patchHistory: ReadonlyArray<PatchHistoryEntry>
): PatchErrorAnalytics {
    const totalErrors = errorHistory.length;

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

    for (const errorEntry of errorHistory) {
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

    const recentErrors = cloneObjectEntries(errorHistory.slice(-20));

    const totalPatches = patchHistory.filter((entry) => entry.action === "apply").length;
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

/**
 * Computes an error summary for a single patch id.
 *
 * Returns `null` when no error occurrences exist for the given id.
 */
export function computeErrorsForPatch(
    patchId: string,
    errorHistory: ReadonlyArray<PatchErrorOccurrence>
): PatchErrorSummary | null {
    const errorsForPatch = errorHistory.filter((entry) => entry.patchId === patchId);

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
