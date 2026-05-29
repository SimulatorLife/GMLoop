/**
 * Tests for rename preview utilities.
 */

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildHotReloadReport,
    formatBatchRenamePlanReport,
    formatOccurrencePreview,
    formatRenamePlanReport,
    generateRenamePreview
} from "../src/rename-preview.js";
import {
    type BatchRenamePlanSummary,
    ConflictType,
    OccurrenceKind,
    type RenamePlanSummary,
    type SymbolOccurrence
} from "../src/types.js";
import { WorkspaceEdit } from "../src/workspace-edit.js";

void describe("generateRenamePreview", () => {
    void it("generates preview for simple rename", () => {
        const workspace = new WorkspaceEdit();
        workspace.addEdit("scripts/player.gml", 10, 20, "scr_hero");
        workspace.addEdit("scripts/player.gml", 50, 60, "scr_hero");
        workspace.addEdit("scripts/enemy.gml", 30, 40, "scr_hero");

        const preview = generateRenamePreview(workspace, "scr_player", "scr_hero");

        assert.equal(preview.summary.totalEdits, 3);
        assert.equal(preview.summary.affectedFiles, 2);
        assert.equal(preview.summary.oldName, "scr_player");
        assert.equal(preview.summary.newName, "scr_hero");
        assert.equal(preview.files.length, 2);
    });

    void it("includes file-level details in preview", () => {
        const workspace = new WorkspaceEdit();
        workspace.addEdit("scripts/player.gml", 10, 20, "newName");
        workspace.addEdit("scripts/player.gml", 50, 60, "newName");

        const preview = generateRenamePreview(workspace, "oldName", "newName");

        const playerFile = preview.files.find((f) => f.filePath === "scripts/player.gml");
        assert.ok(playerFile);
        assert.equal(playerFile.editCount, 2);
        assert.equal(playerFile.edits.length, 2);
        assert.equal(playerFile.edits[0].oldText, "oldName");
        assert.equal(playerFile.edits[0].newText, "newName");
    });

    void it("handles empty workspace", () => {
        const workspace = new WorkspaceEdit();
        const preview = generateRenamePreview(workspace, "oldName", "newName");

        assert.equal(preview.summary.totalEdits, 0);
        assert.equal(preview.summary.affectedFiles, 0);
        assert.equal(preview.files.length, 0);
    });

    void it("validates input parameters", () => {
        const workspace = new WorkspaceEdit();

        assert.throws(() => generateRenamePreview(null, "old", "new"), {
            name: "TypeError",
            message: /requires a valid WorkspaceEdit/
        });

        assert.throws(() => generateRenamePreview(workspace, "", "new"), {
            name: "TypeError",
            message: /requires oldName as a non-empty string/
        });

        assert.throws(() => generateRenamePreview(workspace, "old", ""), {
            name: "TypeError",
            message: /requires newName as a non-empty string/
        });
    });

    void it("preserves edit positions in preview", () => {
        const workspace = new WorkspaceEdit();
        workspace.addEdit("test.gml", 100, 110, "newText");

        const preview = generateRenamePreview(workspace, "oldText", "newText");

        assert.equal(preview.files[0].edits[0].start, 100);
        assert.equal(preview.files[0].edits[0].end, 110);
    });
});

