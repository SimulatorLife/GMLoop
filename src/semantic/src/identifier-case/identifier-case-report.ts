/**
 * Identifier case reporting helpers.
 *
 * Normalizes rename plans/conflicts collected during identifier case dry runs
 * so downstream consumers (CLI output, diagnostics, and log files) receive
 * consistently shaped metadata regardless of the input source.
 */

import path from "node:path";

import { Core } from "@gmloop/core";

import { ConflictSeverity, normalizeConflictSeverityWithFallback } from "./conflict-severity.js";
import {
    consumeIdentifierCaseDryRunContext,
    defaultIdentifierCaseFsFacade as defaultFsFacade,
    warnWithReason
} from "./identifier-case-helpers.js";
import { getIdentifierCaseOptionStore, setIdentifierCaseOption } from "./option-store.js";

type IdentifierCaseReportSummary = {
    renameCount: number;
    impactedFileCount: number;
    totalReferenceCount: number;
    conflictCount: number;
    severityCounts: Partial<Record<ConflictSeverity, number>>;
};

type IdentifierCaseReference = {
    filePath: string;
    occurrences?: number;
};

type IdentifierCaseOperation = {
    id?: string | null;
    kind?: string | null;
    scopeId?: string | null;
    scopeName?: string | null;
    fromName?: string | null;
    toName?: string | null;
    occurrenceCount?: number;
    referenceFileCount?: number;
    references?: Array<IdentifierCaseReference>;
};

type IdentifierCaseConflict = {
    severity?: ConflictSeverity;
    scope: {
        displayName?: string | null;
        id?: string | null;
    };
    identifier?: string | null;
    code?: string | null;
    message: string;
    suggestions: Array<string>;
};

type IdentifierCasePlanData = {
    renamePlan?: unknown;
    conflicts?: Array<unknown>;
};

type IdentifierCaseReportData = {
    summary?: IdentifierCaseReportSummary;
    operations?: Array<IdentifierCaseOperation>;
    conflicts?: Array<IdentifierCaseConflict>;
    renames?: Array<{
        id?: string | null;
        kind?: string | null;
        scopeId?: string | null;
        scopeName?: string | null;
        fromName?: string | null;
        toName?: string | null;
        references?: Array<IdentifierCaseReference>;
    }>;
};

type IdentifierCaseReportLogger = {
    log?: (message: string) => void;
    warn?: (...args: Array<unknown>) => void;
};

type ReportIdentifierCasePlanOptions = IdentifierCasePlanData & {
    conflicts?: Array<unknown>;
    logger?: IdentifierCaseReportLogger;
    diagnostics?: Array<unknown> | null;
    logFilePath?: string | null;
    fsFacade?: {
        mkdirSync?: (path: string, options?: { recursive?: boolean }) => void;
        writeFileSync?: (path: string, data: string) => void;
    };
    now?: () => number;
};

const REPORT_NAMESPACE = "gml-identifier-case";
const LOG_VERSION = 1;

function getNormalizedOperations(report) {
    return Core.asArray(report?.operations);
}

function getNormalizedConflicts(conflicts) {
    return Core.asArray(conflicts);
}

function buildIdentifierCaseOptionKeys(baseName) {
    return [`__identifierCase${baseName}`, `identifierCase${baseName}`];
}

function getIdentifierCaseOption(options, baseName, coalesceOptions?) {
    return Core.coalesceOption(options, buildIdentifierCaseOptionKeys(baseName), coalesceOptions);
}

function extractOperations(plan: any) {
    if (Array.isArray(plan)) {
        return plan;
    }

    if (!Core.isObjectLike(plan)) {
        return [];
    }

    if (Array.isArray(plan.operations)) {
        return plan.operations;
    }

    if (Array.isArray(plan.renames)) {
        return plan.renames;
    }

    return [];
}

function normalizeReference(reference) {
    if (!Core.isObjectLike(reference)) {
        return null;
    }

    const filePath = Core.coalesceTrimmedString(reference.filePath, reference.path, reference.file);

    if (!filePath) {
        return null;
    }

    const occurrenceCandidate = reference.occurrences ?? reference.count ?? reference.references ?? 0;
    const occurrences = Number.isFinite(occurrenceCandidate) ? Number(occurrenceCandidate) : 0;

    return {
        filePath,
        occurrences: Math.max(occurrences, 0)
    };
}

