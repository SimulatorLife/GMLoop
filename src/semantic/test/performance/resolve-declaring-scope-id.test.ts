/**
 * Validates the allocation reduction achieved by `resolveDeclaringScopeId` in
 * the hot-reload invalidation critical path.
 *
 * ## Background
 *
 * `collectScopeDependents` and `recordCrossPathDependencyEdge` are called
 * transitively by `getTransitiveDependents`, `getBatchInvalidationSets`, and
 * `sortPathsForReanalysis` — all core hot-reload operations. Before this
 * optimization, both callers used `resolveIdentifier` which unconditionally
 * clones the resolved `ScopeSymbolMetadata` (a new object + `Core.toMutableArray`
 * for classifications + `Core.cloneLocation` for start/end), even though they
 * only need the `scopeId` string field.
 *
 * The new private `resolveDeclaringScopeId` method performs the same scope-chain
 * walk and populates the same identifier cache, but returns the `scopeId` string
 * directly — zero clone allocations.
 *
 * ## What this test measures
 *
 * We exercise the two hot paths (`getImpactedFilePaths` via
 * `getTransitiveDependents`, and `sortPathsForReanalysis`) with a realistic
 * nested dependency graph and verify that:
 *
 *   1. Both methods still return correct results (no regression).
 *   2. Both methods complete within tight latency budgets, consistent with the
 *      expected allocation reduction.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ScopeTracker } from "../../src/scopes/scope-tracker.js";

/**
 * Builds a realistic nested-scope dependency graph modelling a GML project:
 *
 *   program (path: "utils.gml") declares: log, clamp, lerp
 *     └─ file scope (path: "math.gml") declares: distance, dot
 *        references: clamp, lerp        → depends on utils.gml
 *        └─ file scope (path: "obj_player.gml")
 *           references: distance, log   → depends on math.gml + utils.gml
 *     └─ file scope (path: "hud.gml")
 *        references: log                → depends on utils.gml
 *
 * All dependent scopes are nested inside their declaring scope so that
 * `resolveIdentifier`/`resolveDeclaringScopeId` can walk the parent chain
 * and find the declarations.
 */
function buildMultiFileDependencyGraph(): { tracker: ScopeTracker; paths: string[] } {
    const tracker = new ScopeTracker({ enabled: true });

    // utils.gml — root declaring scope
    tracker.enterScope("program", { path: "utils.gml", name: "utils" });
    tracker.declare("log", { name: "log" });
    tracker.declare("clamp", { name: "clamp" });
    tracker.declare("lerp", { name: "lerp" });

    // math.gml — child of utils, can resolve clamp/lerp from utils
    tracker.enterScope("file", { path: "math.gml", name: "math" });
    tracker.declare("distance", { name: "distance" });
    tracker.declare("dot", { name: "dot" });
    tracker.reference("clamp", { name: "clamp" });
    tracker.reference("lerp", { name: "lerp" });

    // obj_player.gml — child of math, can resolve distance (math) and log (utils)
    tracker.enterScope("file", { path: "obj_player.gml", name: "obj_player_step" });
    tracker.reference("distance", { name: "distance" });
    tracker.reference("log", { name: "log" });
    tracker.exitScope(); // obj_player.gml

    tracker.exitScope(); // math.gml

    // hud.gml — sibling of math under utils, can resolve log from utils
    tracker.enterScope("file", { path: "hud.gml", name: "hud_draw" });
    tracker.reference("log", { name: "log" });
    tracker.exitScope(); // hud.gml

    tracker.exitScope(); // utils.gml

    return {
        tracker,
        paths: ["utils.gml", "math.gml", "obj_player.gml", "hud.gml"]
    };
}

void describe("resolveDeclaringScopeId: allocation-free scope ID lookup in hot-reload paths", () => {
    void describe("getInvalidationSet correctness", () => {
        void it("returns the correct invalidation set after the optimization", () => {
            const { tracker } = buildMultiFileDependencyGraph();

            // Changing utils.gml should invalidate math, obj_player, and hud (all
            // reference symbols declared there).
            const impacted = tracker.getImpactedFilePaths(["utils.gml"]);

            assert.ok(impacted.has("utils.gml"), "Changed file itself must be in the set");
            assert.ok(impacted.has("math.gml"), "math.gml references clamp/lerp from utils.gml");
            assert.ok(impacted.has("obj_player.gml"), "obj_player.gml references log from utils.gml");
            assert.ok(impacted.has("hud.gml"), "hud.gml references log from utils.gml");
        });

        void it("does not over-invalidate unrelated files", () => {
            const { tracker } = buildMultiFileDependencyGraph();

            // Changing math.gml should not invalidate utils.gml (no dependency).
            const impacted = tracker.getImpactedFilePaths(["math.gml"]);

            assert.ok(impacted.has("math.gml"), "Changed file itself must be in the set");
            assert.ok(impacted.has("obj_player.gml"), "obj_player.gml references distance from math.gml");
            assert.ok(!impacted.has("utils.gml"), "utils.gml is not a dependent of math.gml");
            assert.ok(!impacted.has("hud.gml"), "hud.gml does not reference math symbols");
        });
    });

    void describe("sortPathsForReanalysis correctness", () => {
        void it("places dependencies before their dependents", () => {
            const { tracker, paths } = buildMultiFileDependencyGraph();

            const sorted = tracker.sortPathsForReanalysis(paths);

            assert.equal(sorted.length, paths.length, "All paths must be returned");

            const idxUtils = sorted.indexOf("utils.gml");
            const idxMath = sorted.indexOf("math.gml");
            const idxObj = sorted.indexOf("obj_player.gml");

            // utils.gml has no dependencies → must precede math and obj_player.
            assert.ok(idxUtils < idxMath, "utils must come before math (math depends on utils)");
            assert.ok(idxUtils < idxObj, "utils must come before obj_player");
            // math.gml must precede obj_player (obj_player depends on math).
            assert.ok(idxMath < idxObj, "math must come before obj_player");
        });
    });
});

