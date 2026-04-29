import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ScopeTracker } from "../src/scopes/scope-tracker.js";

const delay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

void describe("ScopeTracker: getFilePathsReferencingSymbol", () => {
    void it("returns empty set for null symbol name", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", { path: "/project/a.gml" });
        tracker.declare("x", { name: "x" });

        assert.equal(tracker.getFilePathsReferencingSymbol(null).size, 0);
    });

    void it("returns empty set for undefined symbol name", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", { path: "/project/a.gml" });
        tracker.declare("x", { name: "x" });

        assert.equal(tracker.getFilePathsReferencingSymbol(undefined).size, 0);
    });

    void it("returns empty set when tracker is disabled", () => {
        const tracker = new ScopeTracker({ enabled: false });

        assert.equal(tracker.getFilePathsReferencingSymbol("x").size, 0);
    });

    void it("returns empty set for unknown symbol", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", { path: "/project/a.gml" });
        tracker.declare("x", { name: "x" });

        assert.equal(tracker.getFilePathsReferencingSymbol("unknown").size, 0);
    });

    void it("excludes scopes that only declare the symbol without referencing it", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", { path: "/project/lib.gml" });
        tracker.declare("helper", { name: "helper" });

        const paths = tracker.getFilePathsReferencingSymbol("helper");
        assert.equal(paths.size, 0, "Declaring file must not appear unless it also references the symbol");
    });

    void it("returns the path for a scope that references the symbol", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/lib.gml" });
        tracker.declare("helper", { name: "helper" });
        tracker.exitScope();

        tracker.enterScope("program", { path: "/project/consumer.gml" });
        tracker.reference("helper", { name: "helper" });
        tracker.exitScope();

        const paths = tracker.getFilePathsReferencingSymbol("helper");
        assert.equal(paths.size, 1);
        assert.ok(paths.has("/project/consumer.gml"), "Should include file that references the symbol");
        assert.ok(!paths.has("/project/lib.gml"), "Should not include file that only declares");
    });

    void it("collects multiple referencing file paths", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/lib.gml" });
        tracker.declare("util", { name: "util" });
        tracker.exitScope();

        for (const file of ["a", "b", "c"]) {
            tracker.enterScope("program", { path: `/project/${file}.gml` });
            tracker.reference("util", { name: "util" });
            tracker.exitScope();
        }

        const paths = tracker.getFilePathsReferencingSymbol("util");
        assert.equal(paths.size, 3);
        assert.ok(paths.has("/project/a.gml"));
        assert.ok(paths.has("/project/b.gml"));
        assert.ok(paths.has("/project/c.gml"));
        assert.ok(!paths.has("/project/lib.gml"), "Declaring file excluded");
    });

    void it("deduplicates when multiple scopes in the same file reference the symbol", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/lib.gml" });
        tracker.declare("shared", { name: "shared" });
        tracker.exitScope();

        // Two separate scopes in the same file both reference the symbol
        tracker.enterScope("program", { path: "/project/consumer.gml" });
        tracker.reference("shared", { name: "shared" });
        tracker.exitScope();

        tracker.enterScope("function", { path: "/project/consumer.gml" });
        tracker.reference("shared", { name: "shared" });
        tracker.exitScope();

        const paths = tracker.getFilePathsReferencingSymbol("shared");
        assert.equal(paths.size, 1, "Multiple scopes in the same file should produce one path entry");
        assert.ok(paths.has("/project/consumer.gml"));
    });

    void it("normalizes file paths with mixed separators for reference exports", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: String.raw`project\lib.gml` });
        tracker.declare("shared", { name: "shared" });
        tracker.exitScope();

        tracker.enterScope("program", { path: String.raw`project\scripts\consumer.gml` });
        tracker.reference("shared", { name: "shared" });
        tracker.exitScope();

        tracker.enterScope("function", { path: "project/scripts/consumer.gml" });
        tracker.reference("shared", { name: "shared" });
        tracker.exitScope();

        const paths = tracker.getFilePathsReferencingSymbol("shared");

        assert.deepEqual([...paths], ["project/scripts/consumer.gml"]);
    });

    void it("skips scopes without path metadata", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/lib.gml" });
        tracker.declare("sym", { name: "sym" });
        tracker.exitScope();

        // This scope has no path metadata
        tracker.enterScope("function");
        tracker.reference("sym", { name: "sym" });
        tracker.exitScope();

        const paths = tracker.getFilePathsReferencingSymbol("sym");
        assert.equal(paths.size, 0, "Scopes without path metadata must not produce file paths");
    });

    void it("returns a new independent Set on each call", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", { path: "/project/lib.gml" });
        tracker.declare("x", { name: "x" });
        tracker.exitScope();

        tracker.enterScope("program", { path: "/project/a.gml" });
        tracker.reference("x", { name: "x" });
        tracker.exitScope();

        const result1 = tracker.getFilePathsReferencingSymbol("x");
        const result2 = tracker.getFilePathsReferencingSymbol("x");

        result1.add("/project/injected.gml");

        assert.ok(!result2.has("/project/injected.gml"), "Results should be independent Sets");
    });
});

