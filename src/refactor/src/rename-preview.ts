/**
 * Rename preview utilities for the refactor engine.
 * Provides helpers to generate human-readable previews and diffs of rename
 * operations before applying them, essential for IDE integrations and CLI tools.
 */

import { Core } from "@gmloop/core";

import { groupOccurrencesByFile } from "./occurrence-analysis.js";
import { extractSymbolName } from "./rename/index.js";
import type {
    BatchRenamePlanSummary,
    BatchRenameValidation,
    HotReloadCascadeResult,
    RenameImpactAnalysis,
    RenameImpactSummary,
    RenamePlanSummary,
    SymbolOccurrence
} from "./types.js";
import type { WorkspaceEdit } from "./workspace-edit.js";

/**
 * Append formatted error and warning messages to a lines array.
 * Helper for consistent formatting of validation results in report functions.
 *
 * @param lines - Array to append formatted messages to
 * @param errors - Array of error messages
 * @param warnings - Array of warning messages
 */
function appendErrorsAndWarnings(
    lines: Array<string>,
    errors: ReadonlyArray<string>,
    warnings: ReadonlyArray<string>
): void {
    if (errors.length > 0) {
        lines.push("  Errors:");
        for (const error of errors) {
            lines.push(`    ✗ ${error}`);
        }
    }

    if (warnings.length > 0) {
        lines.push("  Warnings:");
        for (const warning of warnings) {
            lines.push(`    ⚠ ${warning}`);
        }
    }
}

/**
 * Structured hot-reload report extracted from a `ValidationSummary`.
 *
 * Exists to break the Law-of-Demeter violation where callers navigate
 * `validation.hotReload` repeatedly to access safety details.
 *
 * @example
 * const report = buildHotReloadReport(validation);
 * if (report) {
 *     console.log(`Safe: ${report.safe}`);
 *     console.log(`Reason: ${report.reason}`);
 * }
 */
export type RenameHotReloadReport = Readonly<{
    safe: boolean;
    reason: string;
    requiresRestart: boolean;
    canAutoFix: boolean;
    suggestions: ReadonlyArray<string>;
}>;

/**
 * Build a structured hot-reload report from a `ValidationSummary`.
 *
 * Returns `null` when the validation has no hot-reload safety data
 * (i.e., `validation.hotReload` is undefined), allowing callers to
 * handle the absent case explicitly rather than navigating the chain
 * repeatedly.
 *
 * @param validation - Validation summary that may contain hot-reload details
 * @returns Structured report, or null when no hot-reload data exists
 *
 * @example
 * const report = buildHotReloadReport(plan.hotReload);
 * if (report === null) {
 *     // Hot reload validation was not requested
 * } else if (report.safe) {
 *     // Safe to hot reload
 * } else {
 *     console.log(`Reason: ${report.reason}`);
 * }
 */
export function buildHotReloadReport(
    validation: Readonly<{
        valid: boolean;
        errors: ReadonlyArray<string>;
        warnings: ReadonlyArray<string>;
        hotReload?: RenameHotReloadReport;
    }> | null
): RenameHotReloadReport | null {
    if (validation === null || validation === undefined) {
        return null;
    }
    if (validation.hotReload === undefined) {
        return null;
    }
    return validation.hotReload;
}

/**
 * Structured view of a batch plan's `BatchRenameValidation`.
 *
 * Exists to break the Law-of-Demeter violation where callers navigate
 * `plan.batchValidation.{valid,errors,warnings,conflictingSets}`
 * repeatedly inside the batch preview formatter. Wrapping the sub-object
 * in a dedicated type gives downstream code a single immediate neighbour
 * to talk to and keeps the formatter focused on presentation.
 */
export type BatchValidationReport = Readonly<{
    valid: boolean;
    errors: ReadonlyArray<string>;
    warnings: ReadonlyArray<string>;
    conflictingSets: ReadonlyArray<ReadonlyArray<string>>;
}>;

