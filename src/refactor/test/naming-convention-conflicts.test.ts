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

void test("namingConvention blocks reserved built-in names for local variable-category targets", async () => {
    const projectRoot = "/project";
    const targets: Array<NamingConventionTarget> = [
        {
            category: "variable",
            name: "Choose",
            occurrences: [
                {
                    path: "scripts/foo/foo.gml",
                    start: 12,
                    end: 18,
                    scopeId: "scope-function",
                    kind: "definition"
                }
            ],
            path: "scripts/foo/foo.gml",
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
                        variable: { caseStyle: "lower_snake" }
                    }
                }
            }
        }
    });

    assert.equal(plan.localRenameCount, 0);
    assert.equal(
        plan.warnings.some(
            (warning) =>
                warning.includes("reserved GameMaker identifier") &&
                warning.includes("'Choose'") &&
                warning.includes("'choose'")
        ),
        true
    );
});

void test("namingConvention blocks reserved top-level names from semantic keyword providers", async () => {
    const projectRoot = "/project";
    const targets: Array<NamingConventionTarget> = [
        {
            category: "scriptResourceName",
            name: "PoissonDiskSample",
            occurrences: [
                {
                    path: "scripts/PoissonDiskSample/PoissonDiskSample.yy",
                    start: 0,
                    end: 0,
                    scopeId: "scope-global",
                    kind: "definition"
                }
            ],
            path: "scripts/PoissonDiskSample/PoissonDiskSample.yy",
            scopeId: "scope-global",
            symbolId: "gml/scripts/PoissonDiskSample"
        }
    ];

    const semantic: PartialSemanticAnalyzer = {
        listNamingConventionTargets: async () => targets,
        hasSymbol: async () => true,
        getSymbolOccurrences: async () => [],
        getReservedKeywords: async () => ["poisson_disk_sample"],
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

    assert.equal(plan.topLevelRenameRequests.length, 0);
    assert.equal(
        plan.warnings.some(
            (warning) => warning.includes("reserved GameMaker identifier") && warning.includes("poisson_disk_sample")
        ),
        true
    );
});

void test("namingConvention does not block local variable renames due to unresolved property accesses in other scopes/files", async () => {
    const projectRoot = "/project";
    const targets: Array<NamingConventionTarget> = [
        {
            category: "localVariable",
            name: "R",
            occurrences: [
                {
                    path: "scripts/ColmeshCollider/ColmeshCollider.gml",
                    start: 10,
                    end: 11,
                    scopeId: "scope-func-1",
                    kind: "definition"
                }
            ],
            path: "scripts/ColmeshCollider/ColmeshCollider.gml",
            scopeId: "scope-func-1",
            symbolId: null
        }
    ];

    const semantic: any = {
        listNamingConventionTargets: async () => targets,
        getSymbolOccurrences: async () => [],
        hasSymbol: async () => true,
        getFileSymbols: async () => [],
        getReservedKeywords: async () => [],
        validateEdits: async () => ({ errors: [], warnings: [] }),
        checkSemanticGaps: (_name: string, _kind?: string | null) => {
            // Mock an unresolved property access on R
            return [
                {
                    message:
                        "Unresolved same-name property access 'R' in scripts/ColmeshShape/ColmeshShape.gml at position 100-101",
                    path: "scripts/ColmeshShape/ColmeshShape.gml"
                }
            ];
        }
    };

    const engine = new Refactor.RefactorEngine({ semantic });
    const plan = await engine.planNamingConventionCodemod({
        projectRoot,
        targetPaths: [projectRoot],
        config: {
            codemods: {
                namingConvention: {
                    rules: {
                        variable: { caseStyle: "lower_snake" }
                    }
                }
            }
        }
    });

    // The local variable R should be successfully planned to be renamed to r
    assert.equal(plan.errors.length, 0, "Should have no errors");
    assert.equal(plan.warnings.length, 0, "Should have no warnings");
});

void test("namingConvention does not block enum member renames due to unresolved property accesses", async () => {
    const projectRoot = "/project";
    const targets: Array<NamingConventionTarget> = [
        {
            category: "enumMember",
            name: "bounds",
            occurrences: [
                {
                    path: "scripts/Clock/Clock.gml",
                    start: 10,
                    end: 16,
                    scopeId: "scope-global",
                    kind: "definition"
                }
            ],
            path: "scripts/Clock/Clock.gml",
            scopeId: "scope-global",
            symbolId: "gml/enum-member/eGrassMode/bounds"
        }
    ];

    const semantic: any = {
        listNamingConventionTargets: async () => targets,
        getSymbolOccurrences: async () => [
            {
                path: "scripts/Clock/Clock.gml",
                start: 10,
                end: 16,
                scopeId: "scope-global",
                kind: "definition"
            }
        ],
        hasSymbol: async (symbolId: string) => symbolId === "gml/enum-member/eGrassMode/bounds",
        getFileSymbols: async () => [],
        getReservedKeywords: async () => [],
        validateEdits: async () => ({ errors: [], warnings: [] }),
        checkSemanticGaps: (name: string, kind?: string | null) => {
            // Mock checkSemanticGaps. In a real resolver, this returns unresolved same-name references.
            // If the caller passes the correct symbolKind, we skip property access checks.
            if (kind === "enum-member") {
                return [];
            }
            return [
                {
                    message: "Unresolved same-name property access 'bounds' in scripts/Clock/Clock.gml",
                    path: "scripts/Clock/Clock.gml"
                }
            ];
        }
    };

    const engine = new Refactor.RefactorEngine({ semantic });
    const plan = await engine.planNamingConventionCodemod({
        projectRoot,
        targetPaths: [projectRoot],
        config: {
            codemods: {
                namingConvention: {
                    rules: {
                        enumMember: { caseStyle: "upper_snake" }
                    }
                }
            }
        }
    });

    assert.equal(plan.topLevelRenameRequests.length, 1);
    assert.equal(plan.topLevelRenameRequests[0].newName, "BOUNDS");
    assert.equal(plan.errors.length, 0);
});

void test("namingConvention partitions large rename batches (> 256) into fast-path and slow-path", async () => {
    const projectRoot = "/project";
    const targets: Array<NamingConventionTarget> = [];

    // Create 290 fast-pathable script renames (violating naming convention by being PascalCase)
    for (let i = 0; i < 290; i++) {
        targets.push({
            category: "scriptResourceName",
            name: `ScriptFunc${i}`,
            occurrences: [
                {
                    path: `scripts/ScriptFunc${i}/ScriptFunc${i}.yy`,
                    start: 0,
                    end: 0,
                    scopeId: "scope-global",
                    kind: "definition"
                }
            ],
            path: `scripts/ScriptFunc${i}/ScriptFunc${i}.yy`,
            scopeId: "scope-global",
            symbolId: `gml/scripts/ScriptFunc${i}`
        });
    }

    // Create 10 slow-pathable global variable renames (violating naming convention by being CamelCase)
    for (let i = 0; i < 10; i++) {
        targets.push({
            category: "globalVariable",
            name: `GlobalVar${i}`,
            occurrences: [
                {
                    path: "scripts/globals/globals.gml",
                    start: i * 20,
                    end: i * 20 + 8,
                    scopeId: "scope-global",
                    kind: "definition"
                }
            ],
            path: "scripts/globals/globals.gml",
            scopeId: "scope-global",
            symbolId: `gml/var/GlobalVar${i}`
        });
    }

    const semantic: any = {
        listNamingConventionTargets: async () => targets,
        getSymbolOccurrences: async (_name: string, symbolId?: string | null) => {
            const target = targets.find((t) => t.symbolId === symbolId);
            return target ? target.occurrences : [];
        },
        hasSymbol: async (symbolId: string) => {
            // Return true for original symbolIds to simulate existence, false for new names to avoid conflicts
            return targets.some((t) => t.symbolId === symbolId);
        },
        getFileSymbols: async () => [],
        getReservedKeywords: async () => [],
        validateEdits: async () => ({ errors: [], warnings: [] }),
        checkSemanticGaps: () => []
    };

    const engine = new Refactor.RefactorEngine({ semantic });

    // Track how many times validateRenameRequest is called on the engine
    let validateCallCount = 0;
    const originalValidate = engine.validateRenameRequest.bind(engine);
    engine.validateRenameRequest = async (request) => {
        validateCallCount++;
        return originalValidate(request);
    };

    const plan = await engine.planNamingConventionCodemod({
        projectRoot,
        targetPaths: [projectRoot],
        config: {
            codemods: {
                namingConvention: {
                    rules: {
                        scriptResourceName: { caseStyle: "lower_snake" },
                        variable: { caseStyle: "lower_snake" }
                    }
                }
            }
        }
    });

    assert.equal(plan.errors.length, 0);
    assert.equal(plan.topLevelRenameRequests.length, 300);
    assert.equal(
        validateCallCount,
        10,
        "validateRenameRequest should only be called for the 10 slow-path variable renames"
    );
});
