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

    const sourceTexts = new Map<string, string>([["scripts/Attack/Attack.gml", "function Attack() constructor {}"]]);

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

void test("rename-validation allows duplicate target names for localized enum members", () => {
    // Two different enum members from different enums both renaming to "CIRCLE"
    const renames = [
        { symbolId: "gml/enum-member/eDamageType.circle", newName: "CIRCLE" },
        { symbolId: "gml/enum-member/eShape.circle", newName: "CIRCLE" }
    ];

    const duplicates = Refactor.detectDuplicateTargetNames(renames);
    assert.equal(duplicates.length, 0, "Enum members should not conflict even if they share target name");
});
