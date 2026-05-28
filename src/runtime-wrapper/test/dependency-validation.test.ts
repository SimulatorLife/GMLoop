import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { validateBatchPatchDependencies, validatePatchDependencies } from "../browser/runtime/patch-utils.js";
import { createRuntimeWrapper } from "../browser/runtime/runtime-wrapper.js";
import type { Patch, RuntimeRegistry } from "../browser/runtime/types.js";
import { restoreGlobalProperties, snapshotGlobalProperties } from "./test-helpers/runtime-global-state.js";

void describe("Dependency Validation", () => {
    // Strict assertion helpers replace deprecated assert.equal usage.
    // Manual validation: run `node --test dist/runtime-wrapper/test/dependency-validation.test.js` to
    // confirm strict assertion coverage remains equivalent to the legacy assert.equal checks.
    void test("validatePatchDependencies returns satisfied when no dependencies", () => {
        const registry: RuntimeRegistry = {
            version: 0,
            scripts: {},
            events: {},
            closures: {}
        };

        const patch: Patch = {
            kind: "script",
            id: "script:test",
            js_body: "return 42;"
        };

        const result = validatePatchDependencies(patch, registry);
        assert.strictEqual(result.satisfied, true);
        assert.strictEqual(result.missingDependencies.length, 0);
    });

    void test("validatePatchDependencies returns satisfied when empty dependencies array", () => {
        const registry: RuntimeRegistry = {
            version: 0,
            scripts: {},
            events: {},
            closures: {}
        };

        const patch: Patch = {
            kind: "script",
            id: "script:test",
            js_body: "return 42;",
            metadata: {
                dependencies: []
            }
        };

        const result = validatePatchDependencies(patch, registry);
        assert.strictEqual(result.satisfied, true);
        assert.strictEqual(result.missingDependencies.length, 0);
    });

    void test("validatePatchDependencies detects missing script dependency", () => {
        const registry: RuntimeRegistry = {
            version: 0,
            scripts: {},
            events: {},
            closures: {}
        };

        const patch: Patch = {
            kind: "script",
            id: "script:dependent",
            js_body: "return script_base();",
            metadata: {
                dependencies: ["script:base"]
            }
        };

        const result = validatePatchDependencies(patch, registry);
        assert.strictEqual(result.satisfied, false);
        assert.strictEqual(result.missingDependencies.length, 1);
        assert.strictEqual(result.missingDependencies[0], "script:base");
    });

    void test("validatePatchDependencies satisfied when dependency exists in scripts", () => {
        const registry: RuntimeRegistry = {
            version: 1,
            scripts: {
                "script:base": () => 10
            },
            events: {},
            closures: {}
        };

        const patch: Patch = {
            kind: "script",
            id: "script:dependent",
            js_body: "return script_base();",
            metadata: {
                dependencies: ["script:base"]
            }
        };

        const result = validatePatchDependencies(patch, registry);
        assert.strictEqual(result.satisfied, true);
        assert.strictEqual(result.missingDependencies.length, 0);
    });

    void test("validatePatchDependencies satisfied when dependency exists in events", () => {
        const registry: RuntimeRegistry = {
            version: 1,
            scripts: {},
            events: {
                "obj_player#Create": () => {}
            },
            closures: {}
        };

        const patch: Patch = {
            kind: "event",
            id: "obj_enemy#Create",
            js_body: "this.hp = 100;",
            metadata: {
                dependencies: ["obj_player#Create"]
            }
        };

        const result = validatePatchDependencies(patch, registry);
        assert.strictEqual(result.satisfied, true);
        assert.strictEqual(result.missingDependencies.length, 0);
    });

    void test("validatePatchDependencies satisfied when dependency exists in closures", () => {
        const registry: RuntimeRegistry = {
            version: 1,
            scripts: {},
            events: {},
            closures: {
                "closure:counter": () => 0
            }
        };

        const patch: Patch = {
            kind: "script",
            id: "script:use_counter",
            js_body: "return counter();",
            metadata: {
                dependencies: ["closure:counter"]
            }
        };

        const result = validatePatchDependencies(patch, registry);
        assert.strictEqual(result.satisfied, true);
        assert.strictEqual(result.missingDependencies.length, 0);
    });

    void test("validatePatchDependencies accepts script dependencies already present in the GameMaker runtime", () => {
        const snapshot = snapshotGlobalProperties(["dbg_section"]);
        const globals = globalThis as Record<string, unknown>;

        try {
            globals.dbg_section = () => undefined;
            const registry: RuntimeRegistry = {
                version: 0,
                scripts: {},
                events: {},
                closures: {}
            };

            const patch: Patch = {
                kind: "event",
                id: "gml/event/obj_spider/Create_0",
                js_body: "return dbg_section();",
                metadata: {
                    dependencies: ["gml/script/dbg_section"]
                }
            };

            const result = validatePatchDependencies(patch, registry);
            assert.strictEqual(result.satisfied, true);
            assert.deepStrictEqual(result.missingDependencies, []);
        } finally {
            restoreGlobalProperties(snapshot);
        }
    });

    void test("validateBatchPatchDependencies accepts runtime script dependencies during replay", () => {
        const snapshot = snapshotGlobalProperties(["show_debug_overlay"]);
        const globals = globalThis as Record<string, unknown>;

        try {
            globals.show_debug_overlay = () => undefined;
            const registry: RuntimeRegistry = {
                version: 0,
                scripts: {},
                events: {},
                closures: {}
            };

            const patches: Array<Patch> = [
                {
                    kind: "event",
                    id: "gml/event/obj_spider/Create_0",
                    js_body: "return show_debug_overlay();",
                    metadata: {
                        dependencies: ["gml/script/show_debug_overlay"]
                    }
                }
            ];

            const result = validateBatchPatchDependencies(patches, registry);
            assert.strictEqual(result.satisfied, true);
        } finally {
            restoreGlobalProperties(snapshot);
        }
    });

    void test("validatePatchDependencies detects multiple missing dependencies", () => {
        const registry: RuntimeRegistry = {
            version: 1,
            scripts: {
                "script:helper1": () => 1
            },
            events: {},
            closures: {}
        };

        const patch: Patch = {
            kind: "script",
            id: "script:complex",
            js_body: "return helper1() + helper2() + helper3();",
            metadata: {
                dependencies: ["script:helper1", "script:helper2", "script:helper3"]
            }
        };

        const result = validatePatchDependencies(patch, registry);
        assert.strictEqual(result.satisfied, false);
        assert.strictEqual(result.missingDependencies.length, 2);
        assert.ok(result.missingDependencies.includes("script:helper2"));
        assert.ok(result.missingDependencies.includes("script:helper3"));
    });

    void test("validatePatchDependencies reports missing dependencies once when metadata contains duplicates", () => {
        const registry: RuntimeRegistry = {
            version: 1,
            scripts: {
                "script:helper1": () => 1
            },
            events: {},
            closures: {}
        };

        const patch: Patch = {
            kind: "script",
            id: "script:complex",
            js_body: "return helper1() + helper2();",
            metadata: {
                dependencies: ["script:helper1", "script:helper2", "script:helper2", "script:helper2"]
            }
        };

        const result = validatePatchDependencies(patch, registry);
        assert.strictEqual(result.satisfied, false);
        assert.deepStrictEqual(result.missingDependencies, ["script:helper2"]);
    });

    void test("validatePatchDependencies ignores non-string dependencies", () => {
        const registry: RuntimeRegistry = {
            version: 0,
            scripts: {},
            events: {},
            closures: {}
        };

        const patch: Patch = {
            kind: "script",
            id: "script:test",
            js_body: "return 42;",
            metadata: {
                dependencies: ["script:real", null, 123 as any, ""]
            }
        };

        const result = validatePatchDependencies(patch, registry);
        assert.strictEqual(result.satisfied, false);
        assert.strictEqual(result.missingDependencies.length, 1);
        assert.strictEqual(result.missingDependencies[0], "script:real");
    });

    void test("applyPatch rejects patch with missing dependencies", () => {
        const wrapper = createRuntimeWrapper();

        const patchWithDep: Patch = {
            kind: "script",
            id: "script:dependent",
            js_body: "return base_fn();",
            metadata: {
                dependencies: ["script:base_fn"]
            }
        };

        assert.throws(() => {
            wrapper.applyPatch(patchWithDep);
        }, /unsatisfied dependencies/);
    });

    void test("applyPatch succeeds when dependencies are satisfied", () => {
        const wrapper = createRuntimeWrapper();

        // Apply base patch first
        const basePatch: Patch = {
            kind: "script",
            id: "script:base_fn",
            js_body: "return 100;"
        };
        wrapper.applyPatch(basePatch);

        // Apply dependent patch
        const dependentPatch: Patch = {
            kind: "script",
            id: "script:dependent",
            js_body: "return 42;",
            metadata: {
                dependencies: ["script:base_fn"]
            }
        };

        const result = wrapper.applyPatch(dependentPatch);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.version, 2);
    });

    void test("applyPatch tracks dependency validation errors in error analytics", () => {
        const wrapper = createRuntimeWrapper();

        const patchWithDep: Patch = {
            kind: "script",
            id: "script:dependent",
            js_body: "return base_fn();",
            metadata: {
                dependencies: ["script:base_fn", "script:helper"]
            }
        };

        try {
            wrapper.applyPatch(patchWithDep);
        } catch {
            // Expected
        }

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, 1);
        assert.strictEqual(analytics.errorsByCategory.validation, 1);
        assert.ok(analytics.recentErrors[0].error.includes("unsatisfied dependencies"));
        assert.ok(analytics.recentErrors[0].error.includes("script:base_fn"));
        assert.ok(analytics.recentErrors[0].error.includes("script:helper"));
    });

    void test("trySafeApply rejects patches with missing dependencies", () => {
        const wrapper = createRuntimeWrapper();

        const patchWithDep: Patch = {
            kind: "script",
            id: "script:dependent",
            js_body: "return base_fn();",
            metadata: {
                dependencies: ["script:base_fn"]
            }
        };

        const result = wrapper.trySafeApply(patchWithDep);
        assert.strictEqual(result.success, false);
        assert.ok(result.message?.includes("unsatisfied dependencies"));
        assert.strictEqual(wrapper.hasScript("script:dependent"), false);
    });

    void test("applyPatchBatch validates dependencies for all patches", () => {
        const wrapper = createRuntimeWrapper();

        // Apply base patch
        wrapper.applyPatch({
            kind: "script",
            id: "script:base",
            js_body: "return 1;"
        });

        const patches: Array<Patch> = [
            {
                kind: "script",
                id: "script:dep1",
                js_body: "return 2;",
                metadata: { dependencies: ["script:base"] }
            },
            {
                kind: "script",
                id: "script:dep2",
                js_body: "return 3;",
                metadata: { dependencies: ["script:missing"] } // Missing dependency
            }
        ];

        const result = wrapper.applyPatchBatch(patches);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.appliedCount, 0);
        assert.strictEqual(result.failedIndex, 1);
        assert.ok(result.message?.includes("dependency validation failed"));
        assert.ok(result.message?.includes("script:missing"));
    });

    void test("applyPatchBatch succeeds when all dependencies satisfied", () => {
        const wrapper = createRuntimeWrapper();

        // Apply base patches
        wrapper.applyPatch({
            kind: "script",
            id: "script:base1",
            js_body: "return 1;"
        });
        wrapper.applyPatch({
            kind: "script",
            id: "script:base2",
            js_body: "return 2;"
        });

        const patches: Array<Patch> = [
            {
                kind: "script",
                id: "script:dep1",
                js_body: "return 10;",
                metadata: { dependencies: ["script:base1"] }
            },
            {
                kind: "script",
                id: "script:dep2",
                js_body: "return 20;",
                metadata: { dependencies: ["script:base2"] }
            }
        ];

        const result = wrapper.applyPatchBatch(patches);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.appliedCount, 2);
        assert.strictEqual(result.version, 4); // 2 base + 2 dependent
    });

    void test("dependencies can be satisfied by patches applied earlier in same batch", () => {
        const wrapper = createRuntimeWrapper();

        const patches: Array<Patch> = [
            {
                kind: "script",
                id: "script:base",
                js_body: "return 1;"
            },
            {
                kind: "script",
                id: "script:dependent",
                js_body: "return 2;",
                metadata: { dependencies: ["script:base"] }
            }
        ];

        const result = wrapper.applyPatchBatch(patches);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.appliedCount, 2);
        assert.strictEqual(wrapper.hasScript("script:dependent"), true);
    });

    void test("validateBatchPatchDependencies fails when dependency is declared later in the batch", () => {
        const registry: RuntimeRegistry = {
            version: 0,
            scripts: {},
            events: {},
            closures: {}
        };

        const patches: Array<Patch> = [
            {
                kind: "script",
                id: "script:dependent",
                js_body: "return 2;",
                metadata: { dependencies: ["script:base"] }
            },
            {
                kind: "script",
                id: "script:base",
                js_body: "return 1;"
            }
        ];

        const result = validateBatchPatchDependencies(patches, registry);
        assert.strictEqual(result.satisfied, false);
        if (!result.satisfied) {
            assert.strictEqual(result.failedIndex, 0);
            assert.deepStrictEqual(result.missingDependencies, ["script:base"]);
        }
    });

    void test("validateBatchPatchDependencies accepts dependencies satisfied by earlier batch patches", () => {
        const registry: RuntimeRegistry = {
            version: 0,
            scripts: {},
            events: {},
            closures: {}
        };

        const patches: Array<Patch> = [
            {
                kind: "script",
                id: "script:base",
                js_body: "return 1;"
            },
            {
                kind: "script",
                id: "script:dependent",
                js_body: "return 2;",
                metadata: { dependencies: ["script:base"] }
            }
        ];

        const result = validateBatchPatchDependencies(patches, registry);
        assert.strictEqual(result.satisfied, true);
    });

    void test("cross-kind dependencies are validated", () => {
        const wrapper = createRuntimeWrapper();

        // Apply an event
        wrapper.applyPatch({
            kind: "event",
            id: "obj_player#Create",
            js_body: "this.hp = 100;"
        });

        // Apply a closure
        wrapper.applyPatch({
            kind: "closure",
            id: "closure:counter",
            js_body: "let n = 0; return () => ++n;"
        });

        // Script depends on both event and closure
        const patch: Patch = {
            kind: "script",
            id: "script:complex",
            js_body: "return 42;",
            metadata: {
                dependencies: ["obj_player#Create", "closure:counter"]
            }
        };

        const result = wrapper.applyPatch(patch);
        assert.strictEqual(result.success, true);
    });

    void test("getErrorsForPatch includes dependency validation errors", () => {
        const wrapper = createRuntimeWrapper();

        const patch: Patch = {
            kind: "script",
            id: "script:problem",
            js_body: "return 1;",
            metadata: {
                dependencies: ["script:missing1", "script:missing2"]
            }
        };

        // Try to apply multiple times
        for (let i = 0; i < 3; i++) {
            try {
                wrapper.applyPatch(patch);
            } catch {
                // Expected
            }
        }

        const summary = wrapper.getErrorsForPatch("script:problem");
        assert.ok(summary);
        assert.strictEqual(summary.totalErrors, 3);
        assert.strictEqual(summary.errorsByCategory.validation, 3);
        assert.ok(summary.mostRecentError.includes("unsatisfied dependencies"));
    });
});