/**
 * Build a structured view of the `BatchRenameValidation` attached to a
 * batch rename plan.
 *
 * The returned value mirrors the shape of `plan.batchValidation` but is
 * exposed as a named, frozen projection so callers do not have to
 * reach through `plan.batchValidation.*` chains. The helper intentionally
 * does no validation work of its own: it is a structural adapter that
 * preserves the existing batch-validation contract verbatim.
 *
 * @param plan - Batch rename plan whose batch-validation should be exposed
 * @returns Structured view of the plan's `BatchRenameValidation`
 *
 * @example
 * const batchValidation = buildBatchValidationReport(plan);
 * if (!batchValidation.valid) {
 *     for (const error of batchValidation.errors) {
 *         console.error(error);
 *     }
 * }
 */
export function buildBatchValidationReport(plan: BatchRenamePlanSummary): BatchValidationReport {
    return {
        valid: plan.batchValidation.valid,
        errors: plan.batchValidation.errors,
        warnings: plan.batchValidation.warnings,
        conflictingSets: plan.batchValidation.conflictingSets
    };
}

/**
 * Build a hot-reload dependency cascade view for a batch rename plan.
 *
 * Returns `null` when the plan has no cascade result (e.g., the batch
 * did not request hot-reload cascade analysis), allowing callers to
 * handle the absent case explicitly rather than navigating the
 * `plan.cascadeResult` chain repeatedly.
 *
 * The returned value is the existing `HotReloadCascadeResult`; summary
 * counters live on its `metadata` field, so downstream code reads
 * `cascade.metadata.totalSymbols` and friends directly.
 *
 * @param plan - Batch rename plan that may carry a cascade result
 * @returns The cascade result, or null when no cascade exists
 *
 * @example
 * const cascade = buildCascadeReport(plan);
 * if (cascade !== null) {
 *     console.log(`Symbols to reload: ${cascade.metadata.totalSymbols}`);
 * }
 */
export function buildCascadeReport(plan: BatchRenamePlanSummary): HotReloadCascadeResult | null {
    return plan.cascadeResult;
}

/**
 * Structured view of a batch plan's hot-reload validation summary.
 *
 * Mirrors the fields `formatBatchRenamePlanReport` previously reached
 * through `plan.hotReload.{valid,errors,warnings}` chains. Exists as a
 * dedicated type so the formatter can talk to a single immediate
 * neighbour instead of repeatedly walking through `plan.hotReload`.
 */
export type BatchHotReloadReport = Readonly<{
    valid: boolean;
    errors: ReadonlyArray<string>;
    warnings: ReadonlyArray<string>;
}>;

/**
 * Build a structured view of a batch plan's hot-reload validation.
 *
 * Returns `null` when the plan has no hot-reload validation attached
 * (i.e., `plan.hotReload === null`), letting callers branch on the
 * absent case explicitly rather than walking `plan.hotReload` chains.
 *
 * @param plan - Batch rename plan that may carry hot-reload data
 * @returns Structured hot-reload report, or null when not present
 *
 * @example
 * const hotReload = buildBatchHotReloadReport(plan);
 * if (hotReload !== null) {
 *     console.log(`Status: ${hotReload.valid ? "SAFE" : "UNSAFE"}`);
 * }
 */
export function buildBatchHotReloadReport(plan: BatchRenamePlanSummary): BatchHotReloadReport | null {
    if (plan.hotReload === null) {
        return null;
    }
    return {
        valid: plan.hotReload.valid,
        errors: plan.hotReload.errors,
        warnings: plan.hotReload.warnings
    };
}

/**
 * Structured view of a single rename impact summary.
 *
 * Exists to break the Law-of-Demeter violation where callers reach
 * through `analysis.summary.*` chains (for example
 * `plan.analysis.summary.totalOccurrences` or
 * `analysis.summary.affectedFiles`) to read impact metrics inside the
 * rename preview formatters. Promoting the summary to a facaded
 * projection gives every formatter and downstream helper a single
 * immediate neighbour to talk to instead of walking three to four
 * segments deep, and preserves the existing field shape so the
 * formatter output stays byte-for-byte equivalent.
 *
 * The type deliberately mirrors the entire `RenameImpactSummary` surface
 * — the formatters surface nine fields today (symbol id, old/new names,
 * affected files, occurrence counts, definition/reference counts, hot
 * reload flag, dependent symbols), and the facade keeps every one of
 * them rather than hiding any. That keeps the refactor tightly scoped
 * and prevents silent drift if a future field is added to the
 * underlying summary without updating the formatter.
 */
export type RenameImpactReport = Readonly<RenameImpactSummary>;