void describe("ScopeTracker: getBatchFilePathsReferencingSymbols", () => {
    void it("returns referencing paths for multiple symbols and omits non-referenced symbols", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/lib.gml" });
        tracker.declare("alpha", { name: "alpha" });
        tracker.declare("beta", { name: "beta" });
        tracker.exitScope();

        tracker.enterScope("program", { path: "/project/a.gml" });
        tracker.reference("alpha", { name: "alpha" });
        tracker.exitScope();

        tracker.enterScope("program", { path: "/project/b.gml" });
        tracker.reference("alpha", { name: "alpha" });
        tracker.reference("beta", { name: "beta" });
        tracker.exitScope();

        const results = tracker.getBatchFilePathsReferencingSymbols(["alpha", "beta", "gamma"]);

        assert.deepEqual([...(results.get("alpha") ?? [])], ["/project/a.gml", "/project/b.gml"]);
        assert.deepEqual([...(results.get("beta") ?? [])], ["/project/b.gml"]);
        assert.equal(results.has("gamma"), false);
    });

    void it("deduplicates repeated symbol names and respects disabled trackers", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/lib.gml" });
        tracker.declare("shared", { name: "shared" });
        tracker.exitScope();

        tracker.enterScope("program", { path: String.raw`project\consumer.gml` });
        tracker.reference("shared", { name: "shared" });
        tracker.exitScope();

        const enabledResults = tracker.getBatchFilePathsReferencingSymbols(["shared", "shared", ""]);
        assert.deepEqual([...(enabledResults.get("shared") ?? [])], ["project/consumer.gml"]);

        const disabledTracker = new ScopeTracker({ enabled: false });
        const disabledResults = disabledTracker.getBatchFilePathsReferencingSymbols(["shared"]);
        assert.equal(disabledResults.size, 0);
    });

    void it("accepts Set inputs for symbol batches", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/lib.gml" });
        tracker.declare("alpha", { name: "alpha" });
        tracker.declare("beta", { name: "beta" });
        tracker.exitScope();

        tracker.enterScope("program", { path: "/project/consumer.gml" });
        tracker.reference("alpha", { name: "alpha" });
        tracker.reference("beta", { name: "beta" });
        tracker.exitScope();

        const symbolSet = new Set(["alpha", "beta"]);
        const results = tracker.getBatchFilePathsReferencingSymbols(symbolSet);

        assert.deepEqual([...(results.get("alpha") ?? [])], ["/project/consumer.gml"]);
        assert.deepEqual([...(results.get("beta") ?? [])], ["/project/consumer.gml"]);
    });

    void it("reuses normalized-path computations across symbol batches", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: String.raw`project\shared\consumer.gml` });
        tracker.reference("alpha", { name: "alpha" });
        tracker.reference("beta", { name: "beta" });
        tracker.exitScope();

        tracker.enterScope("program", { path: String.raw`project\shared\other.gml` });
        tracker.reference("beta", { name: "beta" });
        tracker.exitScope();

        const trackerPrototype = Object.getPrototypeOf(tracker) as {
            normalizeTrackedPath(path: string): string;
        };
        const originalNormalizeTrackedPath = trackerPrototype.normalizeTrackedPath.bind(tracker);
        const seenInputs = new Set<string>();
        let repeatedPathNormalizations = 0;
        Object.defineProperty(tracker, "normalizeTrackedPath", {
            value: (path: string): string => {
                if (seenInputs.has(path)) {
                    repeatedPathNormalizations += 1;
                } else {
                    seenInputs.add(path);
                }
                return originalNormalizeTrackedPath(path);
            },
            configurable: true
        });

        const results = tracker.getBatchFilePathsReferencingSymbols(["alpha", "beta"]);

        Object.defineProperty(tracker, "normalizeTrackedPath", {
            value: originalNormalizeTrackedPath,
            configurable: true
        });

        assert.deepEqual([...(results.get("alpha") ?? [])], ["project/shared/consumer.gml"]);
        assert.deepEqual([...(results.get("beta") ?? [])], ["project/shared/consumer.gml", "project/shared/other.gml"]);
        assert.equal(repeatedPathNormalizations, 0, "each source path should be normalized at most once per batch");
    });
});

