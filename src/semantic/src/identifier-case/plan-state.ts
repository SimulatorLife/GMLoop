import { Core, type GameMakerAstNode, type MutableGameMakerAstNode } from "@gmloop/core";

import { setIdentifierCaseOption } from "./option-store.js";

type IdentifierCasePlanLookupOptions = {
    filepath?: string | null;
};

function buildRenameKey(_scopeId, location) {
    // Accept numeric start indices as well as location objects. Some AST
    // transformations normalize node locations to raw indices while the
    // planner uses full location objects; normalize numeric inputs so the
    // resulting location key encoding is consistent between planning and
    // printing.
    const normalizedLocation = typeof location === "number" ? { index: location } : location;

    const locationKey = Core.buildLocationKey(normalizedLocation);
    if (!locationKey) {
        return null;
    }

    return locationKey;
}

/**
 * Resolve the rename target for a node when an identifier case plan has been
 * generated. The helper centralizes the guard rails shared by the printer and
 * local planning pipeline so they stay in sync about when a rename can run.
 *
 * - Missing node metadata or absent rename maps short-circuit with `null`.
 * - Dry-run executions and plan snapshots marked as dry-run are ignored to
 *   avoid mutating emitted output.
 *
 * @param node AST node whose identifier may be renamed.
 * @param options Active plugin options possibly containing rename plan state.
 * @returns The planned identifier rename when available.
 */
export function getIdentifierCaseRenameForNode(node: MutableGameMakerAstNode | null, options: unknown) {
    if (!node || !options || typeof options !== "object") {
        return null;
    }

    const optionObject = options as Record<string, unknown>;
    const renameMap = optionObject.__identifierCaseRenameMap;
    if (!Core.isMapLike(renameMap)) {
        return null;
    }
    const renameMapEntries = renameMap as Map<unknown, unknown>;

    const key = buildRenameKey(node.scopeId ?? null, node.start ?? null);
    if (!key) {
        return null;
    }

    let renameTarget = renameMapEntries.get(key) ?? null;
    if (!renameTarget) {
        renameTarget = tryResolveRenameTarget(renameMapEntries, key, node, optionObject);
    }

    if (!renameTarget) {
        return null;
    }

    const planSnapshot = optionObject.__identifierCasePlanSnapshot;

    if (optionObject.__identifierCaseDryRun === true) {
        return null;
    }

    if (planSnapshot && typeof planSnapshot === "object" && "dryRun" in planSnapshot && planSnapshot.dryRun === true) {
        return null;
    }

    return renameTarget;
}

