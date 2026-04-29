import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ScopeTracker } from "../src/scopes/scope-tracker.js";

/**
 * Tests for `ScopeTracker.getFilePathsDeclaringSymbol`.
 *
 * The method is the declaration-side counterpart to
 * `getFilePathsReferencingSymbol` and is used by hot-reload pipelines to
 * identify which source files must be re-analysed when a symbol's definition
 * needs refreshing.
 */
void describe("ScopeTracker.getFilePathsDeclaringSymbol", () => {
    void it("returns empty set for null or undefined name", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", { path: "/project/foo.gml" });
        tracker.declare("x", { name: "x" });

        assert.equal(tracker.getFilePathsDeclaringSymbol(null).size, 0);
        assert.equal(tracker.getFilePathsDeclaringSymbol(undefined).size, 0);
    });

    void it("returns empty set when tracker is disabled", () => {
        const tracker = new ScopeTracker({ enabled: false });

        assert.equal(tracker.getFilePathsDeclaringSymbol("x").size, 0);
    });

    void it("returns empty set for an unknown symbol", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program", { path: "/project/foo.gml" });
        tracker.declare("y", { name: "y" });

        assert.equal(tracker.getFilePathsDeclaringSymbol("unknown").size, 0);
    });

    void it("returns the path of the scope that declares the symbol", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: "/project/scripts/helper.gml" });
        tracker.declare("helperFn", { name: "helperFn" });
        tracker.exitScope();

        const paths = tracker.getFilePathsDeclaringSymbol("helperFn");

        assert.equal(paths.size, 1);
        assert.ok(paths.has("/project/scripts/helper.gml"));
    });

    void it("does not include files that only reference the symbol", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // File that declares the symbol
        tracker.enterScope("file", { path: "/project/scripts/helper.gml" });
        tracker.declare("helperFn", { name: "helperFn" });
        tracker.exitScope();

        // File that only references the symbol
        tracker.enterScope("file", { path: "/project/objects/obj_player.gml" });
        tracker.reference("helperFn", { name: "helperFn" });
        tracker.exitScope();

        const declaringPaths = tracker.getFilePathsDeclaringSymbol("helperFn");

        assert.equal(declaringPaths.size, 1);
        assert.ok(declaringPaths.has("/project/scripts/helper.gml"), "Should include declaring file");
        assert.ok(!declaringPaths.has("/project/objects/obj_player.gml"), "Should not include reference-only file");
    });

    void it("returns multiple paths when the symbol is declared in more than one file", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: "/project/scripts/a.gml" });
        tracker.declare("shared", { name: "shared" });
        tracker.exitScope();

        tracker.enterScope("file", { path: "/project/scripts/b.gml" });
        tracker.declare("shared", { name: "shared" });
        tracker.exitScope();

        const paths = tracker.getFilePathsDeclaringSymbol("shared");

        assert.equal(paths.size, 2);
        assert.ok(paths.has("/project/scripts/a.gml"));
        assert.ok(paths.has("/project/scripts/b.gml"));
    });

    void it("normalizes backslash path separators to forward slashes", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: String.raw`C:\project\scripts\helper.gml` });
        tracker.declare("fn", { name: "fn" });
        tracker.exitScope();

        const paths = tracker.getFilePathsDeclaringSymbol("fn");

        assert.equal(paths.size, 1);
        assert.ok(paths.has("C:/project/scripts/helper.gml"), "Should normalize backslashes");
    });

    void it("skips scopes that have no path metadata", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // Anonymous scope with no path
        tracker.enterScope("block");
        tracker.declare("localVar", { name: "localVar" });
        tracker.exitScope();

        const paths = tracker.getFilePathsDeclaringSymbol("localVar");

        assert.equal(paths.size, 0, "Scopes without path should not contribute file paths");
    });

    void it("complements getFilePathsReferencingSymbol for hot-reload impact analysis", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // Symbol declared in one file, referenced in two others
        tracker.enterScope("file", { path: "/src/scripts/scr_util.gml" });
        tracker.declare("utilFn", { name: "utilFn" });
        tracker.exitScope();

        tracker.enterScope("file", { path: "/src/objects/obj_a/Create_0.gml" });
        tracker.reference("utilFn", { name: "utilFn" });
        tracker.exitScope();

        tracker.enterScope("file", { path: "/src/objects/obj_b/Step_0.gml" });
        tracker.reference("utilFn", { name: "utilFn" });
        tracker.exitScope();

        const declaringPaths = tracker.getFilePathsDeclaringSymbol("utilFn");
        const referencingPaths = tracker.getFilePathsReferencingSymbol("utilFn");

        // Declaration side: only the script file
        assert.equal(declaringPaths.size, 1);
        assert.ok(declaringPaths.has("/src/scripts/scr_util.gml"));

        // Reference side: both object event files
        assert.equal(referencingPaths.size, 2);
        assert.ok(referencingPaths.has("/src/objects/obj_a/Create_0.gml"));
        assert.ok(referencingPaths.has("/src/objects/obj_b/Step_0.gml"));

        // The declaring file is not in the referencing set (it only declares)
        assert.ok(!referencingPaths.has("/src/scripts/scr_util.gml"));
    });
});

