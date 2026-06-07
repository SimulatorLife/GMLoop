import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ScopeTracker } from "../src/scopes/scope-tracker.js";

void describe("ScopeTracker: getScopesByPath", () => {
    void it("returns empty array for null, undefined, or empty string path", () => {
        const tracker = new ScopeTracker({ enabled: true });
        assert.deepStrictEqual(tracker.getScopesByPath(null), []);
        assert.deepStrictEqual(tracker.getScopesByPath(undefined), []);
        assert.deepStrictEqual(tracker.getScopesByPath(""), []);
    });

    void it("returns empty array for non-existent path", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", { path: "scripts/file1.gml" });
        const result = tracker.getScopesByPath("scripts/file2.gml");
        assert.deepStrictEqual(result, []);
    });

    void it("returns single scope for file with one scope", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", {
            name: "main",
            path: "scripts/main.gml"
        });

        const result = tracker.getScopesByPath("scripts/main.gml");
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].scopeId, "scope-0");
        assert.strictEqual(result[0].scopeKind, "program");
        assert.strictEqual(result[0].name, "main");
    });

    void it("returns multiple scopes for file with multiple scopes", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", {
            name: "player_movement",
            path: "scripts/player_movement/player_movement.gml"
        });

        tracker.enterScope("function", {
            name: "updatePlayer",
            path: "scripts/player_movement/player_movement.gml",
            start: { line: 10, column: 0, index: 250 },
            end: { line: 25, column: 1, index: 500 }
        });

        tracker.enterScope("function", {
            name: "resetPlayer",
            path: "scripts/player_movement/player_movement.gml",
            start: { line: 30, column: 0, index: 600 },
            end: { line: 35, column: 1, index: 700 }
        });

        const result = tracker.getScopesByPath("scripts/player_movement/player_movement.gml");
        assert.strictEqual(result.length, 3);
        assert.strictEqual(result[0].scopeId, "scope-0");
        assert.strictEqual(result[0].scopeKind, "program");
        assert.strictEqual(result[0].name, "player_movement");
        assert.strictEqual(result[1].scopeId, "scope-1");
        assert.strictEqual(result[1].scopeKind, "function");
        assert.strictEqual(result[1].name, "updatePlayer");
        assert.strictEqual(result[2].scopeId, "scope-2");
        assert.strictEqual(result[2].scopeKind, "function");
        assert.strictEqual(result[2].name, "resetPlayer");
    });

    void it("returns scopes sorted by scope ID", () => {
        const tracker = new ScopeTracker({ enabled: true });
        // Add scopes in non-sequential order but all with same path
        tracker.enterScope("function", {
            name: "third",
            path: "scripts/test.gml"
        });
        tracker.enterScope("program", { path: "scripts/other.gml" }); // Different file
        tracker.enterScope("function", {
            name: "first",
            path: "scripts/test.gml"
        });
        tracker.enterScope("block", {
            name: "second",
            path: "scripts/test.gml"
        });

        const result = tracker.getScopesByPath("scripts/test.gml");
        assert.strictEqual(result.length, 3);
        // Should be sorted by scope ID (scope-0, scope-2, scope-3)
        assert.strictEqual(result[0].scopeId, "scope-0");
        assert.strictEqual(result[0].name, "third");
        assert.strictEqual(result[1].scopeId, "scope-2");
        assert.strictEqual(result[1].name, "first");
        assert.strictEqual(result[2].scopeId, "scope-3");
        assert.strictEqual(result[2].name, "second");
    });

    void it("preserves source location metadata in results", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("function", {
            name: "myFunction",
            path: "scripts/test.gml",
            start: { line: 5, column: 2, index: 100 },
            end: { line: 10, column: 5, index: 200 }
        });

        const result = tracker.getScopesByPath("scripts/test.gml");
        assert.strictEqual(result.length, 1);
        assert.deepStrictEqual(result[0].start, { line: 5, column: 2, index: 100 });
        assert.deepStrictEqual(result[0].end, { line: 10, column: 5, index: 200 });
    });

    void it("handles scopes without location metadata", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", {
            name: "noLocation",
            path: "scripts/test.gml"
        });

        const result = tracker.getScopesByPath("scripts/test.gml");
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].start, undefined);
        assert.strictEqual(result[0].end, undefined);
    });

    void it("isolates scopes by path", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", { path: "scripts/file1.gml", name: "file1" });
        tracker.enterScope("function", { path: "scripts/file2.gml", name: "file2_func" });
        tracker.enterScope("block", { path: "scripts/file1.gml", name: "file1_block" });
        tracker.enterScope("function", { path: "scripts/file3.gml", name: "file3_func" });

        const file1Scopes = tracker.getScopesByPath("scripts/file1.gml");
        const file2Scopes = tracker.getScopesByPath("scripts/file2.gml");
        const file3Scopes = tracker.getScopesByPath("scripts/file3.gml");

        assert.strictEqual(file1Scopes.length, 2);
        assert.strictEqual(file1Scopes[0].name, "file1");
        assert.strictEqual(file1Scopes[1].name, "file1_block");

        assert.strictEqual(file2Scopes.length, 1);
        assert.strictEqual(file2Scopes[0].name, "file2_func");

        assert.strictEqual(file3Scopes.length, 1);
        assert.strictEqual(file3Scopes[0].name, "file3_func");
    });

    void it("supports hot reload use case: file change invalidation", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // Simulate a project with multiple files
        tracker.enterScope("program", { path: "scripts/config.gml", name: "config" });
        tracker.declare("MAX_HP", { name: "MAX_HP" });

        tracker.enterScope("program", { path: "scripts/player.gml", name: "player" });
        tracker.declare("playerState", { name: "playerState" });
        tracker.reference("MAX_HP", { name: "MAX_HP" }); // References config

        tracker.enterScope("function", { path: "scripts/player.gml", name: "updatePlayer" });
        tracker.reference("playerState", { name: "playerState" });

        // When scripts/player.gml changes, get all scopes in that file
        const changedFileScopes = tracker.getScopesByPath("scripts/player.gml");
        assert.strictEqual(changedFileScopes.length, 2);

        // For each scope, compute invalidation set to determine what needs recompilation
        const invalidationSets = changedFileScopes.map((scope) => tracker.getInvalidationSet(scope.scopeId));

        assert.strictEqual(invalidationSets.length, 2);
        // Verify that the first scope (program) has an invalidation set
        assert.ok(invalidationSets[0].length > 0);
        // Verify that the second scope (function) has an invalidation set
        assert.ok(invalidationSets[1].length > 0);
    });

    void it("handles nested scopes with same path", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", { path: "scripts/nested.gml", name: "outer" });
        tracker.enterScope("function", { path: "scripts/nested.gml", name: "middle" });
        tracker.enterScope("block", { path: "scripts/nested.gml", name: "inner" });
        tracker.exitScope(); // inner
        tracker.exitScope(); // middle
        tracker.exitScope(); // outer

        const result = tracker.getScopesByPath("scripts/nested.gml");
        assert.strictEqual(result.length, 3);
        assert.strictEqual(result[0].name, "outer");
        assert.strictEqual(result[1].name, "middle");
        assert.strictEqual(result[2].name, "inner");
    });

    void it("clones location metadata to prevent mutation", () => {
        const tracker = new ScopeTracker({ enabled: true });
        const originalStart = { line: 5, column: 2, index: 100 };
        const originalEnd = { line: 10, column: 5, index: 200 };

        tracker.enterScope("function", {
            name: "myFunction",
            path: "scripts/test.gml",
            start: originalStart,
            end: originalEnd
        });

        const result = tracker.getScopesByPath("scripts/test.gml");
        assert.strictEqual(result.length, 1);

        // Mutate the returned location objects
        if (result[0].start) {
            result[0].start.line = 999;
        }
        if (result[0].end) {
            result[0].end.line = 999;
        }

        // Get the metadata again - should not be mutated
        const result2 = tracker.getScopesByPath("scripts/test.gml");
        assert.strictEqual(result2[0].start?.line, 5);
        assert.strictEqual(result2[0].end?.line, 10);
    });

    void it("returns only scopes with the exact path match", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", { path: "scripts/player.gml" });
        tracker.enterScope("program", { path: "scripts/player_movement.gml" });
        tracker.enterScope("program", { path: "scripts/enemy.gml" });

        const result = tracker.getScopesByPath("scripts/player.gml");
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].scopeId, "scope-0");
    });
});