void describe("formatRenamePlanReport", () => {
    void it("formats valid rename plan", () => {
        const plan: RenamePlanSummary = {
            workspace: new WorkspaceEdit(),
            validation: {
                valid: true,
                errors: [],
                warnings: []
            },
            hotReload: null,
            analysis: {
                valid: true,
                summary: {
                    symbolId: "gml/script/scr_player",
                    oldName: "scr_player",
                    newName: "scr_hero",
                    affectedFiles: ["scripts/player.gml", "scripts/game.gml"],
                    totalOccurrences: 5,
                    definitionCount: 1,
                    referenceCount: 4,
                    hotReloadRequired: true,
                    dependentSymbols: ["gml/script/scr_combat"]
                },
                conflicts: [],
                warnings: []
            }
        };

        // Add some edits to the workspace
        plan.workspace.addEdit("scripts/player.gml", 10, 20, "scr_hero");
        plan.workspace.addEdit("scripts/game.gml", 30, 40, "scr_hero");

        const report = formatRenamePlanReport(plan);

        assert.ok(report.includes("Rename Plan Report"));
        assert.ok(report.includes("scr_player → scr_hero"));
        assert.ok(report.includes("Status: VALID"));
        assert.ok(report.includes("Total Occurrences: 5"));
        assert.ok(report.includes("Definitions: 1"));
        assert.ok(report.includes("References: 4"));
        assert.ok(report.includes("Affected Files: 2"));
        assert.ok(report.includes("Hot Reload Required: Yes"));
        assert.ok(report.includes("Dependent Symbols: 1"));
        assert.ok(report.includes("Total Edits: 2"));
        assert.ok(report.includes("Files Modified: 2"));
    });

    void it("formats invalid rename plan with errors", () => {
        const plan: RenamePlanSummary = {
            workspace: new WorkspaceEdit(),
            validation: {
                valid: false,
                errors: ["Symbol not found", "Reserved keyword conflict"],
                warnings: []
            },
            hotReload: null,
            analysis: {
                valid: false,
                summary: {
                    symbolId: "gml/script/scr_test",
                    oldName: "scr_test",
                    newName: "if",
                    affectedFiles: [],
                    totalOccurrences: 0,
                    definitionCount: 0,
                    referenceCount: 0,
                    hotReloadRequired: false,
                    dependentSymbols: []
                },
                conflicts: [
                    {
                        type: ConflictType.RESERVED,
                        message: "'if' is a reserved keyword",
                        severity: "error"
                    }
                ],
                warnings: []
            }
        };

        const report = formatRenamePlanReport(plan);

        assert.ok(report.includes("Status: INVALID"));
        assert.ok(report.includes("Validation Errors:"));
        assert.ok(report.includes("Symbol not found"));
        assert.ok(report.includes("Reserved keyword conflict"));
        assert.ok(report.includes("Conflicts:"));
        assert.ok(report.includes("'if' is a reserved keyword"));
    });

    void it("formats plan with warnings", () => {
        const plan: RenamePlanSummary = {
            workspace: new WorkspaceEdit(),
            validation: {
                valid: true,
                errors: [],
                warnings: ["Large number of edits planned"]
            },
            hotReload: null,
            analysis: {
                valid: true,
                summary: {
                    symbolId: "gml/script/common",
                    oldName: "common",
                    newName: "util",
                    affectedFiles: ["a.gml", "b.gml", "c.gml"],
                    totalOccurrences: 100,
                    definitionCount: 1,
                    referenceCount: 99,
                    hotReloadRequired: true,
                    dependentSymbols: []
                },
                conflicts: [],
                warnings: [
                    {
                        type: ConflictType.LARGE_RENAME,
                        message: "This rename will affect 100 occurrences",
                        severity: "warning"
                    }
                ]
            }
        };

        const report = formatRenamePlanReport(plan);

        assert.ok(report.includes("Validation Warnings:"));
        assert.ok(report.includes("Large number of edits planned"));
        assert.ok(report.includes("Analysis Warnings:"));
        assert.ok(report.includes("This rename will affect 100 occurrences"));
    });

    void it("formats plan with hot reload information", () => {
        const plan: RenamePlanSummary = {
            workspace: new WorkspaceEdit(),
            validation: {
                valid: true,
                errors: [],
                warnings: []
            },
            hotReload: {
                valid: true,
                errors: [],
                warnings: ["Large edit detected"],
                hotReload: {
                    safe: true,
                    reason: "Script renames are hot-reload-safe",
                    requiresRestart: false,
                    canAutoFix: true,
                    suggestions: ["All script call sites will be updated atomically"]
                }
            },
            analysis: {
                valid: true,
                summary: {
                    symbolId: "gml/script/scr_move",
                    oldName: "scr_move",
                    newName: "scr_movement",
                    affectedFiles: [],
                    totalOccurrences: 0,
                    definitionCount: 0,
                    referenceCount: 0,
                    hotReloadRequired: false,
                    dependentSymbols: []
                },
                conflicts: [],
                warnings: []
            }
        };

        const report = formatRenamePlanReport(plan);

        assert.ok(report.includes("Hot Reload Status: SAFE"));
        assert.ok(report.includes("Reason: Script renames are hot-reload-safe"));
        assert.ok(report.includes("Requires Restart: No"));
        assert.ok(report.includes("Can Auto-Fix: Yes"));
        assert.ok(report.includes("Suggestions:"));
        assert.ok(report.includes("All script call sites will be updated atomically"));
        assert.ok(report.includes("Warnings:"));
        assert.ok(report.includes("Large edit detected"));
    });

    void it("formats plan with conflicts in specific files", () => {
        const plan: RenamePlanSummary = {
            workspace: new WorkspaceEdit(),
            validation: {
                valid: false,
                errors: [],
                warnings: []
            },
            hotReload: null,
            analysis: {
                valid: false,
                summary: {
                    symbolId: "gml/script/test",
                    oldName: "test",
                    newName: "testing",
                    affectedFiles: [],
                    totalOccurrences: 0,
                    definitionCount: 0,
                    referenceCount: 0,
                    hotReloadRequired: false,
                    dependentSymbols: []
                },
                conflicts: [
                    {
                        type: ConflictType.SHADOW,
                        message: "Would shadow existing symbol",
                        severity: "error",
                        path: "scripts/player.gml"
                    }
                ],
                warnings: []
            }
        };

        const report = formatRenamePlanReport(plan);

        assert.ok(report.includes("Conflicts:"));
        assert.ok(report.includes("Would shadow existing symbol"));
        assert.ok(report.includes("in scripts/player.gml"));
    });
});

