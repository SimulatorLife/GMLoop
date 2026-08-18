import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";
import type { RefactorEngine } from "../src/refactor-engine.js";
import type {
    NamingConventionCodemodPlan,
    NamingConventionTarget,
    PartialSemanticAnalyzer,
    RenameRequest
} from "../src/types.js";

/**
 * These tests pin the public contract of the top-level rename selection
 * pipeline that was extracted from `selectExecutableTopLevelRenames` into
 * single-responsibility helpers:
 *
 *   - `partitionTopLevelRenamesForFastPath`
 *   - `hasFastPathRenameConflicts`
 *   - `validateTopLevelRenames`
 *   - `selectExecutableTopLevelRenamesFromValidated`
 *   - `buildReusableBatchValidation`
 *
 * They are exercised end-to-end through `planNamingConventionCodemod` so the
 * test stays honest about the real behaviour the orchestrator must preserve.
 */

const PROJECT_ROOT = "/project";

function buildTargetsForSpriteRenames(count: number, prefix = "SpriteFunc"): Array<NamingConventionTarget> {
    const targets: Array<NamingConventionTarget> = [];
    for (let i = 0; i < count; i += 1) {
        targets.push({
            category: "spriteResourceName",
            name: `${prefix}${i}`,
            occurrences: [
                {
                    path: `sprites/${prefix}${i}/${prefix}${i}.yy`,
                    start: 0,
                    end: 0,
                    scopeId: "scope-global",
                    kind: "definition"
                }
            ],
            path: `sprites/${prefix}${i}/${prefix}${i}.yy`,
            scopeId: "scope-global",
            symbolId: `gml/sprites/${prefix}${i}`
        });
    }
    return targets;
}

function buildPaddingSpriteTargets(count: number): Array<NamingConventionTarget> {
    return Array.from({ length: count }, (_, i) => ({
        category: "spriteResourceName" as const,
        name: `Pad${i}`,
        occurrences: [
            {
                path: `sprites/Pad${i}/Pad${i}.yy`,
                start: 0,
                end: 0,
                scopeId: "scope-global",
                kind: "definition" as const
            }
        ],
        path: `sprites/Pad${i}/Pad${i}.yy`,
        scopeId: "scope-global",
        symbolId: `gml/sprites/Pad${i}`
    }));
}

function buildSpriteCollisionTarget(parameters: {
    name: string;
    symbolId: string;
    spriteName: string;
}): NamingConventionTarget {
    const { name, symbolId, spriteName } = parameters;
    return {
        category: "spriteResourceName",
        name,
        occurrences: [
            {
                path: `sprites/${spriteName}/${spriteName}.yy`,
                start: 0,
                end: 0,
                scopeId: "scope-global",
                kind: "definition"
            }
        ],
        path: `sprites/${spriteName}/${spriteName}.yy`,
        scopeId: "scope-global",
        symbolId
    };
}

function buildSemanticProvider(targets: Array<NamingConventionTarget>): PartialSemanticAnalyzer {
    return {
        listNamingConventionTargets: async () => targets,
        getSymbolOccurrences: async (_name: string, symbolId?: string | null) => {
            const target = targets.find((t) => t.symbolId === symbolId);
            return target ? target.occurrences : [];
        },
        hasSymbol: async (symbolId: string) => targets.some((t) => t.symbolId === symbolId),
        getFileSymbols: async () => [],
        getReservedKeywords: async () => [],
        validateEdits: async () => ({ errors: [], warnings: [] }),
        checkSemanticGaps: () => []
    };
}

function createSpriteNamingConventionEngine(targets: Array<NamingConventionTarget>): RefactorEngine {
    const semantic = buildSemanticProvider(targets);
    return new Refactor.RefactorEngine({ semantic });
}

function planSpriteNamingConventionCodemod(engine: RefactorEngine): Promise<NamingConventionCodemodPlan> {
    return engine.planNamingConventionCodemod({
        projectRoot: PROJECT_ROOT,
        targetPaths: [PROJECT_ROOT],
        config: {
            codemods: {
                namingConvention: {
                    rules: {
                        spriteResourceName: { caseStyle: "lower_snake" }
                    }
                }
            }
        }
    });
}

void test("small batches take the slow path and validate every top-level rename", async () => {
    const targets = buildTargetsForSpriteRenames(3);
    const engine = createSpriteNamingConventionEngine(targets);

    let validateCallCount = 0;
    const originalValidate = engine.validateRenameRequest.bind(engine);
    engine.validateRenameRequest = async (request: RenameRequest) => {
        validateCallCount += 1;
        return originalValidate(request);
    };

    const plan = await planSpriteNamingConventionCodemod(engine);

    assert.equal(plan.errors.length, 0);
    assert.equal(plan.topLevelRenameRequests.length, 3);
    assert.equal(validateCallCount, 3, "slow path must validate every rename in small batches");
});

