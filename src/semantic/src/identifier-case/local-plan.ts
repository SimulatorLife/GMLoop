import { Core } from "@gmloop/core";

import { resolveProjectRelativeFilePath } from "../project-index/path-normalization.js";
import { applyAssetRenames, planAssetRenames } from "./asset-renames/index.js";
import { evaluateIdentifierCaseAssetRenamePolicy } from "./asset-renames/policy.js";
import { ConflictSeverity } from "./conflict-severity.js";
import { defaultIdentifierCaseFsFacade } from "./fs-facade.js";
import { peekIdentifierCaseDryRunContext } from "./identifier-case-context.js";
import { formatIdentifierCase } from "./identifier-case-utils.js";
import { setIdentifierCaseOption } from "./option-store.js";
import { IdentifierCaseStyle, normalizeIdentifierCaseAssetStyle, normalizeIdentifierCaseOptions } from "./options.js";
import { buildRenameKey } from "./plan-state.js";
import {
    buildPatternMatchers,
    COLLISION_CONFLICT_CODE,
    createConflict,
    formatConfigurationConflictMessage,
    resolveIdentifierConfigurationConflict,
    summarizeReferenceFileOccurrences
} from "./planning-helpers.js";
import {
    applyBootstrappedIdentifierCaseProjectIndex,
    ensureIdentifierCaseProjectIndex,
    resolveIdentifierCaseProjectIndex
} from "./project-index-gateway.js";

type IdentifierCaseDeclaration = {
    name?: string | null;
    scopeId?: string | null;
    start?: number | null;
    uniqueId?: string | null;
    classifications?: string[] | null;
    isBuiltIn?: boolean;
};

type IdentifierCaseEntry = {
    name?: string | null;
    displayName?: string | null;
    scopeId?: string | null;
    declarations?: IdentifierCaseDeclaration[] | null;
    classifications?: Array<string> | null;
    declarationKinds?: Array<string> | null;
    filePath?: string | null;
    uniqueId?: string | null;
    isBuiltIn?: boolean;
    start?: number | null;
};

type IdentifierCaseStyleValue = (typeof IdentifierCaseStyle)[keyof typeof IdentifierCaseStyle];

// Diagnostic counter used during triage to tag generated rename maps so they
// can be correlated across the prepare->capture->attach->apply lifecycle in
// test logs. This is deliberately minimal, non-functional, and attaches a
// non-enumerable property to the Map instance so it does not affect normal
// behavior. Remove once the failing fixtures are resolved.
let DBG_RENAME_MAP_COUNTER = 1;

function getScopeDisplayName(scopeRecord, fallback = "<unknown>") {
    if (!Core.isObjectLike(scopeRecord)) {
        return fallback;
    }

    return scopeRecord.displayName ?? scopeRecord.name ?? scopeRecord.id ?? fallback;
}

function createScopeGroupingKey(scopeId, fallback) {
    if (Core.isNonEmptyString(scopeId)) {
        return scopeId;
    }

    return fallback ?? "<unknown>";
}

function createScopeDescriptor(projectIndex, fileRecord, scopeId) {
    const fileScopeId = fileRecord?.scopeId ?? null;
    const scopeMap = projectIndex?.scopes ?? {};

    if (scopeId && scopeMap[scopeId]) {
        const scopeRecord = scopeMap[scopeId];
        return {
            id: scopeRecord.id,
            displayName: getScopeDisplayName(scopeRecord)
        };
    }

    if (fileScopeId && scopeMap[fileScopeId]) {
        const parentScope = scopeMap[fileScopeId];
        const parentDisplayName = getScopeDisplayName(parentScope, fileRecord?.filePath ?? "<locals>");
        return {
            id: scopeId ?? parentScope.id ?? `locals:${fileRecord?.filePath ?? "<unknown>"}`,
            displayName: `${parentDisplayName} (locals)`
        };
    }

    const filePath = fileRecord?.filePath ?? "<unknown>";
    return {
        id: scopeId ?? `locals:${filePath}`,
        displayName: `locals@${filePath}`
    };
}

function summarizeReferencesByFile(relativeFilePath, references) {
    return summarizeReferenceFileOccurrences(references, {
        fallbackPath: relativeFilePath
    });
}

function applyAssetRenamesIfEligible({ options, projectIndex, assetRenames, assetConflicts, metrics }) {
    const evaluation = evaluateIdentifierCaseAssetRenamePolicy({
        options,
        projectIndex,
        assetRenames,
        assetConflicts
    });

    if (!evaluation.shouldApply) {
        return;
    }

    const fsFacade =
        Core.coalesceOption(options, ["__identifierCaseFs", "identifierCaseFs"]) ?? defaultIdentifierCaseFsFacade;
    const logger = options.logger ?? null;
    const result = applyAssetRenames({
        projectIndex,
        renames: evaluation.renames,
        fsFacade,
        logger
    });
    setIdentifierCaseOption(options, "__identifierCaseAssetRenameResult", result);
    setIdentifierCaseOption(options, "__identifierCaseAssetRenamesApplied", true);
    metrics.counters.increment("assets.appliedRenames", result?.renames?.length ?? 0);
}