void describe("formatBatchRenamePlanReport", () => {
    void it("formats valid batch rename plan", () => {
        const plan: BatchRenamePlanSummary = {
            workspace: new WorkspaceEdit(),
            validation: {
                valid: true,
                errors: [],
                warnings: []
            },
            hotReload: null,
            batchValidation: {
                valid: true,
                errors: [],
                warnings: [],
                renameValidations: new Map(),
                conflictingSets: []
            },
            impactAnalyses: new Map([
                [
                    "gml/script/scr_a",
                    {
                        valid: true,
                        summary: {
                            symbolId: "gml/script/scr_a",
                            oldName: "scr_a",
                            newName: "scr_x",
                            affectedFiles: ["a.gml"],
                            totalOccurrences: 3,
                            definitionCount: 1,
                            referenceCount: 2,
                            hotReloadRequired: true,
                            dependentSymbols: []
                        },
                        conflicts: [],
                        warnings: []
                    }
                ],
                [
                    "gml/script/scr_b",
                    {
                        valid: true,
                        summary: {
                            symbolId: "gml/script/scr_b",
                            oldName: "scr_b",
                            newName: "scr_y",
                            affectedFiles: ["b.gml"],
                            totalOccurrences: 5,
                            definitionCount: 1,
                            referenceCount: 4,
                            hotReloadRequired: true,
                            dependentSymbols: ["gml/script/scr_c"]
                        },
                        conflicts: [],
                        warnings: []
                    }
                ]
            ]),
            cascadeResult: null
        };

        const report = formatBatchRenamePlanReport(plan);

        assert.ok(report.includes("Batch Rename Plan Report"));
        assert.ok(report.includes("Status: VALID"));
        assert.ok(report.includes("Total Renames: 2"));
        assert.ok(report.includes("Per-Symbol Impact:"));
        assert.ok(report.includes("scr_a → scr_x"));
        assert.ok(report.includes("scr_b → scr_y"));
        assert.ok(report.includes("Occurrences: 3"));
        assert.ok(report.includes("Occurrences: 5"));
    });

    void it("formats batch plan with conflicts", () => {
        const plan: BatchRenamePlanSummary = {
            workspace: new WorkspaceEdit(),
            validation: {
                valid: false,
                errors: [],
                warnings: []
            },
            hotReload: null,
            batchValidation: {
                valid: false,
                errors: ["Multiple symbols renamed to same name"],
                warnings: [],
                renameValidations: new Map(),
                conflictingSets: [["gml/script/scr_a", "gml/script/scr_b"]]
            },
            impactAnalyses: new Map(),
            cascadeResult: null
        };

        const report = formatBatchRenamePlanReport(plan);

        assert.ok(report.includes("Status: INVALID"));
        assert.ok(report.includes("Batch Validation Errors:"));
        assert.ok(report.includes("Multiple symbols renamed to same name"));
        assert.ok(report.includes("Conflicting Symbol Sets:"));
        assert.ok(report.includes("gml/script/scr_a, gml/script/scr_b"));
    });

    void it("formats batch plan with cascade result", () => {
        const plan: BatchRenamePlanSummary = {
            workspace: new WorkspaceEdit(),
            validation: {
                valid: true,
                errors: [],
                warnings: []
            },
            hotReload: null,
            batchValidation: {
                valid: true,
                errors: [],
                warnings: [],
                renameValidations: new Map(),
                conflictingSets: []
            },
            impactAnalyses: new Map(),
            cascadeResult: {
                cascade: [
                    {
                        symbolId: "gml/script/scr_a",
                        distance: 0,
                        reason: "direct change"
                    },
                    {
                        symbolId: "gml/script/scr_b",
                        distance: 1,
                        reason: "depends on scr_a"
                    }
                ],
                order: ["gml/script/scr_a", "gml/script/scr_b"],
                circular: [["gml/script/scr_x", "gml/script/scr_y", "gml/script/scr_x"]],
                metadata: {
                    totalSymbols: 2,
                    maxDistance: 1,
                    hasCircular: true
                }
            }
        };

        const report = formatBatchRenamePlanReport(plan);

        assert.ok(report.includes("Hot Reload Dependency Cascade:"));
        assert.ok(report.includes("Total Symbols to Reload: 2"));
        assert.ok(report.includes("Max Dependency Distance: 1"));
        assert.ok(report.includes("Has Circular Dependencies: Yes"));
        assert.ok(report.includes("Circular Dependency Chains:"));
        assert.ok(report.includes("scr_x → scr_y → scr_x"));
    });

    void it("formats batch plan with per-symbol conflicts and warnings", () => {
        const plan: BatchRenamePlanSummary = {
            workspace: new WorkspaceEdit(),
            validation: {
                valid: true,
                errors: [],
                warnings: []
            },
            hotReload: null,
            batchValidation: {
                valid: true,
                errors: [],
                warnings: ["Some warnings"],
                renameValidations: new Map(),
                conflictingSets: []
            },
            impactAnalyses: new Map([
                [
                    "gml/script/scr_test",
                    {
                        valid: false,
                        summary: {
                            symbolId: "gml/script/scr_test",
                            oldName: "scr_test",
                            newName: "if",
                            affectedFiles: [],
                            totalOccurrences: 0,
                            definitionCount: 0,
                            referenceCount: 0,
                            hotReloadRequired: false,
                            dependentSymbols: []
                        },
                        conflicts: [
                            {
                                type: ConflictType.RESERVED,
                                message: "Reserved keyword"
                            }
                        ],
                        warnings: [
                            {
                                type: ConflictType.LARGE_RENAME,
                                message: "Large impact"
                            }
                        ]
                    }
                ]
            ]),
            cascadeResult: null
        };

        const report = formatBatchRenamePlanReport(plan);

        assert.ok(report.includes("Conflicts: 1"));
        assert.ok(report.includes("Reserved keyword"));
        assert.ok(report.includes("Warnings: 1"));
        assert.ok(report.includes("Large impact"));
    });
});