void describe("ScopeTracker.getBatchFilePathsDeclaringSymbols", () => {
    void it("returns declaration paths for multiple symbols and omits missing declarations", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: "/project/scripts/a.gml" });
        tracker.declare("alpha", { name: "alpha" });
        tracker.declare("beta", { name: "beta" });
        tracker.exitScope();

        tracker.enterScope("file", { path: "/project/scripts/b.gml" });
        tracker.declare("alpha", { name: "alpha" });
        tracker.reference("beta", { name: "beta" });
        tracker.exitScope();

        const results = tracker.getBatchFilePathsDeclaringSymbols(["alpha", "beta", "unknown"]);

        assert.deepEqual([...(results.get("alpha") ?? [])], ["/project/scripts/a.gml", "/project/scripts/b.gml"]);
        assert.deepEqual([...(results.get("beta") ?? [])], ["/project/scripts/a.gml"]);
        assert.equal(results.has("unknown"), false);
    });

    void it("deduplicates repeated names, normalizes paths, and returns empty map when disabled", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: String.raw`C:\project\scripts\util.gml` });
        tracker.declare("util", { name: "util" });
        tracker.exitScope();

        const enabledResults = tracker.getBatchFilePathsDeclaringSymbols(["util", "util", ""]);
        assert.deepEqual([...(enabledResults.get("util") ?? [])], ["C:/project/scripts/util.gml"]);

        const disabledTracker = new ScopeTracker({ enabled: false });
        const disabledResults = disabledTracker.getBatchFilePathsDeclaringSymbols(["util"]);
        assert.equal(disabledResults.size, 0);
    });

    void it("accepts Set inputs for declaration symbol batches", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: "/project/scripts/shared.gml" });
        tracker.declare("alpha", { name: "alpha" });
        tracker.declare("beta", { name: "beta" });
        tracker.exitScope();

        const symbolSet = new Set(["alpha", "beta"]);
        const results = tracker.getBatchFilePathsDeclaringSymbols(symbolSet);

        assert.deepEqual([...(results.get("alpha") ?? [])], ["/project/scripts/shared.gml"]);
        assert.deepEqual([...(results.get("beta") ?? [])], ["/project/scripts/shared.gml"]);
    });

    void it("reuses normalized-path computations across declaration symbol batches", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: String.raw`C:\project\scripts\shared.gml` });
        tracker.declare("alpha", { name: "alpha" });
        tracker.declare("beta", { name: "beta" });
        tracker.exitScope();

        tracker.enterScope("file", { path: String.raw`C:\project\scripts\extra.gml` });
        tracker.declare("beta", { name: "beta" });
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

        const results = tracker.getBatchFilePathsDeclaringSymbols(["alpha", "beta"]);

        Object.defineProperty(tracker, "normalizeTrackedPath", {
            value: originalNormalizeTrackedPath,
            configurable: true
        });

        assert.deepEqual([...(results.get("alpha") ?? [])], ["C:/project/scripts/shared.gml"]);
        assert.deepEqual(
            [...(results.get("beta") ?? [])],
            ["C:/project/scripts/shared.gml", "C:/project/scripts/extra.gml"]
        );
        assert.equal(repeatedPathNormalizations, 0, "each source path should be normalized at most once per batch");
    });
});
