import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    computeErrorAnalytics,
    computeErrorsForPatch,
    computePatchDiagnostics,
    computePatchStats,
    computeRegistryHealthCheck,
    computeRegistrySnapshot,
    getRegistryCollectionForPatchKind,
    getRegistryEntry,
    hasRegistryEntry
} from "../src/runtime/diagnostics.js";
import type { PatchErrorOccurrence, PatchHistoryEntry, RuntimeRegistry } from "../src/runtime/types.js";

function createMockRegistry(overrides: Partial<RuntimeRegistry> = {}): RuntimeRegistry {
    return {
        version: overrides.version ?? 1,
        scripts: overrides.scripts ?? {},
        events: overrides.events ?? {},
        closures: overrides.closures ?? {}
    };
}

function createHistoryEntry(
    overrides: Partial<PatchHistoryEntry> & { id?: string; kind?: PatchHistoryEntry["patch"]["kind"] } = {}
): PatchHistoryEntry {
    return {
        patch: {
            id: overrides.id ?? "test-patch",
            kind: overrides.kind ?? "script",
            ...overrides.patch
        },
        version: overrides.version ?? 1,
        timestamp: overrides.timestamp ?? Date.now(),
        action: overrides.action ?? "apply",
        durationMs: overrides.durationMs
    };
}

function createErrorOccurrence(overrides: Partial<PatchErrorOccurrence> = {}): PatchErrorOccurrence {
    return {
        patchId: overrides.patchId ?? "test-patch",
        patchKind: overrides.patchKind ?? "script",
        category: overrides.category ?? "application",
        error: overrides.error ?? "Test error",
        timestamp: overrides.timestamp ?? Date.now()
    };
}

function stubRegistryFunction() {
    return 42;
}

void describe("registry helpers", () => {
    void it("getRegistryCollectionForPatchKind returns scripts for 'script' kind", () => {
        const scripts = { fn1: () => 1 };
        const registry = createMockRegistry({ scripts });
        assert.strictEqual(getRegistryCollectionForPatchKind(registry, "script"), scripts);
    });

    void it("getRegistryCollectionForPatchKind returns events for 'event' kind", () => {
        const events = { ev1: () => 2 };
        const registry = createMockRegistry({ events });
        assert.strictEqual(getRegistryCollectionForPatchKind(registry, "event"), events);
    });

    void it("getRegistryCollectionForPatchKind returns closures for 'closure' kind", () => {
        const closures = { cl1: () => 3 };
        const registry = createMockRegistry({ closures });
        assert.strictEqual(getRegistryCollectionForPatchKind(registry, "closure"), closures);
    });

    void it("hasRegistryEntry returns true when entry exists", () => {
        const registry = createMockRegistry({ scripts: { myFn: () => 42 } });
        assert.strictEqual(hasRegistryEntry(registry, "script", "myFn"), true);
    });

    void it("hasRegistryEntry returns false when entry does not exist", () => {
        const registry = createMockRegistry();
        assert.strictEqual(hasRegistryEntry(registry, "script", "missing"), false);
    });

    void it("getRegistryEntry returns the function when entry exists", () => {
        const registry = createMockRegistry({ scripts: { myFn: stubRegistryFunction } });
        assert.strictEqual(getRegistryEntry(registry, "script", "myFn"), stubRegistryFunction);
    });

    void it("getRegistryEntry returns undefined when entry does not exist", () => {
        const registry = createMockRegistry();
        assert.strictEqual(getRegistryEntry(registry, "script", "missing"), undefined);
    });
});