void describe("formatOccurrencePreview", () => {
    void it("formats occurrence preview", () => {
        const occurrences: Array<SymbolOccurrence> = [
            {
                path: "scripts/player.gml",
                start: 10,
                end: 20,
                kind: OccurrenceKind.DEFINITION
            },
            {
                path: "scripts/player.gml",
                start: 50,
                end: 60,
                kind: OccurrenceKind.REFERENCE
            },
            {
                path: "scripts/enemy.gml",
                start: 30,
                end: 40,
                kind: OccurrenceKind.REFERENCE
            }
        ];

        const preview = formatOccurrencePreview(occurrences, "player_hp", "playerHealth");

        assert.ok(preview.includes("Symbol Occurrences: player_hp → playerHealth"));
        assert.ok(preview.includes("Total: 3 occurrences in 2 files"));
        assert.ok(preview.includes("scripts/player.gml (2 occurrences):"));
        assert.ok(preview.includes("[definition] Position 10-20"));
        assert.ok(preview.includes("[reference] Position 50-60"));
        assert.ok(preview.includes("scripts/enemy.gml (1 occurrence):"));
        assert.ok(preview.includes("[reference] Position 30-40"));
    });

    void it("handles empty occurrences", () => {
        const preview = formatOccurrencePreview([], "oldName", "newName");

        assert.ok(preview.includes("Symbol Occurrences: oldName → newName"));
        assert.ok(preview.includes("Total: 0 occurrences in 0 files"));
    });

    void it("handles occurrences without kind", () => {
        const occurrences: Array<SymbolOccurrence> = [
            {
                path: "test.gml",
                start: 0,
                end: 10
            }
        ];

        const preview = formatOccurrencePreview(occurrences, "old", "new");

        assert.ok(preview.includes("[unknown] Position 0-10"));
    });

    void it("validates input parameters", () => {
        const occurrences: Array<SymbolOccurrence> = [];

        assert.throws(() => formatOccurrencePreview(null, "old", "new"), {
            name: "TypeError",
            message: /requires an array of occurrences/
        });

        assert.throws(() => formatOccurrencePreview(occurrences, "", "new"), {
            name: "TypeError",
            message: /requires oldName as a non-empty string/
        });

        assert.throws(() => formatOccurrencePreview(occurrences, "old", ""), {
            name: "TypeError",
            message: /requires newName as a non-empty string/
        });
    });

    void it("groups occurrences by file correctly", () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "a.gml", start: 0, end: 5, kind: OccurrenceKind.DEFINITION },
            { path: "b.gml", start: 10, end: 15, kind: OccurrenceKind.REFERENCE },
            { path: "a.gml", start: 20, end: 25, kind: OccurrenceKind.REFERENCE },
            { path: "c.gml", start: 30, end: 35, kind: OccurrenceKind.REFERENCE }
        ];

        const preview = formatOccurrencePreview(occurrences, "test", "renamed");

        assert.ok(preview.includes("a.gml (2 occurrences):"));
        assert.ok(preview.includes("b.gml (1 occurrence):"));
        assert.ok(preview.includes("c.gml (1 occurrence):"));
    });
});