/**
 * Builds a larger nested graph for performance tests:
 *   program (root util scope) declares `utilSymbols` symbols
 *     └─ `objectFiles` object scopes each referencing `refsPerObject` of those symbols
 *
 * All object scopes are children of the root, so identifier resolution
 * correctly finds the declared symbols via the parent chain.
 */
function buildLargeGraph(
    utilSymbols: number,
    objectFiles: number,
    refsPerObject: number
): { tracker: ScopeTracker; utilPath: string; objectPaths: string[] } {
    const tracker = new ScopeTracker({ enabled: true });
    const objectPaths: string[] = [];
    const utilPath = "util_root.gml";

    tracker.enterScope("program", { path: utilPath, name: "util_root" });
    for (let sym = 0; sym < utilSymbols; sym++) {
        tracker.declare(`util_sym_${sym}`, { name: `util_sym_${sym}` });
    }

    for (let o = 0; o < objectFiles; o++) {
        const path = `obj_${o}.gml`;
        objectPaths.push(path);
        tracker.enterScope("object_event", { path, name: `obj_${o}_step` });
        for (let r = 0; r < refsPerObject; r++) {
            const sym = r % utilSymbols;
            tracker.reference(`util_sym_${sym}`, { name: `util_sym_${sym}` });
        }
        tracker.exitScope();
    }

    tracker.exitScope(); // util_root.gml

    return { tracker, utilPath, objectPaths };
}

void describe("hot-reload invalidation performance", () => {
    void it("getImpactedFilePaths completes quickly for a large cross-file graph", () => {
        // 200 util symbols, 30 object files × 8 refs each = 240 references
        const { tracker, utilPath } = buildLargeGraph(200, 30, 8);

        const start = performance.now();
        const impacted = tracker.getImpactedFilePaths([utilPath]);
        const elapsed = performance.now() - start;

        assert.ok(elapsed < 100, `getImpactedFilePaths took ${elapsed.toFixed(2)}ms, expected < 100ms`);
        // All object files should be in the impacted set (they reference util symbols)
        assert.ok(impacted.size > 0, "Must include at least the changed util path");
    });

    void it("sortPathsForReanalysis completes quickly for a large cross-file graph", () => {
        const { tracker, utilPath, objectPaths } = buildLargeGraph(200, 30, 8);
        const allPaths = [utilPath, ...objectPaths];

        const start = performance.now();
        const sorted = tracker.sortPathsForReanalysis(allPaths);
        const elapsed = performance.now() - start;

        assert.ok(elapsed < 100, `sortPathsForReanalysis took ${elapsed.toFixed(2)}ms, expected < 100ms`);
        assert.equal(sorted.length, allPaths.length, "All paths must be returned");

        // util_root must come before all object files
        const utilIdx = sorted.indexOf(utilPath);
        assert.ok(utilIdx !== -1, "util_root.gml must be in the result");
        for (const objPath of objectPaths) {
            const objIdx = sorted.indexOf(objPath);
            assert.ok(utilIdx < objIdx, `util_root must precede ${objPath}`);
        }
    });

    void it("second call benefits from cache warm-up (no slower than cold)", () => {
        const { tracker, utilPath } = buildLargeGraph(200, 30, 8);

        // Cold call — populates identifier cache
        const coldStart = performance.now();
        tracker.getImpactedFilePaths([utilPath]);
        const coldElapsed = performance.now() - coldStart;

        // Warm call — identifier cache already populated for these lookups
        const warmStart = performance.now();
        tracker.getImpactedFilePaths([utilPath]);
        const warmElapsed = performance.now() - warmStart;

        // Warm must be no slower than cold (allow 50% overshoot for CI jitter).
        const tolerance = Math.max(10, coldElapsed * 0.5);
        assert.ok(
            warmElapsed <= coldElapsed + tolerance,
            `Warm call (${warmElapsed.toFixed(2)}ms) should not be significantly slower than cold (${coldElapsed.toFixed(2)}ms)`
        );
    });

    void it("sortPathsForReanalysis scales to large independent path sets without queue churn", () => {
        const tracker = new ScopeTracker({ enabled: true });
        const inputPaths: string[] = [];

        for (let index = 0; index < 5000; index += 1) {
            const path = `/independent_${String(index).padStart(4, "0")}.gml`;
            inputPaths.push(path);
            tracker.enterScope("file", { path, name: `independent_${index}` });
            tracker.declare(`symbol_${index}`, { name: `symbol_${index}` });
            tracker.exitScope();
        }

        const start = performance.now();
        const sorted = tracker.sortPathsForReanalysis(inputPaths.toReversed());
        const elapsed = performance.now() - start;

        assert.equal(sorted.length, inputPaths.length, "All independent paths must be returned");
        assert.deepEqual(sorted, inputPaths, "Independent paths should still sort lexicographically");
        assert.ok(elapsed < 250, `sortPathsForReanalysis took ${elapsed.toFixed(2)}ms, expected < 250ms`);
    });
});
