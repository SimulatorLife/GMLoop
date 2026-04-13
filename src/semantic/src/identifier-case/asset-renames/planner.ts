import path from "node:path";

import { Core } from "@gmloop/core";

import { ConflictSeverity } from "../conflict-severity.js";
import type { defaultIdentifierCaseFsFacade } from "../fs-facade.js";
import { formatIdentifierCase } from "../identifier-case-utils.js";
import { IdentifierCaseStyle, normalizeIdentifierCaseAssetStyle } from "../options.js";
import {
    COLLISION_CONFLICT_CODE,
    createConflict,
    formatConfigurationConflictMessage,
    RESERVED_CONFLICT_CODE,
    resolveIdentifierConfigurationConflict,
    summarizeReferenceFileOccurrences
} from "../planning-helpers.js";
import { createAssetRenameExecutor } from "./executor.js";

const RESERVED_IDENTIFIER_NAMES = Core.loadReservedIdentifierNames();

type AssetReferenceMutation = {
    filePath?: string;
    propertyPath?: string;
    originalName?: string;
};

type AssetReference = {
    propertyPath?: string;
    targetPath?: string;
    targetName?: string;
    fromResourcePath?: string;
};

type AssetGmlRename = {
    from: string;
    to: string;
};

type AssetRename = {
    resourcePath?: string;
    resourceType?: string;
    originalName?: string;
    finalName?: string;
    fromName?: string;
    toName?: string;
    newResourcePath?: string;
    gmlRenames?: Array<AssetGmlRename>;
    referenceMutations?: Array<AssetReferenceMutation>;
};

type AssetResourceRecord = {
    name?: string;
    resourceType?: string;
    gmlFiles?: Array<string>;
};

type AssetDirectoryEntry = {
    directory: string;
    resourcePath: string;
    resourceType: string | null;
    originalName: string | null;
    finalName: string | null;
    isRename: boolean;
    rename: AssetRename | null;
};

type MetricsRecorder = {
    counters?: {
        increment?: (key: string, amount?: number) => void;
    };
};

type AssetRenameEntry = {
    directory: string;
    resourcePath: string;
    resourceType: string | null;
    originalName: string;
    finalName: string;
    isRename: boolean;
    rename: AssetRename | null;
};

type AssetConflictOptions = {
    conflicts: Array<unknown>;
    metrics?: MetricsRecorder | null;
    metricKey?: string | null;
    code: string;
    severity?: ConflictSeverity;
    message: string;
    resourcePath?: string | null;
    resourceType?: string | null;
    identifierName?: string | null;
    details?: unknown;
    includeSuggestions?: boolean;
    suggestions?: Array<string> | null;
};

type ProjectIndexWithAssets = {
    projectRoot?: string | null;
    resources?: Record<string, AssetResourceRecord>;
    relationships?: {
        assetReferences?: Array<AssetReference>;
    };
};

type IdentifierCaseLogger = {
    warn?: (message: string) => void;
};

type IdentifierCaseStyleValue = (typeof IdentifierCaseStyle)[keyof typeof IdentifierCaseStyle];

type PlanAssetRenamesOptions = {
    projectIndex?: ProjectIndexWithAssets | null;
    assetStyle?: IdentifierCaseStyleValue | null;
    preservedSet?: Set<string>;
    ignoreMatchers?: Array<string>;
    metrics?: MetricsRecorder | null;
};

type ApplyAssetRenamesOptions = {
    projectIndex?: ProjectIndexWithAssets | null;
    renames?: Array<AssetRename>;
    fsFacade?: typeof defaultIdentifierCaseFsFacade | null;
    logger?: IdentifierCaseLogger | null;
};

function isReservedIdentifierName(name) {
    const normalizedName = Core.toNormalizedLowerCaseString(name);
    if (!normalizedName) {
        return false;
    }

    if (RESERVED_IDENTIFIER_NAMES.size === 0) {
        return false;
    }

    return RESERVED_IDENTIFIER_NAMES.has(normalizedName);
}