/**
 * Build a structured view of a rename impact summary.
 *
 * Returns the summary attached to a `RenameImpactAnalysis` as a named,
 * read-only projection. The helper exists for the same reason as the
 * sibling facade helpers (`buildHotReloadReport`,
 * `buildBatchValidationReport`, `buildCascadeReport`,
 * `buildBatchHotReloadReport`): callers should not have to repeat
 * `analysis.summary.X` four-segment walks across formatters and CLI
 * integrations. The adapter performs no validation work of its own —
 * `summary` is a required field on `RenameImpactAnalysis`, so the
 * absent case cannot occur — it just renames the relationship so the
 * call site speaks a single neighbour's name.
 *
 * The returned value is `Readonly<RenameImpactSummary>`: every input
 * field is copied into the projection so that subsequent mutations of
 * the underlying analysis (e.g., when the engine stages additional
 * occurrences after the report is rendered) cannot retroactively
 * change the formatter's captured snapshot.
 *
 * @param analysis - Rename impact analysis whose summary should be exposed
 * @returns Structured view of the analysis's `RenameImpactSummary`
 *
 * @example
 * const impact = buildRenameImpactReport(plan.analysis);
 * console.log(`${impact.oldName} → ${impact.newName}`);
 * console.log(`${impact.totalOccurrences} occurrences across ${impact.affectedFiles.length} files`);
 *
 * @example
 * for (const [, analysis] of plan.impactAnalyses) {
 *     const impact = buildRenameImpactReport(analysis);
 *     lines.push(`${impact.oldName} → ${impact.newName}: ${impact.totalOccurrences} occurrences`);
 * }
 */
export function buildRenameImpactReport(analysis: RenameImpactAnalysis): RenameImpactReport {
    return {
        symbolId: analysis.summary.symbolId,
        oldName: analysis.summary.oldName,
        newName: analysis.summary.newName,
        affectedFiles: analysis.summary.affectedFiles,
        totalOccurrences: analysis.summary.totalOccurrences,
        definitionCount: analysis.summary.definitionCount,
        referenceCount: analysis.summary.referenceCount,
        hotReloadRequired: analysis.summary.hotReloadRequired,
        dependentSymbols: analysis.summary.dependentSymbols
    };
}

/**
 * Preview entry for a single file in a rename operation.
 * Contains the file path and the edits that will be applied to it.
 */
export interface FilePreview {
    filePath: string;
    editCount: number;
    edits: Array<{
        start: number;
        end: number;
        oldText: string;
        newText: string;
    }>;
}

/**
 * Human-readable diff preview of a rename plan.
 * Shows which files will be modified and what changes will be made.
 */
export interface RenamePreview {
    summary: {
        totalEdits: number;
        affectedFiles: number;
        oldName: string;
        newName: string;
    };
    files: Array<FilePreview>;
}

/**
 * Generate a preview of changes that will be made by a workspace edit.
 * This is useful for showing users a diff-like view before applying renames.
 *
 * @param workspace - The workspace edit to preview
 * @param oldName - Original symbol name
 * @param newName - New symbol name
 * @returns Preview object with file-level change summaries
 *
 * @example
 * const plan = await engine.prepareRenamePlan({
 *     symbolId: "gml/script/scr_player",
 *     newName: "scr_hero"
 * });
 *
 * const preview = generateRenamePreview(plan.workspace, "scr_player", "scr_hero");
 * console.log(`Renaming ${preview.summary.oldName} → ${preview.summary.newName}`);
 * console.log(`Will modify ${preview.summary.affectedFiles} files with ${preview.summary.totalEdits} edits`);
 *
 * for (const file of preview.files) {
 *     console.log(`\n${file.filePath}: ${file.editCount} changes`);
 *     for (const edit of file.edits) {
 *         console.log(`  Line ${edit.start}-${edit.end}: "${edit.oldText}" → "${edit.newText}"`);
 *     }
 * }
 */