void describe("computePatchStats", () => {
    void it("returns zero-initialized stats for empty history", () => {
        const stats = computePatchStats([]);
        assert.strictEqual(stats.totalPatches, 0);
        assert.strictEqual(stats.appliedPatches, 0);
        assert.strictEqual(stats.undonePatches, 0);
        assert.strictEqual(stats.rolledBackPatches, 0);
        assert.strictEqual(stats.uniqueIds, 0);
    });

    void it("counts apply, undo, and rollback actions", () => {
        const history: Array<PatchHistoryEntry> = [
            createHistoryEntry({ action: "apply", id: "p1" }),
            createHistoryEntry({ action: "apply", id: "p2" }),
            createHistoryEntry({ action: "undo", id: "p1" }),
            createHistoryEntry({ action: "rollback", id: "p3" })
        ];
        const stats = computePatchStats(history);
        assert.strictEqual(stats.totalPatches, 4);
        assert.strictEqual(stats.appliedPatches, 2);
        assert.strictEqual(stats.undonePatches, 1);
        assert.strictEqual(stats.rolledBackPatches, 1);
    });

    void it("counts patches by kind", () => {
        const history: Array<PatchHistoryEntry> = [
            createHistoryEntry({ kind: "script" }),
            createHistoryEntry({ kind: "event" }),
            createHistoryEntry({ kind: "closure" }),
            createHistoryEntry({ kind: "script" })
        ];
        const stats = computePatchStats(history);
        assert.strictEqual(stats.scriptPatches, 2);
        assert.strictEqual(stats.eventPatches, 1);
        assert.strictEqual(stats.closurePatches, 1);
    });

    void it("counts unique patch ids", () => {
        const history: Array<PatchHistoryEntry> = [
            createHistoryEntry({ id: "p1", action: "apply" }),
            createHistoryEntry({ id: "p1", action: "undo" }),
            createHistoryEntry({ id: "p2", action: "apply" })
        ];
        const stats = computePatchStats(history);
        assert.strictEqual(stats.uniqueIds, 2);
    });

    void it("includes timing metrics when durations are available", () => {
        const history: Array<PatchHistoryEntry> = [
            createHistoryEntry({ action: "apply", durationMs: 10 }),
            createHistoryEntry({ action: "apply", durationMs: 20 })
        ];
        const stats = computePatchStats(history);
        assert.strictEqual(typeof stats.averagePatchDurationMs, "number");
        assert.strictEqual(typeof stats.totalDurationMs, "number");
    });
});

void describe("computeRegistrySnapshot", () => {
    void it("returns correct counts and ids", () => {
        const registry = createMockRegistry({
            version: 5,
            scripts: { s1: () => 1, s2: () => 2 },
            events: { e1: () => 3 },
            closures: {}
        });
        const snapshot = computeRegistrySnapshot(registry);
        assert.strictEqual(snapshot.version, 5);
        assert.strictEqual(snapshot.scriptCount, 2);
        assert.strictEqual(snapshot.eventCount, 1);
        assert.strictEqual(snapshot.closureCount, 0);
        assert.deepStrictEqual(snapshot.scripts.toSorted(), ["s1", "s2"]);
        assert.deepStrictEqual(snapshot.events, ["e1"]);
        assert.deepStrictEqual(snapshot.closures, []);
    });

    void it("returns empty snapshot for empty registry", () => {
        const registry = createMockRegistry();
        const snapshot = computeRegistrySnapshot(registry);
        assert.strictEqual(snapshot.scriptCount, 0);
        assert.strictEqual(snapshot.eventCount, 0);
        assert.strictEqual(snapshot.closureCount, 0);
    });
});

void describe("computeRegistryHealthCheck", () => {
    void it("returns healthy for valid registry", () => {
        const registry = createMockRegistry({
            scripts: { s1: () => 1 },
            events: { e1: () => 2 }
        });
        const health = computeRegistryHealthCheck(registry);
        assert.strictEqual(health.healthy, true);
        assert.strictEqual(health.issues.length, 0);
    });

    void it("detects non-function entries", () => {
        const registry = createMockRegistry({
            scripts: { s1: "not-a-function" as unknown as () => unknown }
        });
        const health = computeRegistryHealthCheck(registry);
        assert.strictEqual(health.healthy, false);
        assert.strictEqual(health.issues.length, 1);
        assert.strictEqual(health.issues[0].affectedId, "s1");
        assert.strictEqual(health.issues[0].severity, "error");
    });

    void it("includes registry version", () => {
        const registry = createMockRegistry({ version: 42 });
        const health = computeRegistryHealthCheck(registry);
        assert.strictEqual(health.version, 42);
    });
});