function buildAssetConflictSuggestions(identifierName) {
    const suggestions = [];

    if (Core.isNonEmptyString(identifierName)) {
        suggestions.push(`Add '${identifierName}' to gmlIdentifierCaseIgnore`);
    }

    suggestions.push('Disable asset renames by setting gmlIdentifierCaseAssets to "off"');

    return suggestions;
}

function mapRenameConflictDetails(entries) {
    return entries.map((entry) => ({
        resourcePath: entry.resourcePath,
        originalName: entry.originalName,
        finalName: entry.finalName,
        isRename: entry.isRename
    }));
}

function pushAssetRenameConflict({
    conflicts,
    metrics,
    metricKey,
    code,
    severity = ConflictSeverity.ERROR,
    message,
    resourcePath,
    resourceType,
    identifierName,
    details,
    includeSuggestions = true,
    suggestions
}: AssetConflictOptions) {
    const scope = {
        id: resourcePath,
        displayName: `${resourceType}.${identifierName}`
    };

    const resolvedSuggestions =
        suggestions === undefined
            ? includeSuggestions && Core.isNonEmptyString(identifierName)
                ? buildAssetConflictSuggestions(identifierName)
                : null
            : suggestions;

    conflicts.push(
        createConflict({
            code,
            severity,
            message,
            scope,
            identifier: identifierName,
            ...(details !== undefined && { details }),
            ...(resolvedSuggestions?.length ? { suggestions: resolvedSuggestions } : {})
        })
    );

    if (metricKey) {
        metrics?.counters?.increment(metricKey);
    }
}

function recordAssetRenameCollision({
    conflicts,
    renameEntry,
    conflictingEntries,
    message,
    metrics
}: {
    conflicts: Array<unknown>;
    renameEntry: AssetDirectoryEntry;
    conflictingEntries: Array<AssetDirectoryEntry>;
    message: string;
    metrics?: MetricsRecorder | null;
}) {
    pushAssetRenameConflict({
        conflicts,
        metrics,
        metricKey: "assets.collisionConflicts",
        code: COLLISION_CONFLICT_CODE,
        message,
        resourcePath: renameEntry.resourcePath,
        resourceType: renameEntry.resourceType,
        identifierName: renameEntry.originalName,
        details: {
            targetName: renameEntry.finalName,
            conflicts: mapRenameConflictDetails(conflictingEntries)
        }
    });
}

function collectDirectoryEntries({
    projectIndex,
    renames
}: {
    projectIndex?: ProjectIndexWithAssets | null;
    renames?: Array<AssetRename>;
}) {
    const renameByResourcePath = new Map<string, AssetRename>();
    for (const rename of renames ?? []) {
        if (!rename?.resourcePath) {
            continue;
        }
        renameByResourcePath.set(rename.resourcePath, rename);
    }

    const resources = projectIndex?.resources ?? {};
    const directories = new Map<string, Array<AssetDirectoryEntry>>();

    for (const [resourcePath, resourceRecord] of Object.entries(resources)) {
        if (!resourceRecord || resourceRecord.resourceType !== "GMScript" || typeof resourceRecord.name !== "string") {
            continue;
        }

        const rename = (renameByResourcePath.get(resourcePath) ?? null) as AssetRename | null;
        const finalName = rename?.toName ?? resourceRecord.name;
        if (!Core.isNonEmptyString(finalName)) {
            continue;
        }

        const directory = path.posix.dirname(resourcePath);
        const list = Core.getOrCreateMapEntry(directories, directory, () => []);
        list.push({
            directory,
            resourcePath,
            resourceType: resourceRecord.resourceType,
            originalName: resourceRecord.name,
            finalName,
            isRename: Boolean(rename),
            rename
        });
    }

    return directories;
}

function hasPendingAssetRenames(projectIndex, renames) {
    return Boolean(projectIndex) && Core.isNonEmptyArray(renames);
}