export function generateRenamePreview(workspace: WorkspaceEdit, oldName: string, newName: string): RenamePreview {
    if (!workspace || typeof workspace !== "object" || !Array.isArray(workspace.edits)) {
        throw new TypeError("generateRenamePreview requires a valid WorkspaceEdit");
    }

    Core.assertNonEmptyString(oldName, {
        errorMessage: "generateRenamePreview requires oldName as a non-empty string"
    });
    Core.assertNonEmptyString(newName, {
        errorMessage: "generateRenamePreview requires newName as a non-empty string"
    });

    const grouped = workspace.groupByFile();
    const files: Array<FilePreview> = [];

    for (const [filePath, edits] of grouped.entries()) {
        const filePreview: FilePreview = {
            filePath,
            editCount: edits.length,
            edits: edits.map((edit) => ({
                start: edit.start,
                end: edit.end,
                oldText: oldName,
                newText: edit.newText
            }))
        };
        files.push(filePreview);
    }

    return {
        summary: {
            totalEdits: workspace.edits.length,
            affectedFiles: grouped.size,
            oldName,
            newName
        },
        files
    };
}

/**
 * Format a rename plan summary as a human-readable text report.
 * Generates a comprehensive preview showing validation status, conflicts,
 * warnings, and hot reload implications.
 *
 * @param plan - Rename plan from prepareRenamePlan
 * @returns Multi-line text report
 *
 * @example
 * const plan = await engine.prepareRenamePlan({
 *     symbolId: "gml/script/scr_player",
 *     newName: "scr_hero"
 * }, { validateHotReload: true });
 *
 * const report = formatRenamePlanReport(plan);
 * console.log(report);
 *
 * // Output:
 * // Rename Plan Report
 * // ==================
 * // Symbol: gml/script/scr_player → scr_hero
 * // Status: VALID
 * //
 * // Impact Summary:
 * //   Total Occurrences: 15
 * //   Definitions: 1
 * //   References: 14
 * //   Affected Files: 3
 * //   Hot Reload Required: Yes
 * //   Dependent Symbols: 2
 * //
 * // Workspace Changes:
 * //   Total Edits: 15
 * //   Files Modified: 3
 * //
 * // Hot Reload Status: SAFE
 * //   Reason: Script renames are hot-reload-safe
 * //   Requires Restart: No
 */
export function formatRenamePlanReport(plan: RenamePlanSummary): string {
    // Talk to the plan's sub-objects through their dedicated facade helpers
    // so this function only ever addresses one immediate neighbour at a
    // time. `buildRenameImpactReport` collapses the
    // `plan.analysis.summary.*` four-segment walk into a single
    // `impact.field` access, mirroring how `buildHotReloadReport`
    // smooths the `plan.hotReload.*` chain.
    const impact = buildRenameImpactReport(plan.analysis);
    const title = "Rename Plan Report";

    const lines: Array<string> = [
        title,
        "=".repeat(title.length),
        "",
        `Symbol: ${impact.oldName} → ${impact.newName}`,
        `Status: ${plan.validation.valid ? "VALID" : "INVALID"}`,
        ""
    ];

    if (!plan.validation.valid) {
        lines.push("Validation Errors:");
        for (const error of plan.validation.errors) {
            lines.push(`  ✗ ${error}`);
        }
        lines.push("");
    }

    if (plan.validation.warnings.length > 0) {
        lines.push("Validation Warnings:");
        for (const warning of plan.validation.warnings) {
            lines.push(`  ⚠ ${warning}`);
        }
        lines.push("");
    }

    lines.push(
        "Impact Summary:",
        `  Total Occurrences: ${impact.totalOccurrences}`,
        `  Definitions: ${impact.definitionCount}`,
        `  References: ${impact.referenceCount}`,
        `  Affected Files: ${impact.affectedFiles.length}`,
        `  Hot Reload Required: ${impact.hotReloadRequired ? "Yes" : "No"}`,
        `  Dependent Symbols: ${impact.dependentSymbols.length}`,
        ""
    );

    if (plan.analysis.conflicts.length > 0) {
        lines.push("Conflicts:");
        for (const conflict of plan.analysis.conflicts) {
            lines.push(`  ✗ [${conflict.type}] ${conflict.message}`);
            if (conflict.path) {
                lines.push(`    in ${conflict.path}`);
            }
        }
        lines.push("");
    }

    if (plan.analysis.warnings.length > 0) {
        lines.push("Analysis Warnings:");
        for (const warning of plan.analysis.warnings) {
            lines.push(`  ⚠ [${warning.type}] ${warning.message}`);
        }
        lines.push("");
    }

    const grouped = plan.workspace.groupByFile();
    lines.push(
        "Workspace Changes:",
        `  Total Edits: ${plan.workspace.edits.length}`,
        `  Files Modified: ${grouped.size}`,
        ""
    );

    if (plan.hotReload) {
        lines.push(`Hot Reload Status: ${plan.hotReload.valid ? "SAFE" : "UNSAFE"}`);

        const hotReloadReport = buildHotReloadReport(plan.hotReload);
        if (hotReloadReport !== null) {
            lines.push(
                `  Reason: ${hotReloadReport.reason}`,
                `  Requires Restart: ${hotReloadReport.requiresRestart ? "Yes" : "No"}`,
                `  Can Auto-Fix: ${hotReloadReport.canAutoFix ? "Yes" : "No"}`
            );

            if (hotReloadReport.suggestions.length > 0) {
                lines.push("  Suggestions:");
                for (const suggestion of hotReloadReport.suggestions) {
                    lines.push(`    • ${suggestion}`);
                }
            }
        }

        appendErrorsAndWarnings(lines, plan.hotReload.errors, plan.hotReload.warnings);
    }

    return lines.join("\n");
}