function resolveIdentifierEntryName(entry) {
    if (!Core.isObjectLike(entry)) {
        return null;
    }

    const declarations = Core.asArray(entry?.declarations) as IdentifierCaseDeclaration[];
    for (const declaration of declarations) {
        const declarationName = Core.getNonEmptyString(declaration?.name);
        if (declarationName) {
            return declarationName;
        }
    }

    const entryName = Core.getNonEmptyString(entry?.name);
    if (entryName) {
        return entryName;
    }

    const displayName = Core.getNonEmptyString(entry?.displayName);
    if (displayName) {
        return displayName;
    }

    return null;
}

function extractDeclarationClassifications(entry) {
    const tags = new Set();
    const classificationSources = [
        ...(Core.asArray(entry?.declarations) as IdentifierCaseDeclaration[]).flatMap(
            (declaration) => Core.asArray(declaration?.classifications) as string[]
        ),
        ...(Core.asArray(entry?.declarationKinds) as string[])
    ];

    for (const tag of classificationSources) {
        if (tag) {
            tags.add(tag);
        }
    }

    return tags;
}

function isStructScriptEntry(entry) {
    const tags = extractDeclarationClassifications(entry);
    if (tags.size === 0) {
        return false;
    }
    return tags.has("constructor") || tags.has("struct");
}

function isFunctionScriptEntry(entry) {
    const tags = extractDeclarationClassifications(entry);
    if (tags.size === 0) {
        return false;
    }
    if (tags.has("constructor") || tags.has("struct")) {
        return false;
    }
    return tags.has("script") || tags.has("function");
}

function summarizeReferencesAcrossFiles(references) {
    return summarizeReferenceFileOccurrences(references, {
        fallbackPath: null
    });
}

function getDeclarationFilePath(entry) {
    for (const declaration of entry?.declarations ?? []) {
        if (typeof declaration?.filePath === "string") {
            return declaration.filePath;
        }
    }
    return null;
}

function getReferenceLocation(reference) {
    if (!Core.isObjectLike(reference)) {
        return null;
    }
    return reference.start ?? reference.location?.start ?? null;
}

function createTopLevelScopeDescriptor(projectIndex, entry, fallbackKey) {
    const scopeMap = projectIndex?.scopes ?? {};
    const declarations = Core.asArray(entry?.declarations) as IdentifierCaseDeclaration[];

    for (const declaration of declarations) {
        const scopeId = declaration?.scopeId ?? entry?.scopeId ?? null;
        if (scopeId && scopeMap[scopeId]) {
            const scopeRecord = scopeMap[scopeId];
            return {
                id: scopeRecord.id,
                displayName: getScopeDisplayName(scopeRecord)
            };
        }
    }

    const scopeId = entry?.scopeId ?? null;
    if (scopeId && scopeMap[scopeId]) {
        const scopeRecord = scopeMap[scopeId];
        return {
            id: scopeRecord.id,
            displayName: getScopeDisplayName(scopeRecord)
        };
    }

    const identifierKey = entry?.identifierId ?? entry?.id ?? entry?.key ?? entry?.name ?? "";
    return {
        id: `${fallbackKey}:${identifierKey}`,
        displayName: fallbackKey
    };
}

const SCOPE_TYPE_LABELS = Object.freeze({
    functions: "function",
    structs: "struct constructor",
    macros: "macro",
    globals: "global variable",
    instance: "instance variable"
});

function describeScopeType(scopeType) {
    return SCOPE_TYPE_LABELS[scopeType] ?? scopeType;
}

function normalizeNameKey(name) {
    return typeof name === "string" ? Core.toNormalizedLowerCaseString(name) : "";
}

function createNameCollisionTracker() {
    const entriesByName = new Map();
    const entriesById = new Map();

    const addRecord = (record) => {
        const key = normalizeNameKey(record.name);
        const bucket = Core.getOrCreateMapEntry(entriesByName, key, () => []);
        bucket.push(record);
        entriesById.set(record.uniqueId, record);
    };

    return {
        registerExisting(scopeType, uniqueId, name, metadata) {
            if (!name || !uniqueId) {
                return;
            }
            addRecord({
                scopeType,
                uniqueId,
                name,
                metadata,
                isPlanned: false
            });
        },
        removeExisting(uniqueId) {
            if (!uniqueId || !entriesById.has(uniqueId)) {
                return null;
            }
            const record = entriesById.get(uniqueId);
            entriesById.delete(uniqueId);
            const key = normalizeNameKey(record.name);
            const bucket = entriesByName.get(key);
            if (bucket) {
                const index = bucket.findIndex((existing) => existing.uniqueId === uniqueId);
                if (index !== -1) {
                    bucket.splice(index, 1);
                }
                if (bucket.length === 0) {
                    entriesByName.delete(key);
                }
            }
            return record;
        },
        registerCandidate(scopeType, uniqueId, name, metadata) {
            if (!name || !uniqueId) {
                return [];
            }
            const key = normalizeNameKey(name);
            const bucket = entriesByName.get(key) ?? [];
            const collisions = bucket.filter((existing) => existing.uniqueId !== uniqueId);

            if (collisions.length === 0) {
                addRecord({
                    scopeType,
                    uniqueId,
                    name,
                    metadata,
                    isPlanned: true
                });
            }

            return collisions;
        }
    };
}

