import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";
import type { NamingConventionTarget, PartialSemanticAnalyzer } from "../src/types.js";

void test("namingConvention skips top-level rename if it shadows a local variable in its occurrence scope", async () => {
    const projectRoot = "/project";
    const targets: Array<NamingConventionTarget> = [
        {
            category: "scriptResourceName",
            name: "Scaler",
            occurrences: [
                {
                    path: "scripts/Scaler/Scaler.yy",
                    start: 0,
                    end: 0,
                    scopeId: "scope-global",
                    kind: "definition"
                },
                {
                    path: "scripts/Scaler/Scaler.gml",
                    start: 50,
                    end: 56,
                    scopeId: "scope-create-event",
                    kind: "reference"
                }
            ],
            path: "scripts/Scaler/Scaler.yy",
            scopeId: "scope-global",
            symbolId: "gml/scripts/Scaler"
        }
    ];

    const semantic: PartialSemanticAnalyzer = {
        listNamingConventionTargets: async () => targets,
        getSymbolOccurrences: async () => [
            {
                path: "scripts/Scaler/Scaler.yy",
                start: 0,
                end: 0,
                scopeId: "scope-global"
            },
            {
                path: "scripts/Scaler/Scaler.gml",
                start: 50,
                end: 56,
                scopeId: "scope-create-event"
            }
        ],
        hasSymbol: async () => true,
        // Mock lookup to find a local variable named "scaler" in the create event scope
        lookup: async (name: string, scopeId?: string) => {
            if (name === "scaler" && scopeId === "scope-create-event") {
                return { name: "scaler" };
            }
            return null;
        },
        getFileSymbols: async () => [],
        getReservedKeywords: async () => [],
        validateEdits: async () => ({ errors: [], warnings: [] })
    };

    const engine = new Refactor.RefactorEngine({ semantic });

    const plan = await engine.planNamingConventionCodemod({
        projectRoot,
        targetPaths: [projectRoot],
        config: {
            codemods: {
                namingConvention: {
                    rules: {
                        scriptResourceName: { caseStyle: "lower_snake" }
                    }
                }
            }
        }
    });

    // The script resource Scaler should NOT be renamed to scaler because it would shadow the local variable scaler
    const scalerRename = plan.topLevelRenameRequests.find((r) => r.symbolId === "gml/scripts/Scaler");
    assert.equal(scalerRename, undefined, "Script Scaler rename should be skipped due to shadowing");

    // There should be a warning about batch planning failure due to the shadowing conflict
    const hasShadowWarning = plan.warnings.some((w) => w.includes("shadow") || w.includes("planning failed"));
    assert.equal(hasShadowWarning, true, "Should have a warning about shadowing conflict or planning failure");
});

void test("namingConvention skips local variable rename if it conflicts with a global asset name", async () => {
    const projectRoot = "/project";
    const targets: Array<NamingConventionTarget> = [
        // Global script target (already compliant lower_snake_case)
        {
            category: "scriptResourceName",
            name: "scaler",
            occurrences: [
                {
                    path: "scripts/scaler/scaler.yy",
                    start: 0,
                    end: 0,
                    scopeId: "scope-global",
                    kind: "definition"
                }
            ],
            path: "scripts/scaler/scaler.yy",
            scopeId: "scope-global",
            symbolId: "gml/scripts/scaler"
        },
        // Local variable target (PascalCase, e.g. "Scaler" -> "scaler")
        {
            category: "localVariable",
            name: "Scaler",
            occurrences: [
                {
                    path: "scripts/scaler/scaler.gml",
                    start: 100,
                    end: 106,
                    scopeId: "scope-function",
                    kind: "definition"
                }
            ],
            path: "scripts/scaler/scaler.gml",
            scopeId: "scope-function",
            symbolId: null
        }
    ];

    const semantic: PartialSemanticAnalyzer = {
        listNamingConventionTargets: async () => targets,
        validateEdits: async () => ({ errors: [], warnings: [] })
    };

    const engine = new Refactor.RefactorEngine({ semantic });

    const plan = await engine.planNamingConventionCodemod({
        projectRoot,
        targetPaths: [projectRoot],
        config: {
            codemods: {
                namingConvention: {
                    rules: {
                        localVariable: { caseStyle: "lower_snake" }
                    }
                }
            }
        }
    });

    // The local variable should not be planned for rename, localRenameCount should be 0
    assert.equal(
        plan.localRenameCount,
        0,
        "Local variable rename should be skipped due to collision with global asset name"
    );

    // There should be a warning about the conflict
    const hasConflictWarning = plan.warnings.some((w) => w.includes("conflicts with a global asset/resource name"));
    assert.equal(hasConflictWarning, true, "Should have a warning about collision with global asset name");
});
