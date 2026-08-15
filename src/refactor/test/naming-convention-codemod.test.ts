import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";
import type { NamingConventionTarget, PartialSemanticAnalyzer } from "../src/types.js";

void test("namingConvention preserves constructor/struct declarations when script resource is renamed", async () => {
    // 1. Arrange
    const projectRoot = "/project";
    const targets: Array<NamingConventionTarget> = [
        // Script resource target (bad casing, e.g. "attack" or "Attack")
        {
            category: "scriptResourceName",
            name: "Attack",
            occurrences: [
                {
                    path: "scripts/Attack/Attack.yy",
                    start: 0,
                    end: 0,
                    scopeId: "scope-0",
                    kind: "definition"
                }
            ],
            path: "scripts/Attack/Attack.yy",
            scopeId: "scope-0",
            symbolId: "gml/scripts/Attack"
        },
        // Constructor function target inside the script (is compliant PascalCase)
        {
            category: "constructorFunction",
            name: "Attack",
            occurrences: [
                {
                    path: "scripts/Attack/Attack.gml",
                    start: 10,
                    end: 16,
                    scopeId: "scope-1",
                    kind: "definition"
                }
            ],
            path: "scripts/Attack/Attack.gml",
            scopeId: "scope-1",
            symbolId: "gml/scripts/Attack" // shares matching name with script resource
        }
    ];

    const semantic: PartialSemanticAnalyzer = {
        listNamingConventionTargets: async () => targets,
        validateEdits: async () => ({ errors: [], warnings: [] })
    };

    const engine = new Refactor.RefactorEngine({ semantic });

    // 2. Act
    const plan = await engine.planNamingConventionCodemod({
        projectRoot,
        targetPaths: [projectRoot],
        config: {
            codemods: {
                namingConvention: {
                    rules: {
                        structDeclaration: { caseStyle: "pascal" },
                        constructorFunction: { caseStyle: "pascal" },
                        variable: { caseStyle: "lower_snake" }
                    }
                }
            }
        }
    });

    // 3. Assert: constructorFunction and structDeclaration must NOT be renamed
    const attackRename = plan.topLevelRenameRequests.find((r) => r.symbolId === "gml/scripts/Attack");
    assert.equal(attackRename, undefined, "Constructor function Attack should not be planned for rename");
});

void test("namingConvention exempts a script resource that matches its sole struct declaration name", async () => {
    // 1. Arrange: scriptResourceName requires a "scr_" prefix, but "LinkedHashMap.gml"
    // defines exactly one struct named "LinkedHashMap" that already complies with the
    // struct naming rule, so the resource should keep the struct-matching name.
    const projectRoot = "/project";
    const targets: Array<NamingConventionTarget> = [
        {
            category: "scriptResourceName",
            name: "LinkedHashMap",
            occurrences: [
                {
                    path: "scripts/LinkedHashMap/LinkedHashMap.yy",
                    start: 0,
                    end: 0,
                    scopeId: "scope-0",
                    kind: "definition"
                }
            ],
            path: "scripts/LinkedHashMap/LinkedHashMap.yy",
            scopeId: "scope-0",
            symbolId: "gml/scripts/LinkedHashMap"
        },
        {
            category: "structDeclaration",
            name: "LinkedHashMap",
            occurrences: [
                {
                    path: "scripts/LinkedHashMap/LinkedHashMap.gml",
                    start: 10,
                    end: 23,
                    scopeId: "scope-1",
                    kind: "definition"
                }
            ],
            path: "scripts/LinkedHashMap/LinkedHashMap.gml",
            scopeId: "scope-1",
            symbolId: "gml/scripts/LinkedHashMap"
        }
    ];

    const semantic: PartialSemanticAnalyzer = {
        listNamingConventionTargets: async () => targets,
        validateEdits: async () => ({ errors: [], warnings: [] })
    };

    const engine = new Refactor.RefactorEngine({ semantic });

    // 2. Act
    const plan = await engine.planNamingConventionCodemod({
        projectRoot,
        targetPaths: [projectRoot],
        config: {
            codemods: {
                namingConvention: {
                    rules: {
                        scriptResourceName: { prefix: "scr_" },
                        structDeclaration: { caseStyle: "pascal" }
                    }
                }
            }
        }
    });

    // 3. Assert: the script resource keeps its struct-matching name.
    const linkedHashMapRename = plan.topLevelRenameRequests.find((r) => r.symbolId === "gml/scripts/LinkedHashMap");
    assert.equal(linkedHashMapRename, undefined, "Struct-matching script resource should not be flagged for rename");
});