function normalizeScope(scope) {
    if (!Core.isObjectLike(scope)) {
        return { id: null, displayName: null, name: null };
    }

    const displayName = Core.coalesceTrimmedString(scope.displayName, scope.name, scope.scope, scope.path);
    const id = Core.coalesceTrimmedString(scope.id, scope.scopeId);

    return {
        id: id || null,
        displayName: displayName || null,
        name: Core.coalesceTrimmedString(scope.name) || null
    };
}

function normalizeOperation(rawOperation) {
    return Core.withObjectLike(
        rawOperation,
        (operation) => {
            const scope = normalizeScope(operation.scope ?? {});

            const fromName = Core.coalesceTrimmedString(
                operation.from?.name,
                operation.source?.name,
                operation.originalName,
                operation.from,
                operation.source
            );
            const toName = Core.coalesceTrimmedString(
                operation.to?.name,
                operation.target?.name,
                operation.updatedName,
                operation.to,
                operation.target
            );

            const referenceCandidates = Core.compactArray(Core.toArray(operation.references).map(normalizeReference));
            const references = referenceCandidates.toSorted((a, b) => a.filePath.localeCompare(b.filePath));

            const occurrenceCount = references.reduce((total, reference) => total + (reference.occurrences ?? 0), 0);

            const referenceFileCount = new Set(references.map((reference) => reference.filePath)).size;

            return {
                id: Core.coalesceTrimmedString(operation.id, operation.identifier) || null,
                kind: Core.coalesceTrimmedString(operation.kind, operation.type) || "identifier",
                scopeId: scope.id,
                scopeName: scope.displayName ?? scope.name ?? null,
                fromName: fromName || null,
                toName: toName || null,
                references,
                occurrenceCount,
                referenceFileCount
            };
        },
        null
    );
}

function normalizeConflict(rawConflict) {
    return Core.withObjectLike(
        rawConflict,
        (conflict) => {
            const scope = normalizeScope(conflict.scope ?? {});
            const severityCandidate = Core.coalesceTrimmedString(conflict.severity);
            const severity = normalizeConflictSeverityWithFallback(severityCandidate, ConflictSeverity.ERROR);

            const suggestions = Core.compactArray(
                Core.toArray(conflict.suggestions ?? conflict.hints).map((entry) => Core.coalesceTrimmedString(entry))
            );

            return {
                code: Core.coalesceTrimmedString(conflict.code, conflict.identifier, conflict.type) || null,
                message: Core.coalesceTrimmedString(conflict.message, conflict.reason) || "",
                severity,
                scope: {
                    id: scope.id,
                    displayName: scope.displayName ?? scope.name ?? null
                },
                identifier:
                    Core.coalesceTrimmedString(conflict.identifier, conflict.name, conflict.originalName) || null,
                suggestions,
                details: conflict.details && typeof conflict.details === "object" ? { ...conflict.details } : null
            };
        },
        null
    );
}

function sortOperations(operations) {
    return operations.toSorted((a, b) => {
        const scopeCompare = (a.scopeName ?? "").localeCompare(b.scopeName ?? "");
        if (scopeCompare !== 0) return scopeCompare;

        const fromCompare = (a.fromName ?? "").localeCompare(b.fromName ?? "");
        if (fromCompare !== 0) return fromCompare;

        return (a.toName ?? "").localeCompare(b.toName ?? "");
    });
}

function sortConflicts(conflicts) {
    const severityOrder = new Map<ConflictSeverity, number>([
        [ConflictSeverity.ERROR, 0],
        [ConflictSeverity.WARNING, 1],
        [ConflictSeverity.INFO, 2]
    ]);

    return conflicts.toSorted((a, b) => {
        const severityDiff = (severityOrder.get(a.severity) ?? 99) - (severityOrder.get(b.severity) ?? 99);
        if (severityDiff !== 0) return severityDiff;

        const scopeCompare = (a.scope.displayName ?? "").localeCompare(b.scope.displayName ?? "");
        if (scopeCompare !== 0) return scopeCompare;

        return a.message.localeCompare(b.message);
    });
}

function pluralize(value, suffix = "s") {
    return value === 1 ? "" : suffix;
}