void describe("buildHotReloadReport", () => {
    void it("returns null for null input", () => {
        const result = buildHotReloadReport(null);
        assert.equal(result, null);
    });

    void it("returns null when hotReload property is undefined", () => {
        const validation = {
            valid: true,
            errors: [],
            warnings: []
        };
        const result = buildHotReloadReport(validation);
        assert.equal(result, null);
    });

    void it("returns structured report when hotReload data exists", () => {
        const validation = {
            valid: false,
            errors: [],
            warnings: [],
            hotReload: {
                safe: false,
                reason: "Script renames require recompilation",
                requiresRestart: false,
                canAutoFix: false,
                suggestions: ["Consider a full restart"]
            }
        };
        const result = buildHotReloadReport(validation);
        assert.ok(result !== null);
        assert.equal(result.safe, false);
        assert.equal(result.reason, "Script renames require recompilation");
        assert.equal(result.requiresRestart, false);
        assert.equal(result.canAutoFix, false);
        assert.deepEqual(result.suggestions, ["Consider a full restart"]);
    });

    void it("preserves all suggestion items in report", () => {
        const suggestions = ["Suggestion one", "Suggestion two", "Suggestion three"];
        const validation = {
            valid: false,
            errors: [],
            warnings: [],
            hotReload: {
                safe: true,
                reason: "Safe to reload",
                requiresRestart: false,
                canAutoFix: true,
                suggestions
            }
        };
        const result = buildHotReloadReport(validation);
        assert.ok(result !== null);
        assert.deepEqual(result.suggestions, suggestions);
    });
});
