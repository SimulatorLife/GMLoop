import { Core } from "@gmloop/core";

import type { RuntimeTranspilerPatch } from "./coordinator.js";

function resolvePatchDependencies(patch: RuntimeTranspilerPatch): ReadonlyArray<string> {
    const metadata = Core.isObjectLike(patch.metadata) ? patch.metadata : null;
    const dependencies = metadata?.dependencies;

    if (!Array.isArray(dependencies) || dependencies.length === 0) {
        return [];
    }

    return dependencies.filter(
        (dependency): dependency is string => typeof dependency === "string" && dependency.length > 0
    );
}

/**
 * Orders cached patches for late-subscriber replay so dependency patches are
 * delivered before the patches that reference them.
 *
 * When the watch command replays its last successful patches to a newly
 * connected runtime, the runtime receives them as individual WebSocket
 * messages rather than a single batch. Preserving dependency order prevents a
 * dependent script from arriving before the script it calls.
 *
 * Cycles and missing dependencies fall back to the original insertion order so
 * replay remains deterministic without stalling delivery.
 *
 * @param patches - Cached runtime patches in their current insertion order
 * @returns Patches reordered for deterministic dependency-first replay
 */
export function orderPatchesForReplay(patches: ReadonlyArray<RuntimeTranspilerPatch>): Array<RuntimeTranspilerPatch> {
    if (patches.length < 2) {
        return Array.from(patches);
    }

    const patchById = new Map<string, RuntimeTranspilerPatch>();
    const originalOrder = new Map<string, number>();
    const incomingEdgeCount = new Map<string, number>();
    const dependentsByDependency = new Map<string, Array<string>>();
    let hasInReplayDependencies = false;

    for (const [index, patch] of patches.entries()) {
        if (patchById.has(patch.id)) {
            continue;
        }

        patchById.set(patch.id, patch);
        originalOrder.set(patch.id, index);
        incomingEdgeCount.set(patch.id, 0);
    }

    for (const patch of patchById.values()) {
        for (const dependencyId of resolvePatchDependencies(patch)) {
            if (dependencyId === patch.id || !patchById.has(dependencyId)) {
                continue;
            }

            hasInReplayDependencies = true;
            incomingEdgeCount.set(patch.id, (incomingEdgeCount.get(patch.id) ?? 0) + 1);

            const dependents = dependentsByDependency.get(dependencyId);
            if (dependents) {
                dependents.push(patch.id);
            } else {
                dependentsByDependency.set(dependencyId, [patch.id]);
            }
        }
    }

    if (!hasInReplayDependencies) {
        return Array.from(patches);
    }

    const readyPatchIds = Array.from(incomingEdgeCount.entries())
        .filter(([, incomingEdges]) => incomingEdges === 0)
        .map(([patchId]) => patchId)
        .sort((leftId, rightId) => (originalOrder.get(leftId) ?? 0) - (originalOrder.get(rightId) ?? 0));

    const orderedPatches: Array<RuntimeTranspilerPatch> = [];

    while (readyPatchIds.length > 0) {
        const nextPatchId = readyPatchIds.shift();
        if (!nextPatchId) {
            continue;
        }

        const nextPatch = patchById.get(nextPatchId);
        if (!nextPatch) {
            continue;
        }

        orderedPatches.push(nextPatch);

        for (const dependentId of dependentsByDependency.get(nextPatchId) ?? []) {
            const remainingEdges = (incomingEdgeCount.get(dependentId) ?? 0) - 1;
            incomingEdgeCount.set(dependentId, remainingEdges);
            if (remainingEdges === 0) {
                readyPatchIds.push(dependentId);
                readyPatchIds.sort(
                    (leftId, rightId) => (originalOrder.get(leftId) ?? 0) - (originalOrder.get(rightId) ?? 0)
                );
            }
        }
    }

    if (orderedPatches.length !== patchById.size) {
        return Array.from(patches);
    }

    return orderedPatches;
}