export function summarizeIdentifierCasePlan({ renamePlan, conflicts = [] }: IdentifierCasePlanData = {}) {
    const normalizedOperations = sortOperations(
        Core.compactArray(extractOperations(renamePlan).map(normalizeOperation))
    );

    const normalizedConflicts = sortConflicts(Core.compactArray(Core.toArray(conflicts).map(normalizeConflict)));

    const renameSummaries = normalizedOperations.map(buildRenameSummary);

    const impactedFileSet = new Set();
    let totalReferenceCount = 0;

    for (const operation of normalizedOperations) {
        for (const reference of operation.references) {
            impactedFileSet.add(reference.filePath);
            totalReferenceCount += reference.occurrences ?? 0;
        }
    }

    const severityCounts = new Map<ConflictSeverity, number>();
    for (const conflict of normalizedConflicts) {
        const severity = conflict.severity ?? ConflictSeverity.INFO;
        Core.incrementMapValue(severityCounts, severity);
    }

    const summary = {
        renameCount: normalizedOperations.length,
        impactedFileCount: impactedFileSet.size,
        totalReferenceCount,
        conflictCount: normalizedConflicts.length,
        severityCounts: Object.fromEntries(severityCounts.entries())
    };

    return {
        summary,
        operations: normalizedOperations,
        renames: renameSummaries,
        conflicts: normalizedConflicts
    };
}

export function formatIdentifierCaseSummaryText(report: IdentifierCaseReportData | null) {
    if (!report) {
        return [];
    }

    const { summary, operations, conflicts } = report;
    const lines = [`[${REPORT_NAMESPACE}] Identifier case dry-run summary:`];

    const renameDetails =
        summary.renameCount > 0
            ? ` (${summary.totalReferenceCount} reference${pluralize(
                  summary.totalReferenceCount
              )} across ${summary.impactedFileCount} file${pluralize(summary.impactedFileCount)})`
            : "";
    lines.push(`  Planned renames: ${summary.renameCount}${renameDetails}`);

    if (summary.conflictCount > 0) {
        const severityParts = Object.entries(summary.severityCounts)
            .filter(([, count]) => count > 0)
            .map(([severity, count]) => `${count} ${severity}${pluralize(count)}`);

        const conflictSuffix = severityParts.length > 0 ? ` (${severityParts.join(", ")})` : "";
        lines.push(`  Conflicts: ${summary.conflictCount}${conflictSuffix}`);
    } else {
        lines.push("  Conflicts: none");
    }

    if (operations.length > 0) {
        lines.push("", "Rename plan:");

        for (const operation of operations) {
            const referenceSummary =
                operation.occurrenceCount > 0
                    ? ` (${operation.occurrenceCount} reference${pluralize(
                          operation.occurrenceCount
                      )} across ${operation.referenceFileCount} file${pluralize(operation.referenceFileCount)})`
                    : "";

            const scopeName = operation.scopeName ?? operation.scopeId ?? "<unknown scope>";
            const fromName = operation.fromName ?? "<unknown>";
            const toName = operation.toName ?? "<unknown>";

            lines.push(`  - ${scopeName}: ${fromName} -> ${toName}${referenceSummary}`);

            for (const reference of operation.references) {
                const referenceSuffix =
                    reference.occurrences > 0
                        ? ` (${reference.occurrences} reference${pluralize(reference.occurrences)})`
                        : "";
                lines.push(`      • ${reference.filePath}${referenceSuffix}`);
            }
        }
    }

    if (conflicts.length > 0) {
        lines.push("", "Conflicts:");

        for (const conflict of conflicts) {
            const scopeName = conflict.scope.displayName ?? conflict.scope.id ?? "<unknown scope>";
            const identifierSuffix = conflict.identifier ? ` (${conflict.identifier})` : "";
            const codeSuffix = conflict.code ? ` [${conflict.code}]` : "";
            lines.push(`  - [${conflict.severity}]${codeSuffix} ${scopeName}${identifierSuffix}: ${conflict.message}`);

            if (conflict.suggestions.length > 0) {
                lines.push(`      Suggestions: ${conflict.suggestions.join(", ")}`);
            }
        }
    }

    return lines;
}

function getNormalizedReportCollections(report: IdentifierCaseReportData | null) {
    const operations = getNormalizedOperations(report);
    const conflicts = getNormalizedConflicts(report?.conflicts);

    const renamesSource = Array.isArray(report?.renames)
        ? report.renames.filter((rename) => rename && typeof rename === "object")
        : null;

    const renames =
        renamesSource && renamesSource.length === operations.length ? renamesSource : buildRenameSummaries(operations);

    return { operations, renames, conflicts };
}