void test("namingConvention still flags a script resource when its file defines more than one callable", async () => {
    // 1. Arrange: same struct-matching name as above, but the file also defines a second
    // top-level callable, so the resource no longer maps to a single struct declaration
    // and must still follow the standard scriptResourceName prefix rule.
    const projectRoot = "/project";
    const targets: Array<NamingConventionTarget> = [
        {
            category: "scriptResourceName",
            name: "LinkedHashMap",
            occurrences: [
                {
                    path: "scripts/LinkedHashMap/LinkedHashMap.yy",
                    start: 0,
                    end: 0,
                    scopeId: "scope-0",
                    kind: "definition"
                }
            ],
            path: "scripts/LinkedHashMap/LinkedHashMap.yy",
            scopeId: "scope-0",
            symbolId: "gml/scripts/LinkedHashMap"
        },
        {
            category: "structDeclaration",
            name: "LinkedHashMap",
            occurrences: [
                {
                    path: "scripts/LinkedHashMap/LinkedHashMap.gml",
                    start: 10,
                    end: 23,
                    scopeId: "scope-1",
                    kind: "definition"
                }
            ],
            path: "scripts/LinkedHashMap/LinkedHashMap.gml",
            scopeId: "scope-1",
            symbolId: "gml/scripts/LinkedHashMap"
        },
        {
            category: "function",
            name: "linked_hash_map_helper",
            occurrences: [
                {
                    path: "scripts/LinkedHashMap/LinkedHashMap.gml",
                    start: 40,
                    end: 63,
                    scopeId: "scope-2",
                    kind: "definition"
                }
            ],
            path: "scripts/LinkedHashMap/LinkedHashMap.gml",
            scopeId: "scope-2",
            symbolId: "gml/scripts/linked_hash_map_helper"
        }
    ];

    const semantic: PartialSemanticAnalyzer = {
        listNamingConventionTargets: async () => targets,
        hasSymbol: async () => true,
        getSymbolOccurrences: async () => [
            {
                path: "scripts/LinkedHashMap/LinkedHashMap.yy",
                start: 0,
                end: 0,
                scopeId: "scope-0"
            }
        ],
        getFileSymbols: async () => [],
        getReservedKeywords: async () => [],
        validateEdits: async () => ({ errors: [], warnings: [] })
    };

    const engine = new Refactor.RefactorEngine({ semantic });

    // 2. Act
    const plan = await engine.planNamingConventionCodemod({
        projectRoot,
        targetPaths: [projectRoot],
        config: {
            codemods: {
                namingConvention: {
                    rules: {
                        scriptResourceName: { prefix: "scr_" },
                        structDeclaration: { caseStyle: "pascal" }
                    }
                }
            }
        }
    });

    // 3. Assert: the resource is still flagged because the file is no longer single-struct.
    const linkedHashMapRename = plan.topLevelRenameRequests.find((r) => r.symbolId === "gml/scripts/LinkedHashMap");
    assert.equal(linkedHashMapRename?.newName, "scr_LinkedHashMap");
});

void test("rename-validation allows duplicate target names for localized enum members", () => {
    // Two different enum members from different enums both renaming to "CIRCLE"
    const renames = [
        { symbolId: "gml/enum-member/eDamageType.circle", newName: "CIRCLE" },
        { symbolId: "gml/enum-member/eShape.circle", newName: "CIRCLE" }
    ];

    const duplicates = Refactor.detectDuplicateTargetNames(renames);
    assert.equal(duplicates.length, 0, "Enum members should not conflict even if they share target name");
});