function createCrossScopeCollisionConflict({ scopeType, currentName, convertedName, collisions, scopeDescriptor }) {
    const scopeLabel = describeScopeType(scopeType);
    const otherDescriptions = collisions
        .map((collision) => {
            const otherLabel = describeScopeType(collision.scopeType);
            const otherName =
                collision.metadata?.currentName ?? collision.metadata?.entry?.name ?? collision.name ?? convertedName;
            return `${otherLabel} '${otherName}'`;
        })
        .join(", ");

    const message = `Renaming ${scopeLabel} '${currentName}' to '${convertedName}' collides with existing ${otherDescriptions}. Adjust your identifier case configuration or rename the conflicting identifiers before retrying.`;

    return createConflict({
        code: COLLISION_CONFLICT_CODE,
        severity: ConflictSeverity.ERROR,
        message,
        scope: scopeDescriptor,
        identifier: currentName
    });
}

function planIdentifierRenamesForScope({
    scopeType,
    entries,
    style,
    projectIndex,
    preservedSet,
    ignoreMatchers,
    renameMap,
    operations,
    conflicts,
    metrics,
    collisionTracker
}) {
    if (!Core.isNonEmptyArray(entries)) {
        return;
    }

    if (style === IdentifierCaseStyle.OFF) {
        return;
    }

    for (const entry of entries) {
        const currentName = resolveIdentifierEntryName(entry);
        if (typeof currentName !== "string" || currentName.length === 0) {
            continue;
        }

        const declarations = Core.asArray(entry?.declarations) as IdentifierCaseDeclaration[];
        if (declarations.length === 0) {
            continue;
        }

        const convertedName = formatIdentifierCase(currentName, style);
        if (convertedName === currentName || !convertedName) {
            continue;
        }

        const filePath = getDeclarationFilePath(entry);
        const configConflict = resolveIdentifierConfigurationConflict({
            preservedSet,
            identifierName: currentName,
            ignoreMatchers,
            filePath
        });

        const scopeDescriptor = createTopLevelScopeDescriptor(projectIndex, entry, scopeType);

        const uniqueKey = `${scopeType}:${entry?.identifierId ?? entry?.id ?? entry?.key ?? currentName}`;

        if (configConflict) {
            const message = formatConfigurationConflictMessage({
                configConflict,
                identifierName: currentName
            });

            conflicts.push(
                createConflict({
                    code: configConflict.code,
                    severity: ConflictSeverity.INFO,
                    message,
                    scope: scopeDescriptor,
                    identifier: currentName
                })
            );
            metrics?.counters?.increment(`${scopeType}.configurationConflicts`, 1);
            continue;
        }

        const removedRecord = collisionTracker.removeExisting(uniqueKey);
        const collisions = collisionTracker.registerCandidate(scopeType, uniqueKey, convertedName, {
            entry,
            currentName
        });

        if (collisions.length > 0) {
            if (removedRecord) {
                collisionTracker.registerExisting(
                    removedRecord.scopeType,
                    removedRecord.uniqueId,
                    removedRecord.name,
                    removedRecord.metadata
                );
            }

            conflicts.push(
                createCrossScopeCollisionConflict({
                    scopeType,
                    currentName,
                    convertedName,
                    collisions,
                    scopeDescriptor
                })
            );
            metrics?.counters?.increment(`${scopeType}.collisionConflicts`, 1);
            continue;
        }

        const referenceSummaries = summarizeReferencesAcrossFiles(entry.references);

        operations.push({
            id: `${scopeType}:${entry?.identifierId ?? entry?.id ?? currentName}`,
            kind: "identifier",
            scope: scopeDescriptor,
            from: { name: currentName },
            to: { name: convertedName },
            references: referenceSummaries
        });
        metrics?.counters?.increment(`${scopeType}.operations`, 1);

        for (const declaration of declarations) {
            const renameKey = buildRenameKey(declaration?.scopeId ?? null, declaration?.start ?? null);
            if (!renameKey) {
                continue;
            }
            renameMap.set(renameKey, convertedName);
            metrics?.counters?.increment(`${scopeType}.renameMapEntries`, 1);
        }

        for (const reference of entry.references ?? []) {
            const location = getReferenceLocation(reference);
            if (!location) {
                continue;
            }
            const renameKey = buildRenameKey(reference?.scopeId ?? null, location);
            if (!renameKey) {
                continue;
            }
            renameMap.set(renameKey, convertedName);
            metrics?.counters?.increment(`${scopeType}.renameMapEntries`, 1);
        }
    }
}