function detectAssetRenameConflicts({
    projectIndex,
    renames,
    metrics = null
}: {
    projectIndex?: ProjectIndexWithAssets | null;
    renames?: Array<AssetRename>;
    metrics?: MetricsRecorder | null;
}) {
    if (!hasPendingAssetRenames(projectIndex, renames)) {
        return [];
    }

    const directories = collectDirectoryEntries({ projectIndex, renames });
    const conflicts = [];

    for (const entries of directories.values()) {
        const byLowerName = new Map();
        for (const entry of entries) {
            const key = Core.toNormalizedLowerCaseString(entry.finalName);
            const bucket = Core.getOrCreateMapEntry(byLowerName, key, () => []);
            bucket.push(entry);
        }

        for (const bucket of byLowerName.values()) {
            if (bucket.length <= 1) {
                continue;
            }

            const renameEntries = bucket.filter((entry) => entry.isRename);
            if (renameEntries.length === 0) {
                continue;
            }

            const existingEntries = bucket.filter((entry) => !entry.isRename);
            const existingCollisionSummary =
                existingEntries.length > 0
                    ? existingEntries.map((entry) => `'${entry.originalName}' (${entry.resourcePath})`).join(", ")
                    : "";
            const renameNames = renameEntries.map((entry) => `'${entry.originalName}'`);

            for (const [index, renameEntry] of renameEntries.entries()) {
                if (existingEntries.length > 0) {
                    recordAssetRenameCollision({
                        conflicts,
                        renameEntry,
                        conflictingEntries: existingEntries,
                        message: `Renaming '${renameEntry.originalName}' to '${renameEntry.finalName}' collides with existing asset ${existingCollisionSummary}.`,
                        metrics
                    });
                }

                if (renameEntries.length <= 1) {
                    continue;
                }

                const otherRenameInfo = collectOtherRenameEntries(renameEntries, index, renameNames);
                if (!otherRenameInfo) {
                    continue;
                }

                const { otherRenames, otherNames } = otherRenameInfo;

                recordAssetRenameCollision({
                    conflicts,
                    renameEntry,
                    conflictingEntries: otherRenames,
                    message: `Renaming '${renameEntry.originalName}' to '${renameEntry.finalName}' collides with ${otherNames} targeting the same name.`,
                    metrics
                });
            }
        }
    }

    for (const rename of renames) {
        if (!rename?.toName || !isReservedIdentifierName(rename.toName)) {
            continue;
        }

        pushAssetRenameConflict({
            conflicts,
            metrics,
            metricKey: "assets.reservedConflicts",
            code: RESERVED_CONFLICT_CODE,
            message: `Renaming '${rename.fromName}' to '${rename.toName}' conflicts with reserved identifier '${rename.toName}'.`,
            resourcePath: rename.resourcePath,
            resourceType: rename.resourceType,
            identifierName: rename.fromName,
            details: {
                targetName: rename.toName
            }
        });
    }

    return conflicts;
}

function collectOtherRenameEntries(
    renameEntries: readonly AssetRenameEntry[],
    currentIndex: number,
    renameNames: string[]
) {
    const otherRenames: AssetRenameEntry[] = [];
    let otherNames = "";

    for (const [otherIndex, otherEntry] of renameEntries.entries()) {
        if (otherIndex === currentIndex) {
            continue;
        }

        otherRenames.push(otherEntry);
        otherNames = otherNames ? `${otherNames}, ${renameNames[otherIndex]}` : renameNames[otherIndex];
    }

    if (otherRenames.length === 0) {
        return null;
    }

    return { otherRenames, otherNames };
}

function summarizeReferences(referenceMutations, resourcePath) {
    const includeFilePaths = Core.isNonEmptyString(resourcePath) ? [resourcePath] : [];

    return summarizeReferenceFileOccurrences(referenceMutations, {
        includeFilePaths,
        fallbackPath: null
    });
}