function buildRenameSummary(operation) {
    return {
        id: operation.id,
        kind: operation.kind,
        scopeId: operation.scopeId ?? null,
        scopeName: operation.scopeName ?? null,
        fromName: operation.fromName ?? null,
        toName: operation.toName ?? null,
        referenceCount: operation.occurrenceCount ?? 0,
        references: operation.references ?? []
    };
}

function buildRenameSummaries(operations) {
    return operations.map(buildRenameSummary);
}

function buildLogPayload(report: IdentifierCaseReportData | null, generatedAt) {
    const { summary = {} as IdentifierCaseReportSummary } = report ?? {};
    const { renames, conflicts } = getNormalizedReportCollections(report);

    return {
        version: LOG_VERSION,
        generatedAt,
        summary: {
            ...summary,
            severityCounts: { ...summary.severityCounts }
        },
        renames: renames.map((rename) => ({
            id: rename.id,
            kind: rename.kind,
            scope: {
                id: rename.scopeId,
                displayName: rename.scopeName
            },
            from: {
                name: rename.fromName
            },
            to: {
                name: rename.toName
            },
            referenceCount: rename.referenceCount,
            references: rename.references
        })),
        conflicts
    };
}

function resolveSummarySeverity(conflicts): ConflictSeverity {
    if (!Core.isNonEmptyArray(conflicts)) {
        return ConflictSeverity.INFO;
    }

    if (conflicts.some((conflict) => conflict.severity === ConflictSeverity.ERROR)) {
        return ConflictSeverity.ERROR;
    }

    if (conflicts.some((conflict) => conflict.severity === ConflictSeverity.WARNING)) {
        return ConflictSeverity.WARNING;
    }

    return ConflictSeverity.INFO;
}

function pushDiagnosticEntry({
    diagnostics,
    report,
    text
}: {
    diagnostics?: Array<unknown>;
    report: IdentifierCaseReportData | null;
    text: string;
}) {
    if (!Array.isArray(diagnostics)) {
        return;
    }

    const { renames, conflicts } = getNormalizedReportCollections(report);
    const severity = resolveSummarySeverity(conflicts);

    diagnostics.push({
        code: `${REPORT_NAMESPACE}-summary`,
        severity,
        message: text,
        summary: {
            ...report.summary
        },
        renames,
        conflicts
    });
}

export function reportIdentifierCasePlan({
    renamePlan,
    conflicts = [],
    logger = console,
    diagnostics = null,
    logFilePath = null,
    fsFacade = defaultFsFacade,
    now = Date.now
}: ReportIdentifierCasePlanOptions = {}) {
    const report = summarizeIdentifierCasePlan({
        renamePlan,
        conflicts
    });

    const lines = formatIdentifierCaseSummaryText(report);
    const textBlock = lines.join("\n");

    if (typeof logger?.log === "function") {
        logger.log(textBlock);
    } else {
        console.log(textBlock);
    }

    pushDiagnosticEntry({ diagnostics, report, text: textBlock });

    if (logFilePath) {
        try {
            const payload = buildLogPayload(report, Core.formatGeneratedDate(now()));
            const directory = path.dirname(logFilePath);
            if (fsFacade?.mkdirSync) {
                fsFacade.mkdirSync(directory, { recursive: true });
            }
            if (fsFacade?.writeFileSync) {
                fsFacade.writeFileSync(
                    logFilePath,
                    Core.stringifyJsonForFile(payload, {
                        space: 2
                    })
                );
            }
        } catch (error) {
            warnWithReason(logger, REPORT_NAMESPACE, "Failed to write identifier case report", error);
        }
    }

    return report;
}

function pickFunction(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === "function") {
            return candidate;
        }
    }

    return null;
}

function toDiagnosticsArray(value) {
    return Array.isArray(value) ? value : null;
}

function resolveInlineReportContext(options, renamePlan) {
    const conflicts = getIdentifierCaseOption(options, "Conflicts", {
        fallback: []
    });
    const dryRun = getIdentifierCaseOption(options, "DryRun", {
        fallback: null
    });
    const logFilePath = getIdentifierCaseOption(options, "ReportLogPath", {
        fallback: null
    });
    const fsFacade = getIdentifierCaseOption(options, "Fs", { fallback: null });

    return {
        renamePlan,
        conflicts,
        dryRun,
        logFilePath,
        logger: options.logger ?? null,
        diagnostics: toDiagnosticsArray(options.diagnostics),
        fsFacade,
        now: pickFunction(options.__identifierCaseNow, options.identifierCaseNow)
    };
}