function planTopLevelIdentifierRenames({
    projectIndex,
    styles,
    preservedSet,
    ignoreMatchers,
    renameMap,
    operations,
    conflicts,
    metrics
}) {
    if (!projectIndex || !projectIndex.identifiers) {
        return;
    }

    const identifiers = projectIndex.identifiers;
    const scriptEntries = Object.values(identifiers.scripts ?? {});
    const functionEntries = scriptEntries.filter((entry) => isFunctionScriptEntry(entry));
    const structEntries = scriptEntries.filter((entry) => isStructScriptEntry(entry));
    const macroEntries = Object.values(identifiers.macros ?? {});
    const globalEntries = Object.values(identifiers.globalVariables ?? {});
    const instanceEntries = Object.values(identifiers.instanceVariables ?? {});

    const collisionTracker = createNameCollisionTracker();

    const registerEntries = (scopeType, entries) => {
        for (const entry of entries ?? []) {
            const name = resolveIdentifierEntryName(entry);
            if (!name) {
                continue;
            }
            const uniqueKey = `${scopeType}:${entry?.identifierId ?? entry?.id ?? entry?.key ?? name}`;
            collisionTracker.registerExisting(scopeType, uniqueKey, name, {
                entry,
                currentName: name
            });
        }
    };

    registerEntries("functions", functionEntries);
    registerEntries("structs", structEntries);
    registerEntries("macros", macroEntries);
    registerEntries("globals", globalEntries);
    registerEntries("instance", instanceEntries);

    planIdentifierRenamesForScope({
        scopeType: "functions",
        entries: functionEntries,
        style: styles.functions,
        projectIndex,
        preservedSet,
        ignoreMatchers,
        renameMap,
        operations,
        conflicts,
        metrics,
        collisionTracker
    });

    planIdentifierRenamesForScope({
        scopeType: "structs",
        entries: structEntries,
        style: styles.structs,
        projectIndex,
        preservedSet,
        ignoreMatchers,
        renameMap,
        operations,
        conflicts,
        metrics,
        collisionTracker
    });

    planIdentifierRenamesForScope({
        scopeType: "macros",
        entries: macroEntries,
        style: styles.macros,
        projectIndex,
        preservedSet,
        ignoreMatchers,
        renameMap,
        operations,
        conflicts,
        metrics,
        collisionTracker
    });

    planIdentifierRenamesForScope({
        scopeType: "globals",
        entries: globalEntries,
        style: styles.globals,
        projectIndex,
        preservedSet,
        ignoreMatchers,
        renameMap,
        operations,
        conflicts,
        metrics,
        collisionTracker
    });

    planIdentifierRenamesForScope({
        scopeType: "instance",
        entries: instanceEntries,
        style: styles.instance,
        projectIndex,
        preservedSet,
        ignoreMatchers,
        renameMap,
        operations,
        conflicts,
        metrics,
        collisionTracker
    });
}

export async function prepareIdentifierCasePlan(options) {
    if (!options) {
        return;
    }

    applyIdentifierCaseDryRunOverrides(options);

    if (options.__identifierCasePlanGeneratedInternally === true) {
        return;
    }

    if (options.__identifierCaseRenamePlan && options.__identifierCasePlanGeneratedInternally !== true) {
        return;
    }

    const context = peekIdentifierCaseDryRunContext(options.filepath ?? null);
    applyIdentifierCaseDryRunContext(options, context);
    applyBootstrappedIdentifierCaseProjectIndex(options);

    let projectIndex = resolveIdentifierCaseProjectIndex(options, context?.projectIndex ?? null);

    const metricsContext = createIdentifierCaseMetricsContext(options);
    const metrics = metricsContext.metrics;
    const metricsReporting = metricsContext.metricsReporting;
    const stopTotal = metricsContext.stopTotal;
    // Scripts, macros, globals, structs, and instance assignments are tracked via
    // `projectIndex.identifiers`. The scope-specific toggles fan out through the
    // rename planner so we can generate dry-run diagnostics, collision reports,
    // and rename maps without mutating sources when the style is disabled.

    const normalizedOptions: any = normalizeIdentifierCaseOptions(options);
    const styleSettings = resolveIdentifierCaseStyles(normalizedOptions);
    const planFlags = resolveIdentifierCasePlanFlags(styleSettings);

    if (!projectIndex && planFlags.requiresProjectIndex) {
        projectIndex = await ensureIdentifierCaseProjectIndex(options, context?.projectIndex ?? null);
    }

    recordIdentifierCaseStyleMetadata(metrics, styleSettings);

    const preservedIdentifiers = normalizedOptions.preservedIdentifiers;
    const preservedSet: Set<string> = new Set(
        Core.asArray(preservedIdentifiers).filter((v) => typeof v === "string") as string[]
    );
    const ignoreMatchers = buildPatternMatchers(normalizedOptions.ignorePatterns ?? []);

    const finalizeMetrics = createIdentifierCaseMetricsFinalizer({
        options,
        stopTotal,
        metricsReporting
    });

    const renameMap = new Map();
    const operations = [];
    const conflicts = [];
    const assetRenames = [];
    let assetConflicts = [];

    if (projectIndex && styleSettings.assetStyle !== IdentifierCaseStyle.OFF) {
        const assetPlan = planIdentifierCaseAssets({
            projectIndex,
            assetStyle: styleSettings.assetStyle,
            preservedSet,
            ignoreMatchers,
            metrics
        });
        operations.push(...assetPlan.operations);
        conflicts.push(...assetPlan.conflicts);
        assetRenames.push(...assetPlan.renames);
        assetConflicts = assetPlan.conflicts ?? [];
    }

    if (
        projectIndex &&
        (planFlags.shouldPlanFunctions ||
            planFlags.shouldPlanStructs ||
            planFlags.shouldPlanMacros ||
            planFlags.shouldPlanInstance ||
            planFlags.shouldPlanGlobals)
    ) {
        planTopLevelIdentifierRenames({
            projectIndex,
            styles: {
                functions: styleSettings.functionStyle,
                structs: styleSettings.structStyle,
                macros: styleSettings.macroStyle,
                instance: styleSettings.instanceStyle,
                globals: styleSettings.globalStyle
            },
            preservedSet,
            ignoreMatchers,
            renameMap,
            operations,
            conflicts,
            metrics
        });
    }

    const hasLocalSupport = projectIndex && projectIndex.files && styleSettings.localStyle !== IdentifierCaseStyle.OFF;

    if (hasLocalSupport) {
        metrics.counters.increment("locals.supportedFiles");
    }

    const localFileContext = resolveIdentifierCaseLocalFileContext({
        hasLocalSupport,
        projectIndex,
        options
    });
    const fileRecord = localFileContext.fileRecord;
    const relativeFilePath = localFileContext.relativeFilePath;

    if (!fileRecord) {
        finalizePlanWithoutFileRecord({
            options,
            projectIndex,
            relativeFilePath,
            renameMap,
            operations,
            conflicts,
            assetRenames,
            assetConflicts,
            metrics,
            finalizeMetrics
        });
        return;
    }

    const appliedCandidates = planLocalCandidatesForFileRecord({
        fileRecord,
        projectIndex,
        relativeFilePath,
        preservedSet,
        ignoreMatchers,
        localStyle: styleSettings.localStyle,
        metrics,
        conflicts
    });

    registerLocalOperations({
        appliedCandidates,
        projectIndex,
        fileRecord,
        relativeFilePath,
        operations,
        renameMap,
        metrics
    });

    // Tag the generated rename map with a debug id to help trace whether
    // the same Map instance flows through capture/attach/apply or if new
    // instances are created/overwritten. This metadata is non-enumerable
    // and purely diagnostic; remove it after triage is complete.
    try {
        if (renameMap && typeof Object.defineProperty === "function" && !Object.hasOwn(renameMap, "__dbgId")) {
            Object.defineProperty(renameMap, "__dbgId", {
                value: `rm-${DBG_RENAME_MAP_COUNTER++}`,
                enumerable: false,
                configurable: true,
                writable: false
            });
        }
    } catch {
        /* ignore */
    }

    setIdentifierCaseOption(options, "__identifierCaseRenameMap", renameMap);
    finalizeIdentifierCasePlan({
        options,
        operations,
        conflicts,
        assetRenames
    });

    applyAssetRenamesIfEligible({
        options,
        projectIndex,
        assetRenames,
        assetConflicts,
        metrics
    });

    const metricsReport = finalizeMetrics({
        resolvedFile: Boolean(fileRecord),
        relativeFilePath,
        operationCount: operations.length,
        conflictCount: conflicts.length,
        renameEntries: typeof renameMap.size === "number" ? renameMap.size : Core.getIterableSize(renameMap)
    });

    if (options.__identifierCaseRenamePlan) {
        options.__identifierCaseRenamePlan.metrics = metricsReport;
    }
}