function groupAssetReferencesByTargetPath(
    assetReferences?: Array<AssetReference> | null
): Map<string, Array<AssetReference>> {
    const referencesByTargetPath = new Map<string, Array<AssetReference>>();

    for (const reference of assetReferences ?? []) {
        if (!reference || typeof reference.targetPath !== "string") {
            continue;
        }

        const references = Core.getOrCreateMapEntry(referencesByTargetPath, reference.targetPath, () => []);
        references.push(reference);
    }

    return referencesByTargetPath;
}

function collectReferenceMutations(
    inboundReferences: Array<AssetReference>,
    originalName: string
): Array<AssetReferenceMutation> {
    return inboundReferences
        .filter((reference) => typeof reference.fromResourcePath === "string")
        .map((reference) => ({
            filePath: reference.fromResourcePath,
            propertyPath: reference.propertyPath ?? "",
            originalName: reference.targetName ?? originalName
        }));
}

function collectGmlRenames(resourceRecord, originalName, convertedName) {
    const gmlRenames = [];

    for (const gmlFile of resourceRecord.gmlFiles ?? []) {
        const extension = path.posix.extname(gmlFile);
        const baseName = path.posix.basename(gmlFile, extension);
        if (baseName !== originalName) {
            continue;
        }

        const renamedPath = path.posix.join(path.posix.dirname(gmlFile), `${convertedName}${extension}`);
        gmlRenames.push({ from: gmlFile, to: renamedPath });
    }

    return gmlRenames;
}

function planRenamesForResources({
    resources,
    assetStyle,
    preservedSet,
    ignoreMatchers,
    referencesByTargetPath,
    metrics
}: {
    resources?: Record<string, AssetResourceRecord>;
    assetStyle: IdentifierCaseStyleValue;
    preservedSet: Set<string>;
    ignoreMatchers: Array<string>;
    referencesByTargetPath: Map<string, Array<AssetReference>>;
    metrics?: MetricsRecorder | null;
}) {
    if (!resources) {
        return { operations: [], conflicts: [], renames: [] };
    }

    const namesByDirectory = new Map<string, { name: string; path: string }>();
    const operations: Array<unknown> = [];
    const conflicts: Array<unknown> = [];
    const renames: Array<AssetRename> = [];

    for (const [resourcePath, resourceRecordValue] of Object.entries(resources)) {
        const resourceRecord = resourceRecordValue as AssetResourceRecord;
        planRenameForResource({
            resourcePath,
            resourceRecord,
            assetStyle,
            preservedSet,
            ignoreMatchers,
            referencesByTargetPath,
            namesByDirectory,
            metrics,
            operations,
            conflicts,
            renames
        });
    }

    return { operations, conflicts, renames };
}

