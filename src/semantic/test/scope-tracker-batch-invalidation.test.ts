import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ScopeTracker } from "../src/scopes/scope-tracker.js";

type InvalidationEntry = {
    scopeId: string;
    scopeKind: string;
    reason: string;
};

function normalizeInvalidationEntries(entries: ReadonlyArray<InvalidationEntry>): Array<InvalidationEntry> {
    return [...entries].sort((left, right) => {
        if (left.scopeId !== right.scopeId) {
            return left.scopeId.localeCompare(right.scopeId);
        }

        if (left.reason !== right.reason) {
            return left.reason.localeCompare(right.reason);
        }

        return left.scopeKind.localeCompare(right.scopeKind);
    });
}

void describe("ScopeTracker batch invalidation", () => {
    void it("computes invalidation sets for multiple paths efficiently", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/main.gml" });

        tracker.withScope(
            "function",
            () => {
                tracker.declare("playerX", { name: "playerX" });
                tracker.reference("playerX", { name: "playerX" });
            },
            { name: "updatePlayer", path: "/project/player.gml" }
        );

        tracker.withScope(
            "function",
            () => {
                tracker.declare("enemyY", { name: "enemyY" });
                tracker.reference("enemyY", { name: "enemyY" });
            },
            { name: "updateEnemy", path: "/project/enemy.gml" }
        );

        tracker.withScope(
            "function",
            () => {
                tracker.declare("score", { name: "score" });
                tracker.reference("score", { name: "score" });
            },
            { name: "updateScore", path: "/project/score.gml" }
        );

        const paths = ["/project/player.gml", "/project/enemy.gml", "/project/nonexistent.gml"];
        const results = tracker.getBatchInvalidationSets(paths);

        assert.strictEqual(results.size, 3, "Should return results for all paths");
        assert.ok(results.has("/project/player.gml"), "Should have player.gml");
        assert.ok(results.has("/project/enemy.gml"), "Should have enemy.gml");
        assert.ok(results.has("/project/nonexistent.gml"), "Should have nonexistent.gml");

        const playerInvalidation = results.get("/project/player.gml");
        assert.ok(playerInvalidation, "Player invalidation set should exist");
        assert.ok(playerInvalidation.length > 0, "Player should have at least one scope to invalidate");
        assert.ok(
            playerInvalidation.some((entry) => entry.reason === "self"),
            "Should include the scope itself"
        );

        const enemyInvalidation = results.get("/project/enemy.gml");
        assert.ok(enemyInvalidation, "Enemy invalidation set should exist");
        assert.ok(enemyInvalidation.length > 0, "Enemy should have at least one scope to invalidate");

        const nonexistentInvalidation = results.get("/project/nonexistent.gml");
        assert.ok(nonexistentInvalidation, "Nonexistent invalidation set should exist");
        assert.strictEqual(nonexistentInvalidation.length, 0, "Nonexistent path should have empty invalidation set");
    });

    void it("deduplicates scopes across multiple scopes in the same file", () => {
        const tracker = new ScopeTracker({ enabled: true });

        const programScope = tracker.enterScope("program", { path: "/project/utils.gml" });

        const scope1 = tracker.enterScope("function", { name: "helper1", path: "/project/utils.gml" });
        tracker.declare("temp", { name: "temp" });
        tracker.exitScope();

        const scope2 = tracker.enterScope("function", { name: "helper2", path: "/project/utils.gml" });
        tracker.declare("value", { name: "value" });
        tracker.exitScope();

        tracker.enterScope("function", { name: "caller", path: "/project/caller.gml" });
        tracker.reference("temp", { name: "temp" });
        tracker.reference("value", { name: "value" });
        tracker.exitScope();

        const results = tracker.getBatchInvalidationSets(["/project/utils.gml"]);

        assert.strictEqual(results.size, 1, "Should return one result");

        const utilsInvalidation = results.get("/project/utils.gml");
        assert.ok(utilsInvalidation, "Utils invalidation set should exist");

        const scopeIds = new Set(utilsInvalidation.map((entry) => entry.scopeId));
        assert.ok(
            scopeIds.has(scope1.id) || scopeIds.has(scope2.id) || scopeIds.has(programScope.id),
            "Should include at least one scope"
        );

        const selfEntries = utilsInvalidation.filter((entry) => entry.reason === "self");
        assert.ok(selfEntries.length > 0, "Should include self scopes");
    });

    void it("handles includeDescendants option correctly", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/main.gml" });

        tracker.withScope(
            "function",
            () => {
                tracker.withScope(
                    "block",
                    () => {
                        tracker.declare("nested", { name: "nested" });
                    },
                    { name: "nestedBlock" }
                );
            },
            { name: "parentFunction", path: "/project/main.gml" }
        );

        const resultsWithoutDescendants = tracker.getBatchInvalidationSets(["/project/main.gml"], {
            includeDescendants: false
        });

        const resultsWithDescendants = tracker.getBatchInvalidationSets(["/project/main.gml"], {
            includeDescendants: true
        });

        const withoutDescendantsList = resultsWithoutDescendants.get("/project/main.gml");
        const withDescendantsList = resultsWithDescendants.get("/project/main.gml");

        assert.ok(withoutDescendantsList, "Without descendants should exist");
        assert.ok(withDescendantsList, "With descendants should exist");
        assert.ok(
            withDescendantsList.length > withoutDescendantsList.length,
            "With descendants should have more scopes"
        );

        const descendantEntries = withDescendantsList.filter((entry) => entry.reason === "descendant");
        assert.ok(descendantEntries.length > 0, "Should have descendant scopes when requested");
    });

    void it("ignores duplicate input paths without changing invalidation output", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/root.gml" });
        tracker.withScope(
            "function",
            () => {
                tracker.declare("shared", { name: "shared" });
            },
            { path: "/project/shared.gml" }
        );

        const uniqueResults = tracker.getBatchInvalidationSets(["/project/shared.gml"]);
        const duplicateResults = tracker.getBatchInvalidationSets([
            "/project/shared.gml",
            "/project/shared.gml",
            "/project/shared.gml"
        ]);

        assert.strictEqual(duplicateResults.size, 1, "Duplicate paths should produce a single map entry");
        assert.deepStrictEqual(
            duplicateResults.get("/project/shared.gml"),
            uniqueResults.get("/project/shared.gml"),
            "Duplicate paths should not alter invalidation results"
        );
    });

    void it("supports windows-style path queries against normalized scope paths", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "C:/project/root.gml" });
        tracker.withScope(
            "function",
            () => {
                tracker.declare("playerHealth", { name: "playerHealth" });
            },
            { path: "C:/project/scripts/player.gml" }
        );

        const windowsPath = String.raw`C:\project\scripts\player.gml`;
        const invalidationResults = tracker.getBatchInvalidationSets([windowsPath]);
        const scopesByPath = tracker.getScopesByPath(windowsPath);

        const invalidationSet = invalidationResults.get(windowsPath);
        assert.ok(invalidationSet, "Windows-style path should resolve invalidation entries");
        assert.ok(invalidationSet.length > 0, "Windows-style path should return at least one scope");
        assert.ok(scopesByPath.length > 0, "Windows-style path should resolve scopes by path");
    });

    void it("reuses normalized path invalidation work for mixed path separators", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "C:/project/root.gml" });
        tracker.withScope(
            "function",
            () => {
                tracker.declare("playerHealth", { name: "playerHealth" });
            },
            { path: "C:/project/scripts/player.gml" }
        );

        const originalGetTransitiveDependents = tracker.getTransitiveDependents.bind(tracker);
        let getTransitiveDependentsCallCount = 0;

        tracker.getTransitiveDependents = (...arguments_) => {
            getTransitiveDependentsCallCount += 1;
            return originalGetTransitiveDependents(...arguments_);
        };

        const windowsPath = String.raw`C:\project\scripts\player.gml`;
        const posixPath = "C:/project/scripts/player.gml";

        const results = tracker.getBatchInvalidationSets([windowsPath, posixPath]);

        assert.strictEqual(
            getTransitiveDependentsCallCount,
            1,
            "Equivalent normalized paths should compute transitive dependents only once"
        );
        assert.deepStrictEqual(
            results.get(windowsPath),
            results.get(posixPath),
            "Equivalent normalized paths should produce identical invalidation entries"
        );
    });

    void it("reuses the canonical empty invalidation set for missing normalized paths", () => {
        const tracker = new ScopeTracker({ enabled: true });

        const windowsPath = String.raw`\project\missing.gml`;
        const posixPath = "/project/missing.gml";
        const results = tracker.getBatchInvalidationSets([windowsPath, posixPath]);

        const windowsResults = results.get(windowsPath);
        const posixResults = results.get(posixPath);

        assert.ok(windowsResults, "Windows path result should exist");
        assert.ok(posixResults, "POSIX path result should exist");
        assert.strictEqual(
            windowsResults,
            posixResults,
            "Missing normalized paths should share one empty result array"
        );
        assert.strictEqual(windowsResults.length, 0, "Missing normalized path result should be empty");
    });

    void it("handles empty input gracefully", () => {
        const tracker = new ScopeTracker({ enabled: true });

        const results = tracker.getBatchInvalidationSets([]);

        assert.strictEqual(results.size, 0, "Empty input should return empty map");
    });

    void it("handles invalid path inputs gracefully", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/valid.gml" });
        tracker.declare("x", { name: "x" });

        const results = tracker.getBatchInvalidationSets(["", null, undefined, "/project/valid.gml"]);

        assert.ok(results.has("/project/valid.gml"), "Should process valid path");
        const validResults = results.get("/project/valid.gml");
        assert.ok(validResults && validResults.length > 0, "Valid path should have results");
    });

    void it("matches individual invalidation results while keeping batch latency bounded", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/root.gml" });

        const paths = [];
        for (let i = 0; i < 50; i++) {
            const filePath = `/project/file${i}.gml`;
            paths.push(filePath);

            tracker.withScope(
                "function",
                () => {
                    tracker.declare(`var${i}`, { name: `var${i}` });
                },
                { name: `func${i}`, path: filePath }
            );
        }

        const startBatch = performance.now();
        const batchResults = tracker.getBatchInvalidationSets(paths);
        const batchTime = performance.now() - startBatch;

        const individualResults = new Map<string, Array<InvalidationEntry>>();
        for (const path of paths) {
            const scopes = tracker.getScopesByPath(path);
            const seenScopes = new Set<string>();
            const mergedResults: Array<InvalidationEntry> = [];
            for (const scope of scopes) {
                const invalidationSet = tracker.getInvalidationSet(scope.scopeId);
                for (const entry of invalidationSet) {
                    if (seenScopes.has(entry.scopeId)) {
                        continue;
                    }

                    seenScopes.add(entry.scopeId);
                    mergedResults.push(entry);
                }
            }

            individualResults.set(path, mergedResults);
        }

        assert.ok(batchTime < 250, `Batch should complete in < 250ms, took ${batchTime.toFixed(2)}ms`);
        assert.strictEqual(batchResults.size, paths.length, "Should process all paths");
        for (const path of paths) {
            const batchSet = batchResults.get(path) ?? [];
            const individualSet = individualResults.get(path) ?? [];
            assert.deepStrictEqual(
                normalizeInvalidationEntries(batchSet),
                normalizeInvalidationEntries(individualSet),
                `Batch invalidation should match merged individual invalidation for ${path}`
            );
        }
    });

    void it("maintains correct scope metadata in results", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/app.gml" });

        const scope = tracker.enterScope("function", { name: "initialize", path: "/project/app.gml" });
        tracker.declare("initialized", { name: "initialized" });
        tracker.exitScope();

        const results = tracker.getBatchInvalidationSets(["/project/app.gml"]);

        const appInvalidation = results.get("/project/app.gml");
        assert.ok(appInvalidation, "Should have invalidation set");

        const functionEntry = appInvalidation.find((entry) => entry.scopeId === scope.id);
        assert.ok(functionEntry, "Should find the function scope");
        assert.strictEqual(functionEntry.scopeKind, "function", "Should preserve scope kind");
        assert.strictEqual(functionEntry.reason, "self", "Should mark as self");
    });

    void it("processes paths in deterministic order", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/a.gml" });
        tracker.withScope(
            "function",
            () => {
                tracker.declare("x", { name: "x" });
            },
            { path: "/project/a.gml" }
        );

        tracker.withScope(
            "function",
            () => {
                tracker.declare("y", { name: "y" });
            },
            { path: "/project/b.gml" }
        );

        const paths = ["/project/b.gml", "/project/a.gml"];
        const results1 = tracker.getBatchInvalidationSets(paths);
        const results2 = tracker.getBatchInvalidationSets(paths);

        assert.deepStrictEqual(
            Array.from(results1.keys()),
            Array.from(results2.keys()),
            "Keys should be in same order"
        );

        for (const path of paths) {
            const list1 = results1.get(path);
            const list2 = results2.get(path);
            assert.deepStrictEqual(list1, list2, `Results for ${path} should be identical`);
        }
    });
});