function applyIdentifierCaseDryRunOverrides(options: any) {
    if (options.__identifierCaseDryRun === undefined && options.identifierCaseDryRun !== undefined) {
        setIdentifierCaseOption(options, "__identifierCaseDryRun", options.identifierCaseDryRun);
    }
}

function applyIdentifierCaseDryRunContext(options: any, context: any) {
    if (options.__identifierCaseDryRun === undefined && context && typeof context.dryRun === "boolean") {
        setIdentifierCaseOption(options, "__identifierCaseDryRun", context.dryRun);
    }
}

function createIdentifierCaseMetricsContext(options: any) {
    const logger = options.logger ?? null;
    const metricsContracts = Core.createMetricsTracker({
        category: "identifier-case-plan",
        logger,
        autoLog: options.logIdentifierCaseMetrics === true
    });
    const metrics = metricsContracts.recording;
    const metricsReporting = metricsContracts.reporting;
    setIdentifierCaseOption(options, "__identifierCaseMetrics", metricsContracts);
    const stopTotal = metrics.timers.startTimer("preparePlan");

    return { metrics, metricsReporting, stopTotal };
}

type IdentifierCaseStyleSettings = {
    localStyle: IdentifierCaseStyleValue;
    assetStyle: IdentifierCaseStyleValue;
    functionStyle: IdentifierCaseStyleValue;
    structStyle: IdentifierCaseStyleValue;
    macroStyle: IdentifierCaseStyleValue;
    instanceStyle: IdentifierCaseStyleValue;
    globalStyle: IdentifierCaseStyleValue;
};

function resolveIdentifierCaseStyles(normalizedOptions: any): IdentifierCaseStyleSettings {
    const localStyle = normalizedOptions.scopeStyles?.locals ?? IdentifierCaseStyle.OFF;
    const assetStyle = normalizeIdentifierCaseAssetStyle(normalizedOptions.scopeStyles?.assets);
    const functionStyle = normalizedOptions.scopeStyles?.functions ?? "off";
    const structStyle = normalizedOptions.scopeStyles?.structs ?? "off";
    const macroStyle = normalizedOptions.scopeStyles?.macros ?? "off";
    const instanceStyle = normalizedOptions.scopeStyles?.instance ?? "off";
    const globalStyle = normalizedOptions.scopeStyles?.globals ?? "off";

    return {
        localStyle,
        assetStyle,
        functionStyle,
        structStyle,
        macroStyle,
        instanceStyle,
        globalStyle
    };
}

function resolveIdentifierCasePlanFlags(styles: IdentifierCaseStyleSettings) {
    const shouldPlanLocals = styles.localStyle !== IdentifierCaseStyle.OFF;
    const shouldPlanAssets = styles.assetStyle !== IdentifierCaseStyle.OFF;
    const shouldPlanFunctions = styles.functionStyle !== "off";
    const shouldPlanStructs = styles.structStyle !== "off";
    const shouldPlanMacros = styles.macroStyle !== "off";
    const shouldPlanInstance = styles.instanceStyle !== "off";
    const shouldPlanGlobals = styles.globalStyle !== "off";

    return {
        shouldPlanLocals,
        shouldPlanAssets,
        shouldPlanFunctions,
        shouldPlanStructs,
        shouldPlanMacros,
        shouldPlanInstance,
        shouldPlanGlobals,
        requiresProjectIndex:
            shouldPlanLocals ||
            shouldPlanAssets ||
            shouldPlanFunctions ||
            shouldPlanStructs ||
            shouldPlanMacros ||
            shouldPlanInstance ||
            shouldPlanGlobals
    };
}

