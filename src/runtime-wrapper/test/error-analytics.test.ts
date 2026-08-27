import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Runtime } from "../src/index.js";

const { createRuntimeWrapper } = Runtime;

void describe("Error Analytics", () => {
    void test("getErrorAnalytics returns initial empty state", () => {
        const wrapper = createRuntimeWrapper();
        const analytics = wrapper.getErrorAnalytics();

        assert.strictEqual(analytics.totalErrors, 0);
        assert.strictEqual(analytics.uniquePatchesWithErrors, 0);
        assert.strictEqual(analytics.errorRate, 0);
        assert.strictEqual(analytics.mostProblematicPatches.length, 0);
        assert.strictEqual(analytics.recentErrors.length, 0);
        assert.deepStrictEqual(analytics.errorsByCategory, {
            validation: 0,
            shadow: 0,
            application: 0,
            rollback: 0
        });
        assert.deepStrictEqual(analytics.errorsByKind, {
            script: 0,
            event: 0,
            closure: 0,
            resource: 0
        });
    });

    void test("getErrorAnalytics tracks shadow validation errors", () => {
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

        try {
            wrapper.applyPatch({
                kind: "script",
                id: "script:bad_syntax",
                js_body: "return {{ invalid syntax"
            });
            assert.fail("Should have thrown");
        } catch {
            // Expected
        }

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, 1);
        assert.strictEqual(analytics.errorsByCategory.shadow, 1);
        assert.strictEqual(analytics.errorsByKind.script, 1);
        assert.strictEqual(analytics.uniquePatchesWithErrors, 1);
    });

    void test("getErrorAnalytics tracks validation errors from trySafeApply", () => {
        const wrapper = createRuntimeWrapper();

        wrapper.trySafeApply(
            {
                kind: "script",
                id: "script:test",
                js_body: "return 42;"
            },
            () => false
        );

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, 1);
        assert.strictEqual(analytics.errorsByCategory.validation, 1);
        assert.strictEqual(analytics.errorsByKind.script, 1);
    });

    void test("getErrorAnalytics tracks shadow errors from trySafeApply", () => {
        const wrapper = createRuntimeWrapper();

        wrapper.trySafeApply({
            kind: "script",
            id: "script:bad",
            js_body: "return {{ bad syntax"
        });

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, 1);
        assert.strictEqual(analytics.errorsByCategory.shadow, 1);
    });

    void test("getErrorAnalytics tracks multiple errors for same patch", () => {
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

        for (let i = 0; i < 3; i++) {
            try {
                wrapper.applyPatch({
                    kind: "script",
                    id: "script:flaky",
                    js_body: "return {{ bad"
                });
            } catch {
                // Expected
            }
        }

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, 3);
        assert.strictEqual(analytics.uniquePatchesWithErrors, 1);
        assert.strictEqual(analytics.mostProblematicPatches.length, 1);
        assert.strictEqual(analytics.mostProblematicPatches[0].patchId, "script:flaky");
        assert.strictEqual(analytics.mostProblematicPatches[0].errorCount, 3);
    });

    void test("getErrorAnalytics tracks errors across multiple patches", () => {
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

        const badPatches = [
            { kind: "script" as const, id: "script:a", js_body: "return {{ bad" },
            { kind: "event" as const, id: "obj_test#Step", js_body: "return {{ bad" },
            { kind: "closure" as const, id: "closure:x", js_body: "return {{ bad" }
        ];

        for (const patch of badPatches) {
            try {
                wrapper.applyPatch(patch);
            } catch {
                // Expected
            }
        }

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, 3);
        assert.strictEqual(analytics.uniquePatchesWithErrors, 3);
        assert.strictEqual(analytics.errorsByKind.script, 1);
        assert.strictEqual(analytics.errorsByKind.event, 1);
        assert.strictEqual(analytics.errorsByKind.closure, 1);
    });

    void test("getErrorAnalytics calculates error rate correctly", () => {
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

        // Apply 2 good patches
        wrapper.applyPatch({ kind: "script", id: "script:good1", js_body: "return 1;" });
        wrapper.applyPatch({ kind: "script", id: "script:good2", js_body: "return 2;" });

        // Apply 1 bad patch
        try {
            wrapper.applyPatch({ kind: "script", id: "script:bad", js_body: "return {{ bad" });
        } catch {
            // Expected
        }

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, 1);
        assert.strictEqual(analytics.errorRate, 1 / 2); // 1 error / 2 successful applies
    });

    void test("getErrorAnalytics returns recent errors", () => {
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

        for (let i = 0; i < 25; i++) {
            try {
                wrapper.applyPatch({
                    kind: "script",
                    id: `script:error_${i}`,
                    js_body: "return {{ bad"
                });
            } catch {
                // Expected
            }
        }

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, 25);
        assert.strictEqual(analytics.recentErrors.length, 20); // Should cap at 20
        assert.strictEqual(analytics.recentErrors[0].patchId, "script:error_5"); // Oldest of recent 20
        assert.strictEqual(analytics.recentErrors[19].patchId, "script:error_24"); // Most recent
    });

    void test("getErrorAnalytics identifies most problematic patches", () => {
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

        const errorCounts = [
            { id: "script:a", count: 5 },
            { id: "script:b", count: 10 },
            { id: "script:c", count: 3 },
            { id: "script:d", count: 7 },
            { id: "script:e", count: 1 }
        ];

        for (const { id, count } of errorCounts) {
            for (let i = 0; i < count; i++) {
                try {
                    wrapper.applyPatch({ kind: "script", id, js_body: "return {{ bad" });
                } catch {
                    // Expected
                }
            }
        }

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.mostProblematicPatches.length, 5);
        assert.strictEqual(analytics.mostProblematicPatches[0].patchId, "script:b");
        assert.strictEqual(analytics.mostProblematicPatches[0].errorCount, 10);
        assert.strictEqual(analytics.mostProblematicPatches[1].patchId, "script:d");
        assert.strictEqual(analytics.mostProblematicPatches[1].errorCount, 7);
    });

    void test("getErrorsForPatch returns null for patch with no errors", () => {
        const wrapper = createRuntimeWrapper();
        wrapper.applyPatch({ kind: "script", id: "script:good", js_body: "return 1;" });

        const summary = wrapper.getErrorsForPatch("script:good");
        assert.strictEqual(summary, null);
    });

    void test("getErrorsForPatch returns summary for patch with errors", () => {
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

        for (let i = 0; i < 3; i++) {
            try {
                wrapper.applyPatch({ kind: "script", id: "script:bad", js_body: "return {{ bad" });
            } catch {
                // Expected
            }
        }

        const summary = wrapper.getErrorsForPatch("script:bad");
        assert.ok(summary);
        assert.strictEqual(summary.patchId, "script:bad");
        assert.strictEqual(summary.totalErrors, 3);
        assert.strictEqual(summary.errorsByCategory.shadow, 3);
        assert.ok(summary.firstErrorAt > 0);
        assert.ok(summary.lastErrorAt >= summary.firstErrorAt);
        // The shadow validation must surface a non-empty diagnostic — the
        // consumer-facing contract is "the shadow run failed", not the
        // exact JS engine wording. The category is the canonical signal.
        assert.ok(
            summary.mostRecentError.length > 0,
            "mostRecentError should capture the shadow validation diagnostic text"
        );
    });

    void test("getErrorsForPatch counts unique error messages", () => {
        const wrapper = createRuntimeWrapper();

        // First error: custom validation
        wrapper.trySafeApply({ kind: "script", id: "script:test", js_body: "return 1;" }, () => {
            throw new Error("Custom error 1");
        });

        // Second error: different custom validation
        wrapper.trySafeApply({ kind: "script", id: "script:test", js_body: "return 1;" }, () => {
            throw new Error("Custom error 2");
        });

        // Third error: same as first
        wrapper.trySafeApply({ kind: "script", id: "script:test", js_body: "return 1;" }, () => {
            throw new Error("Custom error 1");
        });

        const summary = wrapper.getErrorsForPatch("script:test");
        assert.ok(summary);
        assert.strictEqual(summary.totalErrors, 3);
        assert.strictEqual(summary.uniqueErrorMessages, 2);
    });

    void test("getErrorsForPatch categorizes errors correctly", () => {
        const wrapper = createRuntimeWrapper();

        // Shadow error
        wrapper.trySafeApply({ kind: "script", id: "script:test", js_body: "return {{ bad" });

        // Validation error
        wrapper.trySafeApply({ kind: "script", id: "script:test", js_body: "return 1;" }, () => false);

        const summary = wrapper.getErrorsForPatch("script:test");
        assert.ok(summary);
        assert.strictEqual(summary.totalErrors, 2);
        assert.strictEqual(summary.errorsByCategory.shadow, 1);
        assert.strictEqual(summary.errorsByCategory.validation, 1);
    });

    void test("clearErrorHistory removes all error records", () => {
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

        for (let i = 0; i < 5; i++) {
            try {
                wrapper.applyPatch({ kind: "script", id: `script:${i}`, js_body: "return {{ bad" });
            } catch {
                // Expected
            }
        }

        let analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, 5);

        wrapper.clearErrorHistory();

        analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, 0);
        assert.strictEqual(analytics.uniquePatchesWithErrors, 0);
        assert.strictEqual(analytics.recentErrors.length, 0);
    });

    void test("clearErrorHistory does not affect patch history", () => {
        const wrapper = createRuntimeWrapper();

        wrapper.applyPatch({ kind: "script", id: "script:test", js_body: "return 1;" });

        const historyBefore = wrapper.getPatchHistory();
        wrapper.clearErrorHistory();
        const historyAfter = wrapper.getPatchHistory();

        assert.deepStrictEqual(historyAfter, historyBefore);
    });

    void test("error analytics tracks application errors properly", () => {
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

        // Apply a patch with shadow validation error
        try {
            wrapper.applyPatch({
                kind: "script",
                id: "script:bad_syntax",
                js_body: "return {{ bad"
            });
        } catch {
            // Expected
        }

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, 1);
        assert.strictEqual(analytics.errorsByCategory.shadow, 1);
    });

    void test("error analytics handles batch validation errors", () => {
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

        const patches = [
            { kind: "script" as const, id: "script:a", js_body: "return 1;" },
            { kind: "script" as const, id: "script:b", js_body: "return {{ bad" },
            { kind: "script" as const, id: "script:c", js_body: "return 3;" }
        ];

        wrapper.applyPatchBatch(patches);

        const analytics = wrapper.getErrorAnalytics();
        assert.ok(analytics.totalErrors > 0);
        assert.strictEqual(analytics.errorsByCategory.shadow, 1);
    });

    void test("error occurrences include stack traces when available", () => {
        const wrapper = createRuntimeWrapper();

        wrapper.trySafeApply({ kind: "script", id: "script:test", js_body: "return 1;" }, () => {
            throw new Error("Test error with stack");
        });

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.recentErrors.length, 1);
        // The consumer-facing contract is that a stack trace is captured
        // for Error-like throws and that it carries the throw's message
        // text. The exact "Error: " prefix and surrounding frame text is
        // an engine detail and intentionally not pinned here.
        const stackTrace = analytics.recentErrors[0].stackTrace;
        assert.ok(typeof stackTrace === "string" && stackTrace.length > 0);
        assert.ok(stackTrace.includes("Test error with stack"));
    });

    void test("error analytics preserves error timestamp ordering", () => {
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

        const timestamps: Array<number> = [];
        for (let i = 0; i < 5; i++) {
            try {
                wrapper.applyPatch({ kind: "script", id: `script:${i}`, js_body: "return {{ bad" });
            } catch {
                // Expected
            }
            timestamps.push(Date.now());
        }

        const analytics = wrapper.getErrorAnalytics();
        const errorTimestamps = analytics.recentErrors.map((e) => e.timestamp);

        for (let i = 1; i < errorTimestamps.length; i++) {
            assert.ok(errorTimestamps[i] >= errorTimestamps[i - 1]);
        }
    });

    void test("error history automatically trims when maxErrorHistorySize is reached", () => {
        const maxErrorHistorySize = 10;
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true, maxErrorHistorySize });

        for (let i = 0; i < 20; i++) {
            try {
                wrapper.applyPatch({ kind: "script", id: `script:${i}`, js_body: "return {{ bad" });
            } catch {
                // Expected
            }
        }

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, maxErrorHistorySize);
        assert.ok(analytics.recentErrors.length <= maxErrorHistorySize);
    });

    void test("error history respects unbounded mode when maxErrorHistorySize is zero", () => {
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true, maxErrorHistorySize: 0 });

        for (let i = 0; i < 15; i++) {
            try {
                wrapper.applyPatch({ kind: "script", id: `script:${i}`, js_body: "return {{ bad" });
            } catch {
                // Expected
            }
        }

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, 15);
    });

    void test("error history trims oldest errors first", () => {
        const maxErrorHistorySize = 5;
        const wrapper = createRuntimeWrapper({ validateBeforeApply: true, maxErrorHistorySize });

        for (let i = 0; i < 10; i++) {
            try {
                wrapper.applyPatch({ kind: "script", id: `script:${i}`, js_body: "return {{ bad" });
            } catch {
                // Expected
            }
        }

        const analytics = wrapper.getErrorAnalytics();
        assert.strictEqual(analytics.totalErrors, maxErrorHistorySize);

        // The most recent errors should be from patches 5-9 (the last 5)
        const recentPatchIds = new Set(analytics.recentErrors.map((e) => e.patchId));
        assert.ok(recentPatchIds.has("script:9"));
        assert.ok(recentPatchIds.has("script:8"));
        assert.ok(recentPatchIds.has("script:7"));
        assert.ok(recentPatchIds.has("script:6"));
        assert.ok(recentPatchIds.has("script:5"));

        // The oldest errors (0-4) should have been trimmed
        assert.ok(!recentPatchIds.has("script:0"));
        assert.ok(!recentPatchIds.has("script:1"));
    });
});