function planRenameForResource({
    resourcePath,
    resourceRecord,
    assetStyle,
    preservedSet,
    ignoreMatchers,
    referencesByTargetPath,
    namesByDirectory,
    metrics,
    operations,
    conflicts,
    renames
}: {
    resourcePath: string;
    resourceRecord?: AssetResourceRecord;
    assetStyle: IdentifierCaseStyleValue;
    preservedSet: Set<string>;
    ignoreMatchers: Array<string>;
    referencesByTargetPath: Map<string, Array<AssetReference>>;
    namesByDirectory: Map<string, { name: string; path: string }>;
    metrics?: MetricsRecorder | null;
    operations: Array<unknown>;
    conflicts: Array<unknown>;
    renames: Array<AssetRename>;
}) {
    if (!resourceRecord || !resourceRecord.name) {
        return;
    }

    metrics?.counters?.increment("assets.resourcesScanned");

    if (resourceRecord.resourceType !== "GMScript") {
        return;
    }

    const originalName = resourceRecord.name;
    const convertedName = formatIdentifierCase(originalName, assetStyle);

    if (!convertedName || convertedName === originalName) {
        return;
    }

    metrics?.counters?.increment("assets.renameCandidates");

    const configConflict = resolveIdentifierConfigurationConflict({
        preservedSet,
        identifierName: originalName,
        ignoreMatchers,
        filePath: resourcePath
    });

    if (configConflict) {
        metrics?.counters?.increment("assets.configurationConflicts");
        const message = formatConfigurationConflictMessage({
            configConflict,
            identifierName: originalName,
            noun: "Asset"
        });

        pushAssetRenameConflict({
            conflicts,
            code: configConflict.code,
            severity: ConflictSeverity.INFO,
            message,
            resourcePath,
            resourceType: resourceRecord.resourceType,
            identifierName: originalName,
            includeSuggestions: false
        });
        return;
    }

    const directory = path.posix.dirname(resourcePath);
    const collisionKey = `${directory}|${convertedName.toLowerCase()}`;
    const existing = namesByDirectory.get(collisionKey);

    if (existing) {
        pushAssetRenameConflict({
            conflicts,
            metrics,
            metricKey: "assets.collisionConflicts",
            code: COLLISION_CONFLICT_CODE,
            message: `Renaming '${originalName}' to '${convertedName}' collides with existing asset '${existing.name}'.`,
            resourcePath,
            resourceType: resourceRecord.resourceType,
            identifierName: originalName,
            includeSuggestions: false
        });
        return;
    }

    namesByDirectory.set(collisionKey, {
        name: originalName,
        path: resourcePath
    });

    const inboundReferences = referencesByTargetPath.get(resourcePath) ?? [];
    const referenceMutations = collectReferenceMutations(inboundReferences, originalName);

    const newResourcePath = path.posix.join(directory, `${convertedName}.yy`);
    const gmlRenames = collectGmlRenames(resourceRecord, originalName, convertedName);

    renames.push({
        resourcePath,
        resourceType: resourceRecord.resourceType,
        fromName: originalName,
        toName: convertedName,
        newResourcePath,
        gmlRenames,
        referenceMutations
    });

    metrics?.counters?.increment("assets.renamesQueued");

    operations.push({
        id: `asset:${resourceRecord.resourceType}:${resourcePath}`,
        kind: "asset",
        scope: {
            id: resourcePath,
            displayName: `${resourceRecord.resourceType}.${originalName}`
        },
        from: { name: originalName },
        to: { name: convertedName },
        references: summarizeReferences(referenceMutations, resourcePath)
    });
}

export function planAssetRenames({
    projectIndex,
    assetStyle,
    preservedSet = new Set(),
    ignoreMatchers = [],
    metrics = null
}: PlanAssetRenamesOptions = {}) {
    const normalizedAssetStyle = normalizeIdentifierCaseAssetStyle(assetStyle);

    if (!projectIndex || !projectIndex.resources || normalizedAssetStyle === IdentifierCaseStyle.OFF) {
        return { operations: [], conflicts: [], renames: [] };
    }

    const referencesByTargetPath = groupAssetReferencesByTargetPath(projectIndex.relationships?.assetReferences ?? []);

    const { operations, conflicts, renames } = planRenamesForResources({
        resources: projectIndex.resources,
        assetStyle: normalizedAssetStyle,
        preservedSet,
        ignoreMatchers,
        referencesByTargetPath,
        metrics
    });

    const validationConflicts = detectAssetRenameConflicts({
        projectIndex,
        renames,
        metrics
    });

    if (validationConflicts.length > 0) {
        conflicts.push(...validationConflicts);
        return { operations, conflicts, renames: [] };
    }

    return { operations, conflicts, renames };
}

export function applyAssetRenames({
    projectIndex,
    renames,
    fsFacade = null,
    logger = null
}: ApplyAssetRenamesOptions = {}) {
    if (!hasPendingAssetRenames(projectIndex, renames)) {
        return { writes: [], renames: [] };
    }

    const executor = createAssetRenameExecutor({
        projectIndex,
        fsFacade,
        logger
    });

    let hasQueuedRenames = false;
    for (const rename of renames) {
        const queued = executor.queueRename(rename);
        if (queued) {
            hasQueuedRenames = true;
        }
    }

    if (!hasQueuedRenames) {
        return { writes: [], renames: [] };
    }

    return executor.commit();
}