function recordIdentifierCaseStyleMetadata(metrics: any, styles: IdentifierCaseStyleSettings) {
    for (const [key, value] of Object.entries(styles)) {
        metrics.metadata.setMetadata(key, value);
    }
}

function createIdentifierCaseMetricsFinalizer({
    options,
    stopTotal,
    metricsReporting
}: {
    options: any;
    stopTotal: () => void;
    metricsReporting: any;
}) {
    return (extraMetadata = {}) => {
        stopTotal();
        const report = metricsReporting.summary.finalize({
            metadata: extraMetadata
        });
        setIdentifierCaseOption(options, "__identifierCaseMetricsReport", report);
        return report;
    };
}

function planIdentifierCaseAssets({
    projectIndex,
    assetStyle,
    preservedSet,
    ignoreMatchers,
    metrics
}: {
    projectIndex: any;
    assetStyle: IdentifierCaseStyleValue;
    preservedSet: Set<string>;
    ignoreMatchers: ReturnType<typeof buildPatternMatchers>;
    metrics: any;
}) {
    metrics.counters.increment("assets.projectsWithIndex");
    const assetPlan = metrics.timers.timeSync("assets.plan", () =>
        planAssetRenames({
            projectIndex,
            assetStyle,
            preservedSet,
            ignoreMatchers,
            metrics
        })
    );
    metrics.counters.increment("assets.operations", assetPlan.operations.length);
    metrics.counters.increment("assets.conflicts", assetPlan.conflicts.length);
    metrics.counters.increment("assets.renames", assetPlan.renames.length);

    return assetPlan;
}

function resolveIdentifierCaseLocalFileContext({
    hasLocalSupport,
    projectIndex,
    options
}: {
    hasLocalSupport: boolean;
    projectIndex: any;
    options: any;
}) {
    if (!hasLocalSupport) {
        return { fileRecord: null, relativeFilePath: null };
    }

    const relativeFilePath = resolveProjectRelativeFilePath(projectIndex.projectRoot, options.filepath ?? null);
    const fileRecord =
        relativeFilePath && projectIndex.files[relativeFilePath] ? projectIndex.files[relativeFilePath] : null;

    return { fileRecord, relativeFilePath };
}

function finalizeIdentifierCasePlan({
    options,
    operations,
    conflicts,
    assetRenames
}: {
    options: any;
    operations: any[];
    conflicts: any[];
    assetRenames: any[];
}) {
    if (assetRenames.length > 0) {
        setIdentifierCaseOption(options, "__identifierCaseAssetRenames", assetRenames);
    }

    if (operations.length === 0 && conflicts.length === 0) {
        setIdentifierCaseOption(options, "__identifierCasePlanGeneratedInternally", true);
        return;
    }

    setIdentifierCaseOption(options, "__identifierCaseRenamePlan", {
        operations
    });
    setIdentifierCaseOption(options, "__identifierCaseConflicts", conflicts);
    setIdentifierCaseOption(options, "__identifierCasePlanGeneratedInternally", true);
}

type FinalizePlanWithoutFileRecordParams = {
    options: any;
    projectIndex: any;
    relativeFilePath: string | null;
    renameMap: Map<any, any>;
    operations: any[];
    conflicts: any[];
    assetRenames: any[];
    assetConflicts: any[];
    metrics: any;
    finalizeMetrics: (metadata?: Record<string, unknown>) => any;
};

function finalizePlanWithoutFileRecord({
    options,
    projectIndex,
    relativeFilePath,
    renameMap,
    operations,
    conflicts,
    assetRenames,
    assetConflicts,
    metrics,
    finalizeMetrics
}: FinalizePlanWithoutFileRecordParams) {
    try {
        if (renameMap && typeof Object.defineProperty === "function" && !Object.hasOwn(renameMap, "__dbgId")) {
            Object.defineProperty(renameMap, "__dbgId", {
                value: `rm-${DBG_RENAME_MAP_COUNTER++}`,
                enumerable: false,
                configurable: true,
                writable: false
            });
        }
    } catch {
        /* ignore */
    }

    if (renameMap && typeof renameMap.size === "number" && renameMap.size > 0) {
        setIdentifierCaseOption(options, "__identifierCaseRenameMap", renameMap);
    }

    if (assetRenames.length > 0) {
        setIdentifierCaseOption(options, "__identifierCaseAssetRenames", assetRenames);
    }

    const metricsReport = finalizeMetrics({
        resolvedFile: false,
        relativeFilePath
    });

    if (operations.length === 0 && conflicts.length === 0) {
        // No rename operations or conflicts were detected during case analysis,
        // so we skip attaching the plan to the options object. The formatter will
        // continue without applying any identifier-case transformations to this file.
    } else {
        setIdentifierCaseOption(options, "__identifierCaseRenamePlan", {
            operations
        });
        setIdentifierCaseOption(options, "__identifierCaseConflicts", conflicts);
    }

    applyAssetRenamesIfEligible({
        options,
        projectIndex,
        assetRenames,
        assetConflicts,
        metrics
    });
    setIdentifierCaseOption(options, "__identifierCasePlanGeneratedInternally", true);
    if (options.__identifierCaseRenamePlan) {
        options.__identifierCaseRenamePlan.metrics = metricsReport;
    }
}