/**
 * Format a batch rename plan summary as a human-readable text report.
 * Shows validation status, per-symbol impact, conflicts, and dependency cascade.
 *
 * @param plan - Batch rename plan from prepareBatchRenamePlan
 * @returns Multi-line text report
 *
 * @example
 * const plan = await engine.prepareBatchRenamePlan([
 *     { symbolId: "gml/script/scr_a", newName: "scr_x" },
 *     { symbolId: "gml/script/scr_b", newName: "scr_y" }
 * ], { validateHotReload: true });
 *
 * const report = formatBatchRenamePlanReport(plan);
 * console.log(report);
 */
export function formatBatchRenamePlanReport(plan: BatchRenamePlanSummary): string {
    // Talk to the plan's sub-objects through their dedicated facade helpers
    // so this function only ever addresses one immediate neighbour at a
    // time. The helpers also normalize nullable sub-objects (cascade and
    // hot-reload) into explicit `null` returns, letting the formatter
    // branch on the absent case without repeated `plan.?.?.?` walks.
    const batchValidation = buildBatchValidationReport(plan);
    const cascade = buildCascadeReport(plan);
    const hotReload = buildBatchHotReloadReport(plan);

    const title = "Batch Rename Plan Report";
    const lines: Array<string> = [
        title,
        "=".repeat(title.length),
        "",
        `Status: ${batchValidation.valid ? "VALID" : "INVALID"}`,
        `Total Renames: ${plan.impactAnalyses.size}`,
        ""
    ];

    if (!batchValidation.valid) {
        lines.push("Batch Validation Errors:");
        for (const error of batchValidation.errors) {
            lines.push(`  ✗ ${error}`);
        }
        lines.push("");
    }

    if (batchValidation.warnings.length > 0) {
        lines.push("Batch Validation Warnings:");
        for (const warning of batchValidation.warnings) {
            lines.push(`  ⚠ ${warning}`);
        }
        lines.push("");
    }

    if (batchValidation.conflictingSets.length > 0) {
        lines.push("Conflicting Symbol Sets:");
        for (const set of batchValidation.conflictingSets) {
            lines.push(`  ✗ ${set.join(", ")}`);
        }
        lines.push("");
    }

    lines.push("Per-Symbol Impact:");
    for (const [symbolId, analysis] of plan.impactAnalyses) {
        // `buildRenameImpactReport` collapses the
        // `analysis.summary.*` four-segment walk into a single
        // `impact.field` access, matching the per-symbol contract of
        // `formatRenamePlanReport` and keeping the two formatters
        // symmetric at the immediate-neighbour boundary.
        const impact = buildRenameImpactReport(analysis);
        lines.push(
            `  ${impact.oldName} → ${impact.newName} (${symbolId})`,
            `    Occurrences: ${impact.totalOccurrences} (${impact.definitionCount} def, ${impact.referenceCount} ref)`,
            `    Affected Files: ${impact.affectedFiles.length}`,
            `    Dependent Symbols: ${impact.dependentSymbols.length}`
        );

        if (analysis.conflicts.length > 0) {
            lines.push(`    Conflicts: ${analysis.conflicts.length}`);
            for (const conflict of analysis.conflicts) {
                lines.push(`      ✗ [${conflict.type}] ${conflict.message}`);
            }
        }

        if (analysis.warnings.length > 0) {
            lines.push(`    Warnings: ${analysis.warnings.length}`);
            for (const warning of analysis.warnings) {
                lines.push(`      ⚠ [${warning.type}] ${warning.message}`);
            }
        }
        lines.push("");
    }

    const grouped = plan.workspace.groupByFile();
    lines.push(
        "Workspace Changes:",
        `  Total Edits: ${plan.workspace.edits.length}`,
        `  Files Modified: ${grouped.size}`,
        ""
    );

    if (cascade !== null) {
        // `HotReloadCascadeResult` keeps its summary counters on the
        // `metadata` bag; access them through the canonical path so the
        // report and the cascade result stay in lock-step.
        lines.push(
            "Hot Reload Dependency Cascade:",
            `  Total Symbols to Reload: ${cascade.metadata.totalSymbols}`,
            `  Max Dependency Distance: ${cascade.metadata.maxDistance}`,
            `  Has Circular Dependencies: ${cascade.metadata.hasCircular ? "Yes" : "No"}`
        );

        if (cascade.circular.length > 0) {
            lines.push("  Circular Dependency Chains:");
            for (const cycle of cascade.circular) {
                const formattedCycle = cycle.map((id) => extractSymbolName(id)).join(" → ");
                lines.push(`    ⚠ ${formattedCycle}`);
            }
        }

        lines.push(`  Reload Order: ${cascade.order.length} symbols`, "");
    }

    if (hotReload !== null) {
        lines.push(`Hot Reload Status: ${hotReload.valid ? "SAFE" : "UNSAFE"}`);

        appendErrorsAndWarnings(lines, hotReload.errors, hotReload.warnings);
    }

    return lines.join("\n");
}