void describe("ScopeTracker: getChangedFilePaths", () => {
    void it("returns empty set when tracker is disabled", () => {
        const tracker = new ScopeTracker({ enabled: false });

        assert.equal(tracker.getChangedFilePaths(0).size, 0);
    });

    void it("returns empty set when no scopes are modified after the given timestamp", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", { path: "/project/a.gml" });
        tracker.declare("x", { name: "x" });

        // Use a far-future timestamp
        const futureTimestamp = Date.now() + 100_000;
        assert.equal(tracker.getChangedFilePaths(futureTimestamp).size, 0);
    });

    void it("returns file paths for scopes modified after the given timestamp", async () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/a.gml" });
        tracker.declare("x", { name: "x" });
        tracker.exitScope();

        const timestamp = Date.now();
        await delay();

        tracker.enterScope("program", { path: "/project/b.gml" });
        tracker.declare("y", { name: "y" });
        tracker.exitScope();

        const paths = tracker.getChangedFilePaths(timestamp);
        assert.ok(paths.has("/project/b.gml"), "b.gml was modified after the snapshot");
        assert.ok(!paths.has("/project/a.gml"), "a.gml was modified before the snapshot");
    });

    void it("deduplicates multiple modified scopes from the same file", async () => {
        const tracker = new ScopeTracker({ enabled: true });

        const timestamp = Date.now();
        await delay();

        tracker.enterScope("program", { path: "/project/multi.gml" });
        tracker.declare("x", { name: "x" });
        tracker.exitScope();

        tracker.enterScope("function", { path: "/project/multi.gml" });
        tracker.declare("y", { name: "y" });
        tracker.exitScope();

        const paths = tracker.getChangedFilePaths(timestamp);
        assert.equal(paths.size, 1, "Multiple modified scopes in the same file yield one path");
        assert.ok(paths.has("/project/multi.gml"));
    });

    void it("skips scopes that have no path metadata", async () => {
        const tracker = new ScopeTracker({ enabled: true });

        const timestamp = Date.now();
        await delay();

        // Scope with no path (e.g., an anonymous block)
        tracker.enterScope("function");
        tracker.declare("localVar", { name: "localVar" });
        tracker.exitScope();

        const paths = tracker.getChangedFilePaths(timestamp);
        assert.equal(paths.size, 0, "Scopes without path metadata must be excluded");
    });

    void it("returns all modified file paths when sinceTimestamp is 0", async () => {
        const tracker = new ScopeTracker({ enabled: true });

        await delay();

        tracker.enterScope("program", { path: "/project/a.gml" });
        tracker.declare("x", { name: "x" });
        tracker.exitScope();

        tracker.enterScope("program", { path: "/project/b.gml" });
        tracker.declare("y", { name: "y" });
        tracker.exitScope();

        const paths = tracker.getChangedFilePaths(0);
        assert.ok(paths.has("/project/a.gml"));
        assert.ok(paths.has("/project/b.gml"));
    });

    void it("normalizes file paths with mixed separators for changed-file exports", async () => {
        const tracker = new ScopeTracker({ enabled: true });

        const timestamp = Date.now();
        await delay();

        tracker.enterScope("program", { path: String.raw`project\scripts\modified.gml` });
        tracker.declare("x", { name: "x" });
        tracker.exitScope();

        tracker.enterScope("function", { path: "project/scripts/modified.gml" });
        tracker.declare("y", { name: "y" });
        tracker.exitScope();

        const paths = tracker.getChangedFilePaths(timestamp);

        assert.deepEqual([...paths], ["project/scripts/modified.gml"]);
    });

    void it("returns a new independent Set on each call", async () => {
        const tracker = new ScopeTracker({ enabled: true });

        const timestamp = Date.now();
        await delay();

        tracker.enterScope("program", { path: "/project/a.gml" });
        tracker.declare("x", { name: "x" });
        tracker.exitScope();

        const result1 = tracker.getChangedFilePaths(timestamp);
        result1.add("/project/injected.gml");

        const result2 = tracker.getChangedFilePaths(timestamp);
        assert.ok(!result2.has("/project/injected.gml"), "Results should be independent Sets");
    });

    void it("hot-reload: only reports scopes that are actually modified", async () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/config.gml" });
        tracker.declare("MAX_HP", { name: "MAX_HP" });
        tracker.exitScope();

        const snapshotTimestamp = Date.now();
        await delay();

        tracker.enterScope("program", { path: "/project/player.gml" });
        tracker.declare("playerHealth", { name: "playerHealth" });
        tracker.reference("MAX_HP", { name: "MAX_HP" });
        tracker.exitScope();

        const changedPaths = tracker.getChangedFilePaths(snapshotTimestamp);
        assert.equal(changedPaths.size, 1, "Only player.gml should be detected as changed");
        assert.ok(changedPaths.has("/project/player.gml"));
        assert.ok(!changedPaths.has("/project/config.gml"));
    });

    void it("drops a previous path from changed-file results after metadata path moves", async () => {
        const tracker = new ScopeTracker({ enabled: true });

        const scope = tracker.enterScope("program", { path: "/project/old.gml" });
        tracker.declare("x", { name: "x" });
        tracker.exitScope();

        const snapshotTimestamp = Date.now();
        await delay();

        tracker.updateScopeMetadata(scope.id, { path: "/project/new.gml" });

        const changedPaths = tracker.getChangedFilePaths(snapshotTimestamp);
        assert.equal(changedPaths.size, 1);
        assert.ok(changedPaths.has("/project/new.gml"));
        assert.ok(!changedPaths.has("/project/old.gml"));
    });

    void it("removes cleared file paths from changed-file exports", async () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/removed.gml" });
        tracker.declare("x", { name: "x" });
        tracker.exitScope();

        const snapshotTimestamp = Date.now();
        await delay();

        const removedCount = tracker.clearScopesForPath("/project/removed.gml");
        assert.ok(removedCount > 0);

        const changedPaths = tracker.getChangedFilePaths(snapshotTimestamp);
        assert.equal(changedPaths.size, 0);
    });
});