type LocalCandidate = {
    declaration: IdentifierCaseDeclaration;
    convertedName: string;
    references: Array<IdentifierCaseEntry | null>;
    scopeGroupKey: string;
};

type PlanLocalCandidatesParams = {
    fileRecord: IdentifierCaseEntry;
    projectIndex: any;
    relativeFilePath: string | null;
    preservedSet: Set<string>;
    ignoreMatchers: ReturnType<typeof buildPatternMatchers>;
    localStyle: IdentifierCaseStyleValue;
    metrics: any;
    conflicts: any[];
};

function planLocalCandidatesForFileRecord({
    fileRecord,
    projectIndex,
    relativeFilePath,
    preservedSet,
    ignoreMatchers,
    localStyle,
    metrics,
    conflicts
}: PlanLocalCandidatesParams): LocalCandidate[] {
    const existingNamesByScope = collectExistingNamesByScope(fileRecord, projectIndex, metrics);
    const referencesByScopeAndName = collectReferencesByScopeAndName(
        fileRecord,
        projectIndex,
        relativeFilePath,
        metrics
    );

    const activeCandidates = gatherActiveLocalCandidates({
        fileRecord,
        projectIndex,
        relativeFilePath,
        preservedSet,
        ignoreMatchers,
        localStyle,
        existingNamesByScope,
        referencesByScopeAndName,
        metrics,
        conflicts
    });

    return resolveLocalCandidateCollisions({
        activeCandidates,
        projectIndex,
        fileRecord,
        conflicts,
        metrics
    });
}

function collectExistingNamesByScope(fileRecord, projectIndex, metrics) {
    const existingNamesByScope = new Map();

    for (const declaration of fileRecord.declarations ?? []) {
        if (!declaration || !declaration.name) {
            continue;
        }

        metrics.counters.increment("locals.declarationsScanned");

        const scopeKey = createScopeGroupingKey(declaration.scopeId, fileRecord.scopeId);
        const existing = existingNamesByScope.get(scopeKey) ?? new Set();
        existing.add(declaration.name);
        existingNamesByScope.set(scopeKey, existing);
    }

    return existingNamesByScope;
}

function collectReferencesByScopeAndName(fileRecord, projectIndex, relativeFilePath, metrics) {
    const referencesByScopeAndName = new Map();

    for (const reference of fileRecord.references ?? []) {
        if (!reference || reference.isBuiltIn) {
            continue;
        }

        metrics.counters.increment("locals.referencesScanned");

        const classifications = Core.asArray(reference?.classifications) as string[];

        if (!classifications.includes("variable")) {
            continue;
        }

        const scopeKey = createScopeGroupingKey(reference.scopeId, fileRecord.scopeId);
        const key = `${scopeKey}|${reference.name}`;
        const list = referencesByScopeAndName.get(key) ?? [];
        list.push({
            ...reference,
            filePath: relativeFilePath
        });
        referencesByScopeAndName.set(key, list);
    }

    return referencesByScopeAndName;
}

type GatherActiveLocalCandidatesParams = {
    fileRecord: IdentifierCaseEntry;
    projectIndex: any;
    relativeFilePath: string | null;
    preservedSet: Set<string>;
    ignoreMatchers: ReturnType<typeof buildPatternMatchers>;
    localStyle: IdentifierCaseStyleValue;
    existingNamesByScope: Map<string, Set<string>>;
    referencesByScopeAndName: Map<string, Array<any>>;
    metrics: any;
    conflicts: any[];
};

function gatherActiveLocalCandidates({
    fileRecord,
    projectIndex,
    relativeFilePath,
    preservedSet,
    ignoreMatchers,
    localStyle,
    existingNamesByScope,
    referencesByScopeAndName,
    metrics,
    conflicts
}: GatherActiveLocalCandidatesParams): LocalCandidate[] {
    const activeCandidates: LocalCandidate[] = [];

    for (const declaration of fileRecord.declarations ?? []) {
        if (!declaration || declaration.isBuiltIn) {
            continue;
        }

        metrics.counters.increment("locals.declarationCandidates");

        const classifications = Core.asArray(declaration?.classifications) as string[];

        if (!classifications.includes("variable")) {
            continue;
        }

        if (classifications.includes("global")) {
            continue;
        }

        const renameKey = buildRenameKey(declaration.scopeId, declaration.start);
        if (!renameKey) {
            continue;
        }

        const convertedName = formatIdentifierCase(declaration.name, localStyle);

        if (convertedName === declaration.name) {
            continue;
        }

        const configConflict = resolveIdentifierConfigurationConflict({
            preservedSet,
            identifierName: declaration.name,
            ignoreMatchers,
            filePath: relativeFilePath
        });

        if (configConflict) {
            metrics.counters.increment("locals.configurationConflicts");
            const scopeDescriptor = createScopeDescriptor(projectIndex, fileRecord, declaration.scopeId);

            const message = formatConfigurationConflictMessage({
                configConflict,
                identifierName: declaration.name
            });

            conflicts.push(
                createConflict({
                    code: configConflict.code,
                    severity: ConflictSeverity.INFO,
                    message,
                    scope: scopeDescriptor,
                    identifier: declaration.name
                })
            );
            continue;
        }

        const scopeGroupKey = createScopeGroupingKey(declaration.scopeId, fileRecord.scopeId);
        const existingNames = existingNamesByScope.get(scopeGroupKey) ?? new Set();

        if (existingNames.has(convertedName) && convertedName !== declaration.name) {
            const scopeDescriptor = createScopeDescriptor(projectIndex, fileRecord, declaration.scopeId);
            conflicts.push(
                createConflict({
                    code: COLLISION_CONFLICT_CODE,
                    severity: ConflictSeverity.ERROR,
                    message: `Renaming '${declaration.name}' to '${convertedName}' collides with existing identifier '${convertedName}'.`,
                    scope: scopeDescriptor,
                    identifier: declaration.name
                })
            );
            metrics.counters.increment("locals.collisionConflicts");
            continue;
        }

        const referenceKey = `${scopeGroupKey}|${declaration.name}`;
        const relatedReferences = referencesByScopeAndName.get(referenceKey) ?? [];

        activeCandidates.push({
            declaration,
            convertedName,
            references: relatedReferences,
            scopeGroupKey
        });
        metrics.counters.increment("locals.candidatesAccepted");
    }

    return activeCandidates;
}