/**
 * Format occurrence locations as a diff-style preview.
 * Shows each occurrence with its file path and position for review.
 *
 * @param occurrences - Array of symbol occurrences
 * @param oldName - Original symbol name
 * @param newName - New symbol name
 * @returns Multi-line text preview
 *
 * @example
 * const occurrences = await engine.gatherSymbolOccurrences("player_hp");
 * const preview = formatOccurrencePreview(occurrences, "player_hp", "playerHealth");
 * console.log(preview);
 *
 * // Output:
 * // Symbol Occurrences: player_hp → playerHealth
 * // Total: 10 occurrences in 3 files
 * //
 * // scripts/player.gml (5 occurrences):
 * //   [definition] Line 10-18
 * //   [reference] Line 45-53
 * //   [reference] Line 67-75
 * //   ...
 */
export function formatOccurrencePreview(
    occurrences: Array<SymbolOccurrence>,
    oldName: string,
    newName: string
): string {
    Core.assertArray(occurrences, {
        errorMessage: "formatOccurrencePreview requires an array of occurrences"
    });
    Core.assertNonEmptyString(oldName, {
        errorMessage: "formatOccurrencePreview requires oldName as a non-empty string"
    });
    Core.assertNonEmptyString(newName, {
        errorMessage: "formatOccurrencePreview requires newName as a non-empty string"
    });

    const lines: Array<string> = [];
    const grouped = groupOccurrencesByFile(occurrences);

    const totalOccurrencesText = occurrences.length === 1 ? "occurrence" : "occurrences";
    const totalFilesText = grouped.size === 1 ? "file" : "files";
    lines.push(
        `Symbol Occurrences: ${oldName} → ${newName}`,
        `Total: ${occurrences.length} ${totalOccurrencesText} in ${grouped.size} ${totalFilesText}`,
        ""
    );

    for (const [filePath, fileOccurrences] of grouped) {
        const fileOccurrencesText = fileOccurrences.length === 1 ? "occurrence" : "occurrences";
        lines.push(`${filePath} (${fileOccurrences.length} ${fileOccurrencesText}):`);

        for (const occ of fileOccurrences) {
            const kind = occ.kind ?? "unknown";
            const position = `${occ.start}-${occ.end}`;
            lines.push(`  [${kind}] Position ${position}`);
        }

        lines.push("");
    }

    return lines.join("\n");
}