function tryResolveRenameTarget(
    renameMap: Map<unknown, unknown>,
    key: string,
    node: GameMakerAstNode,
    options: IdentifierCasePlanLookupOptions
): unknown {
    try {
        if (typeof renameMap.has === "function" && renameMap.has(key) === false) {
            try {
                const loc = typeof node.start === "number" ? { index: node.start } : node.start;
                const fileKey = Core.buildFileLocationKey(options?.filepath ?? null, loc);
                if (fileKey && typeof renameMap.has === "function" && renameMap.has(fileKey)) {
                    return renameMap.get(fileKey) ?? null;
                }
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* ignore */
    }

    return null;
}

/**
 * Capture a shallow snapshot of the identifier case plan metadata stored on
 * the options bag. Callers can persist the result to survive across formatter
 * invocations (for example when formatting multiple files) and later apply it
 * with {@link applyIdentifierCasePlanSnapshot}.
 *
 * @param {unknown} options Options object carrying identifier case metadata.
 * @returns {null | {
 *     projectIndex: unknown;
 *     projectRoot: unknown;
 *     bootstrap: unknown;
 *     renameMap: unknown;
 *     renamePlan: unknown;
 *     conflicts: unknown;
 *     metricsReport: unknown;
 *     metrics: unknown;
 *     assetRenames: unknown;
 *     assetRenameResult: unknown;
 *     assetRenamesApplied: unknown;
 *     dryRun: boolean | null;
 *     planGenerated: boolean;
 * }}
 */
export function captureIdentifierCasePlanSnapshot(options) {
    return Core.withObjectLike(
        options,
        (object) => {
            const snapshot = {
                projectIndex: object.__identifierCaseProjectIndex ?? null,
                projectRoot: object.__identifierCaseProjectRoot ?? null,
                bootstrap: object.__identifierCaseProjectIndexBootstrap ?? null,
                renameMap: object.__identifierCaseRenameMap ?? null,
                renamePlan: object.__identifierCaseRenamePlan ?? null,
                conflicts: object.__identifierCaseConflicts ?? null,
                metricsReport: object.__identifierCaseMetricsReport ?? null,
                metrics: object.__identifierCaseMetrics ?? null,
                assetRenames: object.__identifierCaseAssetRenames ?? null,
                assetRenameResult: object.__identifierCaseAssetRenameResult ?? null,
                assetRenamesApplied: object.__identifierCaseAssetRenamesApplied ?? null,
                dryRun: object.__identifierCaseDryRun === undefined ? null : object.__identifierCaseDryRun,
                planGenerated: object.__identifierCasePlanGeneratedInternally === true
            };

            try {
                // If a renameMap exists, emit a small sample of keys to help
                // diagnose mismatched key encodings between planning and
                // printing. Keep messages defensive so tests don't crash on
                // unexpected shapes.
                if (Core.isMapLike(snapshot.renameMap)) {
                    const samples = [];
                    let i = 0;
                    for (const k of snapshot.renameMap.keys()) {
                        let v = null;
                        try {
                            v = snapshot.renameMap.get(k);
                        } catch {
                            /* ignore */
                        }
                        samples.push(`${Core.describeValueForError(k)}=>${Core.describeValueForError(v)}`);
                        i += 1;
                        if (i >= 5) break;
                    }
                }
            } catch {
                /* ignore */
            }

            return snapshot;
        },
        null
    );
}

const SNAPSHOT_OPTION_ENTRIES = Object.freeze([
    ["projectIndex", "__identifierCaseProjectIndex"],
    ["projectRoot", "__identifierCaseProjectRoot"],
    ["bootstrap", "__identifierCaseProjectIndexBootstrap"],
    ["renameMap", "__identifierCaseRenameMap"],
    ["renamePlan", "__identifierCaseRenamePlan"],
    ["conflicts", "__identifierCaseConflicts"],
    ["metricsReport", "__identifierCaseMetricsReport"],
    ["metrics", "__identifierCaseMetrics"],
    ["assetRenames", "__identifierCaseAssetRenames"],
    ["assetRenameResult", "__identifierCaseAssetRenameResult"]
]);

function defineHiddenOption(object, optionKey, value) {
    setIdentifierCaseOption(object, optionKey, value);
    Object.defineProperty(object, optionKey, {
        value,
        writable: true,
        configurable: true,
        enumerable: false
    });
}

/**
 * Rehydrate the identifier case planning metadata onto an options bag using a
 * snapshot captured earlier. Values are only written when the destination does
 * not already define the target option to respect run-time overrides. Hidden
 * options (such as the dry-run flag) are defined as non-enumerable properties
 * so they do not leak into user-facing configuration dumps.
 *
 * @param {ReturnType<typeof captureIdentifierCasePlanSnapshot>} snapshot
 * @param {Record<string, unknown> | null | undefined} options
 * @returns {void}
 */
export function applyIdentifierCasePlanSnapshot(snapshot, options) {
    if (!snapshot) {
        return;
    }

    Core.withObjectLike(
        options,
        (object) => {
            for (const [snapshotKey, optionKey] of SNAPSHOT_OPTION_ENTRIES) {
                const value = snapshot[snapshotKey];
                // Special-case the renameMap: avoid applying an empty map as that
                // would overwrite a previously-captured non-empty plan. Only write
                // the renameMap when it is map-like and contains at least one
                // entry. Other snapshot entries follow the existing semantics.
                if (snapshotKey === "renameMap") {
                    const isMap = Core.isMapLike(value);
                    const size = isMap && typeof value.size === "number" ? value.size : 0;
                    if (isMap && size > 0 && !object[optionKey]) {
                        setIdentifierCaseOption(object, optionKey, value);
                        logIdentifierCaseRenameMapSamples(value as Map<unknown, unknown>);
                    }
                    // After writing the option, emit an identity check to confirm
                    // whether the snapshot's map instance is the same object that
                    // now lives on the options bag. This helps detect cases where
                    // the map may have been cloned, cleared, or replaced between
                    // capture and apply.

                    continue;
                }

                if (value && !object[optionKey]) {
                    setIdentifierCaseOption(object, optionKey, value);
                }
            }

            defineHiddenOption(object, "__identifierCasePlanSnapshot", snapshot);

            if (
                snapshot.assetRenamesApplied !== undefined &&
                object.__identifierCaseAssetRenamesApplied === undefined
            ) {
                setIdentifierCaseOption(object, "__identifierCaseAssetRenamesApplied", snapshot.assetRenamesApplied);
            }

            if (snapshot.dryRun !== null) {
                defineHiddenOption(object, "__identifierCaseDryRun", snapshot.dryRun);
            }

            if (snapshot.planGenerated) {
                setIdentifierCaseOption(object, "__identifierCasePlanGeneratedInternally", true);
            }
        },
        null
    );
}

export { buildRenameKey };

function logIdentifierCaseRenameMapSamples(value: Map<unknown, unknown>): void {
    try {
        const formatKey = (key: unknown) => {
            if (typeof key === "string") {
                return key;
            }

            if (key === null) {
                return "null";
            }

            if (key === undefined) {
                return "undefined";
            }

            if (typeof key === "number" || typeof key === "boolean") {
                return String(key);
            }

            try {
                return JSON.stringify(key);
            } catch {
                return Object.prototype.toString.call(key);
            }
        };

        const samples: Array<string> = [];
        let count = 0;
        for (const key of value.keys()) {
            samples.push(formatKey(key));
            count += 1;
            if (count >= 3) {
                break;
            }
        }
    } catch {
        /* ignore */
    }
}