type ResolveLocalCandidateCollisionsParams = {
    activeCandidates: LocalCandidate[];
    projectIndex: any;
    fileRecord: IdentifierCaseEntry;
    conflicts: any[];
    metrics: any;
};

function resolveLocalCandidateCollisions({
    activeCandidates,
    projectIndex,
    fileRecord,
    conflicts,
    metrics
}: ResolveLocalCandidateCollisionsParams): LocalCandidate[] {
    const candidatesByScope = new Map<string, Map<string, LocalCandidate[]>>();

    for (const candidate of activeCandidates) {
        const scopeCandidates = candidatesByScope.get(candidate.scopeGroupKey) ?? new Map();
        const existing = scopeCandidates.get(candidate.convertedName) ?? [];
        existing.push(candidate);
        scopeCandidates.set(candidate.convertedName, existing);
        candidatesByScope.set(candidate.scopeGroupKey, scopeCandidates);
    }

    const appliedCandidates: LocalCandidate[] = [];
    for (const [, nameMap] of candidatesByScope.entries()) {
        for (const [convertedName, groupedCandidates] of nameMap.entries()) {
            if (groupedCandidates.length > 1) {
                for (const candidate of groupedCandidates) {
                    const scopeDescriptor = createScopeDescriptor(
                        projectIndex,
                        fileRecord,
                        candidate.declaration.scopeId
                    );
                    const otherNames = groupedCandidates
                        .filter((other) => other !== candidate)
                        .map((other) => other.declaration.name);
                    conflicts.push(
                        createConflict({
                            code: COLLISION_CONFLICT_CODE,
                            severity: ConflictSeverity.ERROR,
                            message: `Renaming '${candidate.declaration.name}' to '${convertedName}' collides with ${otherNames
                                .map((name) => `'${name}'`)
                                .join(", ")}.`,
                            scope: scopeDescriptor,
                            identifier: candidate.declaration.name
                        })
                    );
                    metrics.counters.increment("locals.collisionConflicts");
                }
                continue;
            }

            appliedCandidates.push(groupedCandidates[0]);
            metrics.counters.increment("locals.candidatesApplied");
        }
    }

    return appliedCandidates;
}

type RegisterLocalOperationsParams = {
    appliedCandidates: LocalCandidate[];
    projectIndex: any;
    fileRecord: IdentifierCaseEntry;
    relativeFilePath: string | null;
    operations: any[];
    renameMap: Map<any, any>;
    metrics: any;
};

function registerLocalOperations({
    appliedCandidates,
    projectIndex,
    fileRecord,
    relativeFilePath,
    operations,
    renameMap,
    metrics
}: RegisterLocalOperationsParams) {
    for (const candidate of appliedCandidates) {
        metrics.counters.increment("locals.operations", 1);
        const { declaration, convertedName, references } = candidate;
        const scopeDescriptor = createScopeDescriptor(projectIndex, fileRecord, declaration.scopeId);

        const referenceSummaries = summarizeReferencesByFile(relativeFilePath, references);

        operations.push({
            id: `local:${scopeDescriptor.id ?? candidate.scopeGroupKey}:${declaration.name}`,
            kind: "identifier",
            scope: {
                id: scopeDescriptor.id,
                displayName: scopeDescriptor.displayName
            },
            from: { name: declaration.name },
            to: { name: convertedName },
            references: referenceSummaries
        });

        const declarationKey = buildRenameKey(declaration.scopeId, declaration.start);
        if (declarationKey) {
            renameMap.set(declarationKey, convertedName);
            metrics.counters.increment("locals.renameMapEntries");
        }

        for (const reference of references) {
            const referenceKey = buildRenameKey(reference.scopeId, reference.start);
            if (referenceKey) {
                renameMap.set(referenceKey, convertedName);
                metrics.counters.increment("locals.renameMapEntries");
            }
        }
    }
}

export {
    applyIdentifierCasePlanSnapshot,
    captureIdentifierCasePlanSnapshot,
    getIdentifierCaseRenameForNode
} from "./plan-state.js";