void test("large batches with duplicate target names fall through to the slow path and block duplicates", async () => {
    // Two renames that target the same new name. The duplicate-target detector
    // must surface this even when the fast-path subset is otherwise safe.
    const collidingTargets: Array<NamingConventionTarget> = [
        buildSpriteCollisionTarget({ name: "Foo", symbolId: "gml/sprites/FooA", spriteName: "FooA" }),
        buildSpriteCollisionTarget({ name: "Foo", symbolId: "gml/sprites/FooB", spriteName: "FooB" })
    ];
    // Pad with >256 renames total so the fast-path branch is even considered.
    const targets: Array<NamingConventionTarget> = [...collidingTargets, ...buildPaddingSpriteTargets(260)];
    const engine = createSpriteNamingConventionEngine(targets);
    const plan = await planSpriteNamingConventionCodemod(engine);

    // Both colliding renames must be dropped from the executable set.
    const fooARename = plan.topLevelRenameRequests.find((r) => r.symbolId === "gml/sprites/FooA");
    const fooBRename = plan.topLevelRenameRequests.find((r) => r.symbolId === "gml/sprites/FooB");
    assert.equal(fooARename, undefined, "duplicate target name must block rename FooA");
    assert.equal(fooBRename, undefined, "duplicate target name must block rename FooB");
});

void test("large batches with duplicate targets fall through to the slow path and surface skip warnings", async () => {
    // We pin the contract of `selectExecutableTopLevelRenamesFromValidated`
    // by feeding the planning step a set of renames that will collapse to
    // the same newName once the naming-convention rule rewrites them. This
    // is the most common batch-level conflict survivors see in practice:
    // two distinct source symbols proposed for the same target name. The
    // naming-convention rule for `lower_snake` will then propose the same
    // `newName` for both colliding sources.
    const collidingTargets: Array<NamingConventionTarget> = [
        buildSpriteCollisionTarget({ name: "CollideMe", symbolId: "gml/sprites/CollideOne", spriteName: "CollideOne" }),
        buildSpriteCollisionTarget({ name: "CollideMe", symbolId: "gml/sprites/CollideTwo", spriteName: "CollideTwo" })
    ];
    const targets: Array<NamingConventionTarget> = [...collidingTargets, ...buildPaddingSpriteTargets(260)];
    const engine = createSpriteNamingConventionEngine(targets);
    const plan = await planSpriteNamingConventionCodemod(engine);

    // Both colliding renames must be dropped from the executable set, and
    // a skip warning must be surfaced.
    const oneRename = plan.topLevelRenameRequests.find((r) => r.symbolId === "gml/sprites/CollideOne");
    const twoRename = plan.topLevelRenameRequests.find((r) => r.symbolId === "gml/sprites/CollideTwo");
    assert.equal(oneRename, undefined, "duplicate target must block rename CollideOne");
    assert.equal(twoRename, undefined, "duplicate target must block rename CollideTwo");
    const hasDuplicateWarning = plan.warnings.some((w) =>
        w.includes("another naming-convention rename in the same run also targets")
    );
    assert.equal(hasDuplicateWarning, true, "duplicate target must surface a skip warning");
});

void test("validation warnings from the engine surface through the slow-path warnings", async () => {
    const targets = buildTargetsForSpriteRenames(2);
    const engine = createSpriteNamingConventionEngine(targets);
    engine.validateRenameRequest = async (request: RenameRequest) => ({
        valid: true,
        errors: [],
        warnings: [`${request.symbolId}: noisy engine warning`]
    });
    const plan = await planSpriteNamingConventionCodemod(engine);

    assert.equal(plan.errors.length, 0);
    assert.equal(plan.topLevelRenameRequests.length, 2);
    // The slow path must surface validation warnings on the top-level
    // `warnings` field, not swallow them.
    const hasEngineWarning = plan.warnings.some((w) => w.includes("noisy engine warning"));
    assert.equal(hasEngineWarning, true, "validation warnings must propagate to plan.warnings");
});

void test("invalid top-level renames are skipped with skip warnings, not errors", async () => {
    const targets = buildTargetsForSpriteRenames(2);
    const engine = createSpriteNamingConventionEngine(targets);
    engine.validateRenameRequest = async (request: RenameRequest) => ({
        valid: false,
        errors: [`${request.symbolId}: not safe`],
        warnings: []
    });
    const plan = await planSpriteNamingConventionCodemod(engine);

    assert.equal(plan.topLevelRenameRequests.length, 0, "all renames fail validation and must be skipped");
    // The skip path must record warnings, not errors, so the codemod run can
    // continue with the remaining renames.
    const hasSkipWarning = plan.warnings.some((w) => w.includes("Skipping top-level rename"));
    assert.equal(hasSkipWarning, true, "failed validation must surface as a skip warning");
});