void describe("ScopeTracker: file-path query integration for hot reload", () => {
    void it("combines getChangedFilePaths and getFilePathsReferencingSymbol for invalidation", async () => {
        const tracker = new ScopeTracker({ enabled: true });

        // Simulate initial project state
        tracker.enterScope("program", { path: "/project/utils.gml" });
        tracker.declare("computeScore", { name: "computeScore" });
        tracker.exitScope();

        tracker.enterScope("program", { path: "/project/hud.gml" });
        tracker.reference("computeScore", { name: "computeScore" });
        tracker.exitScope();

        tracker.enterScope("program", { path: "/project/leaderboard.gml" });
        tracker.reference("computeScore", { name: "computeScore" });
        tracker.exitScope();

        const snapshotTimestamp = Date.now();
        await delay();

        // Simulate re-analysing utils.gml after an edit
        tracker.enterScope("program", { path: "/project/utils.gml" });
        tracker.declare("computeScore", { name: "computeScore" });
        tracker.declare("resetScore", { name: "resetScore" });
        tracker.exitScope();

        // Step 1: detect which files were re-analysed
        const changedFiles = tracker.getChangedFilePaths(snapshotTimestamp);
        assert.ok(changedFiles.has("/project/utils.gml"), "utils.gml should be detected as changed");

        // Step 2: find all files that reference symbols declared in the changed files
        const dependents = tracker.getFilePathsReferencingSymbol("computeScore");
        assert.ok(dependents.has("/project/hud.gml"), "hud.gml references computeScore");
        assert.ok(dependents.has("/project/leaderboard.gml"), "leaderboard.gml references computeScore");
    });
});
