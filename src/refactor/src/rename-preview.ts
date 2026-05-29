/**
 * Rename preview utilities for the refactor engine.
 * Provides helpers to generate human-readable previews and diffs of rename
 * operations before applying them, essential for IDE integrations and CLI tools.
 */

import { Core } from "@gmloop/core";

import { groupOccurrencesByFile } from "./occurrence-analysis.js";
import { extractSymbolName } from "./rename/index.js";
import type { BatchRenamePlanSummary, RenamePlanSummary, SymbolOccurrence } from "./types.js";
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
    const title = "Rename Plan Report";
    const lines: Array<string> = [title, "=".repeat(title.length), ""];

    // Extract the impact summary to avoid repeated deep-navigation through plan.analysis.summary.*
    const impactSummary = plan.analysis.summary;
    lines.push(
        `Symbol: ${impactSummary.oldName} → ${impactSummary.newName}`,
        `Status: ${plan.validation.valid ? "VALID" : "INVALID"}`,
        ""
    );

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
        `  Total Occurrences: ${impactSummary.totalOccurrences}`,
        `  Definitions: ${impactSummary.definitionCount}`,
        `  References: ${impactSummary.referenceCount}`,
        `  Affected Files: ${impactSummary.affectedFiles.length}`,
        `  Hot Reload Required: ${impactSummary.hotReloadRequired ? "Yes" : "No"}`,
        `  Dependent Symbols: ${impactSummary.dependentSymbols.length}`,
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
    const title = "Batch Rename Plan Report";
    const lines: Array<string> = [
        title,
        "=".repeat(title.length),
        "",
        `Status: ${plan.batchValidation.valid ? "VALID" : "INVALID"}`,
        `Total Renames: ${plan.impactAnalyses.size}`,
        ""
    ];

    if (!plan.batchValidation.valid) {
        lines.push("Batch Validation Errors:");
        for (const error of plan.batchValidation.errors) {
            lines.push(`  ✗ ${error}`);
        }
        lines.push("");
    }

    if (plan.batchValidation.warnings.length > 0) {
        lines.push("Batch Validation Warnings:");
        for (const warning of plan.batchValidation.warnings) {
            lines.push(`  ⚠ ${warning}`);
        }
        lines.push("");
    }

    if (plan.batchValidation.conflictingSets.length > 0) {
        lines.push("Conflicting Symbol Sets:");
        for (const set of plan.batchValidation.conflictingSets) {
            lines.push(`  ✗ ${set.join(", ")}`);
        }
        lines.push("");
    }

    lines.push("Per-Symbol Impact:");
    for (const [symbolId, analysis] of plan.impactAnalyses) {
        const summary = analysis.summary;
        lines.push(
            `  ${summary.oldName} → ${summary.newName} (${symbolId})`,
            `    Occurrences: ${summary.totalOccurrences} (${summary.definitionCount} def, ${summary.referenceCount} ref)`,
            `    Affected Files: ${summary.affectedFiles.length}`,
            `    Dependent Symbols: ${summary.dependentSymbols.length}`
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

    if (plan.cascadeResult) {
        // Extract metadata to avoid repeated deep-navigation through plan.cascadeResult.metadata.*
        const cascadeMetadata = plan.cascadeResult.metadata;
        lines.push(
            "Hot Reload Dependency Cascade:",
            `  Total Symbols to Reload: ${cascadeMetadata.totalSymbols}`,
            `  Max Dependency Distance: ${cascadeMetadata.maxDistance}`,
            `  Has Circular Dependencies: ${cascadeMetadata.hasCircular ? "Yes" : "No"}`
        );

        if (plan.cascadeResult.circular.length > 0) {
            lines.push("  Circular Dependency Chains:");
            for (const cycle of plan.cascadeResult.circular) {
                const formattedCycle = cycle.map((id) => extractSymbolName(id)).join(" → ");
                lines.push(`    ⚠ ${formattedCycle}`);
            }
        }

        lines.push(`  Reload Order: ${plan.cascadeResult.order.length} symbols`, "");
    }

    if (plan.hotReload) {
        lines.push(`Hot Reload Status: ${plan.hotReload.valid ? "SAFE" : "UNSAFE"}`);

        appendErrorsAndWarnings(lines, plan.hotReload.errors, plan.hotReload.warnings);
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