void describe("computePatchDiagnostics", () => {
    void it("returns null for non-existent patch id", () => {
        const result = computePatchDiagnostics("missing", [], createMockRegistry());
        assert.strictEqual(result, null);
    });

    void it("aggregates diagnostics for a known patch", () => {
        const registry = createMockRegistry({ scripts: { p1: () => 1 } });
        const history: Array<PatchHistoryEntry> = [
            createHistoryEntry({ id: "p1", action: "apply", durationMs: 5, timestamp: 100 }),
            createHistoryEntry({ id: "p1", action: "apply", durationMs: 15, timestamp: 200 })
        ];
        const result = computePatchDiagnostics("p1", history, registry);
        assert.notStrictEqual(result, null);
        assert.strictEqual(result.applicationCount, 2);
        assert.strictEqual(result.firstAppliedAt, 100);
        assert.strictEqual(result.lastAppliedAt, 200);
        assert.strictEqual(result.averageDurationMs, 10);
        assert.strictEqual(result.currentlyApplied, true);
    });

    void it("tracks undo and rollback counts", () => {
        const history: Array<PatchHistoryEntry> = [
            createHistoryEntry({ id: "p1", action: "apply" }),
            createHistoryEntry({ id: "p1", action: "undo" }),
            createHistoryEntry({ id: "p1", action: "rollback" })
        ];
        const result = computePatchDiagnostics("p1", history, createMockRegistry());
        assert.notStrictEqual(result, null);
        assert.strictEqual(result.undoCount, 1);
        assert.strictEqual(result.rollbackCount, 1);
    });
});

void describe("computeErrorAnalytics", () => {
    void it("returns zeroed analytics for empty histories", () => {
        const analytics = computeErrorAnalytics([], []);
        assert.strictEqual(analytics.totalErrors, 0);
        assert.strictEqual(analytics.uniquePatchesWithErrors, 0);
        assert.strictEqual(analytics.errorRate, 0);
    });

    void it("counts errors by category and kind", () => {
        const errors: Array<PatchErrorOccurrence> = [
            createErrorOccurrence({ category: "validation", patchKind: "script" }),
            createErrorOccurrence({ category: "application", patchKind: "event" }),
            createErrorOccurrence({ category: "validation", patchKind: "script" })
        ];
        const analytics = computeErrorAnalytics(errors, []);
        assert.strictEqual(analytics.totalErrors, 3);
        assert.strictEqual(analytics.errorsByCategory.validation, 2);
        assert.strictEqual(analytics.errorsByCategory.application, 1);
        assert.strictEqual(analytics.errorsByKind.script, 2);
        assert.strictEqual(analytics.errorsByKind.event, 1);
    });

    void it("computes error rate relative to applied patches", () => {
        const errors: Array<PatchErrorOccurrence> = [createErrorOccurrence()];
        const history: Array<PatchHistoryEntry> = [
            createHistoryEntry({ action: "apply" }),
            createHistoryEntry({ action: "apply" })
        ];
        const analytics = computeErrorAnalytics(errors, history);
        assert.strictEqual(analytics.errorRate, 0.5);
    });
});

void describe("computeErrorsForPatch", () => {
    void it("returns null for patch with no errors", () => {
        const result = computeErrorsForPatch("missing", []);
        assert.strictEqual(result, null);
    });

    void it("returns summary for patch with errors", () => {
        const errors: Array<PatchErrorOccurrence> = [
            createErrorOccurrence({ patchId: "p1", category: "validation", error: "err1", timestamp: 100 }),
            createErrorOccurrence({ patchId: "p1", category: "application", error: "err2", timestamp: 200 }),
            createErrorOccurrence({ patchId: "other", category: "validation", error: "err3", timestamp: 300 })
        ];
        const result = computeErrorsForPatch("p1", errors);
        assert.notStrictEqual(result, null);
        assert.strictEqual(result.totalErrors, 2);
        assert.strictEqual(result.errorsByCategory.validation, 1);
        assert.strictEqual(result.errorsByCategory.application, 1);
        assert.strictEqual(result.firstErrorAt, 100);
        assert.strictEqual(result.lastErrorAt, 200);
        assert.strictEqual(result.uniqueErrorMessages, 2);
    });
});