function resolveStoredReportContext(options) {
    const storeKey = Core.coalesceTrimmedString(options?.__identifierCaseOptionsStoreKey, options?.filepath);
    if (!storeKey) {
        return null;
    }

    const storedOptions = getIdentifierCaseOptionStore(storeKey);
    if (!Core.isObjectLike(storedOptions)) {
        return null;
    }

    const storedRenamePlan = getIdentifierCaseOption(storedOptions, "RenamePlan", {
        fallback: null
    });
    if (!storedRenamePlan) {
        return null;
    }

    return resolveInlineReportContext(storedOptions, storedRenamePlan);
}

function mergeReportContexts(primary, fallback) {
    if (!primary) {
        return fallback;
    }

    if (!fallback) {
        return primary;
    }

    return {
        ...primary,
        logger: primary.logger ?? fallback.logger,
        diagnostics: primary.diagnostics ?? fallback.diagnostics,
        logFilePath: primary.logFilePath ?? fallback.logFilePath,
        fsFacade: primary.fsFacade ?? fallback.fsFacade,
        now: primary.now ?? fallback.now,
        dryRun: primary.dryRun ?? fallback.dryRun,
        conflicts: primary.conflicts ?? fallback.conflicts,
        renamePlan: primary.renamePlan ?? fallback.renamePlan
    };
}

function resolveReportContext(options) {
    const inlinePlan = getIdentifierCaseOption(options, "RenamePlan", {
        fallback: null
    });
    const storedContext = resolveStoredReportContext(options);

    const context = consumeIdentifierCaseDryRunContext(options.filepath ?? null);

    if (inlinePlan) {
        const inlineContext = resolveInlineReportContext(options, inlinePlan);
        return mergeReportContexts(mergeReportContexts(inlineContext, storedContext), context);
    }

    return mergeReportContexts(storedContext, context);
}

function resolveDryRunFlag(options, contextDryRun) {
    const explicitDryRun = getIdentifierCaseOption(options, "DryRun", {
        fallback: null
    });
    if (explicitDryRun !== undefined && explicitDryRun !== null) {
        return explicitDryRun !== false;
    }

    if (contextDryRun !== undefined && contextDryRun !== null) {
        return contextDryRun !== false;
    }

    return false;
}

function finalizeIdentifierCaseReport(options, result? /* optional */) {
    setIdentifierCaseOption(options, "__identifierCaseReportEmitted", true);

    if (result !== undefined) {
        setIdentifierCaseOption(options, "__identifierCaseReportResult", result);
    }

    return result ?? null;
}

function resolveReportIo(options, context) {
    const logger = context.logger ?? options.logger ?? console;
    const diagnostics = context.diagnostics ?? toDiagnosticsArray(options.diagnostics);
    const logFilePath = context.logFilePath ?? getIdentifierCaseOption(options, "ReportLogPath", { fallback: null });
    const fsFacade = context.fsFacade ?? getIdentifierCaseOption(options, "Fs", { fallback: defaultFsFacade });
    const now = context.now ?? pickFunction(options.__identifierCaseNow, options.identifierCaseNow) ?? Date.now;

    return { logger, diagnostics, logFilePath, fsFacade, now };
}

export function maybeReportIdentifierCaseDryRun(options) {
    if (!options || options.__identifierCaseReportEmitted) {
        return null;
    }

    const context = resolveReportContext(options);
    if (!context) {
        return null;
    }

    const { renamePlan } = context;

    if (!renamePlan) {
        return finalizeIdentifierCaseReport(options);
    }

    const { conflicts = [], dryRun: contextDryRun } = context;

    const shouldDryRun = resolveDryRunFlag(options, contextDryRun);

    setIdentifierCaseOption(options, "__identifierCaseDryRun", shouldDryRun);

    if (!shouldDryRun) {
        const result = summarizeIdentifierCasePlan({
            renamePlan,
            conflicts
        });

        return finalizeIdentifierCaseReport(options, result);
    }

    const reportIo = resolveReportIo(options, context);

    const result = reportIdentifierCasePlan({
        renamePlan,
        conflicts,
        ...reportIo
    });

    return finalizeIdentifierCaseReport(options, result);
}
